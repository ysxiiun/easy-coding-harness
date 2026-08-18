import { readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { EASY_CODING_DIR, SESSIONS_DIR, TASKS_DIR } from "../constants/paths.js";
import type { SessionFile, TaskJson } from "../types/task.js";
import {
  ensureDir,
  pathExists,
  readTextFile,
  readTextIfExists,
  writeTextFile,
} from "./file-writer.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const IDLE_SESSION_RETENTION_MS = 7 * DAY_MS;
const ATTACHED_SESSION_RETENTION_MS = 30 * DAY_MS;
const MAX_SESSION_FILES = 100;
const SESSION_KEY_PATTERN = /^[A-Za-z0-9._-]+$/;

export type SessionFileWithMetadata = SessionFile & {
  external_session_id?: string | null;
  session_key?: string;
  session_source?: string;
  last_active_at?: string;
};

export interface SessionEntry {
  key: string;
  filePath: string;
  session: SessionFileWithMetadata;
}

export interface SessionCleanupOptions {
  idleRetentionMs?: number;
  attachedRetentionMs?: number;
  maxSessions?: number;
  reserveSlots?: number;
}

export interface SessionCleanupResult {
  sessionsRemoved: number;
  acceptanceSnapshotsRemoved: number;
}

interface SessionCleanupCandidate {
  filePath: string;
  content: string;
  activityTime: number;
  attached: boolean;
}

function parseSessionFile(content: string): SessionFileWithMetadata | null {
  try {
    const parsed: unknown = JSON.parse(content);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as SessionFileWithMetadata)
      : null;
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
  return parseSessionFile(content);
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
  await cleanSessionRuntime(cwd, { reserveSlots: 1 });
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

export async function cleanSessionRuntime(
  cwd: string,
  options: SessionCleanupOptions = {},
): Promise<SessionCleanupResult> {
  const now = Date.now();
  const idleRetentionMs = options.idleRetentionMs ?? IDLE_SESSION_RETENTION_MS;
  const attachedRetentionMs = options.attachedRetentionMs ?? ATTACHED_SESSION_RETENTION_MS;
  const maxSessions = options.maxSessions ?? MAX_SESSION_FILES;
  const reserveSlots = options.reserveSlots ?? 0;
  const candidates = await listSessionCleanupCandidates(cwd);
  const removed = new Set<string>();

  for (const candidate of candidates) {
    const retentionMs = candidate.attached ? attachedRetentionMs : idleRetentionMs;
    if (now - candidate.activityTime <= retentionMs) {
      continue;
    }
    if (await unlinkIfUnchanged(candidate)) {
      removed.add(candidate.filePath);
    }
  }

  const allowedExistingSessions = Math.max(0, maxSessions - reserveSlots);
  const remaining = candidates
    .filter((candidate) => !removed.has(candidate.filePath))
    .sort((left, right) => left.activityTime - right.activityTime);
  for (const candidate of remaining.slice(
    0,
    Math.max(0, remaining.length - allowedExistingSessions),
  )) {
    if (await unlinkIfUnchanged(candidate)) {
      removed.add(candidate.filePath);
    }
  }

  return {
    sessionsRemoved: removed.size,
    acceptanceSnapshotsRemoved: await cleanOrphanAcceptanceSnapshots(cwd),
  };
}

async function listSessionCleanupCandidates(cwd: string): Promise<SessionCleanupCandidate[]> {
  const dir = getSessionDir(cwd);
  if (!(await pathExists(dir))) {
    return [];
  }

  const candidates: SessionCleanupCandidate[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) {
      continue;
    }
    const filePath = path.join(dir, entry.name);
    try {
      const [content, fileStat] = await Promise.all([readTextFile(filePath), stat(filePath)]);
      const session = parseSessionFile(content);
      const activityValue = session?.last_active_at ?? session?.created_at;
      const parsedActivity =
        typeof activityValue === "string" ? new Date(activityValue).getTime() : Number.NaN;
      candidates.push({
        filePath,
        content,
        activityTime: Number.isNaN(parsedActivity) ? fileStat.mtimeMs : parsedActivity,
        attached: Boolean(session?.current_task),
      });
    } catch (error) {
      if (!isFileNotFound(error)) {
        throw error;
      }
    }
  }
  return candidates;
}

async function unlinkIfUnchanged(candidate: SessionCleanupCandidate): Promise<boolean> {
  try {
    // 删除前复核内容，避免清理扫描之后的并发刷新被旧候选覆盖。
    if ((await readTextFile(candidate.filePath)) !== candidate.content) {
      return false;
    }
    await unlink(candidate.filePath);
    return true;
  } catch (error) {
    if (isFileNotFound(error)) {
      return false;
    }
    throw error;
  }
}

async function cleanOrphanAcceptanceSnapshots(cwd: string): Promise<number> {
  const acceptanceDir = path.join(getSessionDir(cwd), "acceptance");
  if (!(await pathExists(acceptanceDir))) {
    return 0;
  }

  let removed = 0;
  for (const entry of await readdir(acceptanceDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) {
      continue;
    }
    const snapshotPath = path.join(acceptanceDir, entry.name);
    if (!(await isOrphanAcceptanceSnapshot(cwd, snapshotPath, entry.name.slice(0, -5)))) {
      continue;
    }
    try {
      await unlink(snapshotPath);
      removed++;
    } catch (error) {
      if (!isFileNotFound(error)) {
        throw error;
      }
    }
  }
  return removed;
}

async function isOrphanAcceptanceSnapshot(
  cwd: string,
  snapshotPath: string,
  taskId: string,
): Promise<boolean> {
  let taskContent: string;
  try {
    taskContent = await readTextFile(
      path.join(cwd, EASY_CODING_DIR, TASKS_DIR, taskId, "task.json"),
    );
  } catch (error) {
    if (isFileNotFound(error)) {
      return true;
    }
    throw error;
  }

  let parsedTask: unknown;
  try {
    parsedTask = JSON.parse(taskContent);
  } catch {
    return false;
  }
  if (typeof parsedTask !== "object" || parsedTask === null || Array.isArray(parsedTask)) {
    return false;
  }
  const task = parsedTask as TaskJson;
  if (task.status === "COMPLETE" || task.status === "CLOSED") {
    return true;
  }

  const checkpoint = task.verification_checkpoint;
  return (
    typeof checkpoint?.snapshot_file !== "string" ||
    path.resolve(cwd, checkpoint.snapshot_file) !== path.resolve(snapshotPath)
  );
}

function isFileNotFound(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}
