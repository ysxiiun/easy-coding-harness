import path from "node:path";
import { note, outro } from "@clack/prompts";
import chalk from "chalk";
import { CONFIG_FILE, EASY_CODING_DIR } from "../constants/paths.js";
import { PLATFORM_META } from "../types/platform.js";
import type { AgentPlatform } from "../types/platform.js";
import type { InstallContext, SubmoduleEntry } from "../types/supermodule.js";
import { renderBanner } from "../ui/banner.js";
import { readConfigYaml, updateSupermoduleConfig } from "../utils/config-yaml.js";
import { pathExists } from "../utils/file-writer.js";
import { parseGitmodules } from "../utils/gitmodules.js";
import { detectEasyCodingInstallState } from "../utils/install-state.js";
import {
  installHarnessToDir,
  refreshSupermoduleParent,
  supermoduleConfigFromContext,
} from "./install-harness.js";
import { type PlatformOptions, resolvePlatforms } from "./platforms.js";
import {
  rejectSubmoduleListWithoutGitmodules,
  resolveInitSubmoduleSelection,
} from "./supermodule-targets.js";

interface InstallTarget {
  dir: string;
  label: string;
  context: InstallContext;
  installed: boolean;
}

export async function init(opts: PlatformOptions): Promise<void> {
  renderBanner();

  const cwd = process.cwd();
  const submodules = await parseGitmodules(cwd);
  if (submodules.length === 0) {
    rejectSubmoduleListWithoutGitmodules(opts);
  }

  const targets =
    submodules.length === 0
      ? [await standaloneTarget(cwd)]
      : await supermoduleTargets(cwd, opts, submodules);

  const installableTargets = targets.filter((target) => !target.installed);
  const parentTarget = targets.find((target) => target.label === ".");
  if (installableTargets.length === 0) {
    await refreshInstalledChildTopologies(targets);
    if (submodules.length > 0 && parentTarget) {
      const platforms = await resolveInitPlatforms(cwd, opts, true);
      await refreshParentTopologyIfNeeded(cwd, parentTarget, platforms);
    }
    outro(chalk.yellow("All selected easy-coding harness targets are already installed."));
    return;
  }

  const platforms = await resolveInitPlatforms(cwd, opts, Boolean(parentTarget?.installed));
  for (const target of installableTargets) {
    await installHarnessToDir(target.dir, platforms, target.context);
  }
  await refreshInstalledChildTopologies(targets);
  if (submodules.length > 0 && parentTarget) {
    await refreshParentTopologyIfNeeded(cwd, parentTarget, platforms);
  }

  const triggers = platforms
    .map(
      (platform) =>
        `${PLATFORM_META[platform].label}: ${PLATFORM_META[platform].skillTrigger}ec-init`,
    )
    .join("\n");

  note(triggers, "Next step");
  outro(
    chalk.green(
      `easy-coding harness installed in ${installableTargets.map((target) => target.label).join(", ")}. Open your agent and run ec-init.`,
    ),
  );
}

async function standaloneTarget(cwd: string): Promise<InstallTarget> {
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

  return {
    dir: cwd,
    label: ".",
    context: contextFromState("standalone", installState),
    installed: false,
  };
}

async function supermoduleTargets(
  cwd: string,
  opts: PlatformOptions,
  submodules: SubmoduleEntry[],
): Promise<InstallTarget[]> {
  const { installable, parentSubmodulePaths } = await resolveInitSubmoduleSelection(cwd, opts);
  const skipped = submodules.filter(
    (entry) => !installable.some((installableEntry) => installableEntry.path === entry.path),
  );
  if (skipped.length > 0) {
    note(
      skipped.map((entry) => `${entry.path} (${entry.name})`).join("\n"),
      "Skipped unchecked-out submodules",
    );
  }

  const targets: InstallTarget[] = [
    await targetFromState(cwd, ".", "super-parent", {
      submodulePaths: parentSubmodulePaths,
    }),
  ];

  const targetSubmodulePaths =
    opts.submodules === false ? new Set<string>() : new Set(parentSubmodulePaths);
  for (const entry of installable) {
    if (!targetSubmodulePaths.has(entry.path)) {
      continue;
    }
    const dir = path.join(cwd, entry.path);
    targets.push(
      await targetFromState(dir, entry.path, "submodule-child", {
        parent: toPosixRelative(dir, cwd),
      }),
    );
  }

  return targets;
}

async function targetFromState(
  targetDir: string,
  label: string,
  role: InstallContext["role"],
  extraContext: Partial<InstallContext> = {},
): Promise<InstallTarget> {
  const installState = await detectEasyCodingInstallState(targetDir);
  if (installState.kind === "unknown") {
    throw new Error(
      `${targetDir}/.easy-coding exists but is not recognized as an easy-coding harness or legacy easy-coding skill project. Please inspect it manually before running init.`,
    );
  }
  if (installState.kind === "installed") {
    return {
      dir: targetDir,
      label,
      installed: true,
      context: {
        role,
        initSource: "fresh",
        ...extraContext,
      },
    };
  }
  return {
    dir: targetDir,
    label,
    installed: false,
    context: {
      ...contextFromState(role, installState),
      ...extraContext,
    },
  };
}

function contextFromState(
  role: InstallContext["role"],
  installState: Awaited<ReturnType<typeof detectEasyCodingInstallState>>,
): InstallContext {
  return {
    role,
    initSource: installState.kind === "legacy" ? "legacy-easy-coding" : "fresh",
    legacyAssets: installState.kind === "legacy" ? installState.legacyAssets : undefined,
    legacyMissingHarnessFiles:
      installState.kind === "legacy" ? installState.missingHarnessFiles : undefined,
  };
}

function toPosixRelative(from: string, to: string): string {
  const relative = path.relative(from, to);
  return relative ? relative.split(path.sep).join("/") : ".";
}

async function resolveInitPlatforms(
  cwd: string,
  opts: PlatformOptions,
  parentInstalled: boolean,
): Promise<AgentPlatform[]> {
  if (opts.agent || !parentInstalled) {
    return resolvePlatforms(opts, ["claude-code"]);
  }

  const config = await readConfigYaml(path.join(cwd, EASY_CODING_DIR, CONFIG_FILE));
  if (Array.isArray(config.agents) && config.agents.length > 0) {
    return config.agents;
  }
  return resolvePlatforms(opts, ["claude-code"]);
}

async function refreshParentTopologyIfNeeded(
  cwd: string,
  parentTarget: InstallTarget,
  installPlatforms: AgentPlatform[],
): Promise<void> {
  if (!(await pathExists(path.join(cwd, EASY_CODING_DIR, CONFIG_FILE)))) {
    return;
  }

  const config = parentTarget.installed
    ? await readConfigYaml(path.join(cwd, EASY_CODING_DIR, CONFIG_FILE))
    : { agents: installPlatforms };
  const platforms =
    Array.isArray(config.agents) && config.agents.length > 0 ? config.agents : installPlatforms;

  // Re-entry can add a child without reinstalling the parent; refresh only the parent topology.
  await refreshSupermoduleParent(cwd, platforms, parentTarget.context.submodulePaths ?? []);
}

async function refreshInstalledChildTopologies(targets: InstallTarget[]): Promise<void> {
  for (const target of targets) {
    if (!target.installed || target.context.role !== "submodule-child") {
      continue;
    }
    const configPath = path.join(target.dir, EASY_CODING_DIR, CONFIG_FILE);
    if (!(await pathExists(configPath))) {
      continue;
    }
    await updateSupermoduleConfig(configPath, supermoduleConfigFromContext(target.context));
  }
}
