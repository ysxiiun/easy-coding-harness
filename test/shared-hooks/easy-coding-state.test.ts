import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "ec-state-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

function stateApiPath(): string {
  return path.join(process.cwd(), "src", "templates", "shared-hooks", "easy_coding_state.py");
}

async function writeTaskFixture(
  taskId: string,
  status: string,
  lastAgent: string,
): Promise<void> {
  await mkdir(path.join(tempDir, ".easy-coding", "tasks", taskId), { recursive: true });
  await writeFile(
    path.join(tempDir, ".easy-coding", "tasks", taskId, "task.json"),
    JSON.stringify(
      {
        type: "feature",
        title: `${taskId} fixture`,
        status,
        created_at: "2026-06-26T00:00:00Z",
        created_by: lastAgent,
        last_agent: lastAgent,
        stage_history: [{ stage: status, agent: lastAgent }],
      },
      null,
      2,
    ),
    "utf8",
  );
}

async function writeSessionFixture(currentTask: string | null): Promise<void> {
  await mkdir(path.join(tempDir, ".easy-coding", "sessions"), { recursive: true });
  await writeFile(
    path.join(tempDir, ".easy-coding", "sessions", "test.json"),
    JSON.stringify(
      {
        current_task: currentTask,
        created_at: "2026-06-26T00:00:00Z",
      },
      null,
      2,
    ),
    "utf8",
  );
}

async function writeMemoryLongFixture(shortCount: number): Promise<string> {
  await mkdir(path.join(tempDir, ".easy-coding", "sessions"), { recursive: true });
  await mkdir(path.join(tempDir, ".easy-coding", "tasks", "06-23-memory"), {
    recursive: true,
  });
  await mkdir(path.join(tempDir, ".easy-coding", "memory", "short"), { recursive: true });
  await writeFile(
    path.join(tempDir, ".easy-coding", "config.yaml"),
    [
      "version: 1",
      "memory:",
      "  short_term_max: 10",
      "  short_term_keep: 5",
      "  schema_version: 2",
      "",
    ].join("\n"),
    "utf8",
  );
  await writeFile(
    path.join(tempDir, ".easy-coding", "sessions", "test.json"),
    JSON.stringify(
      {
        current_task: "06-23-memory",
        created_at: "2026-06-23T00:00:00Z",
      },
      null,
      2,
    ),
    "utf8",
  );
  await writeFile(
    path.join(tempDir, ".easy-coding", "tasks", "06-23-memory", "task.json"),
    JSON.stringify(
      {
        type: "feature",
        title: "Memory gate fixture",
        status: "MEMORY_SHORT",
        created_at: "2026-06-23T00:00:00Z",
        created_by: "codex",
        last_agent: "codex",
        stage_history: [{ stage: "MEMORY_SHORT", agent: "codex" }],
      },
      null,
      2,
    ),
    "utf8",
  );

  for (let index = 1; index <= shortCount; index += 1) {
    await writeFile(
      path.join(
        tempDir,
        ".easy-coding",
        "memory",
        "short",
        `${String(index).padStart(3, "0")}_20260623_item-${index}.md`,
      ),
      [
        "---",
        "memory_schema: 2",
        `id: SM-20260623-${String(index).padStart(3, "0")}`,
        "---",
        "",
        `Short memory ${index}`,
        "",
      ].join("\n"),
      "utf8",
    );
  }
  await writeFile(
    path.join(tempDir, ".easy-coding", "memory", "short", "legacy-schema.md"),
    ["---", "memory_schema: 1", "---", "", "Legacy short memory", ""].join("\n"),
    "utf8",
  );

  return stateApiPath();
}

function transitionMemoryLong(scriptPath: string) {
  const output = execFileSync(
    "python3",
    [
      scriptPath,
      "transition",
      "--session-file",
      ".easy-coding/sessions/test.json",
      "--stage",
      "MEMORY_LONG",
      "--agent",
      "codex",
    ],
    {
      cwd: tempDir,
      encoding: "utf8",
    },
  );
  return JSON.parse(output) as {
    memory_long: Record<string, unknown>;
    status_line: string;
    status_context: string;
  };
}

describe("easy_coding_state.py MEMORY_LONG instruction", () => {
  it("returns no-op when short memory count is below threshold", async () => {
    const scriptPath = await writeMemoryLongFixture(1);

    const snapshot = transitionMemoryLong(scriptPath);

    expect(snapshot.memory_long).toEqual({
      short_count: 1,
      short_term_max: 10,
      short_term_keep: 5,
      action: "no-op",
      trim_count: 0,
    });
    expect(snapshot.status_line).toContain("> **Easy Coding** · `06-23-memory` · `MEMORY_LONG`");
    expect(snapshot.status_context).toContain("[workflow-state:MEMORY_LONG]");
  });

  it("returns distill instructions and trim count when threshold is exceeded", async () => {
    const scriptPath = await writeMemoryLongFixture(12);

    const snapshot = transitionMemoryLong(scriptPath);

    expect(snapshot.memory_long).toEqual({
      short_count: 12,
      short_term_max: 10,
      short_term_keep: 5,
      action: "distill",
      trim_count: 7,
    });
    expect(snapshot.status_line).toContain("> **Easy Coding** · `06-23-memory` · `MEMORY_LONG`");
    expect(snapshot.status_context).toContain("[workflow-state:MEMORY_LONG]");
  });
});

