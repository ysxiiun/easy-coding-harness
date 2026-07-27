import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import YAML, { isScalar, isSeq, parseDocument } from "yaml";
import type { AgentPlatform } from "../types/platform.js";
import type { SupermoduleConfig } from "../types/supermodule.js";
import { writeTextFile } from "./file-writer.js";

export const CONFIG_SCHEMA_VERSION = 3;
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

export function resolveLegacyBehavior(config: EasyCodingConfig): {
  approvalMode: ApprovalMode;
  workflowMode: ConfiguredWorkflowMode;
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
  return { approvalMode, workflowMode };
}

export async function setBehaviorModes(
  filePath: string,
  approvalMode: ApprovalMode,
  workflowMode: ConfiguredWorkflowMode,
): Promise<EasyCodingConfig> {
  return updateConfigYaml(filePath, (config) => {
    const legacyBehavior = (config.behavior ?? {}) as unknown as Record<string, unknown>;
    const behavior = Object.fromEntries(
      Object.entries(legacyBehavior).filter(
        ([key]) =>
          key !== "strict_confirm" &&
          key !== "auto_mode" &&
          key !== "confirm_mode" &&
          key !== "approval_mode" &&
          key !== "workflow_mode",
      ),
    );
    behavior.approval_mode = approvalMode;
    behavior.workflow_mode = workflowMode;
    config.behavior = behavior as EasyCodingConfig["behavior"];
    config.version = CONFIG_SCHEMA_VERSION;
  });
}

export async function migrateBehaviorConfig(filePath: string): Promise<EasyCodingConfig> {
  const config = await readConfigYaml(filePath);
  const { approvalMode, workflowMode } = resolveLegacyBehavior(config);
  return setBehaviorModes(filePath, approvalMode, workflowMode);
}

/** @deprecated Use setBehaviorModes. Kept for API compatibility during the 0.9 beta. */
export async function setConfirmMode(
  filePath: string,
  mode: LegacyConfirmMode,
): Promise<EasyCodingConfig> {
  const config = await readConfigYaml(filePath);
  const { workflowMode } = resolveLegacyBehavior(config);
  return setBehaviorModes(
    filePath,
    mode === "lite" ? "guard" : mode,
    mode === "lite" ? "fast" : workflowMode,
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
