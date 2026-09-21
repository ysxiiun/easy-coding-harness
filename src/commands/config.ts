import path from "node:path";
import { cancel, confirm, outro, select, text } from "@clack/prompts";
import chalk from "chalk";
import { CONFIG_FILE, EASY_CODING_DIR } from "../constants/paths.js";
import { VERSION } from "../constants/version.js";
import type { CooperateMode, UnitTestMode } from "../types/task.js";
import { renderBanner } from "../ui/banner.js";
import { compareVersions } from "../utils/compare-versions.js";
import {
  APPROVAL_MODES,
  type ApprovalMode,
  BEHAVIOR_KEYS,
  type BehaviorSettings,
  COOPERATE_MODES,
  type ConfiguredWorkflowMode,
  UNIT_TEST_MODES,
  isUtCoverageThreshold,
  localConfigPath,
  readConfigYaml,
  readLocalBehavior,
  resolveLegacyBehavior,
  setBehaviorModes,
  validateBehaviorValue,
  writeBehaviorOverrides,
} from "../utils/config-yaml.js";
import { pathExists } from "../utils/file-writer.js";
import { inspectTddReadiness } from "../utils/tdd-readiness.js";

interface ConfigOptions {
  scope?: string;
  approvalMode?: string;
  cooperateMode?: string;
  unitTestMode?: string;
  utCoverageThreshold?: string;
  reset?: string;
  yes?: boolean;
}

export async function config(options: ConfigOptions = {}): Promise<void> {
  renderBanner();
  const scope = options.scope ?? "project";
  if (scope !== "project" && scope !== "local")
    throw new Error("Config scope must be project or local.");
  const explicit =
    options.approvalMode !== undefined ||
    options.cooperateMode !== undefined ||
    options.unitTestMode !== undefined ||
    options.utCoverageThreshold !== undefined ||
    options.reset !== undefined;
  if (scope === "local") {
    await configureOverrides(localConfigPath(), scope, options, explicit);
    return;
  }

  const configPath = path.join(process.cwd(), EASY_CODING_DIR, CONFIG_FILE);
  if (!(await pathExists(configPath))) {
    throw new Error("No easy-coding harness found in this project.");
  }

  const projectConfig = await readConfigYaml(configPath);
  if (projectConfig.harness_version !== VERSION) {
    const relation = compareVersions(projectConfig.harness_version, VERSION);
    if (relation === -1) {
      throw new Error(
        `Project harness ${projectConfig.harness_version} is older than CLI ${VERSION}. Run easy-coding upgrade first.`,
      );
    }
    if (relation === 1) {
      throw new Error(
        `Project harness ${projectConfig.harness_version} is newer than CLI ${VERSION}. Update the CLI first.`,
      );
    }
    throw new Error(
      `Project harness ${projectConfig.harness_version} does not exactly match CLI ${VERSION}. Upgrade the harness or update the CLI before changing config.`,
    );
  }

  if (explicit) {
    await configureOverrides(configPath, scope, options, true);
    return;
  }

  const current = resolveLegacyBehavior(projectConfig);
  const approvalMode = await select<ApprovalMode>({
    message: `Select project approval mode (current: ${current.approvalMode})`,
    initialValue: current.approvalMode,
    options: [
      {
        value: "approve",
        label: "approve — confirm every stage transition",
        hint: "except INIT -> ANALYSIS and MEMORY -> COMPLETE",
      },
      {
        value: "guard",
        label: "guard — confirm critical gates (default)",
        hint: "ANALYSIS -> IMPLEMENT and QUALITY -> MEMORY",
      },
      {
        value: "confirm",
        label: "confirm — confirm the plan once",
        hint: "only ANALYSIS -> IMPLEMENT; later stages advance after quality gates",
      },
      {
        value: "auto",
        label: "auto — advance workflow stages automatically",
        hint: "only new post-verification code drift pauses for exact acceptance",
      },
    ],
  });
  if (typeof approvalMode === "symbol") {
    cancel("Configuration cancelled.");
    return;
  }

  const workflowMode: ConfiguredWorkflowMode = "adaptive";

  const unitTestMode = await select<UnitTestMode>({
    message: `Select Java unit test strategy (current: ${current.unitTestMode})`,
    initialValue: current.unitTestMode,
    options: [
      { value: "none", label: "none — preserve task-required verification (default)" },
      { value: "ut", label: "UT — passing unit tests and changed-line coverage" },
      { value: "tdd", label: "TDD — test-first development and changed-line coverage" },
    ],
  });
  if (typeof unitTestMode === "symbol") {
    cancel("Configuration cancelled.");
    return;
  }

  if (unitTestMode !== "none") {
    const readiness = await inspectTddReadiness(process.cwd());
    if (readiness.status !== "ready") {
      cancel(
        `Unit test strategy was not enabled. ${readiness.status === "needs_init" ? "Run ec-tdd-init first" : "Repair coverage readiness"}: ${readiness.reasons.join("; ")}. No project modes were changed.`,
      );
      return;
    }
  }

  let utCoverageThreshold = current.utCoverageThreshold;
  if (unitTestMode !== "none") {
    const thresholdInput = await text({
      message: "Minimum changed-production-line coverage percentage",
      initialValue: String(current.utCoverageThreshold),
      validate(value) {
        const parsed = Number(value);
        return isUtCoverageThreshold(parsed) ? undefined : "Enter an integer from 1 to 100.";
      },
    });
    if (typeof thresholdInput === "symbol") {
      cancel("Configuration cancelled.");
      return;
    }
    utCoverageThreshold = Number(thresholdInput);
  }

  const cooperateMode = await select<CooperateMode>({
    message: `Select project cooperation (current: ${projectConfig.behavior.cooperate_mode ?? "default"})`,
    initialValue: projectConfig.behavior.cooperate_mode ?? "default",
    options: [
      { value: "default", label: "default — hand off at stage boundaries" },
      {
        value: "dispatch",
        label: "dispatch — manually hand off implementation and QUALITY repairs",
      },
    ],
  });
  if (typeof cooperateMode === "symbol") {
    cancel("Configuration cancelled.");
    return;
  }

  const shouldSave = await confirm({
    message: `Set approval=${approvalMode}, cooperate=${cooperateMode}, unit-test=${unitTestMode}${unitTestMode === "none" ? "" : ` (${utCoverageThreshold}%)`}?`,
    initialValue: true,
  });
  if (typeof shouldSave === "symbol" || !shouldSave) {
    cancel("Configuration cancelled.");
    return;
  }

  if (unitTestMode !== "none") {
    const readiness = await inspectTddReadiness(process.cwd());
    if (readiness.status !== "ready") {
      cancel(
        `Unit test strategy was not enabled because readiness changed before save: ${readiness.reasons.join("; ")}. No project modes were changed.`,
      );
      return;
    }
  }

  await setBehaviorModes(
    configPath,
    approvalMode,
    workflowMode,
    unitTestMode,
    utCoverageThreshold,
    cooperateMode,
  );
  outro(
    chalk.green(
      `Project modes updated: approval=${approvalMode}, workflow=${workflowMode}, unit-test=${unitTestMode}${unitTestMode === "none" ? "" : ` (${utCoverageThreshold}%)`}.`,
    ),
  );
}

