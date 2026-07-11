import { readdir } from "node:fs/promises";
import path from "node:path";
import {
  EASY_CODING_DIR,
  PROJECT_INIT_TASK_ID,
  SESSIONS_DIR,
  TASKS_DIR,
} from "../constants/paths.js";
import { VERSION } from "../constants/version.js";
import type { AgentPlatform } from "../types/platform.js";
import type { Stage, TaskJson, TaskStatus } from "../types/task.js";
import { pathExists, readTextFile, writeTextFile } from "./file-writer.js";

export type ProjectInitSource = "fresh" | "legacy-easy-coding";

type LegacyStage = "WAITING_CONFIRM" | "MEMORY_SHORT" | "MEMORY_LONG";

const LEGACY_STAGE_MAP: Record<LegacyStage, Stage> = {
  WAITING_CONFIRM: "ANALYSIS",
  MEMORY_SHORT: "MEMORY",
  MEMORY_LONG: "MEMORY",
};

export interface WorkflowStateMigrationResult {
  tasksUpdated: number;
  sessionsUpdated: number;
}

export function createProjectInitTask(params: {
  agents: AgentPlatform[];
  initSource?: ProjectInitSource;
  legacyAssets?: string[];
  legacyMissingHarnessFiles?: string[];
  now?: Date;
}): TaskJson {
  return {
    type: "project-init",
    status: "PENDING",
    created_at: (params.now ?? new Date()).toISOString(),
    created_by: "cli-init",
    last_agent: "cli",
    stage_history: [],
    context: {
      agents_installed: params.agents,
      cli_version: VERSION,
      init_source: params.initSource ?? "fresh",
      ...(params.legacyAssets ? { legacy_assets: params.legacyAssets } : {}),
      ...(params.legacyMissingHarnessFiles
        ? { legacy_missing_harness_files: params.legacyMissingHarnessFiles }
        : {}),
    },
    init_log: [],
  };
}

export function enterTaskStage(task: TaskJson, stage: Stage, agent: string): TaskJson {
  return {
    ...task,
    status: stage,
    last_agent: agent,
    stage_history: [
      ...(task.stage_history ?? []),
      { stage, agent, entered_at: new Date().toISOString() },
    ],
  };
}

export function getTaskJsonPath(cwd: string, taskId: string): string {
  return path.join(cwd, EASY_CODING_DIR, TASKS_DIR, taskId, "task.json");
}

export async function writeTaskJson(filePath: string, task: TaskJson): Promise<void> {
  await writeTextFile(filePath, JSON.stringify(task, null, 2));
}

export async function readTaskJson(filePath: string): Promise<TaskJson> {
  return JSON.parse(await readTextFile(filePath)) as TaskJson;
}

export async function writeProjectInitTask(
  cwd: string,
  agents: AgentPlatform[],
  options: {
    initSource?: ProjectInitSource;
    legacyAssets?: string[];
    legacyMissingHarnessFiles?: string[];
  } = {},
): Promise<void> {
  await writeTaskJson(
    getTaskJsonPath(cwd, PROJECT_INIT_TASK_ID),
    createProjectInitTask({
      agents,
      initSource: options.initSource,
      legacyAssets: options.legacyAssets,
      legacyMissingHarnessFiles: options.legacyMissingHarnessFiles,
    }),
  );
}

// Older harness versions wrote an absolute project_path into the committed init
// task, leaking each contributor's local checkout root across a shared repo. Strip
// it on upgrade; idempotent and a no-op when the task or field is absent.
export async function stripInitTaskProjectPath(cwd: string): Promise<boolean> {
  const filePath = getTaskJsonPath(cwd, PROJECT_INIT_TASK_ID);
  if (!(await pathExists(filePath))) return false;
  const task = await readTaskJson(filePath);
  if (!task.context || !("project_path" in task.context)) return false;
  // Assign undefined instead of `delete` (biome noDelete); JSON.stringify drops the
  // key on write, so the persisted task.json no longer carries project_path.
  task.context.project_path = undefined;
  await writeTaskJson(filePath, task);
  return true;
}

function isLegacyStage(value: unknown): value is LegacyStage {
  return typeof value === "string" && value in LEGACY_STAGE_MAP;
}

function migrateStage(value: unknown): unknown {
  return isLegacyStage(value) ? LEGACY_STAGE_MAP[value] : value;
}

function migrateStageHistory(task: Record<string, unknown>): boolean {
  if (!Array.isArray(task.stage_history)) return false;

  let changed = false;
  const migrated: unknown[] = [];
  for (const rawEntry of task.stage_history) {
    if (!rawEntry || typeof rawEntry !== "object" || Array.isArray(rawEntry)) {
      migrated.push(rawEntry);
      continue;
    }
    const entry = { ...(rawEntry as Record<string, unknown>) };
    const mappedStage = migrateStage(entry.stage);
    if (mappedStage !== entry.stage) {
      entry.stage = mappedStage;
      changed = true;
    }
    const previous = migrated.at(-1);
    if (
      previous &&
      typeof previous === "object" &&
      !Array.isArray(previous) &&
      (previous as Record<string, unknown>).stage === entry.stage
    ) {
      changed = true;
      continue;
    }
    migrated.push(entry);
  }

  if (changed) task.stage_history = migrated;
  return changed;
}

