import path from "node:path";
import { cancel, confirm, outro, select, text } from "@clack/prompts";
import chalk from "chalk";
import { CONFIG_FILE, EASY_CODING_DIR } from "../constants/paths.js";
import { VERSION } from "../constants/version.js";
import type { UnitTestMode } from "../types/task.js";
import { renderBanner } from "../ui/banner.js";
import { compareVersions } from "../utils/compare-versions.js";
import {
  type ApprovalMode,
  type ConfiguredWorkflowMode,
  isUtCoverageThreshold,
  readConfigYaml,
  resolveLegacyBehavior,
  setBehaviorModes,
} from "../utils/config-yaml.js";
import { pathExists } from "../utils/file-writer.js";
import { inspectTddReadiness } from "../utils/tdd-readiness.js";

export async function config(): Promise<void> {
  renderBanner();

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

  const shouldSave = await confirm({
    message: `Set approval=${approvalMode}, workflow=${workflowMode}, unit-test=${unitTestMode}${unitTestMode === "none" ? "" : ` (${utCoverageThreshold}%)`}?`,
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

  await setBehaviorModes(configPath, approvalMode, workflowMode, unitTestMode, utCoverageThreshold);
  outro(
    chalk.green(
      `Project modes updated: approval=${approvalMode}, workflow=${workflowMode}, unit-test=${unitTestMode}${unitTestMode === "none" ? "" : ` (${utCoverageThreshold}%)`}.`,
    ),
  );
}
