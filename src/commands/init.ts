import { note, outro } from "@clack/prompts";
import chalk from "chalk";
import { CONFIGURATORS } from "../configurators/index.js";
import { VERSION } from "../constants/version.js";
import { PLATFORM_META } from "../types/platform.js";
import { renderBanner } from "../ui/banner.js";
import { ensureEasyCodingSessionsIgnored } from "../utils/gitignore.js";
import { type InstallArtifact, writeInstallManifest } from "../utils/install-manifest.js";
import { detectEasyCodingInstallState } from "../utils/install-state.js";
import { writeRuntimeScaffold } from "../utils/runtime-scaffold.js";
import { writeProjectInitTask } from "../utils/task-json.js";
import { type PlatformOptions, resolvePlatforms } from "./platforms.js";

export async function init(opts: PlatformOptions): Promise<void> {
  renderBanner();

  const cwd = process.cwd();
  const installState = await detectEasyCodingInstallState(cwd);
  if (installState.kind === "installed") {
    throw new Error(
      ".easy-coding/config.yaml already exists. Use easy-coding add-agent or easy-coding upgrade.",
    );
  }
  if (installState.kind === "unknown") {
    throw new Error(
      ".easy-coding exists but is not recognized as an easy-coding harness or legacy easy-coding skill project. Please inspect it manually before running init.",
    );
  }

  const platforms = await resolvePlatforms(opts, ["claude-code"]);
  const artifacts: InstallArtifact[] = [];

  for (const platform of platforms) {
    artifacts.push(...(await CONFIGURATORS[platform](cwd)));
  }

  await writeRuntimeScaffold(cwd, platforms);
  await writeInstallManifest(cwd, {
    harnessVersion: VERSION,
    agents: platforms,
    artifacts,
  });
  await writeProjectInitTask(cwd, platforms, {
    initSource: installState.kind === "legacy" ? "legacy-easy-coding" : "fresh",
    legacyAssets: installState.kind === "legacy" ? installState.legacyAssets : undefined,
    legacyMissingHarnessFiles:
      installState.kind === "legacy" ? installState.missingHarnessFiles : undefined,
  });
  await ensureEasyCodingSessionsIgnored(cwd);

  const triggers = platforms
    .map(
      (platform) =>
        `${PLATFORM_META[platform].label}: ${PLATFORM_META[platform].skillTrigger}ec-init`,
    )
    .join("\n");

  note(triggers, "Next step");
  outro(chalk.green("easy-coding harness installed. Open your agent and run ec-init."));
}
