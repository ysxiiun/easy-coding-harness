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
import { type InstallArtifact, writeInstallManifest } from "../utils/install-manifest.js";
import { writeRuntimeScaffold } from "../utils/runtime-scaffold.js";
import { setPendingInitSince } from "../utils/task-json.js";

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

  const installedVersion = String(config.harness_version ?? "");
  const hasAgents = Array.isArray(config.agents) && config.agents.length > 0;
  if (!installedVersion || !hasAgents) {
    throw new Error(
      "config.yaml is missing required harness fields (harness_version / agents). " +
        "This project predates the current config layout. Run `easy-coding clear` then " +
        "`easy-coding init` to migrate — your tasks, spec, and memory are preserved.",
    );
  }

  const relation = compareVersions(installedVersion, VERSION);

  if (relation === 0) {
    outro(chalk.green(`easy-coding harness is already up to date (${VERSION}).`));
    return;
  }

  if (relation === 1) {
    throw new Error(
      `Project harness version ${installedVersion} is newer than CLI ${VERSION}. Update the CLI first.`,
    );
  }

  const summary = [
    `Upgrade: ${installedVersion || "unknown"} -> ${VERSION}`,
    `Installed agents: ${config.agents.join(", ")}`,
    "Will overwrite managed skills, hooks, agents, templates, and generated main-constraint regions.",
    "Will update project-init task to recommend ec-init re-run for version adaptation.",
    "Will not touch memory, state, spec, or project knowledge files.",
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

  const artifacts: InstallArtifact[] = [];
  for (const platform of config.agents) {
    artifacts.push(...(await CONFIGURATORS[platform](cwd)));
  }
  await writeRuntimeScaffold(cwd, config.agents);
  await writeInstallManifest(cwd, {
    harnessVersion: VERSION,
    agents: config.agents,
    artifacts,
  });
  await ensureEasyCodingSessionsIgnored(cwd);
  await updateHarnessVersion(configPath, VERSION);
  await setPendingInitSince(cwd, VERSION);

  outro(chalk.green(`easy-coding harness upgraded to ${VERSION}.`));
}
