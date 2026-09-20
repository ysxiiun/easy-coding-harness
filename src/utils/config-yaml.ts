import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import YAML, { isScalar, isSeq, parseDocument } from "yaml";
import type { AgentPlatform } from "../types/platform.js";
import type { SupermoduleConfig } from "../types/supermodule.js";
import type { UnitTestMode } from "../types/task.js";
import { writeTextFile } from "./file-writer.js";

export const CONFIG_SCHEMA_VERSION = 6;
export const DEFAULT_UT_COVERAGE_THRESHOLD = 90;
export const UNIT_TEST_MODES = ["none", "ut", "tdd"] as const;
export const APPROVAL_MODES = ["approve", "guard", "confirm", "auto"] as const;
export const CONFIGURED_WORKFLOW_MODES = ["adaptive", "fast", "standard", "strict"] as const;
export const CONCRETE_WORKFLOW_MODES = ["fast", "standard", "strict"] as const;
export type ApprovalMode = (typeof APPROVAL_MODES)[number];
export type ConfiguredWorkflowMode = (typeof CONFIGURED_WORKFLOW_MODES)[number];
export type ConcreteWorkflowMode = (typeof CONCRETE_WORKFLOW_MODES)[number];
export type LegacyConfirmMode = ApprovalMode | "lite";

export interface EasyCodingConfig {
  version: number;
  harness_version: string;
  agents: AgentPlatform[];
  project: {
    id: string;
    name: string;
  };
  memory: {
    short_term_max: number;
    short_term_keep: number;
    schema_version: number;
  };
  tasks: {
    auto_archive_days: number;
  };
  behavior: {
    approval_mode: ApprovalMode;
    workflow_mode: ConfiguredWorkflowMode;
    unit_test_mode: UnitTestMode;
    ut_coverage_threshold: number;
  };
  supermodule?: SupermoduleConfig;
  [key: string]: unknown;
}

export function createDefaultConfig(params: {
  projectName: string;
  harnessVersion: string;
  agents: AgentPlatform[];
  supermodule?: SupermoduleConfig;
  projectId?: string;
}): EasyCodingConfig {
  const config: EasyCodingConfig = {
    version: CONFIG_SCHEMA_VERSION,
    harness_version: params.harnessVersion,
    agents: params.agents,
    project: {
      id: params.projectId ?? createProjectId(),
      name: params.projectName,
    },
    memory: {
      short_term_max: 10,
      short_term_keep: 5,
      schema_version: 2,
    },
    tasks: {
      auto_archive_days: 30,
    },
    behavior: {
      approval_mode: "guard",
      workflow_mode: "adaptive",
      unit_test_mode: "none",
      ut_coverage_threshold: DEFAULT_UT_COVERAGE_THRESHOLD,
    },
  };
  if (params.supermodule) {
    config.supermodule = params.supermodule;
  }
  return config;
}

export function stringifyConfig(config: EasyCodingConfig): string {
  return YAML.stringify(config);
}

export async function writeConfigYaml(filePath: string, config: EasyCodingConfig): Promise<void> {
  await writeTextFile(filePath, stringifyConfig(config));
}

export async function readConfigYaml(filePath: string): Promise<EasyCodingConfig> {
  const content = await readFile(filePath, "utf8");
  return YAML.parse(content) as EasyCodingConfig;
}

export async function readProjectIdIfExists(filePath: string): Promise<string | null> {
  try {
    const config = await readConfigYaml(filePath);
    return typeof config.project?.id === "string" && config.project.id.trim()
      ? config.project.id
      : null;
  } catch {
    return null;
  }
}

export async function updateConfigYaml(
  filePath: string,
  updater: (config: EasyCodingConfig) => void,
): Promise<EasyCodingConfig> {
  const content = await readFile(filePath, "utf8");
  const document = parseDocument(content);
  const config = document.toJSON() as EasyCodingConfig;
  updater(config);

  for (const [key, value] of Object.entries(config)) {
    document.set(key, value);
  }

  await writeTextFile(filePath, document.toString());
  return config;
}

export async function addAgentsToConfig(
  filePath: string,
  agents: AgentPlatform[],
): Promise<EasyCodingConfig> {
  return updateConfigYaml(filePath, (config) => {
    const merged = new Set([...(config.agents ?? []), ...agents]);
    config.agents = [...merged];
  });
}

export async function updateHarnessVersion(
  filePath: string,
  version: string,
): Promise<EasyCodingConfig> {
  return updateConfigYaml(filePath, (config) => {
    config.harness_version = version;
  });
}

export function isApprovalMode(value: unknown): value is ApprovalMode {
  return typeof value === "string" && APPROVAL_MODES.includes(value as ApprovalMode);
}

export function isConfiguredWorkflowMode(value: unknown): value is ConfiguredWorkflowMode {
  return (
    typeof value === "string" && CONFIGURED_WORKFLOW_MODES.includes(value as ConfiguredWorkflowMode)
  );
}

export function isUtCoverageThreshold(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 100;
}

export function isUnitTestMode(value: unknown): value is UnitTestMode {
  return typeof value === "string" && UNIT_TEST_MODES.includes(value as UnitTestMode);
}

/** 只在迁移边界转换旧字段，缺省的 session 值继续继承项目配置。 */
export function migrateUnitTestSettings(record: Record<string, unknown>): boolean {
  let changed = false;
  if ("tdd_enabled" in record) {
    if (!("unit_test_mode" in record) && typeof record.tdd_enabled === "boolean") {
      record.unit_test_mode = record.tdd_enabled ? "tdd" : "none";
    }
    Reflect.deleteProperty(record, "tdd_enabled");
    changed = true;
  }
  if ("tdd_coverage_threshold" in record) {
    record.ut_coverage_threshold ??= record.tdd_coverage_threshold;
    Reflect.deleteProperty(record, "tdd_coverage_threshold");
    changed = true;
  }
  return changed;
}

