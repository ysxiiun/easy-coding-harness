import path from "node:path";
import { cancel, multiselect } from "@clack/prompts";
import { CONFIG_FILE, EASY_CODING_DIR } from "../constants/paths.js";
import type {
  SubmoduleEntry,
  SupermoduleBoundary,
  SupermoduleConfig,
} from "../types/supermodule.js";
import { readConfigYaml } from "../utils/config-yaml.js";
import { pathExists } from "../utils/file-writer.js";
import { listInstallableSubmodules, parseGitmodules } from "../utils/gitmodules.js";
import { type PlatformOptions, resolveSubmodules } from "./platforms.js";

export interface CommandTarget {
  dir: string;
  label: string;
  configPath: string;
  supermodule: SupermoduleConfig;
  boundary?: SupermoduleBoundary;
}

export interface InitSubmoduleSelection {
  installable: SubmoduleEntry[];
  installed: SubmoduleEntry[];
  selected: SubmoduleEntry[];
  parentSubmodulePaths: string[];
}

export function rejectSubmoduleListWithoutGitmodules(
  opts: Pick<PlatformOptions, "submodules">,
): void {
  if (typeof opts.submodules === "string") {
    throw new Error("--submodules can only be used in a repository with .gitmodules.");
  }
}

export async function resolveAddAgentTargets(
  cwd: string,
  opts: PlatformOptions,
): Promise<CommandTarget[]> {
  const installedSubmodules = await listInstalledSubmodules(cwd);
  if ((await parseGitmodules(cwd)).length === 0) {
    rejectSubmoduleListWithoutGitmodules(opts);
    return [standaloneTarget(cwd)];
  }

  const selected = await resolveSubmodules(opts, installedSubmodules);
  const parentManagedSubmodulePaths = await listParentManagedSubmodulePaths(cwd);
  const parentSubmodulePaths = [
    ...new Set([...parentManagedSubmodulePaths, ...selected.map((entry) => entry.path)]),
  ].sort();
  return [
    parentTargetFromPaths(cwd, parentSubmodulePaths),
    ...selected.map((entry) => childTarget(cwd, entry)),
  ];
}

export async function resolveUpgradeTargets(cwd: string): Promise<CommandTarget[]> {
  const installedSubmodules = await listInstalledSubmodules(cwd);
  if ((await parseGitmodules(cwd)).length === 0) {
    return [standaloneTarget(cwd)];
  }

  return [
    parentTarget(cwd, installedSubmodules),
    ...installedSubmodules.map((entry) => childTarget(cwd, entry)),
  ];
}

export async function resolveInitSubmoduleSelection(
  cwd: string,
  opts: PlatformOptions,
): Promise<InitSubmoduleSelection> {
  const installable = await listInstallableSubmodules(cwd);
  const installed = await listInstalledSubmodules(cwd);
  const parentManagedSubmodulePaths = await listParentManagedSubmodulePaths(cwd);
  const defaultSelection = installable;
  const selected = await resolveSubmodules(opts, installable, defaultSelection);
  const parentSubmodulePaths = [
    ...new Set([...parentManagedSubmodulePaths, ...selected.map((entry) => entry.path)]),
  ].sort();

  return { installable, installed, selected, parentSubmodulePaths };
}

export async function resolveClearTargets(
  cwd: string,
  opts: { yes?: boolean; submodules?: string | false },
): Promise<CommandTarget[]> {
  if ((await parseGitmodules(cwd)).length === 0) {
    rejectSubmoduleListWithoutGitmodules(opts);
    return [standaloneTarget(cwd)];
  }

  const installedSubmodules = await listInstalledSubmodules(cwd);
  const parent = (await pathExists(path.join(cwd, EASY_CODING_DIR)))
    ? parentTarget(cwd, installedSubmodules)
    : null;
  const children = installedSubmodules.map((entry) => childTarget(cwd, entry));

  if (opts.submodules === false) {
    return parent ? [parent] : [];
  }

  if (typeof opts.submodules === "string") {
    return [
      ...(parent ? [parent] : []),
      ...parseSubmoduleSelection(opts.submodules, installedSubmodules).map((entry) =>
        childTarget(cwd, entry),
      ),
    ];
  }

  if (opts.yes) {
    return parent ? [parent] : [];
  }

  const candidates = [...(parent ? [parent] : []), ...children];
  if (candidates.length === 0) {
    return [];
  }

  const result = await multiselect({
    message: "Select Easy Coding harness targets to clear",
    options: candidates.map((target) => ({
      label: target.label === "." ? "parent repository" : `submodule: ${target.label}`,
      value: target.label,
    })),
    initialValues: parent ? [parent.label] : [],
    required: true,
  });

  if (typeof result === "symbol") {
    cancel("Clear target selection cancelled.");
    process.exit(1);
  }

  const selected = new Set(result);
  return candidates.filter((target) => selected.has(target.label));
}

