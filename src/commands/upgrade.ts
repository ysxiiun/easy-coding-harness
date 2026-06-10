import path from "node:path";
import { cancel, confirm, outro } from "@clack/prompts";
import chalk from "chalk";
import { CONFIGURATORS } from "../configurators/index.js";
import { CONFIG_FILE, EASY_CODING_DIR } from "../constants/paths.js";
import { VERSION } from "../constants/version.js";
import { renderBanner } from "../ui/banner.js";
import { compareVersions } from "../utils/compare-versions.js";
import { readConfigYaml, updateHarnessVersion } from "../utils/config-yaml.js";
import { pathExists } from "../utils/file-writer.js";
import { ensureEasyCodingSessionsIgnored } from "../utils/gitignore.js";

export interface UpgradeOptions {
  dryRun?: boolean;
  yes?: boolean;
}

export async function upgrade(opts: UpgradeOptions): Promise<void> {
  renderBanner();

  const cwd = process.cwd();
  const configPath = path.join(cwd, EASY_CODING_DIR, CONFIG_FILE);
  if (!(await pathExists(configPath))) {
    throw new Error("No .easy-coding/config.yaml found. Run easy-coding init first.");
  }

  const config = await readConfigYaml(configPath);
  const relation = compareVersions(config.harness_version, VERSION);

  if (relation === 0) {
    outro(chalk.green(`easy-coding harness is already up to date (${VERSION}).`));
    return;
  }

  if (relation === 1) {
    throw new Error(
      `Project harness version ${config.harness_version} is newer than CLI ${VERSION}. Update the CLI first.`,
    );
  }

  const summary = [
    `Upgrade: ${config.harness_version} -> ${VERSION}`,
    `Installed agents: ${config.agents.join(", ")}`,
    "Will overwrite managed skills, hooks, agents, and generated main-constraint regions.",
    "Will not touch tasks, memory, state, spec, or project knowledge files.",
  ].join("\n");

  if (opts.dryRun) {
    console.log(summary);
    return;
  }

  if (!opts.yes) {
    const shouldUpgrade = await confirm({
      message: "Apply this harness upgrade?",
      initialValue: true,
    });
    if (typeof shouldUpgrade === "symbol" || !shouldUpgrade) {
      cancel("Upgrade cancelled.");
      return;
    }
  }

  for (const platform of config.agents) {
    await CONFIGURATORS[platform](cwd);
  }
  await ensureEasyCodingSessionsIgnored(cwd);
  await updateHarnessVersion(configPath, VERSION);

  outro(chalk.green(`easy-coding harness upgraded to ${VERSION}.`));
}