describe("easy_coding_state.py handoff and claim", () => {
  it("writes a target-less handoff record and clears the current session pointer", async () => {
    await writeSessionFixture("06-26-handoff");
    await writeTaskFixture("06-26-handoff", "WAITING_CONFIRM", "codex");

    const output = execFileSync(
      "python3",
      [
        stateApiPath(),
        "handoff-task",
        "--session-file",
        ".easy-coding/sessions/test.json",
        "--agent",
        "codex",
        "--summary",
        "Plan is ready for implementation.",
      ],
      { cwd: tempDir, encoding: "utf8" },
    );
    const snapshot = JSON.parse(output) as {
      action: string;
      handoff: Record<string, unknown>;
      status_context: string;
    };

    expect(snapshot.action).toBe("handoff");
    expect(snapshot.handoff).toMatchObject({
      type: "handoff",
      from: "codex",
      stage: "WAITING_CONFIRM",
      summary: "Plan is ready for implementation.",
    });
    expect(snapshot.handoff).not.toHaveProperty("to");
    expect(snapshot.handoff).not.toHaveProperty("next_agent");
    expect(snapshot.status_context).toContain("[workflow-state:idle]");

    const executionLine = await readFile(
      path.join(tempDir, ".easy-coding", "tasks", "06-26-handoff", "execution.jsonl"),
      "utf8",
    );
    const handoff = JSON.parse(executionLine.trim()) as Record<string, unknown>;
    expect(handoff).not.toHaveProperty("to");
    expect(handoff).not.toHaveProperty("next_agent");

    const session = JSON.parse(
      await readFile(path.join(tempDir, ".easy-coding", "sessions", "test.json"), "utf8"),
    );
    expect(session.current_task).toBeNull();
  });

  it("marks task list entries as continue or takeover for the current agent", async () => {
    await writeSessionFixture(null);
    await writeTaskFixture("06-26-continue", "ANALYSIS", "codex");
    await writeTaskFixture("06-26-takeover", "IMPLEMENT", "claude-code");
    await writeFile(
      path.join(tempDir, ".easy-coding", "tasks", "06-26-takeover", "execution.jsonl"),
      JSON.stringify({
        type: "handoff",
        from: "claude-code",
        stage: "IMPLEMENT",
        summary: "Implementation is half done.",
        timestamp: "2026-06-26T00:00:00Z",
      }) + "\n",
      "utf8",
    );

    const output = execFileSync(
      "python3",
      [stateApiPath(), "list-tasks", "--agent", "codex"],
      { cwd: tempDir, encoding: "utf8" },
    );
    const listed = JSON.parse(output) as {
      tasks: Array<{
        id: string;
        action: string;
        previous_agent: string | null;
        latest_handoff: { summary: string } | null;
      }>;
    };

    const continued = listed.tasks.find((task) => task.id === "06-26-continue");
    const takeover = listed.tasks.find((task) => task.id === "06-26-takeover");
    expect(continued?.action).toBe("continue");
    expect(continued?.previous_agent).toBeNull();
    expect(takeover?.action).toBe("takeover");
    expect(takeover?.previous_agent).toBe("claude-code");
    expect(takeover?.latest_handoff?.summary).toBe("Implementation is half done.");
  });

  it("claims a task and updates the task owner to the current agent", async () => {
    await writeSessionFixture(null);
    await writeTaskFixture("06-26-claim", "IMPLEMENT", "claude-code");
    await writeFile(
      path.join(tempDir, ".easy-coding", "tasks", "06-26-claim", "execution.jsonl"),
      JSON.stringify({
        type: "handoff",
        from: "claude-code",
        stage: "IMPLEMENT",
        summary: "Continue from unit B.",
        timestamp: "2026-06-26T00:00:00Z",
      }) + "\n",
      "utf8",
    );

    const output = execFileSync(
      "python3",
      [
        stateApiPath(),
        "claim-task",
        "--session-file",
        ".easy-coding/sessions/test.json",
        "--task-id",
        "06-26-claim",
        "--agent",
        "codex",
      ],
      { cwd: tempDir, encoding: "utf8" },
    );
    const snapshot = JSON.parse(output) as {
      action: string;
      previous_agent: string;
      latest_handoff: { summary: string };
      status_context: string;
    };

    expect(snapshot.action).toBe("takeover");
    expect(snapshot.previous_agent).toBe("claude-code");
    expect(snapshot.latest_handoff.summary).toBe("Continue from unit B.");
    expect(snapshot.status_context).toContain("[current-task:06-26-claim]");

    const task = JSON.parse(
      await readFile(path.join(tempDir, ".easy-coding", "tasks", "06-26-claim", "task.json"), "utf8"),
    );
    const session = JSON.parse(
      await readFile(path.join(tempDir, ".easy-coding", "sessions", "test.json"), "utf8"),
    );
    expect(task.last_agent).toBe("codex");
    expect(session.current_task).toBe("06-26-claim");
  });

  it("rejects claiming terminal tasks", async () => {
    await writeSessionFixture(null);
    await writeTaskFixture("06-26-done", "COMPLETE", "codex");

    const result = spawnSync(
      "python3",
      [
        stateApiPath(),
        "claim-task",
        "--session-file",
        ".easy-coding/sessions/test.json",
        "--task-id",
        "06-26-done",
        "--agent",
        "claude-code",
      ],
      { cwd: tempDir, encoding: "utf8" },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Cannot claim terminal task: 06-26-done");
  });
});
