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
  extra: Record<string, unknown> = {},
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
        ...extra,
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

async function writeMemoryConfig(shortTermMax: number, shortTermKeep: number): Promise<void> {
  await mkdir(path.join(tempDir, ".easy-coding"), { recursive: true });
  await writeFile(
    path.join(tempDir, ".easy-coding", "config.yaml"),
    [
      "version: 1",
      "memory:",
      `  short_term_max: ${shortTermMax}`,
      `  short_term_keep: ${shortTermKeep}`,
      "  schema_version: 2",
      "",
    ].join("\n"),
    "utf8",
  );
}

async function writeMemoryFixture(
  shortCount: number,
  checkpointIndex: number = shortCount,
): Promise<string> {
  await mkdir(path.join(tempDir, ".easy-coding", "sessions"), { recursive: true });
  await mkdir(path.join(tempDir, ".easy-coding", "tasks", "06-23-memory"), {
    recursive: true,
  });
  await mkdir(path.join(tempDir, ".easy-coding", "memory", "short"), { recursive: true });
  await writeMemoryConfig(10, 5);
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
        status: "MEMORY",
        created_at: "2026-06-23T00:00:00Z",
        created_by: "codex",
        last_agent: "codex",
        stage_history: [{ stage: "MEMORY", agent: "codex" }],
        memory_progress: {},
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
        "source_task: 06-23-memory",
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

  execFileSync(
    "python3",
    [
      stateApiPath(),
      "memory-short-complete",
      "--session-file",
      ".easy-coding/sessions/test.json",
      "--file",
      `.easy-coding/memory/short/${String(checkpointIndex).padStart(3, "0")}_20260623_item-${checkpointIndex}.md`,
      "--agent",
      "codex",
    ],
    { cwd: tempDir, encoding: "utf8" },
  );

  return stateApiPath();
}

function readMemoryInstruction(scriptPath: string) {
  const output = execFileSync(
    "python3",
    [
      scriptPath,
      "memory-instruction",
      "--session-file",
      ".easy-coding/sessions/test.json",
    ],
    {
      cwd: tempDir,
      encoding: "utf8",
    },
  );
  return JSON.parse(output) as {
    memory: Record<string, unknown>;
    status_line: string;
    status_context: string;
  };
}

