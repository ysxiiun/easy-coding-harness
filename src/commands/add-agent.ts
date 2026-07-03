import { outro } from "@clack/prompts";
import chalk from "chalk";
import { VERSION } from "../constants/version.js";
import { renderBanner } from "../ui/banner.js";
import {
  addAgentsToConfig,
  readConfigYaml,
  updateSupermoduleConfig,
} from "../utils/config-yaml.js";
import { pathExists } from "../utils/file-writer.js";
import { ensureEasyCodingSessionsIgnored, ensureHookBytecodeIgnored } from "../utils/gitignore.js";
import { type InstallArtifact, writeInstallManifest } from "../utils/install-manifest.js";
import { writeRuntimeScaffold } from "../utils/runtime-scaffold.js";
import { setPendingInitSince } from "../utils/task-json.js";
import { configurePlatformsForDir, refreshSupermoduleParent } from "./install-harness.js";
import { type PlatformOptions, resolvePlatforms } from "./platforms.js";
import { resolveAddAgentTargets } from "./supermodule-targets.js";

export async function addAgent(opts: PlatformOptions): Promise<void> {
  renderBanner();

  const cwd = process.cwd();
  const targets = await resolveAddAgentTargets(cwd, opts);
  if (!(await pathExists(targets[0].configPath))) {
    throw new Error("No .easy-coding/config.yaml found. Run easy-coding init first.");
  }

  const platforms = await resolvePlatforms(opts, ["claude-code"]);
  const installedLabels: string[] = [];
  const refreshedLabels: string[] = [];

  for (const target of targets) {
    if (!(await pathExists(target.configPath))) {
      continue;
    }
    const config = await readConfigYaml(target.configPath);
    const toInstall = platforms.filter((platform) => !config.agents.includes(platform));
    const agents = [...config.agents, ...toInstall];

    if (toInstall.length > 0) {
      const projectId = await writeRuntimeScaffold(target.dir, agents, {
        supermodule: target.supermodule,
      });
      const artifacts: InstallArtifact[] = await configurePlatformsForDir(target.dir, toInstall, {
        supermodule: target.boundary,
        projectId,
      });
      await writeInstallManifest(target.dir, {
        harnessVersion: VERSION,
        agents: toInstall,
        artifacts,
        mode: "merge",
      });
      await ensureEasyCodingSessionsIgnored(target.dir);
      await ensureHookBytecodeIgnored(target.dir);
      await addAgentsToConfig(target.configPath, toInstall);
      await setPendingInitSince(target.dir, VERSION);

      installedLabels.push(`${target.label}: ${toInstall.join(", ")}`);
    }

    if (target.supermodule.role === "super-parent") {
      await refreshSupermoduleParent(target.dir, agents, target.supermodule.submodules ?? []);
      refreshedLabels.push(target.label);
      continue;
    }

    if (target.supermodule.role === "submodule-child") {
      await updateSupermoduleConfig(target.configPath, target.supermodule);
      refreshedLabels.push(target.label);
    }
  }

  if (installedLabels.length === 0) {
    if (refreshedLabels.length > 0) {
      outro(chalk.green(`Supermodule topology refreshed:\n${refreshedLabels.join("\n")}`));
      return;
    }
    outro(chalk.yellow("All selected agent platforms are already installed."));
    return;
  }

  outro(chalk.green(`Added agent platforms:\n${installedLabels.join("\n")}`));
}
