import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { EASY_CODING_DIR, INSTALL_MANIFEST_FILE } from "../constants/paths.js";
import { type AgentPlatform, isAgentPlatform } from "../types/platform.js";
import { pathExists, readTextIfExists, writeTextFile } from "./file-writer.js";

export type InstallFileKind = "skill" | "hook" | "agent" | "platform-config";

export type InstallArtifact =
  | {
      type: "file";
      kind: InstallFileKind;
      filePath: string;
      platform: AgentPlatform;
    }
  | {
      type: "hook-registration";
      configPath: string;
      command: string;
      hookPath: string | null;
      platform: AgentPlatform;
    }
  | {
      type: "constraint-region";
      filePath: string;
      platform: AgentPlatform;
    };

export interface InstallManifest {
  schema_version: 1;
  harness_version: string;
  generated_at: string;
  agents: AgentPlatform[];
  files: InstallManifestFile[];
  hook_registrations: InstallManifestHookRegistration[];
  constraint_regions: InstallManifestConstraintRegion[];
}

export interface InstallManifestFile {
  path: string;
  kind: InstallFileKind;
  platform: AgentPlatform;
  sha256: string;
}

export interface InstallManifestHookRegistration {
  config_path: string;
  command: string;
  hook_path: string | null;
  platform: AgentPlatform;
}

export interface InstallManifestConstraintRegion {
  path: string;
  platform: AgentPlatform;
}

export function fileArtifact(
  filePath: string,
  kind: InstallFileKind,
  platform: AgentPlatform,
): InstallArtifact {
  return { type: "file", kind, filePath, platform };
}

export function constraintRegionArtifact(
  filePath: string,
  platform: AgentPlatform,
): InstallArtifact {
  return { type: "constraint-region", filePath, platform };
}

export async function hookRegistrationArtifacts(
  configPath: string,
  platform: AgentPlatform,
): Promise<InstallArtifact[]> {
  const content = await readTextIfExists(configPath);
  if (content === null) {
    return [];
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(content) as Record<string, unknown>;
  } catch {
    return [];
  }

  return collectHookCommands(parsed.hooks).map((command) => ({
    type: "hook-registration",
    configPath,
    command,
    hookPath: extractHookPathFromCommand(command),
    platform,
  }));
}

export async function writeInstallManifest(
  cwd: string,
  params: {
    harnessVersion: string;
    agents: AgentPlatform[];
    artifacts: InstallArtifact[];
    mode?: "replace" | "merge";
  },
): Promise<void> {
  const existing = params.mode === "merge" ? await readInstallManifest(cwd) : null;
  const files = new Map<string, InstallManifestFile>();
  const hookRegistrations = new Map<string, InstallManifestHookRegistration>();
  const constraintRegions = new Map<string, InstallManifestConstraintRegion>();

  if (existing) {
    for (const file of existing.files) {
      files.set(file.path, file);
    }
    for (const registration of existing.hook_registrations) {
      hookRegistrations.set(
        `${registration.config_path}\0${normalizeCommand(registration.command)}`,
        registration,
      );
    }
    for (const region of existing.constraint_regions) {
      constraintRegions.set(region.path, region);
    }
  }

  for (const artifact of params.artifacts) {
    if (artifact.type === "file") {
      if (!(await pathExists(artifact.filePath))) {
        continue;
      }
      const relPath = toProjectPath(cwd, artifact.filePath);
      files.set(relPath, {
        path: relPath,
        kind: artifact.kind,
        platform: artifact.platform,
        sha256: await sha256File(artifact.filePath),
      });
      continue;
    }

    if (artifact.type === "hook-registration") {
      const configPath = toProjectPath(cwd, artifact.configPath);
      const registration = {
        config_path: configPath,
        command: artifact.command,
        hook_path: artifact.hookPath ? normalizeHookPath(cwd, artifact.hookPath) : null,
        platform: artifact.platform,
      };
      hookRegistrations.set(`${configPath}\0${normalizeCommand(artifact.command)}`, registration);
      continue;
    }

    const relPath = toProjectPath(cwd, artifact.filePath);
    constraintRegions.set(relPath, {
      path: relPath,
      platform: artifact.platform,
    });
  }

  const manifest: InstallManifest = {
    schema_version: 1,
    harness_version: params.harnessVersion,
    generated_at: new Date().toISOString(),
    agents: [...new Set([...(existing?.agents ?? []), ...params.agents])],
    files: [...files.values()].sort(byPath),
    hook_registrations: [...hookRegistrations.values()].sort((a, b) =>
      `${a.config_path}\0${a.command}`.localeCompare(`${b.config_path}\0${b.command}`),
    ),
    constraint_regions: [...constraintRegions.values()].sort(byPath),
  };

  await writeTextFile(
    path.join(cwd, EASY_CODING_DIR, INSTALL_MANIFEST_FILE),
    JSON.stringify(manifest, null, 2),
  );
}

