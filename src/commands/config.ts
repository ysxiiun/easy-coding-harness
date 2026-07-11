import path from "node:path";
import { cancel, confirm, outro, select } from "@clack/prompts";
import chalk from "chalk";
import { CONFIG_FILE, EASY_CODING_DIR } from "../constants/paths.js";
import { VERSION } from "../constants/version.js";
import { renderBanner } from "../ui/banner.js";
import { compareVersions } from "../utils/compare-versions.js";
import {
  type ConfirmMode,
  readConfigYaml,
  resolveLegacyConfirmMode,
  setConfirmMode,
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

  const current = resolveLegacyConfirmMode(projectConfig);
  const selected = await select<ConfirmMode>({
    message: `Select project confirm mode (current: ${current})`,
    initialValue: current,
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
        value: "auto",
        label: "auto — advance workflow stages automatically",
        hint: "task closure remains explicit",
      },
    ],
  });
  if (typeof selected === "symbol") {
    cancel("Configuration cancelled.");
    return;
  }

  const shouldSave = await confirm({
    message: `Set behavior.confirm_mode to ${selected}?`,
    initialValue: true,
  });
  if (typeof shouldSave === "symbol" || !shouldSave) {
    cancel("Configuration cancelled.");
    return;
  }

  await setConfirmMode(configPath, selected);
  outro(chalk.green(`Project confirm mode updated to ${selected}.`));
}
