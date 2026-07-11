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

async function writeSessionFixture(
  currentTask: string | null,
  extra: Record<string, unknown> = {},
): Promise<void> {
  await mkdir(path.join(tempDir, ".easy-coding", "sessions"), { recursive: true });
  await writeFile(
    path.join(tempDir, ".easy-coding", "sessions", "test.json"),
    JSON.stringify(
      {
        current_task: currentTask,
        created_at: "2026-06-26T00:00:00Z",
        ...extra,
      },
      null,
      2,
    ),
    "utf8",
  );
}

async function writeAnalysisSkeleton(taskId: string): Promise<void> {
  const skeleton = await readFile(
    path.join(process.cwd(), "src", "templates", "runtime", "templates", "dev-spec-skeleton.md"),
    "utf8",
  );
  await mkdir(path.join(tempDir, ".easy-coding", "templates"), { recursive: true });
  await mkdir(path.join(tempDir, ".easy-coding", "tasks", taskId), { recursive: true });
  await writeFile(
    path.join(tempDir, ".easy-coding", "templates", "dev-spec-skeleton.md"),
    skeleton,
    "utf8",
  );
  await writeFile(
    path.join(tempDir, ".easy-coding", "tasks", taskId, "dev-spec.md"),
    skeleton,
    "utf8",
  );
}