export async function readInstallManifest(cwd: string): Promise<InstallManifest | null> {
  const manifestPath = path.join(cwd, EASY_CODING_DIR, INSTALL_MANIFEST_FILE);
  const content = await readTextIfExists(manifestPath);
  if (content === null) {
    return null;
  }

  try {
    const parsed = JSON.parse(content) as Partial<InstallManifest>;
    if (
      parsed.schema_version !== 1 ||
      !Array.isArray(parsed.files) ||
      !Array.isArray(parsed.hook_registrations) ||
      !Array.isArray(parsed.constraint_regions)
    ) {
      return null;
    }
    const agents = Array.isArray(parsed.agents)
      ? parsed.agents.filter((agent): agent is AgentPlatform => isAgentPlatform(agent))
      : [];
    return { ...parsed, agents } as InstallManifest;
  } catch {
    return null;
  }
}

export async function manifestFileMatches(filePath: string, sha256: string): Promise<boolean> {
  if (!(await pathExists(filePath))) {
    return false;
  }
  return (await sha256File(filePath)) === sha256;
}

export function manifestPath(cwd: string, projectPath: string): string {
  return resolveProjectPath(cwd, projectPath);
}

export function toProjectPath(cwd: string, filePath: string): string {
  const root = path.resolve(cwd);
  const resolved = path.resolve(filePath);
  assertPathInsideProject(root, resolved, filePath);
  return path.relative(root, resolved).split(path.sep).join("/");
}

export function normalizeCommand(command: string): string {
  return command.replace(/\\/g, "/").trim().replace(/\s+/g, " ");
}

async function sha256File(filePath: string): Promise<string> {
  const content = await readFile(filePath);
  return createHash("sha256").update(content).digest("hex");
}

function resolveProjectPath(cwd: string, projectPath: string): string {
  const normalized = projectPath.replace(/\\/g, "/");
  const parts = normalized.split("/");
  if (
    normalized.trim() === "" ||
    path.isAbsolute(projectPath) ||
    path.posix.isAbsolute(normalized) ||
    path.win32.isAbsolute(projectPath) ||
    /^[A-Za-z]:/.test(projectPath) ||
    parts.some((part) => part === "..")
  ) {
    throw new Error(`Unsafe install manifest path: ${projectPath}`);
  }

  const root = path.resolve(cwd);
  const resolved = path.resolve(root, normalized);
  assertPathInsideProject(root, resolved, projectPath);
  return resolved;
}

function assertPathInsideProject(root: string, resolvedPath: string, sourcePath: string): void {
  const relative = path.relative(root, resolvedPath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Unsafe install manifest path: ${sourcePath}`);
  }
}

function collectHookCommands(hooks: unknown): string[] {
  if (!hooks || typeof hooks !== "object" || Array.isArray(hooks)) {
    return [];
  }

  const commands: string[] = [];
  for (const value of Object.values(hooks)) {
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
          commands.push(command);
        }
      }
    }
  }
  return commands;
}

export function extractHookPathFromCommand(command: string): string | null {
  return extractQuotedHookPath(command) ?? extractUnquotedHookPath(command);
}

function extractQuotedHookPath(command: string): string | null {
  for (let index = 0; index < command.length; index += 1) {
    const quote = command[index];
    if (quote !== '"' && quote !== "'") {
      continue;
    }
    if (index > 0 && !/\s/.test(command[index - 1])) {
      continue;
    }

    const parsed = parseQuotedToken(command, index, quote);
    if (!parsed) {
      continue;
    }

    const suffix = readPathSuffix(command, parsed.endIndex);
    for (const candidate of [parsed.value + suffix, parsed.value]) {
      if (isHookPythonPath(candidate)) {
        return candidate;
      }
    }
    index = parsed.endIndex;
  }
  return null;
}

function parseQuotedToken(
  command: string,
  startIndex: number,
  quote: '"' | "'",
): { value: string; endIndex: number } | null {
  let value = "";
  for (let index = startIndex + 1; index < command.length; index += 1) {
    const char = command[index];
    if (quote === '"' && char === "\\" && index + 1 < command.length) {
      value += command[index + 1];
      index += 1;
      continue;
    }
    if (char === quote) {
      return { value, endIndex: index + 1 };
    }
    value += char;
  }
  return null;
}

function readPathSuffix(command: string, startIndex: number): string {
  if (command[startIndex] !== "/") {
    return "";
  }
  let suffix = "";
  for (let index = startIndex; index < command.length; index += 1) {
    const char = command[index];
    if (/\s/.test(char)) {
      break;
    }
    suffix += char;
  }
  return suffix;
}

function extractUnquotedHookPath(command: string): string | null {
  const match = command.match(/(?:^|\s)(\S+\/hooks\/\S+\.py)(?:\s|$)/);
  return match?.[1] ?? null;
}

function isHookPythonPath(candidate: string): boolean {
  return /\/hooks\/\S+\.py$/.test(candidate);
}

function normalizeHookPath(cwd: string, hookPath: string): string {
  const normalized = hookPath.replace(/\\/g, "/").replace(/^\.\//, "");
  if (
    path.isAbsolute(hookPath) ||
    path.posix.isAbsolute(normalized) ||
    path.win32.isAbsolute(hookPath)
  ) {
    return toProjectPath(cwd, hookPath);
  }
  return normalized;
}

function byPath<T extends { path: string }>(a: T, b: T): number {
  return a.path.localeCompare(b.path);
}