function migrateTaskWorkflowState(task: Record<string, unknown>): boolean {
  const legacyStatus = isLegacyStage(task.status) ? task.status : null;
  const legacyRequestedAt = Array.isArray(task.stage_history)
    ? [...task.stage_history]
        .reverse()
        .find(
          (entry) =>
            entry &&
            typeof entry === "object" &&
            !Array.isArray(entry) &&
            (entry as Record<string, unknown>).stage === "WAITING_CONFIRM",
        )
    : null;
  let changed = migrateStageHistory(task);

  if (legacyStatus) {
    task.status = LEGACY_STAGE_MAP[legacyStatus];
    changed = true;
  }

  if (legacyStatus === "WAITING_CONFIRM" && !task.pending_transition) {
    const requestedAt =
      legacyRequestedAt &&
      typeof legacyRequestedAt === "object" &&
      !Array.isArray(legacyRequestedAt)
        ? String(
            (legacyRequestedAt as Record<string, unknown>).entered_at ?? new Date().toISOString(),
          )
        : new Date().toISOString();
    task.pending_transition = {
      from: "ANALYSIS",
      to: "IMPLEMENT",
      requested_at: requestedAt,
      requested_by: String(task.last_agent ?? "upgrade-migration"),
      reason: "migrated-from-WAITING_CONFIRM",
    };
    changed = true;
  }

  if (legacyStatus === "MEMORY_LONG") {
    const progress =
      task.memory_progress && typeof task.memory_progress === "object"
        ? { ...(task.memory_progress as Record<string, unknown>) }
        : {};
    if (progress.short_memory_written !== true) {
      progress.short_memory_written = true;
    }
    progress.legacy_short_memory_assumed = true;
    progress.updated_at = new Date().toISOString();
    task.memory_progress = progress;
    changed = true;
  }

  return changed;
}

async function taskFiles(cwd: string): Promise<string[]> {
  const tasksDir = path.join(cwd, EASY_CODING_DIR, TASKS_DIR);
  if (!(await pathExists(tasksDir))) return [];
  const entries = await readdir(tasksDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(tasksDir, entry.name, "task.json"));
}

async function sessionFiles(cwd: string): Promise<string[]> {
  const sessionsDir = path.join(cwd, EASY_CODING_DIR, SESSIONS_DIR);
  if (!(await pathExists(sessionsDir))) return [];
  const entries = await readdir(sessionsDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => path.join(sessionsDir, entry.name));
}

async function readJsonRecord(filePath: string): Promise<Record<string, unknown> | null> {
  try {
    const parsed = JSON.parse(await readTextFile(filePath));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export async function hasLegacyWorkflowState(cwd: string): Promise<boolean> {
  for (const filePath of await taskFiles(cwd)) {
    if (!(await pathExists(filePath))) continue;
    const task = await readJsonRecord(filePath);
    if (!task) continue;
    if (
      isLegacyStage(task.status) ||
      (Array.isArray(task.stage_history) &&
        task.stage_history.some(
          (entry) =>
            entry &&
            typeof entry === "object" &&
            !Array.isArray(entry) &&
            isLegacyStage((entry as Record<string, unknown>).stage),
        ))
    ) {
      return true;
    }
  }

  for (const filePath of await sessionFiles(cwd)) {
    const session = await readJsonRecord(filePath);
    if (!session) continue;
    if (isLegacyStage(session.last_seen_stage)) return true;
  }
  return false;
}

export async function migrateLegacyWorkflowState(
  cwd: string,
): Promise<WorkflowStateMigrationResult> {
  let tasksUpdated = 0;
  let sessionsUpdated = 0;

  for (const filePath of await taskFiles(cwd)) {
    if (!(await pathExists(filePath))) continue;
    const task = await readJsonRecord(filePath);
    if (!task) continue;
    if (!migrateTaskWorkflowState(task)) continue;
    await writeTextFile(filePath, JSON.stringify(task, null, 2));
    tasksUpdated += 1;
  }

  for (const filePath of await sessionFiles(cwd)) {
    const session = await readJsonRecord(filePath);
    if (!session) continue;
    const mappedStage = migrateStage(session.last_seen_stage);
    if (mappedStage === session.last_seen_stage) continue;
    session.last_seen_stage = mappedStage;
    await writeTextFile(filePath, JSON.stringify(session, null, 2));
    sessionsUpdated += 1;
  }

  return { tasksUpdated, sessionsUpdated };
}

export async function setPendingInitSince(cwd: string, version: string): Promise<void> {
  const filePath = getTaskJsonPath(cwd, PROJECT_INIT_TASK_ID);
  if (!(await pathExists(filePath))) return;
  const task = await readTaskJson(filePath);
  if (task.status !== "COMPLETE") return;
  task.pending_init_since = version;
  await writeTaskJson(filePath, task);
}

export interface TaskSummary {
  id: string;
  task: TaskJson;
}

export async function listTasks(cwd: string): Promise<TaskSummary[]> {
  const tasksDir = path.join(cwd, EASY_CODING_DIR, TASKS_DIR);
  if (!(await pathExists(tasksDir))) {
    return [];
  }

  const entries = await readdir(tasksDir, { withFileTypes: true });
  const tasks: TaskSummary[] = [];

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isDirectory()) {
      continue;
    }

    const taskPath = getTaskJsonPath(cwd, entry.name);
    if (!(await pathExists(taskPath))) {
      continue;
    }

    tasks.push({ id: entry.name, task: await readTaskJson(taskPath) });
  }

  return tasks;
}

export function summarizeTaskStatuses(tasks: TaskSummary[]): Record<TaskStatus, number> {
  return tasks.reduce(
    (summary, item) => {
      summary[item.task.status] = (summary[item.task.status] ?? 0) + 1;
      return summary;
    },
    {} as Record<TaskStatus, number>,
  );
}

export function isActiveTask(task: TaskJson): boolean {
  return task.status !== "COMPLETE" && task.status !== "CLOSED";
}
