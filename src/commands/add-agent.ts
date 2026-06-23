import path from "node:path";
import { outro } from "@clack/prompts";
import chalk from "chalk";
import { CONFIGURATORS } from "../configurators/index.js";
import { CONFIG_FILE, EASY_CODING_DIR } from "../constants/paths.js";
import { VERSION } from "../constants/version.js";
import { renderBanner } from "../ui/banner.js";
import { addAgentsToConfig, readConfigYaml } from "../utils/config-yaml.js";
import { pathExists } from "../utils/file-writer.js";
import { ensureEasyCodingSessionsIgnored } from "../utils/gitignore.js";
import { type InstallArtifact, writeInstallManifest } from "../utils/install-manifest.js";
import { writeRuntimeScaffold } from "../utils/runtime-scaffold.js";
import { setPendingInitSince } from "../utils/task-json.js";
import { type PlatformOptions, resolvePlatforms } from "./platforms.js";

export async function addAgent(opts: PlatformOptions): Promise<void> {
  renderBanner();

  const cwd = process.cwd();
  const configPath = path.join(cwd, EASY_CODING_DIR, CONFIG_FILE);
  if (!(await pathExists(configPath))) {
    throw new Error("No .easy-coding/config.yaml found. Run easy-coding init first.");
  }

  const config = await readConfigYaml(configPath);
  const platforms = await resolvePlatforms(opts, ["claude-code"]);
  const toInstall = platforms.filter((platform) => !config.agents.includes(platform));

  if (toInstall.length === 0) {
    outro(chalk.yellow("All selected agent platforms are already installed."));
    return;
  }

  const artifacts: InstallArtifact[] = [];
  for (const platform of toInstall) {
    artifacts.push(...(await CONFIGURATORS[platform](cwd)));
  }
  await writeRuntimeScaffold(cwd, [...config.agents, ...toInstall]);
  await writeInstallManifest(cwd, {
    harnessVersion: VERSION,
    agents: toInstall,
    artifacts,
    mode: "merge",
  });
  await ensureEasyCodingSessionsIgnored(cwd);
  await addAgentsToConfig(configPath, toInstall);
  await setPendingInitSince(cwd, VERSION);

  outro(chalk.green(`Added agent platforms: ${toInstall.join(", ")}`));
}
