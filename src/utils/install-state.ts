import { readdir } from "node:fs/promises";
import path from "node:path";
import {
  CONFIG_FILE,
  EASY_CODING_DIR,
  PROJECT_INIT_TASK_ID,
  TASKS_DIR,
} from "../constants/paths.js";
import { isDirectory, pathExists } from "./file-writer.js";

export type EasyCodingInstallState =
  | { kind: "fresh"; easyCodingDir: string }
  | { kind: "installed"; easyCodingDir: string; configPath: string }
  | {
      kind: "legacy";
      easyCodingDir: string;
      legacyAssets: string[];
      missingHarnessFiles: string[];
    }
  | { kind: "unknown"; easyCodingDir: string };

const LEGACY_ROOT_FILES = ["SOUL.md", "RULES.md", "ABSTRACT.md"];

export async function detectEasyCodingInstallState(cwd: string): Promise<EasyCodingInstallState> {
  const easyCodingDir = path.join(cwd, EASY_CODING_DIR);
  if (!(await pathExists(easyCodingDir))) {
    return { kind: "fresh", easyCodingDir };
  }

  const configPath = path.join(easyCodingDir, CONFIG_FILE);
  if (await pathExists(configPath)) {
    return { kind: "installed", easyCodingDir, configPath };
  }

  const legacyAssets = await detectLegacyAssets(easyCodingDir);
  if (legacyAssets.length === 0) {
    return { kind: "unknown", easyCodingDir };
  }

  return {
    kind: "legacy",
    easyCodingDir,
    legacyAssets,
    missingHarnessFiles: [relativeConfigPath(), relativeProjectInitTaskPath()],
  };
}

async function detectLegacyAssets(easyCodingDir: string): Promise<string[]> {
  const assets: string[] = [];

  for (const file of LEGACY_ROOT_FILES) {
    if (await pathExists(path.join(easyCodingDir, file))) {
      assets.push(relativeEasyCodingPath(file));
    }
  }

  if (await pathExists(path.join(easyCodingDir, "memory", "long", "MEMORY.md"))) {
    assets.push(relativeEasyCodingPath("memory", "long", "MEMORY.md"));
  }

  const shortMemoryFiles = await listMarkdownFiles(path.join(easyCodingDir, "memory", "short"));
  assets.push(...shortMemoryFiles.map((file) => relativeEasyCodingPath("memory", "short", file)));

  for (const dir of ["spec", "prototype"]) {
    if (await hasAnyDirectoryEntry(path.join(easyCodingDir, dir))) {
      assets.push(relativeEasyCodingPath(dir));
    }
  }

  return assets.sort();
}

async function listMarkdownFiles(dir: string): Promise<string[]> {
  if (!(await isDirectory(dir))) {
    return [];
  }

  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => entry.name)
    .sort();
}

async function hasAnyDirectoryEntry(dir: string): Promise<boolean> {
  if (!(await isDirectory(dir))) {
    return false;
  }

  return (await readdir(dir)).length > 0;
}

function relativeEasyCodingPath(...segments: string[]): string {
  return path.posix.join(EASY_CODING_DIR, ...segments);
}

function relativeConfigPath(): string {
  return path.posix.join(EASY_CODING_DIR, CONFIG_FILE);
}

function relativeProjectInitTaskPath(): string {
  return path.posix.join(EASY_CODING_DIR, TASKS_DIR, PROJECT_INIT_TASK_ID, "task.json");
}
