import { readdir } from "node:fs/promises";
import path from "node:path";
import { EASY_CODING_DIR, SESSIONS_DIR } from "../constants/paths.js";
import type { SessionFile } from "../types/task.js";
import { ensureDir, pathExists, readTextIfExists, writeTextFile } from "./file-writer.js";

const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000;

export function getSessionDir(cwd: string): string {
  return path.join(cwd, EASY_CODING_DIR, SESSIONS_DIR);
}

export function getSessionFilePath(cwd: string, ppid?: number): string {
  const pid = ppid ?? process.ppid;
  return path.join(getSessionDir(cwd), `${pid}.json`);
}

export function createSessionFile(currentTask: string | null = null): SessionFile {
  return {
    current_task: currentTask,
    created_at: new Date().toISOString(),
  };
}

export async function readSessionFile(cwd: string, ppid?: number): Promise<SessionFile | null> {
  const content = await readTextIfExists(getSessionFilePath(cwd, ppid));
  if (!content) {
    return null;
  }
  return JSON.parse(content) as SessionFile;
}

export async function writeSessionFile(
  cwd: string,
  session: SessionFile,
  ppid?: number,
): Promise<void> {
  const dir = getSessionDir(cwd);
  await ensureDir(dir);
  await writeTextFile(getSessionFilePath(cwd, ppid), JSON.stringify(session, null, 2));
}

export async function ensureSessionFile(cwd: string): Promise<SessionFile> {
  const existing = await readSessionFile(cwd);
  if (existing) {
    return existing;
  }
  const session = createSessionFile();
  await writeSessionFile(cwd, session);
  return session;
}

export async function cleanStaleSessions(cwd: string): Promise<number> {
  const dir = getSessionDir(cwd);
  if (!(await pathExists(dir))) {
    return 0;
  }

  const now = Date.now();
  const entries = await readdir(dir);
  let cleaned = 0;

  for (const entry of entries) {
    if (!entry.endsWith(".json")) {
      continue;
    }

    const filePath = path.join(dir, entry);
    const content = await readTextIfExists(filePath);
    if (!content) {
      continue;
    }

    let session: SessionFile;
    try {
      session = JSON.parse(content) as SessionFile;
    } catch {
      continue;
    }

    const age = now - new Date(session.created_at).getTime();
    if (age <= STALE_THRESHOLD_MS) {
      continue;
    }

    const pid = Number.parseInt(entry.replace(".json", ""), 10);
    if (Number.isNaN(pid)) {
      continue;
    }

    if (isProcessAlive(pid)) {
      continue;
    }

    const { unlink } = await import("node:fs/promises");
    await unlink(filePath);
    cleaned++;
  }

  return cleaned;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