async function listInstalledSubmodules(cwd: string): Promise<SubmoduleEntry[]> {
  const entries = await listInstallableSubmodules(cwd);
  const installed: SubmoduleEntry[] = [];

  for (const entry of entries) {
    if (await pathExists(configPath(path.join(cwd, entry.path)))) {
      installed.push(entry);
    }
  }

  return installed;
}

async function listParentManagedSubmodulePaths(cwd: string): Promise<string[]> {
  const parentConfigPath = configPath(cwd);
  if (!(await pathExists(parentConfigPath))) {
    return [];
  }

  try {
    const config = await readConfigYaml(parentConfigPath);
    if (
      config.supermodule?.role !== "super-parent" ||
      !Array.isArray(config.supermodule.submodules)
    ) {
      return [];
    }
    return config.supermodule.submodules
      .filter((submodulePath): submodulePath is string => typeof submodulePath === "string")
      .sort();
  } catch {
    return [];
  }
}

function standaloneTarget(cwd: string): CommandTarget {
  return {
    dir: cwd,
    label: ".",
    configPath: configPath(cwd),
    supermodule: { role: "standalone" },
  };
}

function parentTarget(cwd: string, installedSubmodules: SubmoduleEntry[]): CommandTarget {
  const submodulePaths = installedSubmodules.map((entry) => entry.path);
  return parentTargetFromPaths(cwd, submodulePaths);
}

function parentTargetFromPaths(cwd: string, submodulePaths: string[]): CommandTarget {
  return {
    dir: cwd,
    label: ".",
    configPath: configPath(cwd),
    supermodule: { role: "super-parent", submodules: submodulePaths },
    boundary: { submodulePaths },
  };
}

function childTarget(cwd: string, entry: SubmoduleEntry): CommandTarget {
  const dir = path.join(cwd, entry.path);
  return {
    dir,
    label: entry.path,
    configPath: configPath(dir),
    supermodule: { role: "submodule-child", parent: toPosixRelative(dir, cwd) },
  };
}

function parseSubmoduleSelection(
  submoduleList: string,
  available: SubmoduleEntry[],
): SubmoduleEntry[] {
  const requested = submoduleList
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (requested.length === 0) {
    throw new Error("No submodule specified.");
  }

  const byPathOrName = new Map<string, SubmoduleEntry>();
  for (const submodule of available) {
    byPathOrName.set(submodule.path, submodule);
    byPathOrName.set(submodule.name, submodule);
  }

  const selected: SubmoduleEntry[] = [];
  const invalid: string[] = [];
  for (const value of requested) {
    const submodule = byPathOrName.get(value);
    if (!submodule) {
      invalid.push(value);
      continue;
    }
    if (!selected.some((item) => item.path === submodule.path)) {
      selected.push(submodule);
    }
  }

  if (invalid.length > 0) {
    throw new Error(`Unknown or unavailable initialized submodule: ${invalid.join(", ")}`);
  }

  return selected.sort((a, b) => a.path.localeCompare(b.path));
}

function configPath(cwd: string): string {
  return path.join(cwd, EASY_CODING_DIR, CONFIG_FILE);
}

function toPosixRelative(from: string, to: string): string {
  const relative = path.relative(from, to);
  return relative ? relative.split(path.sep).join("/") : ".";
}
