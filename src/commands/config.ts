import path from "node:path";
import { cancel, confirm, outro, select } from "@clack/prompts";
import chalk from "chalk";
import { CONFIG_FILE, EASY_CODING_DIR } from "../constants/paths.js";
import { VERSION } from "../constants/version.js";
import { renderBanner } from "../ui/banner.js";
import { compareVersions } from "../utils/compare-versions.js";
import {
  type ApprovalMode,
  type ConfiguredWorkflowMode,
  readConfigYaml,
  resolveLegacyBehavior,
  setBehaviorModes,
} from "../utils/config-yaml.js";
import { pathExists } from "../utils/file-writer.js";

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
        hint: "ANALYSIS -> IMPLEMENT and VERIFICATION -> MEMORY",
      },
      {
        value: "confirm",
        label: "confirm — confirm the plan once",
        hint: "only ANALYSIS -> IMPLEMENT; later stages advance after quality gates",
      },
      {
        value: "auto",
        label: "auto — advance workflow stages automatically",
        hint: "task closure remains explicit",
      },
    ],
  });
  if (typeof approvalMode === "symbol") {
    cancel("Configuration cancelled.");
    return;
  }

  const workflowMode = await select<ConfiguredWorkflowMode>({
    message: `Select project workflow mode (current: ${current.workflowMode})`,
    initialValue: current.workflowMode,
    options: [
      {
        value: "adaptive",
        label: "adaptive — choose by task risk (default)",
        hint: "freezes to fast, standard, or strict after ANALYSIS",
      },
      {
        value: "fast",
        label: "fast — compact execution for low-risk tasks",
        hint: "all workflow stages still run",
      },
      {
        value: "standard",
        label: "standard — balanced execution",
        hint: "independent review and impacted verification",
      },
      {
        value: "strict",
        label: "strict — maximum assurance",
        hint: "multi-dimensional review and full verification",
      },
    ],
  });
  if (typeof workflowMode === "symbol") {
    cancel("Configuration cancelled.");
    return;
  }

  const shouldSave = await confirm({
    message: `Set behavior.approval_mode to ${approvalMode} and behavior.workflow_mode to ${workflowMode}?`,
    initialValue: true,
  });
  if (typeof shouldSave === "symbol" || !shouldSave) {
    cancel("Configuration cancelled.");
    return;
  }

  await setBehaviorModes(configPath, approvalMode, workflowMode);
  outro(chalk.green(`Project modes updated: approval=${approvalMode}, workflow=${workflowMode}.`));
}
