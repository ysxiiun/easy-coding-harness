import { cancel, confirm, outro } from "@clack/prompts";
import chalk from "chalk";
import { VERSION } from "../constants/version.js";
import { renderBanner } from "../ui/banner.js";
import { compareVersions } from "../utils/compare-versions.js";
import {
  readConfigYaml,
  updateHarnessVersion,
  updateSupermoduleConfig,
} from "../utils/config-yaml.js";
import { pathExists } from "../utils/file-writer.js";
import { ensureEasyCodingSessionsIgnored } from "../utils/gitignore.js";
import { type InstallArtifact, writeInstallManifest } from "../utils/install-manifest.js";
import { writeRuntimeScaffold } from "../utils/runtime-scaffold.js";
import { setPendingInitSince } from "../utils/task-json.js";
import { configurePlatformsForDir, refreshSupermoduleParent } from "./install-harness.js";
import { type CommandTarget, resolveUpgradeTargets } from "./supermodule-targets.js";

export interface UpgradeOptions {
  dryRun?: boolean;
  yes?: boolean;
}

interface PendingUpgradeTarget {
  target: CommandTarget;
  config: Awaited<ReturnType<typeof readConfigYaml>>;
}

interface ParentTopologyRefresh {
  target: CommandTarget;
  agents: Awaited<ReturnType<typeof readConfigYaml>>["agents"];
  submodulePaths: string[];
}

interface ChildTopologyRefresh {
  target: CommandTarget;
}

export async function upgrade(opts: UpgradeOptions): Promise<void> {
  renderBanner();

  const cwd = process.cwd();
  const targets = await resolveUpgradeTargets(cwd);
  if (!(await pathExists(targets[0].configPath))) {
    throw new Error("No .easy-coding/config.yaml found. Run easy-coding init first.");
  }

  const pending = await resolvePendingUpgradeTargets(targets);
  const parentTopologyRefresh = await resolveParentTopologyRefresh(targets, pending);
  const childTopologyRefreshes = await resolveChildTopologyRefreshes(targets, pending);

  if (pending.length === 0 && !parentTopologyRefresh && childTopologyRefreshes.length === 0) {
    outro(chalk.green(`easy-coding harness is already up to date (${VERSION}).`));
    return;
  }

  const summary = [
    "Upgrade targets:",
    ...(pending.length > 0
      ? pending.map(
          ({ target, config }) =>
            `- ${target.label}: ${String(config.harness_version ?? "unknown")} -> ${VERSION}; agents: ${config.agents.join(", ")}`,
        )
      : ["- (none)"]),
    ...(parentTopologyRefresh
      ? [
          "Supermodule topology refresh:",
          `- ${parentTopologyRefresh.target.label}: submodules: ${parentTopologyRefresh.submodulePaths.length > 0 ? parentTopologyRefresh.submodulePaths.join(", ") : "(none)"}`,
        ]
      : []),
    ...(childTopologyRefreshes.length > 0
      ? [
          parentTopologyRefresh ? "" : "Supermodule topology refresh:",
          ...childTopologyRefreshes.map(({ target }) => `- ${target.label}: role: submodule-child`),
        ].filter(Boolean)
      : []),
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

  for (const { target, config } of pending) {
    const artifacts: InstallArtifact[] = await configurePlatformsForDir(
      target.dir,
      config.agents,
      target.boundary,
    );
    await writeRuntimeScaffold(target.dir, config.agents, {
      supermodule: target.supermodule,
    });
    await writeInstallManifest(target.dir, {
      harnessVersion: VERSION,
      agents: config.agents,
      artifacts,
    });
    await ensureEasyCodingSessionsIgnored(target.dir);
    await updateHarnessVersion(target.configPath, VERSION);
    await updateSupermoduleConfig(target.configPath, target.supermodule);
    await setPendingInitSince(target.dir, VERSION);
  }

  if (parentTopologyRefresh) {
    await refreshSupermoduleParent(
      parentTopologyRefresh.target.dir,
      parentTopologyRefresh.agents,
      parentTopologyRefresh.submodulePaths,
    );
  }

  for (const { target } of childTopologyRefreshes) {
    await updateSupermoduleConfig(target.configPath, target.supermodule);
  }

  outro(
    chalk.green(
      pending.length > 0
        ? `easy-coding harness upgraded to ${VERSION}.`
        : "easy-coding supermodule topology refreshed.",
    ),
  );
}

async function resolvePendingUpgradeTargets(
  targets: CommandTarget[],
): Promise<PendingUpgradeTarget[]> {
  const pending: PendingUpgradeTarget[] = [];
  for (const target of targets) {
    if (!(await pathExists(target.configPath))) {
      continue;
    }
    const config = await readConfigYaml(target.configPath);
    const installedVersion = String(config.harness_version ?? "");
    const hasAgents = Array.isArray(config.agents) && config.agents.length > 0;
    if (!installedVersion || !hasAgents) {
      throw new Error(
        `${target.label} config.yaml is missing required harness fields (harness_version / agents). This project predates the current config layout. Run \`easy-coding clear\` then \`easy-coding init\` to migrate — your tasks, spec, and memory are preserved.`,
      );
    }

    const relation = compareVersions(installedVersion, VERSION);
    if (relation === 1) {
      throw new Error(
        `${target.label} harness version ${installedVersion} is newer than CLI ${VERSION}. Update the CLI first.`,
      );
    }
    if (relation === -1) {
      pending.push({ target, config });
    }
  }

  return pending;
}

async function resolveParentTopologyRefresh(
  targets: CommandTarget[],
  pending: PendingUpgradeTarget[],
): Promise<ParentTopologyRefresh | null> {
  const parent = targets.find(
    (target) => target.label === "." && target.supermodule.role === "super-parent",
  );
  if (!parent || pending.some(({ target }) => target.label === ".")) {
    return null;
  }
  if (!(await pathExists(parent.configPath))) {
    return null;
  }

  const config = await readConfigYaml(parent.configPath);
  if (!Array.isArray(config.agents) || config.agents.length === 0) {
    return null;
  }
  const submodulePaths = parent.supermodule.submodules ?? [];
  const configuredSubmodules = Array.isArray(config.supermodule?.submodules)
    ? config.supermodule.submodules
    : [];
  const needsRefresh =
    config.supermodule?.role !== "super-parent" ||
    !sameStringList(configuredSubmodules, submodulePaths);
  if (!needsRefresh) {
    return null;
  }

  return {
    target: parent,
    agents: config.agents,
    submodulePaths,
  };
}

async function resolveChildTopologyRefreshes(
  targets: CommandTarget[],
  pending: PendingUpgradeTarget[],
): Promise<ChildTopologyRefresh[]> {
  const pendingLabels = new Set(pending.map(({ target }) => target.label));
  const refreshes: ChildTopologyRefresh[] = [];

  for (const target of targets) {
    if (
      target.supermodule.role !== "submodule-child" ||
      pendingLabels.has(target.label) ||
      !(await pathExists(target.configPath))
    ) {
      continue;
    }

    const config = await readConfigYaml(target.configPath);
    if (
      config.supermodule?.role === "submodule-child" &&
      config.supermodule.parent === target.supermodule.parent
    ) {
      continue;
    }

    refreshes.push({ target });
  }

  return refreshes;
}

function sameStringList(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.every((value, index) => value === sortedRight[index]);
}
