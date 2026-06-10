import { readdir } from "node:fs/promises";
import path from "node:path";
import { EASY_CODING_DIR, PROJECT_INIT_TASK_ID, TASKS_DIR } from "../constants/paths.js";
import { VERSION } from "../constants/version.js";
import type { AgentPlatform } from "../types/platform.js";
import type { Stage, TaskJson, TaskStatus } from "../types/task.js";
import { pathExists, readTextFile, writeTextFile } from "./file-writer.js";

export type ProjectInitSource = "fresh" | "legacy-easy-coding";

export function createProjectInitTask(params: {
  cwd: string;
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
      project_path: params.cwd,
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
      cwd,
      agents,
      initSource: options.initSource,
      legacyAssets: options.legacyAssets,
      legacyMissingHarnessFiles: options.legacyMissingHarnessFiles,
    }),
  );
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