async function configureOverrides(
  filePath: string,
  scope: string,
  options: ConfigOptions,
  explicit: boolean,
): Promise<void> {
  const changes: Partial<Record<keyof BehaviorSettings, unknown>> = {};
  const flags = {
    approval_mode: options.approvalMode,
    cooperate_mode: options.cooperateMode,
    unit_test_mode: options.unitTestMode,
    ut_coverage_threshold: options.utCoverageThreshold,
  };
  for (const key of BEHAVIOR_KEYS) {
    if (flags[key] !== undefined)
      changes[key] = key === "ut_coverage_threshold" ? Number(flags[key]) : flags[key];
  }
  if (options.reset) {
    if (!BEHAVIOR_KEYS.includes(options.reset as keyof BehaviorSettings))
      throw new Error("Unknown behavior field to reset.");
    changes[options.reset as keyof BehaviorSettings] = null;
  }
  if (!explicit) {
    const local = await readLocalBehavior();
    const key = await select<keyof BehaviorSettings>({
      message: "Select local override to edit",
      options: BEHAVIOR_KEYS.map((value) => ({
        value,
        label: `${value}: ${local[value] ?? "inherit project"}`,
      })),
    });
    if (typeof key === "symbol") {
      cancel("Configuration cancelled.");
      return;
    }
    if (key === "ut_coverage_threshold") {
      const value = await text({
        message: "Coverage threshold 1..100, or inherit",
        initialValue: String(local[key] ?? "inherit"),
        validate: (value) =>
          value === "inherit" || isUtCoverageThreshold(Number(value))
            ? undefined
            : "Enter 1..100 or inherit.",
      });
      if (typeof value === "symbol") {
        cancel("Configuration cancelled.");
        return;
      }
      changes[key] = value === "inherit" ? null : Number(value);
    } else {
      const values =
        key === "approval_mode"
          ? APPROVAL_MODES
          : key === "cooperate_mode"
            ? COOPERATE_MODES
            : UNIT_TEST_MODES;
      const value = await select({
        message: `Set local ${key}`,
        initialValue: local[key] ?? "inherit",
        options: [
          { value: "inherit", label: "inherit — use project setting" },
          ...values.map((value) => ({ value, label: value })),
        ],
      });
      if (typeof value === "symbol") {
        cancel("Configuration cancelled.");
        return;
      }
      changes[key] = value === "inherit" ? null : value;
    }
  }
  for (const key of BEHAVIOR_KEYS) {
    if (changes[key] !== undefined && changes[key] !== null)
      validateBehaviorValue(key, changes[key]);
  }
  if (!options.yes) {
    const accepted = await confirm({
      message: `Save ${scope} overrides ${JSON.stringify(changes)}?`,
      initialValue: true,
    });
    if (accepted !== true) {
      cancel("Configuration cancelled.");
      return;
    }
  }
  if (scope === "project" && changes.unit_test_mode && changes.unit_test_mode !== "none") {
    const readiness = await inspectTddReadiness(process.cwd());
    if (readiness.status !== "ready")
      throw new Error(`Unit test readiness: ${readiness.status}. ${readiness.reasons.join("; ")}`);
  }
  await writeBehaviorOverrides(filePath, changes);
  outro(chalk.green(`${scope} behavior overrides saved: ${filePath}`));
}
