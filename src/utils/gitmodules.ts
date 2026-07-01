import { lstat, realpath } from "node:fs/promises";
import path from "node:path";
import type { SubmoduleEntry } from "../types/supermodule.js";
import { readTextIfExists } from "./file-writer.js";

export async function parseGitmodules(rootDir: string): Promise<SubmoduleEntry[]> {
  const content = await readTextIfExists(path.join(rootDir, ".gitmodules"));
  if (content === null) {
    return [];
  }

  const entries: SubmoduleEntry[] = [];
  let current: Partial<SubmoduleEntry> | null = null;

  const flushCurrent = () => {
    if (current?.name && current.path) {
      entries.push({
        name: current.name,
        path: current.path,
        url: current.url ?? "",
      });
    }
  };

  for (const rawLine of content.split(/\r?\n/)) {
    const line = stripGitConfigInlineComment(rawLine).trim();
    if (!line || line.startsWith("#") || line.startsWith(";")) {
      continue;
    }

    const section = line.match(/^\[submodule\s+"(.+)"\]$/i);
    if (section) {
      flushCurrent();
      current = { name: section[1] };
      continue;
    }

    if (!current) {
      continue;
    }

    const keyValue = line.match(/^([A-Za-z0-9_.-]+)\s*=\s*(.*)$/);
    if (!keyValue) {
      continue;
    }

    const key = keyValue[1].toLowerCase();
    const value = unquote(keyValue[2].trim());
    if (key === "path") {
      current.path = normalizeSubmodulePath(value);
      continue;
    }
    if (key === "url") {
      current.url = value;
    }
  }

  flushCurrent();
  return entries.sort((a, b) => a.path.localeCompare(b.path));
}

export async function listInstallableSubmodules(rootDir: string): Promise<SubmoduleEntry[]> {
  const entries = await parseGitmodules(rootDir);
  const installable: SubmoduleEntry[] = [];

  for (const entry of entries) {
    if (await isSubmoduleWorktree(rootDir, entry.path)) {
      installable.push(entry);
    }
  }

  return installable;
}

function normalizeSubmodulePath(value: string): string {
  const normalized = value
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "")
    .trim();
  const parts = normalized.split("/").filter(Boolean);

  // .gitmodules is repository-controlled input; reject paths that would escape the parent root.
  if (
    normalized === "" ||
    path.posix.isAbsolute(normalized) ||
    path.win32.isAbsolute(value) ||
    parts.some((part) => part === "..")
  ) {
    throw new Error(`Unsafe submodule path in .gitmodules: ${value}`);
  }

  return parts.join("/");
}

function unquote(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function stripGitConfigInlineComment(value: string): string {
  let inQuotes = false;
  let escaped = false;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (inQuotes && char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && (char === "#" || char === ";") && isCommentStart(value, index)) {
      return value.slice(0, index);
    }
  }

  return value;
}

function isCommentStart(value: string, index: number): boolean {
  return index === 0 || /\s/.test(value[index - 1]);
}

async function isSubmoduleWorktree(rootDir: string, submodulePath: string): Promise<boolean> {
  const dir = path.join(rootDir, submodulePath);
  try {
    if (!(await pathHasNoSymlinkSegments(rootDir, submodulePath))) {
      return false;
    }

    const rootRealPath = await realpath(rootDir);
    const dirRealPath = await realpath(dir);
    if (!isInsideDirectory(rootRealPath, dirRealPath)) {
      return false;
    }

    const dirStat = await lstat(dir);
    if (!dirStat.isDirectory()) {
      return false;
    }

    const gitMarkerStat = await lstat(path.join(dir, ".git"));
    return (
      !gitMarkerStat.isSymbolicLink() && (gitMarkerStat.isFile() || gitMarkerStat.isDirectory())
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function pathHasNoSymlinkSegments(rootDir: string, submodulePath: string): Promise<boolean> {
  let current = rootDir;
  for (const part of submodulePath.split("/")) {
    current = path.join(current, part);
    const partStat = await lstat(current);
    if (partStat.isSymbolicLink()) {
      return false;
    }
  }
  return true;
}

function isInsideDirectory(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}
