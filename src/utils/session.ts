import { readdir, unlink } from "node:fs/promises";
import path from "node:path";
import { EASY_CODING_DIR, SESSIONS_DIR } from "../constants/paths.js";
import type { SessionFile } from "../types/task.js";
import { ensureDir, pathExists, readTextIfExists, writeTextFile } from "./file-writer.js";

const STALE_THRESHOLD_MS = 30 * 24 * 60 * 60 * 1000;
const SESSION_KEY_PATTERN = /^[A-Za-z0-9._-]+$/;

export type SessionFileWithMetadata = SessionFile & {
  agent?: string;
  external_session_id?: string | null;
  session_key?: string;
  session_source?: string;
  last_active_at?: string;
  last_agent?: string;
};

export interface SessionEntry {
  key: string;
  filePath: string;
  session: SessionFileWithMetadata;
}

function parseSessionFile(content: string): SessionFileWithMetadata | null {
  try {
    return JSON.parse(content) as SessionFileWithMetadata;
  } catch {
    return null;
  }
}

export function getSessionDir(cwd: string): string {
  return path.join(cwd, EASY_CODING_DIR, SESSIONS_DIR);
}

export function getSessionFilePath(cwd: string, sessionKey: string | number): string {
  const normalizedKey = String(sessionKey);
  if (
    !normalizedKey ||
    normalizedKey === "." ||
    normalizedKey === ".." ||
    !SESSION_KEY_PATTERN.test(normalizedKey)
  ) {
    throw new Error(`Unsafe session key: ${normalizedKey}`);
  }
  return path.join(getSessionDir(cwd), `${normalizedKey}.json`);
}

export function createSessionFile(currentTask: string | null = null): SessionFileWithMetadata {
  const timestamp = new Date().toISOString();
  return {
    current_task: currentTask,
    created_at: timestamp,
    last_active_at: timestamp,
  };
}

export async function readSessionFile(
  cwd: string,
  sessionKey: string | number,
): Promise<SessionFileWithMetadata | null> {
  const content = await readTextIfExists(getSessionFilePath(cwd, sessionKey));
  if (!content) {
    return null;
  }
  return JSON.parse(content) as SessionFileWithMetadata;
}

export async function writeSessionFile(
  cwd: string,
  session: SessionFileWithMetadata,
  sessionKey: string | number,
): Promise<void> {
  const dir = getSessionDir(cwd);
  await ensureDir(dir);
  await writeTextFile(getSessionFilePath(cwd, sessionKey), JSON.stringify(session, null, 2));
}

export async function ensureSessionFile(
  cwd: string,
  sessionKey: string | number,
): Promise<SessionFileWithMetadata> {
  const existing = await readSessionFile(cwd, sessionKey);
  if (existing) {
    return existing;
  }
  const session = createSessionFile();
  await writeSessionFile(cwd, session, sessionKey);
  return session;
}

export async function listSessionFiles(cwd: string): Promise<SessionEntry[]> {
  const dir = getSessionDir(cwd);
  if (!(await pathExists(dir))) {
    return [];
  }

  const entries: SessionEntry[] = [];
  for (const name of await readdir(dir)) {
    if (!name.endsWith(".json")) {
      continue;
    }
    const filePath = path.join(dir, name);
    const content = await readTextIfExists(filePath);
    if (!content) {
      continue;
    }
    const session = parseSessionFile(content);
    if (!session) {
      continue;
    }
    entries.push({
      key: name.slice(0, -".json".length),
      filePath,
      session,
    });
  }
  return entries.sort((left, right) => left.key.localeCompare(right.key));
}

export async function cleanStaleSessions(
  cwd: string,
  staleThresholdMs = STALE_THRESHOLD_MS,
): Promise<number> {
  const now = Date.now();
  let cleaned = 0;
  for (const entry of await listSessionFiles(cwd)) {
    if (entry.session.current_task) {
      continue;
    }
    const activityValue = entry.session.last_active_at ?? entry.session.created_at;
    const activityTime = new Date(activityValue).getTime();
    if (Number.isNaN(activityTime) || now - activityTime <= staleThresholdMs) {
      continue;
    }
    await unlink(entry.filePath);
    cleaned++;
  }
  return cleaned;
}
