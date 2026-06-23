import { readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { cancel, confirm, outro } from "@clack/prompts";
import chalk from "chalk";
import {
  CONFIG_FILE,
  EASY_CODING_DIR,
  INSTALL_MANIFEST_FILE,
  SESSIONS_DIR,
  TEMPLATES_DIR,
} from "../constants/paths.js";
import {
  AGENT_PLATFORMS,
  type AgentPlatform,
  PLATFORM_META,
  type PlatformMeta,
  isAgentPlatform,
} from "../types/platform.js";
import { renderBanner } from "../ui/banner.js";
import { readConfigYaml } from "../utils/config-yaml.js";
import { pathExists, readTextIfExists } from "../utils/file-writer.js";
import {
  type InstallManifest,
  manifestFileMatches,
  manifestPath,
  normalizeCommand,
  readInstallManifest,
} from "../utils/install-manifest.js";
import { removeMarkedRegion } from "../utils/marked-region.js";
import { resolvePlatformMeta, resolveQoderVariantMetas } from "../utils/platform-paths.js";
import { getTemplatePath } from "../utils/template-paths.js";

export interface ClearOptions {
  dryRun?: boolean;
  yes?: boolean;
}

interface ClearPlan {
  remove: string[];
  removeFiles: ManifestFileRemoval[];
  skippedModified: string[];
  pruneHookConfigs: HookConfigPrune[];
  constraints: string[];
  emptyDirs: string[];
}

interface ManifestFileRemoval {
  filePath: string;
  expectedSha256: string;
}

interface HookConfigPrune {
  filePath: string;
  managedHookPaths: string[];
  managedHookCommands: string[];
}

interface MutableClearPlan {
  remove: Set<string>;
  removeFiles: ManifestFileRemoval[];
  skippedModified: string[];
  pruneHookConfigs: Map<string, Set<string>>;
  pruneHookCommands: Map<string, Set<string>>;
  constraints: Set<string>;
  emptyDirs: Set<string>;
}

const PLATFORM_TEMPLATE_DIR: Record<AgentPlatform, string> = {
  "claude-code": "claude",
  codex: "codex",
  qoder: "qoder",
};

export async function clear(opts: ClearOptions): Promise<void> {
  renderBanner();

  const cwd = process.cwd();
  const easyCodingDir = path.join(cwd, EASY_CODING_DIR);
  if (!(await pathExists(easyCodingDir))) {
    throw new Error("No .easy-coding directory found in this project — nothing to clear.");
  }

  const agents = await resolveInstalledAgents(cwd);
  const plan = await buildClearPlan(cwd, agents);

  console.log(renderPlan(cwd, agents, plan));

  if (opts.dryRun) {
    return;
  }

  if (!opts.yes) {
    const ok = await confirm({
      message: "Remove these harness files? Tasks, spec, memory, and knowledge files are kept.",
      initialValue: false,
    });
    if (typeof ok === "symbol" || !ok) {
      cancel("Clear cancelled.");
      return;
    }
  }

  await executeClearPlan(plan);
  outro(chalk.green("Easy Coding harness removed. Run easy-coding init to reinstall."));
}

async function resolveInstalledAgents(cwd: string): Promise<AgentPlatform[]> {
  const configPath = path.join(cwd, EASY_CODING_DIR, CONFIG_FILE);
  if (await pathExists(configPath)) {
    try {
      const config = await readConfigYaml(configPath);
      const listed = Array.isArray(config.agents) ? config.agents.filter(isAgentPlatform) : [];
      if (listed.length > 0) {
        return listed;
      }
    } catch {
      // unreadable or legacy config — fall back to on-disk detection
    }
  }

  const detected: AgentPlatform[] = [];
  for (const platform of AGENT_PLATFORMS) {
    if (await hasPlatformInstall(cwd, platform)) {
      detected.push(platform);
    }
  }
  return detected;
}

async function hasPlatformInstall(cwd: string, platform: AgentPlatform): Promise<boolean> {
  const metas =
    platform === "qoder" ? resolveQoderVariantMetas() : [resolvePlatformMeta(cwd, platform)];
  for (const meta of metas) {
    if (await hasInstallMarkers(cwd, meta)) {
      return true;
    }
  }
  return false;
}

async function hasInstallMarkers(cwd: string, meta: PlatformMeta): Promise<boolean> {
  const markers = [meta.skillsDir, meta.hooksDir, meta.agentsDir, meta.hookConfigFile];
  for (const marker of markers) {
    if (await pathExists(path.join(cwd, marker))) {
      return true;
    }
  }
  return false;
}

async function resolveClearPlatformMetas(
  cwd: string,
  platform: AgentPlatform,
): Promise<PlatformMeta[]> {
  if (platform !== "qoder") {
    return [resolvePlatformMeta(cwd, platform)];
  }

  const installed: PlatformMeta[] = [];
  for (const meta of resolveQoderVariantMetas()) {
    if (await hasInstallMarkers(cwd, meta)) {
      installed.push(meta);
    }
  }

  return installed.length > 0 ? installed : [resolvePlatformMeta(cwd, platform)];
}

async function buildClearPlan(cwd: string, agents: AgentPlatform[]): Promise<ClearPlan> {
  const manifest = await readInstallManifest(cwd);
  if (manifest) {
    const plan = await buildManifestClearPlan(cwd, agents, manifest);
    const manifestAgents = new Set(manifest.agents.filter(isAgentPlatform));
    const missingAgents = agents.filter((agent) => !manifestAgents.has(agent));
    if (missingAgents.length > 0) {
      mergeClearPlan(plan, await buildTemplateClearPlan(cwd, missingAgents));
    }
    if (manifestAgents.has("qoder") && agents.includes("qoder")) {
      const uncoveredQoderMetas = await resolveManifestUncoveredQoderMetas(cwd, manifest);
      if (uncoveredQoderMetas.length > 0) {
        mergeClearPlan(
          plan,
          await buildTemplateClearPlanForMetas(cwd, "qoder", uncoveredQoderMetas),
        );
      }
    }
    addRuntimeClearEntries(plan, cwd);
    return plan;
  }

  const plan = await buildTemplateClearPlan(cwd, agents);
  addRuntimeClearEntries(plan, cwd);
  return plan;
}

async function buildManifestClearPlan(
  cwd: string,
  agents: AgentPlatform[],
  manifest: InstallManifest,
): Promise<ClearPlan> {
  const plan = createClearPlan();
  const agentSet = new Set(agents);

  for (const file of manifest.files) {
    if (!agentSet.has(file.platform)) {
      continue;
    }
    const filePath = manifestPath(cwd, file.path);
    if (!(await pathExists(filePath))) {
      continue;
    }
    if (await manifestFileMatches(filePath, file.sha256)) {
      plan.removeFiles.push({ filePath, expectedSha256: file.sha256 });
      addEmptyDirChain(plan.emptyDirs, path.dirname(filePath), cwd);
    } else {
      plan.skippedModified.push(filePath);
    }
  }

  for (const registration of manifest.hook_registrations) {
    if (!agentSet.has(registration.platform)) {
      continue;
    }
    addHookConfigPrune(
      plan.pruneHookConfigs,
      plan.pruneHookCommands,
      manifestPath(cwd, registration.config_path),
      registration.hook_path ? [registration.hook_path] : [],
      [registration.command],
    );
  }

  for (const region of manifest.constraint_regions) {
    if (!agentSet.has(region.platform)) {
      continue;
    }
    plan.constraints.add(manifestPath(cwd, region.path));
  }

  return finalizeClearPlan(plan);
}

async function buildTemplateClearPlan(cwd: string, agents: AgentPlatform[]): Promise<ClearPlan> {
  const plan = createClearPlan();
  const managedSkills = await listDirNames(getTemplatePath("common", "skills"));
  managedSkills.push(...(await listDirNames(getTemplatePath("common", "bundled-skills"))));

  for (const platform of agents) {
    const metas = await resolveClearPlatformMetas(cwd, platform);
    await addTemplateClearEntries(plan, cwd, platform, metas, managedSkills);
  }

  return finalizeClearPlan(plan);
}

async function buildTemplateClearPlanForMetas(
  cwd: string,
  platform: AgentPlatform,
  metas: PlatformMeta[],
): Promise<ClearPlan> {
  const plan = createClearPlan();
  const managedSkills = await listDirNames(getTemplatePath("common", "skills"));
  managedSkills.push(...(await listDirNames(getTemplatePath("common", "bundled-skills"))));
  await addTemplateClearEntries(plan, cwd, platform, metas, managedSkills);
  return finalizeClearPlan(plan);
}

async function addTemplateClearEntries(
  plan: MutableClearPlan,
  cwd: string,
  platform: AgentPlatform,
  metas: PlatformMeta[],
  managedSkills: string[],
): Promise<void> {
  const hookFileNames = await listSharedHookNamesForPlatform(platform);
  const agentFileNames = await listFileNames(
    getTemplatePath(PLATFORM_TEMPLATE_DIR[platform], "agents"),
  );

  for (const meta of metas) {
    for (const name of managedSkills) {
      plan.remove.add(path.join(cwd, meta.skillsDir, name));
    }
    for (const name of hookFileNames) {
      plan.remove.add(path.join(cwd, meta.hooksDir, name));
    }
    for (const name of agentFileNames) {
      plan.remove.add(path.join(cwd, meta.agentsDir, name));
    }

    addHookConfigPrune(
      plan.pruneHookConfigs,
      plan.pruneHookCommands,
      path.join(cwd, meta.hookConfigFile),
      hookFileNames.map((name) => `${meta.templateContext.platform_config_dir}/hooks/${name}`),
      [],
    );
    plan.constraints.add(path.join(cwd, meta.mainConstraint));

    if (platform === "codex") {
      plan.remove.add(path.join(cwd, meta.templateContext.platform_config_dir, "config.toml"));
    }

    plan.emptyDirs.add(path.join(cwd, meta.skillsDir));
    plan.emptyDirs.add(path.join(cwd, meta.hooksDir));
    plan.emptyDirs.add(path.join(cwd, meta.agentsDir));
  }
}

async function resolveManifestUncoveredQoderMetas(
  cwd: string,
  manifest: InstallManifest,
): Promise<PlatformMeta[]> {
  const coveredBaseDirs = manifestCoveredQoderBaseDirs(manifest);
  const metas: PlatformMeta[] = [];
  for (const meta of resolveQoderVariantMetas()) {
    const baseDir = meta.templateContext.platform_config_dir;
    if (coveredBaseDirs.has(baseDir)) {
      continue;
    }
    if (await hasInstallMarkers(cwd, meta)) {
      metas.push(meta);
    }
  }
  return metas;
}

function manifestCoveredQoderBaseDirs(manifest: InstallManifest): Set<string> {
  const covered = new Set<string>();
  for (const meta of resolveQoderVariantMetas()) {
    const baseDir = meta.templateContext.platform_config_dir.replace(/\\/g, "/");
    const prefix = `${baseDir}/`;
    if (
      manifest.files.some((file) => file.platform === "qoder" && file.path.startsWith(prefix)) ||
      manifest.hook_registrations.some(
        (registration) =>
          registration.platform === "qoder" &&
          (registration.config_path === meta.hookConfigFile ||
            registration.config_path.startsWith(prefix) ||
            Boolean(registration.hook_path?.startsWith(prefix))),
      )
    ) {
      covered.add(baseDir);
    }
  }
  return covered;
}

function addHookConfigPrune(
  pruneHookConfigs: Map<string, Set<string>>,
  pruneHookCommands: Map<string, Set<string>>,
  filePath: string,
  managedHookPaths: string[],
  managedHookCommands: string[],
): void {
  const existingPaths = pruneHookConfigs.get(filePath) ?? new Set<string>();
  for (const managedHookPath of managedHookPaths) {
    existingPaths.add(managedHookPath);
  }
  pruneHookConfigs.set(filePath, existingPaths);

  const existingCommands = pruneHookCommands.get(filePath) ?? new Set<string>();
  for (const managedHookCommand of managedHookCommands) {
    existingCommands.add(managedHookCommand);
  }
  pruneHookCommands.set(filePath, existingCommands);
}

function createClearPlan(): MutableClearPlan {
  return {
    remove: new Set<string>(),
    removeFiles: [],
    skippedModified: [],
    pruneHookConfigs: new Map<string, Set<string>>(),
    pruneHookCommands: new Map<string, Set<string>>(),
    constraints: new Set<string>(),
    emptyDirs: new Set<string>(),
  };
}

function finalizeClearPlan(plan: MutableClearPlan): ClearPlan {
  return {
    remove: [...plan.remove],
    removeFiles: plan.removeFiles,
    skippedModified: plan.skippedModified,
    pruneHookConfigs: mergeHookConfigPrunes(plan.pruneHookConfigs, plan.pruneHookCommands),
    constraints: [...plan.constraints],
    emptyDirs: [...plan.emptyDirs],
  };
}

function mergeHookConfigPrunes(
  pruneHookConfigs: Map<string, Set<string>>,
  pruneHookCommands: Map<string, Set<string>>,
): HookConfigPrune[] {
  const filePaths = new Set([...pruneHookConfigs.keys(), ...pruneHookCommands.keys()]);
  return [...filePaths].map((filePath) => ({
    filePath,
    managedHookPaths: [...(pruneHookConfigs.get(filePath) ?? new Set<string>())],
    managedHookCommands: [...(pruneHookCommands.get(filePath) ?? new Set<string>())],
  }));
}

function mergeClearPlan(target: ClearPlan, source: ClearPlan): void {
  target.remove = [...new Set([...target.remove, ...source.remove])];
  target.removeFiles = dedupeFileRemovals([...target.removeFiles, ...source.removeFiles]);
  target.skippedModified = [...new Set([...target.skippedModified, ...source.skippedModified])];
  target.constraints = [...new Set([...target.constraints, ...source.constraints])];
  target.emptyDirs = [...new Set([...target.emptyDirs, ...source.emptyDirs])];

  for (const sourcePrune of source.pruneHookConfigs) {
    const existing = target.pruneHookConfigs.find(
      (prune) => prune.filePath === sourcePrune.filePath,
    );
    if (!existing) {
      target.pruneHookConfigs.push(sourcePrune);
      continue;
    }
    existing.managedHookPaths = [
      ...new Set([...existing.managedHookPaths, ...sourcePrune.managedHookPaths]),
    ];
    existing.managedHookCommands = [
      ...new Set([...existing.managedHookCommands, ...sourcePrune.managedHookCommands]),
    ];
  }
}

function dedupeFileRemovals(removals: ManifestFileRemoval[]): ManifestFileRemoval[] {
  const byPath = new Map<string, ManifestFileRemoval>();
  for (const removal of removals) {
    byPath.set(removal.filePath, removal);
  }
  return [...byPath.values()];
}

function addRuntimeClearEntries(plan: ClearPlan, cwd: string): void {
  plan.remove = [
    ...new Set([
      ...plan.remove,
      path.join(cwd, EASY_CODING_DIR, CONFIG_FILE),
      path.join(cwd, EASY_CODING_DIR, SESSIONS_DIR),
      path.join(cwd, EASY_CODING_DIR, TEMPLATES_DIR),
      path.join(cwd, EASY_CODING_DIR, INSTALL_MANIFEST_FILE),
    ]),
  ];
}

function addEmptyDirChain(emptyDirs: Set<string>, startDir: string, cwd: string): void {
  let current = startDir;
  while (current !== cwd && isInsideDirectory(cwd, current)) {
    emptyDirs.add(current);
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
}

function isInsideDirectory(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

async function listSharedHookNamesForPlatform(platform: AgentPlatform): Promise<string[]> {
  const names = await listFileNames(getTemplatePath("shared-hooks"));
  if (PLATFORM_META[platform].hasSubagentContext) {
    return names;
  }
  return names.filter((name) => name !== "inject-subagent-context.py");
}

async function executeClearPlan(plan: ClearPlan): Promise<void> {
  for (const target of plan.removeFiles) {
    if (await manifestFileMatches(target.filePath, target.expectedSha256)) {
      await rm(target.filePath, { force: true });
    }
  }

  for (const target of plan.remove) {
    await rm(target, { recursive: true, force: true });
  }

  for (const config of plan.pruneHookConfigs) {
    await pruneHookConfig(config);
  }

  for (const constraint of plan.constraints) {
    await stripConstraintRegion(constraint);
  }

  for (const dir of sortDirsDeepestFirst(plan.emptyDirs)) {
    await removeIfEmpty(dir);
  }
}

// Removes only the harness's own hook registrations from a settings.json / hooks.json,
// preserving any user-authored config. Deletes the file only when nothing else remains.
async function pruneHookConfig(config: HookConfigPrune): Promise<void> {
  const { filePath, managedHookCommands, managedHookPaths } = config;
  const content = await readTextIfExists(filePath);
  if (content === null) {
    return;
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(content) as Record<string, unknown>;
  } catch {
    return; // malformed or user-owned — leave it untouched
  }

  const hooks = parsed.hooks;
  if (hooks && typeof hooks === "object" && !Array.isArray(hooks)) {
    const cleaned = pruneHookEvents(
      hooks as Record<string, unknown>,
      managedHookPaths,
      managedHookCommands,
    );
    if (cleaned === null) {
      parsed = Object.fromEntries(Object.entries(parsed).filter(([key]) => key !== "hooks"));
    } else {
      parsed.hooks = cleaned;
    }
  }

  if (Object.keys(parsed).length === 0) {
    await rm(filePath, { force: true });
    return;
  }
  await writeFile(filePath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
}

function pruneHookEvents(
  hooks: Record<string, unknown>,
  managedHookPaths: string[],
  managedHookCommands: string[],
): Record<string, unknown> | null {
  const result: Record<string, unknown> = {};
  for (const [event, value] of Object.entries(hooks)) {
    if (!Array.isArray(value)) {
      result[event] = value;
      continue;
    }
    const keptGroups = value
      .map((group) => pruneHookGroup(group, managedHookPaths, managedHookCommands))
      .filter((group) => group !== null);
    if (keptGroups.length > 0) {
      result[event] = keptGroups;
    }
  }
  return Object.keys(result).length === 0 ? null : result;
}

function pruneHookGroup(
  group: unknown,
  managedHookPaths: string[],
  managedHookCommands: string[],
): unknown {
  if (!group || typeof group !== "object") {
    return group;
  }
  const entry = group as { hooks?: unknown };
  if (!Array.isArray(entry.hooks)) {
    return group;
  }
  const keptHooks = entry.hooks.filter(
    (hook) => !isManagedHook(hook, managedHookPaths, managedHookCommands),
  );
  if (keptHooks.length === 0) {
    return null;
  }
  return { ...(group as Record<string, unknown>), hooks: keptHooks };
}

function isManagedHook(
  hook: unknown,
  managedHookPaths: string[],
  managedHookCommands: string[],
): boolean {
  if (!hook || typeof hook !== "object") {
    return false;
  }
  const command = (hook as { command?: unknown }).command;
  if (typeof command !== "string") {
    return false;
  }
  const normalizedManagedCommands = managedHookCommands.map(normalizeCommand);
  if (normalizedManagedCommands.includes(normalizeCommand(command))) {
    return true;
  }
  const normalizedCommand = command.replace(/\\/g, "/");
  return managedHookPaths.some((hookPath) =>
    commandContainsPathToken(normalizedCommand, hookPath.replace(/\\/g, "/")),
  );
}

function commandContainsPathToken(command: string, targetPath: string): boolean {
  const escaped = targetPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|\\s|["'])${escaped}($|\\s|["'])`).test(command);
}

async function stripConstraintRegion(filePath: string): Promise<void> {
  const content = await readTextIfExists(filePath);
  if (content === null) {
    return;
  }
  const stripped = removeMarkedRegion(content);
  if (stripped !== content) {
    await writeFile(filePath, stripped, "utf8");
  }
}

async function removeIfEmpty(dir: string): Promise<void> {
  try {
    const entries = await readdir(dir);
    if (entries.length === 0) {
      await rm(dir, { recursive: true, force: true });
    }
  } catch {
    // missing directory — nothing to clean
  }
}

function sortDirsDeepestFirst(dirs: string[]): string[] {
  return [...dirs].sort((left, right) => {
    const depthDiff = pathDepth(right) - pathDepth(left);
    return depthDiff === 0 ? left.localeCompare(right) : depthDiff;
  });
}

function pathDepth(dir: string): number {
  return path.normalize(dir).split(path.sep).filter(Boolean).length;
}

async function listDirNames(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    return [];
  }
}

async function listFileNames(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
  } catch {
    return [];
  }
}

function renderPlan(cwd: string, agents: AgentPlatform[], plan: ClearPlan): string {
  const rel = (target: string) => path.relative(cwd, target) || target;
  const lines: string[] = [];
  lines.push(chalk.bold("easy-coding clear"));
  lines.push(`Platforms: ${agents.length > 0 ? agents.join(", ") : "(none detected)"}`);
  lines.push("");
  lines.push("Will remove:");
  for (const target of plan.removeFiles) {
    lines.push(`  - ${rel(target.filePath)}`);
  }
  for (const target of plan.remove) {
    lines.push(`  - ${rel(target)}`);
  }
  if (plan.skippedModified.length > 0) {
    lines.push("Will keep modified manifest files:");
    for (const target of plan.skippedModified) {
      lines.push(`  - ${rel(target)}`);
    }
  }
  if (plan.constraints.length > 0) {
    lines.push("Will strip the generated region from (file kept):");
    for (const target of plan.constraints) {
      lines.push(`  - ${rel(target)}`);
    }
  }
  if (plan.pruneHookConfigs.length > 0) {
    lines.push("Will prune harness hooks from (file kept if other config remains):");
    for (const target of plan.pruneHookConfigs) {
      lines.push(`  - ${rel(target.filePath)}`);
    }
  }
  lines.push("");
  lines.push(
    chalk.dim(
      "Kept: .easy-coding/tasks, spec, memory, project.yaml, and knowledge files (SOUL/RULES/ABSTRACT/TEST_STRATEGY).",
    ),
  );
  return lines.join("\n");
}