describe("easy_coding_state.py MEMORY instruction", () => {
  it("rejects a memory window where short_term_keep exceeds short_term_max", async () => {
    const scriptPath = await writeMemoryFixture(6);
    await writeMemoryConfig(5, 10);

    const result = spawnSync(
      "python3",
      [
        scriptPath,
        "memory-instruction",
        "--session-file",
        ".easy-coding/sessions/test.json",
      ],
      { cwd: tempDir, encoding: "utf8" },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "memory.short_term_keep must be less than or equal to memory.short_term_max",
    );
  });

  it("accepts equal max/keep values and still produces a real candidate", async () => {
    const scriptPath = await writeMemoryFixture(6);
    await writeMemoryConfig(5, 5);

    const snapshot = readMemoryInstruction(scriptPath);

    expect(snapshot.memory).toMatchObject({
      action: "distill",
      trim_count: 1,
      checkpoint_disposition: "kept",
    });
    expect(snapshot.memory.candidate_files).toEqual([
      ".easy-coding/memory/short/001_20260623_item-1.md",
    ]);
  });

  it("supports a zero-sized retained window", async () => {
    const scriptPath = await writeMemoryFixture(6);
    await writeMemoryConfig(5, 0);

    const snapshot = readMemoryInstruction(scriptPath);

    expect(snapshot.memory).toMatchObject({
      action: "distill",
      trim_count: 6,
      checkpoint_disposition: "candidate",
      kept_files: [],
    });
    expect(snapshot.memory.candidate_files).toHaveLength(6);
  });

  it("preserves the explicit legacy MEMORY_LONG recovery exception", async () => {
    await writeSessionFixture("06-23-legacy-memory");
    await writeTaskFixture("06-23-legacy-memory", "MEMORY", "codex", {
      memory_progress: {
        short_memory_written: true,
        legacy_short_memory_assumed: true,
      },
    });

    const snapshot = readMemoryInstruction(stateApiPath());

    expect(snapshot.memory).toMatchObject({ action: "no-op", short_count: 0 });
  });

  it("rejects malformed or cross-task short-memory checkpoints", async () => {
    await writeSessionFixture("06-23-invalid-memory");
    await writeTaskFixture("06-23-invalid-memory", "MEMORY", "codex", {
      memory_progress: {},
    });
    const shortDir = path.join(tempDir, ".easy-coding", "memory", "short");
    await mkdir(shortDir, { recursive: true });
    const malformedPath = path.join(shortDir, "001_malformed.md");
    await writeFile(malformedPath, "plain markdown without schema\n", "utf8");

    const malformed = spawnSync(
      "python3",
      [
        stateApiPath(),
        "memory-short-complete",
        "--session-file",
        ".easy-coding/sessions/test.json",
        "--file",
        ".easy-coding/memory/short/001_malformed.md",
        "--agent",
        "codex",
      ],
      { cwd: tempDir, encoding: "utf8" },
    );
    expect(malformed.status).toBe(1);
    expect(malformed.stderr).toContain("must declare memory_schema: 2");

    const reusedPath = path.join(shortDir, "002_reused.md");
    await writeFile(
      reusedPath,
      ["---", "memory_schema: 2", "source_task: another-task", "---", ""].join("\n"),
      "utf8",
    );
    const reused = spawnSync(
      "python3",
      [
        stateApiPath(),
        "memory-short-complete",
        "--session-file",
        ".easy-coding/sessions/test.json",
        "--file",
        ".easy-coding/memory/short/002_reused.md",
        "--agent",
        "codex",
      ],
      { cwd: tempDir, encoding: "utf8" },
    );
    expect(reused.status).toBe(1);
    expect(reused.stderr).toContain("does not match current task 06-23-invalid-memory");
  });

  it("revalidates the short-memory fingerprint before completion", async () => {
    await writeSessionFixture("06-23-fingerprint");
    await writeTaskFixture("06-23-fingerprint", "MEMORY", "codex", {
      memory_progress: {},
    });
    const memoryPath = path.join(
      tempDir,
      ".easy-coding",
      "memory",
      "short",
      "001_fingerprint.md",
    );
    await mkdir(path.dirname(memoryPath), { recursive: true });
    await writeFile(
      memoryPath,
      ["---", "memory_schema: 2", "source_task: 06-23-fingerprint", "---", "original"].join(
        "\n",
      ),
      "utf8",
    );
    execFileSync(
      "python3",
      [
        stateApiPath(),
        "memory-short-complete",
        "--session-file",
        ".easy-coding/sessions/test.json",
        "--file",
        ".easy-coding/memory/short/001_fingerprint.md",
        "--agent",
        "codex",
      ],
      { cwd: tempDir, encoding: "utf8" },
    );
    readMemoryInstruction(stateApiPath());
    await writeFile(
      memoryPath,
      ["---", "memory_schema: 2", "source_task: 06-23-fingerprint", "---", "changed"].join(
        "\n",
      ),
      "utf8",
    );

    const completed = spawnSync(
      "python3",
      [
        stateApiPath(),
        "memory-complete",
        "--session-file",
        ".easy-coding/sessions/test.json",
        "--action",
        "no-op",
        "--agent",
        "codex",
      ],
      { cwd: tempDir, encoding: "utf8" },
    );
    expect(completed.status).toBe(1);
    expect(completed.stderr).toContain("changed after its checkpoint");

    await rm(memoryPath);
    const missing = spawnSync(
      "python3",
      [
        stateApiPath(),
        "memory-complete",
        "--session-file",
        ".easy-coding/sessions/test.json",
        "--action",
        "no-op",
        "--agent",
        "codex",
      ],
      { cwd: tempDir, encoding: "utf8" },
    );
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain("Short-memory file not found");
  });

  it("returns no-op when short memory count is below threshold", async () => {
    const scriptPath = await writeMemoryFixture(1);

    const snapshot = readMemoryInstruction(scriptPath);

    expect(snapshot.memory).toEqual({
      short_count: 1,
      short_term_max: 10,
      short_term_keep: 5,
      action: "no-op",
      trim_count: 0,
      candidate_files: [],
      kept_files: [".easy-coding/memory/short/001_20260623_item-1.md"],
      checkpoint_disposition: "kept",
    });
    expect(snapshot.status_line).toContain("> **Easy Coding** · `06-23-memory` · `MEMORY`");
    expect(snapshot.status_context).toContain("[workflow-state:MEMORY]");
  });

  it("returns distill instructions and trim count when threshold is exceeded", async () => {
    const scriptPath = await writeMemoryFixture(12);

    const snapshot = readMemoryInstruction(scriptPath);

    expect(snapshot.memory).toEqual({
      short_count: 12,
      short_term_max: 10,
      short_term_keep: 5,
      action: "distill",
      trim_count: 7,
      candidate_files: Array.from(
        { length: 7 },
        (_, index) =>
          `.easy-coding/memory/short/${String(index + 1).padStart(3, "0")}_20260623_item-${index + 1}.md`,
      ),
      kept_files: Array.from(
        { length: 5 },
        (_, index) =>
          `.easy-coding/memory/short/${String(index + 8).padStart(3, "0")}_20260623_item-${index + 8}.md`,
      ),
      checkpoint_disposition: "kept",
    });
    expect(snapshot.status_line).toContain("> **Easy Coding** · `06-23-memory` · `MEMORY`");
    expect(snapshot.status_context).toContain("[workflow-state:MEMORY]");

    for (let index = 1; index <= 7; index += 1) {
      await rm(
        path.join(
          tempDir,
          ".easy-coding",
          "memory",
          "short",
          `${String(index).padStart(3, "0")}_20260623_item-${index}.md`,
        ),
      );
    }
    const completed = JSON.parse(
      execFileSync(
        "python3",
        [
          scriptPath,
          "memory-complete",
          "--session-file",
          ".easy-coding/sessions/test.json",
          "--action",
          "distill",
          "--agent",
          "codex",
        ],
        { cwd: tempDir, encoding: "utf8" },
      ),
    ) as { memory_progress: { completed: boolean; long_memory_action: string } };
    expect(completed.memory_progress).toMatchObject({
      completed: true,
      long_memory_action: "distill",
    });
  });

  it("rejects distill completion when the retained checkpoint is missing", async () => {
    const scriptPath = await writeMemoryFixture(12);
    readMemoryInstruction(scriptPath);
    for (let index = 1; index <= 7; index += 1) {
      await rm(
        path.join(
          tempDir,
          ".easy-coding",
          "memory",
          "short",
          `${String(index).padStart(3, "0")}_20260623_item-${index}.md`,
        ),
      );
    }
    await rm(
      path.join(tempDir, ".easy-coding", "memory", "short", "012_20260623_item-12.md"),
    );

    const completed = spawnSync(
      "python3",
      [
        scriptPath,
        "memory-complete",
        "--session-file",
        ".easy-coding/sessions/test.json",
        "--action",
        "distill",
        "--agent",
        "codex",
      ],
      { cwd: tempDir, encoding: "utf8" },
    );
    expect(completed.status).toBe(1);
    expect(completed.stderr).toContain("Short-memory file not found");
  });

  it("allows a checkpoint to disappear only when it is a consumed candidate", async () => {
    const scriptPath = await writeMemoryFixture(12, 1);
    const snapshot = readMemoryInstruction(scriptPath);
    expect(snapshot.memory).toMatchObject({
      action: "distill",
      checkpoint_disposition: "candidate",
    });

    const premature = spawnSync(
      "python3",
      [
        scriptPath,
        "memory-complete",
        "--session-file",
        ".easy-coding/sessions/test.json",
        "--action",
        "distill",
        "--agent",
        "codex",
      ],
      { cwd: tempDir, encoding: "utf8" },
    );
    expect(premature.status).toBe(1);
    expect(premature.stderr).toContain("Distillation candidate was not consumed");

    for (let index = 1; index <= 7; index += 1) {
      await rm(
        path.join(
          tempDir,
          ".easy-coding",
          "memory",
          "short",
          `${String(index).padStart(3, "0")}_20260623_item-${index}.md`,
        ),
      );
    }
    const completed = JSON.parse(
      execFileSync(
        "python3",
        [
          scriptPath,
          "memory-complete",
          "--session-file",
          ".easy-coding/sessions/test.json",
          "--action",
          "distill",
          "--agent",
          "codex",
        ],
        { cwd: tempDir, encoding: "utf8" },
      ),
    ) as { memory_progress: { completed: boolean } };
    expect(completed.memory_progress.completed).toBe(true);
  });
});

