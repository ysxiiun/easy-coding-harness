import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createProjectInitTask,
  getTaskJsonPath,
  hasLegacyWorkflowState,
  isActiveTask,
  listTasks,
  migrateLegacyWorkflowState,
  readTaskJson,
  stripInitTaskProjectPath,
  writeTaskJson,
} from "../../src/utils/task-json.js";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "ec-task-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("task-json", () => {
  it("lists task folders and detects active tasks", async () => {
    await writeTaskJson(
      path.join(tempDir, ".easy-coding", "tasks", "project-init", "task.json"),
      createProjectInitTask({
        agents: ["claude-code"],
        now: new Date("2026-06-09T00:00:00Z"),
      }),
    );
    await writeTaskJson(path.join(tempDir, ".easy-coding", "tasks", "06-09-demo", "task.json"), {
      type: "feature",
      status: "IMPLEMENT",
      created_at: "2026-06-09T01:00:00Z",
      created_by: "claude-code",
      last_agent: "claude-code",
      stage_history: [
        { stage: "IMPLEMENT", agent: "claude-code", entered_at: "2026-06-09T01:00:00Z" },
      ],
      context: {},
      spawned_from: null,
      spawned_tasks: [],
      closed_reason: null,
      repos: ["main"],
    });

    const tasks = await listTasks(tempDir);
    expect(tasks.map((item) => item.id)).toEqual(["06-09-demo", "project-init"]);
    expect(tasks.filter((item) => isActiveTask(item.task)).map((item) => item.id)).toEqual([
      "06-09-demo",
      "project-init",
    ]);
  });

  it("omits the local absolute project_path from the init task", () => {
    const task = createProjectInitTask({ agents: ["claude-code"] });
    expect(task.context).toBeDefined();
    expect(task.context).not.toHaveProperty("project_path");
  });

  it("strips a legacy project_path from an existing init task idempotently", async () => {
    const filePath = getTaskJsonPath(tempDir, "project-init");
    await writeTaskJson(filePath, {
      type: "project-init",
      status: "PENDING",
      created_at: "2026-06-09T00:00:00Z",
      created_by: "cli-init",
      last_agent: "cli",
      stage_history: [],
      context: { cli_version: "0.5.1", project_path: "/Users/someone/local/repo" },
      init_log: [],
    });

    expect(await stripInitTaskProjectPath(tempDir)).toBe(true);
    expect(await stripInitTaskProjectPath(tempDir)).toBe(false);

    const task = await readTaskJson(filePath);
    expect(task.context).not.toHaveProperty("project_path");
    expect(task.context?.cli_version).toBe("0.5.1");
  });

  it("no-ops stripInitTaskProjectPath when the init task is absent", async () => {
    expect(await stripInitTaskProjectPath(tempDir)).toBe(false);
  });

  it("migrates legacy stages, pending confirmation, memory progress, and sessions", async () => {
    const waitingPath = getTaskJsonPath(tempDir, "waiting");
    await mkdir(path.dirname(waitingPath), { recursive: true });
    await writeFile(
      waitingPath,
      JSON.stringify({
        type: "feature",
        status: "WAITING_CONFIRM",
        created_at: "2026-07-01T00:00:00Z",
        created_by: "codex",
        last_agent: "codex",
        stage_history: [
          { stage: "ANALYSIS", agent: "codex", entered_at: "2026-07-01T00:00:00Z" },
          { stage: "WAITING_CONFIRM", agent: "codex", entered_at: "2026-07-01T00:01:00Z" },
        ],
      }),
      "utf8",
    );
    const memoryPath = getTaskJsonPath(tempDir, "memory");
    await mkdir(path.dirname(memoryPath), { recursive: true });
    await writeFile(
      memoryPath,
      JSON.stringify({
        type: "feature",
        status: "MEMORY_LONG",
        created_at: "2026-07-01T00:00:00Z",
        created_by: "claude-code",
        last_agent: "claude-code",
        stage_history: [
          { stage: "MEMORY_SHORT", agent: "claude-code", entered_at: "2026-07-01T00:02:00Z" },
          { stage: "MEMORY_LONG", agent: "claude-code", entered_at: "2026-07-01T00:03:00Z" },
        ],
      }),
      "utf8",
    );
    const sessionPath = path.join(tempDir, ".easy-coding", "sessions", "123.json");
    await mkdir(path.dirname(sessionPath), { recursive: true });
    await writeFile(
      sessionPath,
      JSON.stringify({ current_task: "waiting", last_seen_stage: "WAITING_CONFIRM" }),
      "utf8",
    );

    expect(await hasLegacyWorkflowState(tempDir)).toBe(true);
    expect(await migrateLegacyWorkflowState(tempDir)).toEqual({
      tasksUpdated: 2,
      sessionsUpdated: 1,
    });
    expect(await migrateLegacyWorkflowState(tempDir)).toEqual({
      tasksUpdated: 0,
      sessionsUpdated: 0,
    });
    expect(await hasLegacyWorkflowState(tempDir)).toBe(false);

    const waiting = JSON.parse(await readFile(waitingPath, "utf8"));
    expect(waiting.status).toBe("ANALYSIS");
    expect(waiting.stage_history.map((entry: { stage: string }) => entry.stage)).toEqual([
      "ANALYSIS",
    ]);
    expect(waiting.pending_transition).toMatchObject({ from: "ANALYSIS", to: "IMPLEMENT" });

    const memory = JSON.parse(await readFile(memoryPath, "utf8"));
    expect(memory.status).toBe("MEMORY");
    expect(memory.stage_history.map((entry: { stage: string }) => entry.stage)).toEqual([
      "MEMORY",
    ]);
    expect(memory.memory_progress.short_memory_written).toBe(true);
    expect(memory.memory_progress.legacy_short_memory_assumed).toBe(true);

    const session = JSON.parse(await readFile(sessionPath, "utf8"));
    expect(session.last_seen_stage).toBe("ANALYSIS");
  });
});
