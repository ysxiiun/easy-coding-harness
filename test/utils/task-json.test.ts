import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createProjectInitTask,
  getTaskJsonPath,
  isActiveTask,
  listTasks,
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
});