describe("easy_coding_state.py pending transition gate", () => {
  it("keeps the current stage until the pending edge is confirmed", async () => {
    await writeSessionFixture("06-26-gate");
    await writeTaskFixture("06-26-gate", "ANALYSIS", "codex");

    const requested = JSON.parse(
      execFileSync(
        "python3",
        [
          stateApiPath(),
          "request-transition",
          "--session-file",
          ".easy-coding/sessions/test.json",
          "--stage",
          "IMPLEMENT",
          "--agent",
          "codex",
        ],
        { cwd: tempDir, encoding: "utf8" },
      ),
    ) as { status: string; pending_transition: { from: string; to: string }; status_context: string };

    expect(requested.status).toBe("ANALYSIS");
    expect(requested.pending_transition).toMatchObject({ from: "ANALYSIS", to: "IMPLEMENT" });
    expect(requested.status_context).toContain(
      "[easy-coding:pending-transition:ANALYSIS->IMPLEMENT]",
    );

    const confirmed = JSON.parse(
      execFileSync(
        "python3",
        [
          stateApiPath(),
          "confirm-transition",
          "--session-file",
          ".easy-coding/sessions/test.json",
          "--stage",
          "IMPLEMENT",
          "--agent",
          "codex",
        ],
        { cwd: tempDir, encoding: "utf8" },
      ),
    ) as { status: string; pending_transition: null; confirmed_transition: Record<string, string> };

    expect(confirmed.status).toBe("IMPLEMENT");
    expect(confirmed.pending_transition).toBeNull();
    expect(confirmed.confirmed_transition).toEqual({ from: "ANALYSIS", to: "IMPLEMENT" });
  });

  it("rejects confirmation when no edge is pending", async () => {
    await writeSessionFixture("06-26-no-gate");
    await writeTaskFixture("06-26-no-gate", "ANALYSIS", "codex");

    const result = spawnSync(
      "python3",
      [
        stateApiPath(),
        "confirm-transition",
        "--session-file",
        ".easy-coding/sessions/test.json",
        "--stage",
        "IMPLEMENT",
        "--agent",
        "codex",
      ],
      { cwd: tempDir, encoding: "utf8" },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("No transition is pending user confirmation");
  });
});

describe("easy_coding_state.py handoff and claim", () => {
  it("writes a target-less handoff record and clears the current session pointer", async () => {
    await writeSessionFixture("06-26-handoff");
    await writeTaskFixture("06-26-handoff", "ANALYSIS", "codex", {
      pending_transition: {
        from: "ANALYSIS",
        to: "IMPLEMENT",
        requested_at: "2026-06-26T00:00:00Z",
        requested_by: "codex",
      },
    });

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
      stage: "ANALYSIS",
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

    const task = JSON.parse(
      await readFile(
        path.join(tempDir, ".easy-coding", "tasks", "06-26-handoff", "task.json"),
        "utf8",
      ),
    );
    expect(task.pending_transition).toMatchObject({ from: "ANALYSIS", to: "IMPLEMENT" });
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
