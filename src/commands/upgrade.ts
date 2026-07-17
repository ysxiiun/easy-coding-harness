import path from "node:path";
import { cancel, confirm, outro } from "@clack/prompts";
import chalk from "chalk";
import { renderHookCommand } from "../configurators/shared.js";
import { VERSION } from "../constants/version.js";
import type { AgentPlatform, PlatformMeta } from "../types/platform.js";
import { renderBanner } from "../ui/banner.js";
import { compareVersions } from "../utils/compare-versions.js";
import {
  migrateConfirmModeConfig,
  readConfigYaml,
  updateHarnessVersion,
  updateSupermoduleConfig,
} from "../utils/config-yaml.js";
import { pathExists, readTextIfExists } from "../utils/file-writer.js";
import { ensureEasyCodingSessionsIgnored, ensureHookBytecodeIgnored } from "../utils/gitignore.js";
import {
  type InstallArtifact,
  extractHookPathFromCommand,
  readInstallManifest,
  writeInstallManifest,
} from "../utils/install-manifest.js";
import { resolvePlatformMeta } from "../utils/platform-paths.js";
import { writeRuntimeScaffold } from "../utils/runtime-scaffold.js";
import {
  hasLegacyWorkflowState,
  migrateLegacyWorkflowState,
  setPendingInitSince,
  stripInitTaskProjectPath,
} from "../utils/task-json.js";
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

interface ExpectedHookScriptRegistration {
  event: string;
  scriptName: string;
}

interface ExpectedHookRegistration {
  event: string;
  command: string;
}

const EXPECTED_HOOK_REGISTRATION_SCRIPTS: Record<AgentPlatform, ExpectedHookScriptRegistration[]> =
  {
    "claude-code": [
      { event: "SessionStart", scriptName: "session-start.py" },
      { event: "UserPromptSubmit", scriptName: "inject-workflow-state.py" },
      { event: "PreToolUse", scriptName: "inject-subagent-context.py" },
    ],
    codex: [
      { event: "SessionStart", scriptName: "session-start.py" },
      { event: "UserPromptSubmit", scriptName: "inject-workflow-state.py" },
    ],
    qoder: [
      { event: "UserPromptSubmit", scriptName: "inject-workflow-state.py" },
      { event: "PreToolUse", scriptName: "inject-subagent-context.py" },
    ],
  };

const MANAGED_HOOK_SCRIPT_NAMES: Record<AgentPlatform, string[]> = {
  "claude-code": [
    ...new Set(
      EXPECTED_HOOK_REGISTRATION_SCRIPTS["claude-code"].map(({ scriptName }) => scriptName),
    ),
  ],
  codex: [...new Set(EXPECTED_HOOK_REGISTRATION_SCRIPTS.codex.map(({ scriptName }) => scriptName))],
  // Keep removed registrations recognizable so same-version repair can clean them without a manifest.
  qoder: [
    ...new Set([
      ...EXPECTED_HOOK_REGISTRATION_SCRIPTS.qoder.map(({ scriptName }) => scriptName),
      "session-start.py",
    ]),
  ],
};

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
    "Will migrate behavior.strict_confirm/auto_mode to behavior.confirm_mode and remove the old keys.",
    "Will migrate legacy workflow stage metadata; memory content, spec, and project knowledge files remain untouched.",
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
    const projectId = await writeRuntimeScaffold(target.dir, config.agents, {
      supermodule: target.supermodule,
    });
    const artifacts: InstallArtifact[] = await configurePlatformsForDir(target.dir, config.agents, {
      supermodule: target.boundary,
      projectId,
    });
    await writeInstallManifest(target.dir, {
      harnessVersion: VERSION,
      agents: config.agents,
      artifacts,
    });
    await ensureEasyCodingSessionsIgnored(target.dir);
    await ensureHookBytecodeIgnored(target.dir);
    await migrateLegacyWorkflowState(target.dir);
    await migrateConfirmModeConfig(target.configPath);
    await updateHarnessVersion(target.configPath, VERSION);
    await updateSupermoduleConfig(target.configPath, target.supermodule);
    await setPendingInitSince(target.dir, VERSION);
    await stripInitTaskProjectPath(target.dir);
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
    if (
      relation === -1 ||
      (relation === 0 &&
        (installedVersion !== VERSION ||
          (await needsHookConfigRefresh(target, config)) ||
          (await hasLegacyWorkflowState(target.dir))))
    ) {
      pending.push({ target, config });
    }
  }

  return pending;
}

async function needsHookConfigRefresh(
  target: CommandTarget,
  config: Awaited<ReturnType<typeof readConfigYaml>>,
): Promise<boolean> {
  const projectId = typeof config.project?.id === "string" ? config.project.id.trim() : "";
  if (!projectId) {
    return true;
  }
  const manifest = await readInstallManifest(target.dir);
  for (const agent of config.agents) {
    const meta = resolvePlatformMeta(target.dir, agent);
    const configPath = path.join(target.dir, meta.hookConfigFile);
    const content = await readTextIfExists(configPath);
    if (content === null) {
      return true;
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(content) as Record<string, unknown>;
    } catch {
      return true;
    }

    const commandsByEvent = collectHookCommandsByEvent(parsed.hooks);
    const actualRegistrations = [...commandsByEvent.entries()].flatMap(([event, commands]) =>
      commands.map((command) => ({ event, command })),
    );
    const expectedRegistrations = expectedHookRegistrations(target.dir, meta, agent, projectId);
    const expectedCommandSet = new Set(
      expectedRegistrations.map((registration) => registration.command),
    );
    if (!hasExpectedHookRegistrations(commandsByEvent, expectedRegistrations)) {
      return true;
    }
    const manifestManagedCommands = new Set(
      manifest?.hook_registrations
        .filter((registration) => registration.platform === agent)
        .map((registration) => registration.command) ?? [],
    );
    if (
      hasUnexpectedManagedHookRegistrations(
        actualRegistrations,
        expectedRegistrations,
        expectedCommandSet,
        target.dir,
        meta,
        agent,
        manifestManagedCommands,
      )
    ) {
      return true;
    }
  }
  return false;
}

