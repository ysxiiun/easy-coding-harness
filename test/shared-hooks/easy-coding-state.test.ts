import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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

  return path.join(process.cwd(), "src", "templates", "shared-hooks", "easy_coding_state.py");
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
