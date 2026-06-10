import path from "node:path";
import { SESSIONS_GITIGNORE_ENTRY } from "../constants/paths.js";
import { readTextIfExists, writeTextFile } from "./file-writer.js";

export async function ensureGitignoreEntry(
  cwd: string,
  entry: string,
  heading = "# ═══ easy-coding-harness (auto-generated) ═══\n# Personal runtime state; do not commit",
): Promise<boolean> {
  const gitignorePath = path.join(cwd, ".gitignore");
  const current = (await readTextIfExists(gitignorePath)) ?? "";
  const lines = current.split(/\r?\n/).map((line) => line.trim());

  if (lines.includes(entry)) {
    return false;
  }

  const prefix = current.trimEnd();
  const next = [prefix, heading, entry].filter(Boolean).join("\n");
  await writeTextFile(gitignorePath, next);
  return true;
}

export function gitignoreContains(content: string, entry: string): boolean {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .includes(entry);
}

export async function ensureEasyCodingSessionsIgnored(cwd: string): Promise<boolean> {
  return ensureGitignoreEntry(cwd, SESSIONS_GITIGNORE_ENTRY);
}