function expectedHookRegistrations(
  cwd: string,
  meta: PlatformMeta,
  platform: AgentPlatform,
  projectId: string,
): ExpectedHookRegistration[] {
  return EXPECTED_HOOK_REGISTRATION_SCRIPTS[platform].map(({ event, scriptName }) => ({
    event,
    command: renderHookCommand(cwd, meta.templateContext, scriptName, process.platform, projectId),
  }));
}

function hasExpectedHookRegistrations(
  commandsByEvent: Map<string, string[]>,
  expectedRegistrations: ExpectedHookRegistration[],
): boolean {
  const actualCounts = countRegistrations(
    [...commandsByEvent.entries()].flatMap(([event, commands]) =>
      commands.map((command) => ({ event, command })),
    ),
  );
  const expectedCounts = countRegistrations(expectedRegistrations);
  return [...expectedCounts.entries()].every(
    ([registrationKey, expectedCount]) => (actualCounts.get(registrationKey) ?? 0) >= expectedCount,
  );
}

function countRegistrations(registrations: ExpectedHookRegistration[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const registration of registrations) {
    const key = hookRegistrationKey(registration);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function hookRegistrationKey(registration: ExpectedHookRegistration): string {
  return `${registration.event}\0${registration.command}`;
}

function hasUnexpectedManagedHookRegistrations(
  actualRegistrations: ExpectedHookRegistration[],
  expectedRegistrations: ExpectedHookRegistration[],
  expectedCommands: Set<string>,
  cwd: string,
  meta: PlatformMeta,
  platform: AgentPlatform,
  manifestManagedCommands: Set<string>,
): boolean {
  const remainingExpected = countRegistrations(expectedRegistrations);
  for (const registration of actualRegistrations) {
    const key = hookRegistrationKey(registration);
    const remainingCount = remainingExpected.get(key) ?? 0;
    if (remainingCount > 0) {
      remainingExpected.set(key, remainingCount - 1);
      continue;
    }
    if (
      isManagedHookCommand(
        registration.command,
        expectedCommands,
        cwd,
        meta,
        platform,
        manifestManagedCommands,
      )
    ) {
      return true;
    }
  }
  return false;
}

function collectHookCommandsByEvent(hooks: unknown): Map<string, string[]> {
  if (!hooks || typeof hooks !== "object" || Array.isArray(hooks)) {
    return new Map();
  }

  const commandsByEvent = new Map<string, string[]>();
  for (const [event, value] of Object.entries(hooks)) {
    if (!Array.isArray(value)) {
      continue;
    }
    for (const group of value) {
      if (!group || typeof group !== "object") {
        continue;
      }
      const hookItems = (group as { hooks?: unknown }).hooks;
      if (!Array.isArray(hookItems)) {
        continue;
      }
      for (const hook of hookItems) {
        if (!hook || typeof hook !== "object") {
          continue;
        }
        const command = (hook as { command?: unknown }).command;
        if (typeof command === "string") {
          const eventCommands = commandsByEvent.get(event) ?? [];
          eventCommands.push(command);
          commandsByEvent.set(event, eventCommands);
        }
      }
    }
  }
  return commandsByEvent;
}

function isManagedHookCommand(
  command: string,
  expectedCommands: Set<string>,
  cwd: string,
  meta: PlatformMeta,
  platform: AgentPlatform,
  manifestManagedCommands: Set<string>,
): boolean {
  if (expectedCommands.has(command)) {
    return true;
  }
  if (manifestManagedCommands.has(command)) {
    return true;
  }

  const hookPath = extractHookPathFromCommand(command);
  return hookPath === null ? false : isCurrentProjectManagedHookPath(cwd, hookPath, meta, platform);
}

function isCurrentProjectManagedHookPath(
  cwd: string,
  hookPath: string,
  meta: PlatformMeta,
  platform: AgentPlatform,
): boolean {
  const normalizedHookPath = normalizePathForHookComparison(hookPath);
  const configDir = normalizePathForHookComparison(meta.templateContext.platform_config_dir);

  return MANAGED_HOOK_SCRIPT_NAMES[platform].some((scriptName) => {
    const relativeHookPath = `${configDir}/hooks/${scriptName}`;
    if (normalizedHookPath === relativeHookPath) {
      return true;
    }
    return pathAliases(
      normalizePathForHookComparison(path.resolve(cwd, relativeHookPath)),
    ).includes(normalizedHookPath);
  });
}

function normalizePathForHookComparison(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "");
}

function pathAliases(value: string): string[] {
  const aliases = new Set([value]);
  if (value.startsWith("/private/var/")) {
    aliases.add(value.replace(/^\/private\/var\//, "/var/"));
  } else if (value.startsWith("/var/")) {
    aliases.add(`/private${value}`);
  }
  return [...aliases];
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