export function resolveLegacyBehavior(config: EasyCodingConfig): {
  approvalMode: ApprovalMode;
  workflowMode: ConfiguredWorkflowMode;
  unitTestMode: UnitTestMode;
  utCoverageThreshold: number;
} {
  const behavior = (config.behavior ?? {}) as unknown as Record<string, unknown>;
  const legacyLite = behavior.confirm_mode === "lite";
  const approvalMode = isApprovalMode(behavior.approval_mode)
    ? behavior.approval_mode
    : isApprovalMode(behavior.confirm_mode)
      ? behavior.confirm_mode
      : behavior.auto_mode === true
        ? "auto"
        : behavior.strict_confirm === true
          ? "approve"
          : "guard";
  const workflowMode = isConfiguredWorkflowMode(behavior.workflow_mode)
    ? behavior.workflow_mode
    : legacyLite
      ? "fast"
      : "adaptive";
  const unitTestMode = isUnitTestMode(behavior.unit_test_mode)
    ? behavior.unit_test_mode
    : Number(config.version) >= 4 && behavior.tdd_enabled === true
      ? "tdd"
      : "none";
  const configuredThreshold =
    behavior.ut_coverage_threshold ??
    (Number(config.version) >= 4 ? behavior.tdd_coverage_threshold : undefined);
  const utCoverageThreshold = isUtCoverageThreshold(configuredThreshold)
    ? configuredThreshold
    : DEFAULT_UT_COVERAGE_THRESHOLD;
  return { approvalMode, workflowMode, unitTestMode, utCoverageThreshold };
}

export async function setBehaviorModes(
  filePath: string,
  approvalMode: ApprovalMode,
  workflowMode: ConfiguredWorkflowMode,
  unitTestMode?: UnitTestMode,
  utCoverageThreshold?: number,
): Promise<EasyCodingConfig> {
  if (unitTestMode !== undefined && !isUnitTestMode(unitTestMode)) {
    throw new Error("Unit test mode must be none, ut, or tdd.");
  }
  if (utCoverageThreshold !== undefined && !isUtCoverageThreshold(utCoverageThreshold)) {
    throw new Error("Unit test coverage threshold must be an integer from 1 to 100.");
  }
  return updateConfigYaml(filePath, (config) => {
    const legacyBehavior = (config.behavior ?? {}) as unknown as Record<string, unknown>;
    const resolvedBehavior = resolveLegacyBehavior(config);
    const behavior = Object.fromEntries(
      Object.entries(legacyBehavior).filter(
        ([key]) =>
          key !== "strict_confirm" &&
          key !== "auto_mode" &&
          key !== "confirm_mode" &&
          key !== "approval_mode" &&
          key !== "workflow_mode" &&
          key !== "tdd_enabled" &&
          key !== "tdd_coverage_threshold" &&
          key !== "unit_test_mode" &&
          key !== "ut_coverage_threshold",
      ),
    );
    behavior.approval_mode = approvalMode;
    behavior.workflow_mode = workflowMode;
    behavior.unit_test_mode = unitTestMode ?? resolvedBehavior.unitTestMode;
    behavior.ut_coverage_threshold = utCoverageThreshold ?? resolvedBehavior.utCoverageThreshold;
    config.behavior = behavior as EasyCodingConfig["behavior"];
    config.version = CONFIG_SCHEMA_VERSION;
  });
}

export async function migrateBehaviorConfig(filePath: string): Promise<EasyCodingConfig> {
  const config = await readConfigYaml(filePath);
  const { approvalMode, workflowMode, unitTestMode, utCoverageThreshold } =
    resolveLegacyBehavior(config);
  return setBehaviorModes(filePath, approvalMode, workflowMode, unitTestMode, utCoverageThreshold);
}

/** @deprecated Use setBehaviorModes. Kept for API compatibility during the 0.9 beta. */
export async function setConfirmMode(
  filePath: string,
  mode: LegacyConfirmMode,
): Promise<EasyCodingConfig> {
  const config = await readConfigYaml(filePath);
  const { workflowMode, unitTestMode, utCoverageThreshold } = resolveLegacyBehavior(config);
  return setBehaviorModes(
    filePath,
    mode === "lite" ? "guard" : mode,
    mode === "lite" ? "fast" : workflowMode,
    unitTestMode,
    utCoverageThreshold,
  );
}

/** @deprecated Use migrateBehaviorConfig. */
export const migrateConfirmModeConfig = migrateBehaviorConfig;

export async function ensureProjectId(filePath: string): Promise<string> {
  let projectId = "";
  await updateConfigYaml(filePath, (config) => {
    if (!config.project || typeof config.project !== "object") {
      config.project = { id: createProjectId(), name: "" };
    }
    if (typeof config.project.id !== "string" || !config.project.id.trim()) {
      config.project.id = createProjectId();
    }
    projectId = config.project.id;
  });
  return projectId;
}

export async function updateSupermoduleConfig(
  filePath: string,
  supermodule: SupermoduleConfig,
): Promise<EasyCodingConfig> {
  return updateConfigYaml(filePath, (config) => {
    config.supermodule = supermodule;
  });
}

export function yamlHasAgent(documentContent: string, agent: AgentPlatform): boolean {
  const document = parseDocument(documentContent);
  const agents = document.get("agents", true);
  if (!isSeq(agents)) {
    return false;
  }
  return agents.items.some((item) => isScalar(item) && String(item.value) === agent);
}

export function createProjectId(): string {
  return `ec-${randomUUID()}`;
}