async function writeAnalysisArtifacts(taskId: string): Promise<void> {
  await writeAnalysisSkeleton(taskId);
  const taskDir = path.join(tempDir, ".easy-coding", "tasks", taskId);
  await writeFile(
    path.join(taskDir, "dev-spec.md"),
    [
      "## 技术方案：Fixture",
      "### 项目模式",
      "迭代项目",
      "### 任务类型",
      "Bug 修复",
      "### 需求解析",
      "目标、输入、输出和边界均已确认。",
      "### 现状",
      "证据：src/example.ts:1；真实模板文本 `{title}` 允许出现在方案中。",
      "### 冲突摘要",
      "无冲突。",
      "### 影响面分析",
      "仅影响状态迁移。",
      "### 改动范围",
      "src/example.ts，保持 UTF-8。",
      "### 修改方案",
      "增加严格校验。",
      "### 实施拆解",
      "U1：完成修复。",
      "### 测试策略",
      "执行回归测试。",
      "### 风险与注意事项",
      "保持兼容。",
      "",
    ].join("\n"),
    "utf8",
  );
  await writeFile(
    path.join(taskDir, "execution.jsonl"),
    `${JSON.stringify({
      type: "plan",
      strategy: "single",
      units: [
        {
          id: "U1",
          title: "完成修复",
          type: "backend",
          files: ["src/example.ts"],
          depends_on: [],
          rules_sections: [],
          abstract_modules: [],
        },
      ],
    })}\n`,
    "utf8",
  );
  await writeFile(path.join(taskDir, "test-strategy.md"), "# Test strategy\n\nRun tests.\n", "utf8");
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

async function writeConfirmModeConfig(mode: "approve" | "guard" | "auto"): Promise<void> {
  await mkdir(path.join(tempDir, ".easy-coding"), { recursive: true });
  await writeFile(
    path.join(tempDir, ".easy-coding", "config.yaml"),
    ["version: 2", "behavior:", `  confirm_mode: ${mode}`, ""].join("\n"),
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

describe("easy_coding_state.py ANALYSIS template gate", () => {
  it("rejects the untouched skeleton before analysis artifacts are ready", async () => {
    await writeSessionFixture("07-11-analysis-template");
    await writeTaskFixture("07-11-analysis-template", "ANALYSIS", "codex");
    await writeAnalysisSkeleton("07-11-analysis-template");

    const result = spawnSync(
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
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "ANALYSIS cannot advance to IMPLEMENT before analysis artifacts are ready",
    );
    expect(result.stderr).toContain("dev-spec.md contains unresolved template placeholders");
    expect(result.stderr).toContain("execution.jsonl has no valid plan record");
    expect(result.stderr).toContain("test-strategy.md is missing or empty");

    const task = JSON.parse(
      await readFile(
        path.join(
          tempDir,
          ".easy-coding",
          "tasks",
          "07-11-analysis-template",
          "task.json",
        ),
        "utf8",
      ),
    ) as { status: string; pending_transition?: unknown };
    expect(task.status).toBe("ANALYSIS");
    expect(task.pending_transition).toBeUndefined();
  });

  it("accepts a completed dev-spec, execution plan, and test strategy", async () => {
    await writeSessionFixture("07-11-analysis-ready");
    await writeTaskFixture("07-11-analysis-ready", "ANALYSIS", "codex");
    await writeAnalysisArtifacts("07-11-analysis-ready");

    const output = JSON.parse(
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
    ) as { status_context: string; pending_transition: { from: string; to: string } };

    expect(output.status_context).toContain("[easy-coding:analysis-template-ok]");
    expect(output.status_context).not.toContain("[easy-coding:analysis-template-drift:");
    expect(output.pending_transition).toMatchObject({ from: "ANALYSIS", to: "IMPLEMENT" });
  });

  it("rejects an empty dev-spec and an invalid latest plan record", async () => {
    await writeSessionFixture("07-11-analysis-invalid");
    await writeTaskFixture("07-11-analysis-invalid", "ANALYSIS", "codex");
    await writeAnalysisArtifacts("07-11-analysis-invalid");
    const taskDir = path.join(tempDir, ".easy-coding", "tasks", "07-11-analysis-invalid");
    await writeFile(path.join(taskDir, "dev-spec.md"), "", "utf8");
    await writeFile(
      path.join(taskDir, "execution.jsonl"),
      [
        JSON.stringify({
          type: "plan",
          strategy: "single",
          units: [{ id: "U1", title: "valid historical plan" }],
        }),
        JSON.stringify({ type: "plan", strategy: "single", units: [] }),
        "",
      ].join("\n"),
      "utf8",
    );

    const result = spawnSync(
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
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("dev-spec.md is empty");
    expect(result.stderr).toContain("execution.jsonl has no valid plan record");
  });

  it("rejects a heading-only dev-spec even when the other artifacts exist", async () => {
    await writeSessionFixture("07-11-analysis-empty-sections");
    await writeTaskFixture("07-11-analysis-empty-sections", "ANALYSIS", "codex");
    await writeAnalysisArtifacts("07-11-analysis-empty-sections");
    const taskDir = path.join(
      tempDir,
      ".easy-coding",
      "tasks",
      "07-11-analysis-empty-sections",
    );
    await writeFile(
      path.join(taskDir, "dev-spec.md"),
      [
        "## 技术方案：空章节回归",
        "### 项目模式",
        "### 任务类型",
        "### 需求解析",
        "### 现状",
        "### 冲突摘要",
        "### 影响面分析",
        "### 改动范围",
        "### 修改方案",
        "### 实施拆解",
        "### 测试策略",
        "### 风险与注意事项",
        "",
      ].join("\n"),
      "utf8",
    );

    const result = spawnSync(
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
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("dev-spec.md has empty mandatory sections");
  });

  it("rejects mandatory sections that contain only skeleton labels and table headers", async () => {
    const taskId = "07-11-analysis-boilerplate-only";
    await writeSessionFixture(taskId);
    await writeTaskFixture(taskId, "ANALYSIS", "codex");
    await writeAnalysisArtifacts(taskId);
    const taskDir = path.join(tempDir, ".easy-coding", "tasks", taskId);
    await writeFile(
      path.join(taskDir, "dev-spec.md"),
      [
        "## 技术方案：骨架样板回归",
        "### 项目模式",
        "迭代项目",
        "### 任务类型",
        "Bug 修复",
        "### 需求解析",
        "- **目标**：",
        "- **输入**：",
        "- **输出**：",
        "- **边界**：",
        "### 现状",
        "证据：src/example.ts:1。",
        "### 冲突摘要",
        "无冲突。",
        "### 影响面分析",
        "仅影响状态迁移。",
        "### 改动范围",
        "> 只列真实项目源码/配置文件的改动。",
        "| 改动文件 | 改动类型 | 文件编码 | 改动核心内容 |",
        "|----------|---------|---------|-------------|",
        "### 修改方案",
        "增加严格校验。",
        "### 实施拆解",
        "U1：完成修复。",
        "### 测试策略",
        "执行回归测试。",
        "### 风险与注意事项",
        "保持兼容。",
        "",
      ].join("\n"),
      "utf8",
    );

    const result = spawnSync(
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
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("需求解析");
    expect(result.stderr).toContain("改动范围");
  });

  it("rejects plan units that cannot produce a bounded implementation task card", async () => {
    await writeSessionFixture("07-11-analysis-invalid-unit");
    await writeTaskFixture("07-11-analysis-invalid-unit", "ANALYSIS", "codex");
    await writeAnalysisArtifacts("07-11-analysis-invalid-unit");
    const taskDir = path.join(tempDir, ".easy-coding", "tasks", "07-11-analysis-invalid-unit");
    await writeFile(
      path.join(taskDir, "execution.jsonl"),
      `${JSON.stringify({ type: "plan", strategy: "single", units: [{}] })}\n`,
      "utf8",
    );

    const result = spawnSync(
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
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("execution.jsonl has no valid plan record");
  });

  it("allows empty file scope only for explicit no-code task types", async () => {
    const noCodePlan = {
      type: "plan",
      strategy: "single",
      units: [
        {
          id: "U1",
          title: "Produce the read-only report",
          type: "analysis",
          files: [],
          depends_on: [],
          rules_sections: [],
          abstract_modules: [],
        },
      ],
    };

    await writeSessionFixture("07-11-analysis-no-code");
    await writeTaskFixture("07-11-analysis-no-code", "ANALYSIS", "codex", { type: "report" });
    await writeAnalysisArtifacts("07-11-analysis-no-code");
    await rm(
      path.join(
        tempDir,
        ".easy-coding",
        "tasks",
        "07-11-analysis-no-code",
        "test-strategy.md",
      ),
      { force: true },
    );
    await writeFile(
      path.join(
        tempDir,
        ".easy-coding",
        "tasks",
        "07-11-analysis-no-code",
        "execution.jsonl",
      ),
      `${JSON.stringify(noCodePlan)}\n`,
      "utf8",
    );
    const accepted = spawnSync(
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
    );
    expect(accepted.status).toBe(0);

    await writeSessionFixture("07-11-analysis-code-empty-scope");
    await writeTaskFixture("07-11-analysis-code-empty-scope", "ANALYSIS", "codex", {
      type: "feature",
    });
    await writeAnalysisArtifacts("07-11-analysis-code-empty-scope");
    await writeFile(
      path.join(
        tempDir,
        ".easy-coding",
        "tasks",
        "07-11-analysis-code-empty-scope",
        "execution.jsonl",
      ),
      `${JSON.stringify(noCodePlan)}\n`,
      "utf8",
    );
    const rejected = spawnSync(
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
    );
    expect(rejected.status).toBe(1);
    expect(rejected.stderr).toContain("execution.jsonl has no valid plan record");

    await writeSessionFixture("07-11-analysis-no-code-parallel");
    await writeTaskFixture("07-11-analysis-no-code-parallel", "ANALYSIS", "codex", {
      type: "doc",
    });
    await writeAnalysisArtifacts("07-11-analysis-no-code-parallel");
    await rm(
      path.join(
        tempDir,
        ".easy-coding",
        "tasks",
        "07-11-analysis-no-code-parallel",
        "test-strategy.md",
      ),
      { force: true },
    );
    await writeFile(
      path.join(
        tempDir,
        ".easy-coding",
        "tasks",
        "07-11-analysis-no-code-parallel",
        "execution.jsonl",
      ),
      `${JSON.stringify({
        type: "plan",
        strategy: "parallel",
        units: [
          { ...noCodePlan.units[0], id: "U1" },
          { ...noCodePlan.units[0], id: "U2" },
        ],
        parallel_groups: [{ level: 0, units: ["U1", "U2"] }],
      })}\n`,
      "utf8",
    );
    const parallelNoCode = spawnSync(
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
    );
    expect(parallelNoCode.status).toBe(1);
    expect(parallelNoCode.stderr).toContain("execution.jsonl has no valid plan record");
  });

  it("allows a read-only task to leave the change-scope table empty", async () => {
    const taskId = "07-11-read-only-empty-change-scope";
    await writeSessionFixture(taskId);
    await writeTaskFixture(taskId, "ANALYSIS", "codex", { type: "report" });
    await writeAnalysisArtifacts(taskId);
    const taskDir = path.join(tempDir, ".easy-coding", "tasks", taskId);
    const devSpec = await readFile(path.join(taskDir, "dev-spec.md"), "utf8");
    await writeFile(
      path.join(taskDir, "dev-spec.md"),
      devSpec.replace(
        "### 改动范围\nsrc/example.ts，保持 UTF-8。",
        [
          "### 改动范围",
          "> 只读任务不修改项目文件。",
          "",
          "| 改动文件 | 改动类型 | 文件编码 | 改动核心内容 |",
          "|----------|---------|---------|-------------|",
        ].join("\n"),
      ),
      "utf8",
    );
    await rm(path.join(taskDir, "test-strategy.md"), { force: true });
    await writeFile(
      path.join(taskDir, "execution.jsonl"),
      `${JSON.stringify({
        type: "plan",
        strategy: "single",
        units: [
          {
            id: "U1",
            title: "Produce the read-only report",
            type: "analysis",
            files: [],
            depends_on: [],
            rules_sections: [],
            abstract_modules: [],
          },
        ],
      })}\n`,
      "utf8",
    );

    const accepted = spawnSync(
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
    );

    expect(accepted.status).toBe(0);
  });

  it("requires explicit no-code task types to use a read-only empty-scope plan", async () => {
    const taskId = "07-11-report-must-be-read-only";
    await writeSessionFixture(taskId);
    await writeTaskFixture(taskId, "ANALYSIS", "codex", { type: "report" });
    await writeAnalysisArtifacts(taskId);
    await rm(path.join(tempDir, ".easy-coding", "tasks", taskId, "test-strategy.md"), {
      force: true,
    });
    await writeFile(
      path.join(tempDir, ".easy-coding", "tasks", taskId, "execution.jsonl"),
      `${JSON.stringify({
        type: "plan",
        strategy: "single",
        units: [
          {
            id: "U1",
            title: "Write a report file",
            type: "documentation",
            files: ["report.md"],
            depends_on: [],
          },
        ],
      })}\n`,
      "utf8",
    );

    const rejected = spawnSync(
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
    );

    expect(rejected.status).toBe(1);
    expect(rejected.stderr).toContain("execution.jsonl has no valid plan record");
  });

  it("rejects test-strategy.md for read-only tasks", async () => {
    const taskId = "07-11-read-only-no-test-strategy";
    await writeSessionFixture(taskId);
    await writeTaskFixture(taskId, "ANALYSIS", "codex", { type: "analysis" });
    await writeAnalysisArtifacts(taskId);
    await writeFile(
      path.join(tempDir, ".easy-coding", "tasks", taskId, "execution.jsonl"),
      `${JSON.stringify({
        type: "plan",
        strategy: "single",
        units: [
          {
            id: "U1",
            title: "Produce analysis",
            type: "analysis",
            files: [],
            depends_on: [],
          },
        ],
      })}\n`,
      "utf8",
    );

    const rejected = spawnSync(
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
    );

    expect(rejected.status).toBe(1);
    expect(rejected.stderr).toContain("read-only task must not create test-strategy.md");
  });

  it.each([
    {
      name: "cyclic sequential dependencies",
      plan: {
        type: "plan",
        strategy: "sequential",
        units: [
          { id: "U1", title: "One", type: "backend", files: ["a.ts"], depends_on: ["U2"] },
          { id: "U2", title: "Two", type: "backend", files: ["b.ts"], depends_on: ["U1"] },
        ],
      },
    },
    {
      name: "parallel dependency scheduled before its prerequisite",
      plan: {
        type: "plan",
        strategy: "parallel",
        units: [
          { id: "U1", title: "One", type: "backend", files: ["a.ts"], depends_on: ["U2"] },
          { id: "U2", title: "Two", type: "backend", files: ["b.ts"], depends_on: [] },
        ],
        parallel_groups: [
          { level: 0, units: ["U1"] },
          { level: 1, units: ["U2"] },
        ],
      },
    },
  ])("rejects $name", async ({ name, plan }) => {
    const taskId = `07-11-invalid-dependencies-${name.startsWith("cyclic") ? "cycle" : "level"}`;
    await writeSessionFixture(taskId);
    await writeTaskFixture(taskId, "ANALYSIS", "codex");
    await writeAnalysisArtifacts(taskId);
    await writeFile(
      path.join(tempDir, ".easy-coding", "tasks", taskId, "execution.jsonl"),
      `${JSON.stringify(plan)}\n`,
      "utf8",
    );
    const result = spawnSync(
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
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("execution.jsonl has no valid plan record");
  });

  it("accepts a topologically ordered parallel plan", async () => {
    const taskId = "07-11-valid-parallel-plan";
    await writeSessionFixture(taskId);
    await writeTaskFixture(taskId, "ANALYSIS", "codex");
    await writeAnalysisArtifacts(taskId);
    await writeFile(
      path.join(tempDir, ".easy-coding", "tasks", taskId, "execution.jsonl"),
      `${JSON.stringify({
        type: "plan",
        strategy: "parallel",
        units: [
          { id: "U1", title: "One", type: "backend", files: ["a.ts"], depends_on: [] },
          { id: "U2", title: "Two", type: "test", files: ["b.ts"], depends_on: ["U1"] },
        ],
        parallel_groups: [
          { level: 0, units: ["U1"] },
          { level: 1, units: ["U2"] },
        ],
      })}\n`,
      "utf8",
    );
    const result = spawnSync(
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
    );
    expect(result.status).toBe(0);
  });

  it("revalidates analysis artifacts when the pending edge is confirmed", async () => {
    await writeSessionFixture("07-11-analysis-revalidate");
    await writeTaskFixture("07-11-analysis-revalidate", "ANALYSIS", "codex");
    await writeAnalysisArtifacts("07-11-analysis-revalidate");

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
    );
    await writeFile(
      path.join(
        tempDir,
        ".easy-coding",
        "tasks",
        "07-11-analysis-revalidate",
        "test-strategy.md",
      ),
      "",
      "utf8",
    );

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
    expect(result.stderr).toContain("test-strategy.md is missing or empty");
    const task = JSON.parse(
      await readFile(
        path.join(
          tempDir,
          ".easy-coding",
          "tasks",
          "07-11-analysis-revalidate",
          "task.json",
        ),
        "utf8",
      ),
    ) as { status: string; pending_transition: { from: string; to: string } };
    expect(task.status).toBe("ANALYSIS");
    expect(task.pending_transition).toMatchObject({ from: "ANALYSIS", to: "IMPLEMENT" });
  });
});

describe("easy_coding_state.py pending transition gate", () => {
  it("keeps the current stage until the pending edge is confirmed", async () => {
    await writeSessionFixture("06-26-gate");
    await writeTaskFixture("06-26-gate", "ANALYSIS", "codex");
    await writeAnalysisArtifacts("06-26-gate");

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

describe("easy_coding_state.py automatic and optional transitions", () => {
  it("automatically advances INIT to ANALYSIS while consuming a legacy pending edge", async () => {
    await writeSessionFixture("07-11-auto-analysis");
    await writeTaskFixture("07-11-auto-analysis", "INIT", "codex", {
      pending_transition: {
        from: "INIT",
        to: "ANALYSIS",
        requested_at: "2026-07-10T00:00:00Z",
        requested_by: "codex",
      },
    });

    const resumed = JSON.parse(
      execFileSync(
        "python3",
        [
          stateApiPath(),
          "set-current",
          "--session-file",
          ".easy-coding/sessions/test.json",
          "--task-id",
          "07-11-auto-analysis",
          "--agent",
          "codex",
        ],
        { cwd: tempDir, encoding: "utf8" },
      ),
    ) as { status_context: string };
    expect(resumed.status_context).toContain(
      "[easy-coding:auto-transition-ready:INIT->ANALYSIS]",
    );
    expect(resumed.status_context).not.toContain(
      "[easy-coding:transition-confirmation-required]",
    );

    const output = JSON.parse(
      execFileSync(
        "python3",
        [
          stateApiPath(),
          "auto-transition",
          "--session-file",
          ".easy-coding/sessions/test.json",
          "--stage",
          "ANALYSIS",
          "--agent",
          "codex",
        ],
        { cwd: tempDir, encoding: "utf8" },
      ),
    ) as {
      status: string;
      pending_transition: null;
      automatic_transition: { from: string; to: string };
    };

    expect(output.status).toBe("ANALYSIS");
    expect(output.pending_transition).toBeNull();
    expect(output.automatic_transition).toEqual({ from: "INIT", to: "ANALYSIS" });
  });

  it("uses the session confirm mode before the project mode", async () => {
    await writeConfirmModeConfig("approve");
    await writeSessionFixture("07-11-session-auto", { confirm_mode: "auto" });
    await writeTaskFixture("07-11-session-auto", "ANALYSIS", "codex");
    await writeAnalysisArtifacts("07-11-session-auto");

    const output = JSON.parse(
      execFileSync(
        "python3",
        [
          stateApiPath(),
          "auto-transition",
          "--session-file",
          ".easy-coding/sessions/test.json",
          "--stage",
          "IMPLEMENT",
          "--agent",
          "codex",
        ],
        { cwd: tempDir, encoding: "utf8" },
      ),
    ) as {
      status: string;
      project_confirm_mode: string;
      session_confirm_mode: string;
      effective_confirm_mode: string;
    };

    expect(output.status).toBe("IMPLEMENT");
    expect(output.project_confirm_mode).toBe("approve");
    expect(output.session_confirm_mode).toBe("auto");
    expect(output.effective_confirm_mode).toBe("auto");
  });

  it("automatically follows IMPLEMENT to REVIEW in guard mode", async () => {
    await writeConfirmModeConfig("guard");
    await writeSessionFixture("07-11-guard-review");
    await writeTaskFixture("07-11-guard-review", "IMPLEMENT", "codex");

    const output = JSON.parse(
      execFileSync(
        "python3",
        [
          stateApiPath(),
          "auto-transition",
          "--session-file",
          ".easy-coding/sessions/test.json",
          "--stage",
          "REVIEW",
          "--agent",
          "codex",
        ],
        { cwd: tempDir, encoding: "utf8" },
      ),
    ) as { status: string; effective_confirm_mode: string };

    expect(output.status).toBe("REVIEW");
    expect(output.effective_confirm_mode).toBe("guard");
  });

  it("preserves a pending edge when a session mode change makes it automatic", async () => {
    await writeConfirmModeConfig("approve");
    await writeSessionFixture("07-11-mode-change");
    await writeTaskFixture("07-11-mode-change", "IMPLEMENT", "codex", {
      pending_transition: {
        from: "IMPLEMENT",
        to: "REVIEW",
        requested_at: "2026-07-11T00:00:00Z",
        requested_by: "codex",
      },
    });

    const output = JSON.parse(
      execFileSync(
        "python3",
        [
          stateApiPath(),
          "set-confirm-mode",
          "--session-file",
          ".easy-coding/sessions/test.json",
          "--mode",
          "guard",
          "--agent",
          "codex",
        ],
        { cwd: tempDir, encoding: "utf8" },
      ),
    ) as {
      pending_transition: { from: string; to: string };
      status_context: string;
    };

    expect(output.pending_transition).toMatchObject({ from: "IMPLEMENT", to: "REVIEW" });
    expect(output.status_context).toContain(
      "[easy-coding:auto-transition-ready:IMPLEMENT->REVIEW]",
    );

    const transitioned = JSON.parse(
      execFileSync(
        "python3",
        [
          stateApiPath(),
          "auto-transition",
          "--session-file",
          ".easy-coding/sessions/test.json",
          "--stage",
          "REVIEW",
          "--agent",
          "codex",
        ],
        { cwd: tempDir, encoding: "utf8" },
      ),
    ) as { status: string; pending_transition: null };

    expect(transitioned.status).toBe("REVIEW");
    expect(transitioned.pending_transition).toBeNull();
  });

  it("bypasses only harness context for the current session and preserves task state", async () => {
    await writeSessionFixture("07-11-native-session");
    await writeTaskFixture("07-11-native-session", "IMPLEMENT", "codex");

    const disabled = JSON.parse(
      execFileSync(
        "python3",
        [
          stateApiPath(),
          "disable-harness",
          "--session-file",
          ".easy-coding/sessions/test.json",
          "--agent",
          "codex",
        ],
        { cwd: tempDir, encoding: "utf8" },
      ),
    ) as { status: string; status_line: string; status_context: string; harness_disabled: boolean };

    expect(disabled.status).toBe("IMPLEMENT");
    expect(disabled.status_line).toBe("");
    expect(disabled.status_context).toContain("[easy-coding:no-harness]");
    expect(disabled.harness_disabled).toBe(true);

    const task = JSON.parse(
      await readFile(
        path.join(tempDir, ".easy-coding", "tasks", "07-11-native-session", "task.json"),
        "utf8",
      ),
    ) as { status: string };
    expect(task.status).toBe("IMPLEMENT");

    const enabled = JSON.parse(
      execFileSync(
        "python3",
        [
          stateApiPath(),
          "enable-harness",
          "--session-file",
          ".easy-coding/sessions/test.json",
          "--agent",
          "codex",
        ],
        { cwd: tempDir, encoding: "utf8" },
      ),
    ) as { status_line: string; status_context: string; harness_disabled: boolean };
    expect(enabled.status_line).toContain("Easy Coding");
    expect(enabled.status_context).not.toContain("[easy-coding:no-harness]");
    expect(enabled.harness_disabled).toBe(false);
  });

  it("keeps the two guard gates confirmation-required", async () => {
    await writeSessionFixture("07-11-no-auto-bypass");
    await writeTaskFixture("07-11-no-auto-bypass", "ANALYSIS", "codex");

    const result = spawnSync(
      "python3",
      [
        stateApiPath(),
        "auto-transition",
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
    expect(result.stderr).toContain(
      "Automatic transition is not allowed in guard mode: ANALYSIS -> IMPLEMENT",
    );
  });

  it.each(["guard", "auto"] as const)(
    "does not allow %s mode to auto-close a task",
    async (confirmMode) => {
      await writeConfirmModeConfig(confirmMode);
      await writeSessionFixture(`07-11-no-auto-close-${confirmMode}`);
      await writeTaskFixture(`07-11-no-auto-close-${confirmMode}`, "IMPLEMENT", "codex");

      const result = spawnSync(
        "python3",
        [
          stateApiPath(),
          "auto-transition",
          "--session-file",
          ".easy-coding/sessions/test.json",
          "--stage",
          "CLOSED",
          "--agent",
          "codex",
        ],
        { cwd: tempDir, encoding: "utf8" },
      );

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        `Automatic transition is not allowed in ${confirmMode} mode: IMPLEMENT -> CLOSED`,
      );

      const task = JSON.parse(
        await readFile(
          path.join(
            tempDir,
            ".easy-coding",
            "tasks",
            `07-11-no-auto-close-${confirmMode}`,
            "task.json",
          ),
          "utf8",
        ),
      ) as { status: string };
      expect(task.status).toBe("IMPLEMENT");
    },
  );

  it("rejects pending confirmation gates for automatic edges", async () => {
    await writeSessionFixture("07-11-no-auto-pending");
    await writeTaskFixture("07-11-no-auto-pending", "INIT", "codex");

    const result = spawnSync(
      "python3",
      [
        stateApiPath(),
        "request-transition",
        "--session-file",
        ".easy-coding/sessions/test.json",
        "--stage",
        "ANALYSIS",
        "--agent",
        "codex",
      ],
      { cwd: tempDir, encoding: "utf8" },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "Transition INIT -> ANALYSIS is automatic in guard mode; use auto-transition instead",
    );
  });

  it.each([
    ["confirm-transition", "INIT", "ANALYSIS"],
    ["transition", "INIT", "ANALYSIS"],
    ["confirm-transition", "MEMORY", "COMPLETE"],
    ["transition", "MEMORY", "COMPLETE"],
  ] as const)(
    "rejects %s for a legacy %s -> %s automatic edge",
    async (command, source, target) => {
      const taskId = `07-11-no-confirm-${command}-${source.toLowerCase()}`;
      await writeSessionFixture(taskId);
      await writeTaskFixture(taskId, source, "codex", {
        pending_transition: {
          from: source,
          to: target,
          requested_at: "2026-07-10T00:00:00Z",
          requested_by: "codex",
        },
      });

      const result = spawnSync(
        "python3",
        [
          stateApiPath(),
          command,
          "--session-file",
          ".easy-coding/sessions/test.json",
          "--stage",
          target,
          "--agent",
          "codex",
        ],
        { cwd: tempDir, encoding: "utf8" },
      );

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        `Transition ${source} -> ${target} is automatic in guard mode; use auto-transition instead`,
      );

      const task = JSON.parse(
        await readFile(
          path.join(tempDir, ".easy-coding", "tasks", taskId, "task.json"),
          "utf8",
        ),
      ) as { status: string; pending_transition: { from: string; to: string } };
      expect(task.status).toBe(source);
      expect(task.pending_transition).toMatchObject({ from: source, to: target });
    },
  );

  it("allows IMPLEMENT to skip REVIEW only through the confirmed pending gate", async () => {
    await writeConfirmModeConfig("approve");
    await writeSessionFixture("07-11-skip-review");
    await writeTaskFixture("07-11-skip-review", "IMPLEMENT", "codex");

    const requestedReview = JSON.parse(
      execFileSync(
        "python3",
        [
          stateApiPath(),
          "request-transition",
          "--session-file",
          ".easy-coding/sessions/test.json",
          "--stage",
          "REVIEW",
          "--agent",
          "codex",
        ],
        { cwd: tempDir, encoding: "utf8" },
      ),
    ) as { status: string; pending_transition: { from: string; to: string } };

    expect(requestedReview.status).toBe("IMPLEMENT");
    expect(requestedReview.pending_transition).toMatchObject({
      from: "IMPLEMENT",
      to: "REVIEW",
    });

    const cancelled = JSON.parse(
      execFileSync(
        "python3",
        [
          stateApiPath(),
          "cancel-transition",
          "--session-file",
          ".easy-coding/sessions/test.json",
          "--agent",
          "codex",
        ],
        { cwd: tempDir, encoding: "utf8" },
      ),
    ) as {
      status: string;
      pending_transition: null;
      cancelled_transition: { from: string; to: string };
    };

    expect(cancelled.status).toBe("IMPLEMENT");
    expect(cancelled.pending_transition).toBeNull();
    expect(cancelled.cancelled_transition).toMatchObject({
      from: "IMPLEMENT",
      to: "REVIEW",
    });

    const requested = JSON.parse(
      execFileSync(
        "python3",
        [
          stateApiPath(),
          "request-transition",
          "--session-file",
          ".easy-coding/sessions/test.json",
          "--stage",
          "VERIFICATION",
          "--agent",
          "codex",
        ],
        { cwd: tempDir, encoding: "utf8" },
      ),
    ) as { status: string; pending_transition: { from: string; to: string } };

    expect(requested.status).toBe("IMPLEMENT");
    expect(requested.pending_transition).toMatchObject({
      from: "IMPLEMENT",
      to: "VERIFICATION",
    });

    const confirmed = JSON.parse(
      execFileSync(
        "python3",
        [
          stateApiPath(),
          "confirm-transition",
          "--session-file",
          ".easy-coding/sessions/test.json",
          "--stage",
          "VERIFICATION",
          "--agent",
          "codex",
        ],
        { cwd: tempDir, encoding: "utf8" },
      ),
    ) as { status: string };

    expect(confirmed.status).toBe("VERIFICATION");
  });

  it("automatically completes a read-only task after a valid deliverable result", async () => {
    const taskId = "07-11-read-only-complete";
    await writeSessionFixture(taskId);
    await writeTaskFixture(taskId, "IMPLEMENT", "codex", { type: "report" });
    await writeFile(
      path.join(tempDir, ".easy-coding", "tasks", taskId, "execution.jsonl"),
      [
        JSON.stringify({
          type: "plan",
          strategy: "single",
          units: [
            {
              id: "U1",
              title: "Produce the report",
              type: "analysis",
              files: [],
              depends_on: [],
              rules_sections: [],
              abstract_modules: [],
            },
          ],
        }),
        JSON.stringify({
          type: "dispatch",
          unit_id: "U1",
          timestamp: "2026-07-11T00:00:00Z",
        }),
        JSON.stringify({
          type: "result",
          unit_id: "U1",
          changed_files: [],
          summary: "Report produced.",
          deliverable: "# Analysis report\n\nComplete result.",
          issues: [],
          needs_attention: [],
        }),
        "",
      ].join("\n"),
      "utf8",
    );

    const output = JSON.parse(
      execFileSync(
        "python3",
        [
          stateApiPath(),
          "auto-transition",
          "--session-file",
          ".easy-coding/sessions/test.json",
          "--stage",
          "COMPLETE",
          "--agent",
          "codex",
        ],
        { cwd: tempDir, encoding: "utf8" },
      ),
    ) as { status: string; status_context: string; automatic_transition: Record<string, string> };

    expect(output.status).toBe("idle");
    expect(output.status_context).toContain("[workflow-state:idle]");
    expect(output.automatic_transition).toEqual({ from: "IMPLEMENT", to: "COMPLETE" });

    const task = JSON.parse(
      await readFile(path.join(tempDir, ".easy-coding", "tasks", taskId, "task.json"), "utf8"),
    ) as { status: string; memory_progress?: unknown };
    expect(task.status).toBe("COMPLETE");
    expect(task.memory_progress).toBeUndefined();
  });

  it.each([
    {
      name: "missing deliverable",
      result: {
        type: "result",
        unit_id: "U1",
        changed_files: [],
        summary: "No report.",
        deliverable: "",
        issues: [],
        needs_attention: [],
      },
      error: "non-empty deliverable",
    },
    {
      name: "changed files",
      result: {
        type: "result",
        unit_id: "U1",
        changed_files: ["report.md"],
        summary: "Changed a file.",
        deliverable: "Report",
        issues: [],
        needs_attention: [],
      },
      error: "changed_files:[]",
    },
  ])("rejects read-only completion with $name", async ({ result, error }) => {
    const taskId = `07-11-read-only-invalid-${error.includes("deliverable") ? "empty" : "files"}`;
    await writeSessionFixture(taskId);
    await writeTaskFixture(taskId, "IMPLEMENT", "codex", { type: "analysis" });
    await writeFile(
      path.join(tempDir, ".easy-coding", "tasks", taskId, "execution.jsonl"),
      [
        JSON.stringify({
          type: "plan",
          strategy: "single",
          units: [
            {
              id: "U1",
              title: "Produce analysis",
              type: "analysis",
              files: [],
              depends_on: [],
            },
          ],
        }),
        JSON.stringify({
          type: "dispatch",
          unit_id: "U1",
          timestamp: "2026-07-11T00:00:00Z",
        }),
        JSON.stringify(result),
        "",
      ].join("\n"),
      "utf8",
    );

    const rejected = spawnSync(
      "python3",
      [
        stateApiPath(),
        "auto-transition",
        "--session-file",
        ".easy-coding/sessions/test.json",
        "--stage",
        "COMPLETE",
        "--agent",
        "codex",
      ],
      { cwd: tempDir, encoding: "utf8" },
    );

    expect(rejected.status).toBe(1);
    expect(rejected.stderr).toContain(error);
  });

  it("rejects read-only completion without a matching dispatch record", async () => {
    const taskId = "07-11-read-only-no-dispatch";
    await writeSessionFixture(taskId);
    await writeTaskFixture(taskId, "IMPLEMENT", "codex", { type: "report" });
    await writeFile(
      path.join(tempDir, ".easy-coding", "tasks", taskId, "execution.jsonl"),
      [
        JSON.stringify({
          type: "plan",
          strategy: "single",
          units: [
            {
              id: "U1",
              title: "Produce the report",
              type: "analysis",
              files: [],
              depends_on: [],
            },
          ],
        }),
        JSON.stringify({
          type: "result",
          unit_id: "U1",
          changed_files: [],
          summary: "Report produced inline.",
          deliverable: "Report",
          issues: [],
          needs_attention: [],
        }),
        "",
      ].join("\n"),
      "utf8",
    );

    const rejected = spawnSync(
      "python3",
      [
        stateApiPath(),
        "auto-transition",
        "--session-file",
        ".easy-coding/sessions/test.json",
        "--stage",
        "COMPLETE",
        "--agent",
        "codex",
      ],
      { cwd: tempDir, encoding: "utf8" },
    );

    expect(rejected.status).toBe(1);
    expect(rejected.stderr).toContain("no matching dispatch record");
  });

  it("rejects IMPLEMENT to COMPLETE for code tasks", async () => {
    await writeSessionFixture("07-11-code-no-complete");
    await writeTaskFixture("07-11-code-no-complete", "IMPLEMENT", "codex", { type: "feature" });

    const rejected = spawnSync(
      "python3",
      [
        stateApiPath(),
        "auto-transition",
        "--session-file",
        ".easy-coding/sessions/test.json",
        "--stage",
        "COMPLETE",
        "--agent",
        "codex",
      ],
      { cwd: tempDir, encoding: "utf8" },
    );

    expect(rejected.status).toBe(1);
    expect(rejected.stderr).toContain("ILLEGAL TRANSITION: IMPLEMENT -> COMPLETE");
  });

  it.each(["REVIEW", "VERIFICATION", "MEMORY"])(
    "prevents read-only IMPLEMENT from entering %s",
    async (target) => {
      const taskId = `07-11-read-only-no-${target.toLowerCase()}`;
      await writeSessionFixture(taskId);
      await writeTaskFixture(taskId, "IMPLEMENT", "codex", { type: "report" });

      const rejected = spawnSync(
        "python3",
        [
          stateApiPath(),
          "request-transition",
          "--session-file",
          ".easy-coding/sessions/test.json",
          "--stage",
          target,
          "--agent",
          "codex",
        ],
        { cwd: tempDir, encoding: "utf8" },
      );

      expect(rejected.status).toBe(1);
      expect(rejected.stderr).toContain(`ILLEGAL TRANSITION: IMPLEMENT -> ${target}`);
    },
  );

  it("automatically completes MEMORY only after memory processing finishes", async () => {
    const scriptPath = await writeMemoryFixture(1);

    const blocked = spawnSync(
      "python3",
      [
        scriptPath,
        "auto-transition",
        "--session-file",
        ".easy-coding/sessions/test.json",
        "--stage",
        "COMPLETE",
        "--agent",
        "codex",
      ],
      { cwd: tempDir, encoding: "utf8" },
    );
    expect(blocked.status).toBe(1);
    expect(blocked.stderr).toContain(
      "MEMORY cannot advance to COMPLETE before memory processing completes",
    );

    execFileSync(
      "python3",
      [scriptPath, "memory-instruction", "--session-file", ".easy-coding/sessions/test.json"],
      { cwd: tempDir, encoding: "utf8" },
    );
    execFileSync(
      "python3",
      [
        scriptPath,
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

    const completed = JSON.parse(
      execFileSync(
        "python3",
        [
          scriptPath,
          "auto-transition",
          "--session-file",
          ".easy-coding/sessions/test.json",
          "--stage",
          "COMPLETE",
          "--agent",
          "codex",
        ],
        { cwd: tempDir, encoding: "utf8" },
      ),
    ) as { status: string; status_context: string };

    expect(completed.status).toBe("idle");
    expect(completed.status_context).toContain("[workflow-state:idle]");
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
