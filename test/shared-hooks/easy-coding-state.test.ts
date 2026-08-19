import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFile, mkdir, mkdtemp, readFile, readdir, rm, utimes, writeFile } from "node:fs/promises";
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

async function writeTddReadinessFixture(): Promise<void> {
  const build = "<plugin>jacoco-maven-plugin</plugin>\n";
  const tool = "# Easy Coding changed Java production-line JaCoCo coverage gate\n";
  const ci = [
    "changed-line-coverage:",
    "  stage: test",
    "  artifacts: { reports: jacoco }",
    "  script: python3 .easy-coding/tools/easy_coding_java_coverage.py check --base $EASY_CODING_TDD_BASE_SHA --threshold $EASY_CODING_TDD_THRESHOLD",
    "",
  ].join("\n");
  await writeFile(path.join(tempDir, "pom.xml"), build, "utf8");
  await writeFile(path.join(tempDir, ".gitlab-ci.yml"), ci, "utf8");
  await mkdir(path.join(tempDir, ".easy-coding", "tools"), { recursive: true });
  await writeFile(path.join(tempDir, ".easy-coding", "tools", "easy_coding_java_coverage.py"), tool);
  const receipt = path.join(tempDir, ".easy-coding", "tdd", "readiness.json");
  await mkdir(path.dirname(receipt), { recursive: true });
  await writeFile(
    receipt,
    JSON.stringify({
      schema: "easy-coding/tdd-readiness-v1",
      provider: "gitlab",
      coverage_scope: "changed-production-lines",
      historical_coverage_required: false,
      build_files: [{ path: "pom.xml", sha256: createHash("sha256").update(build).digest("hex") }],
      ci_files: [
        { path: ".gitlab-ci.yml", sha256: createHash("sha256").update(ci).digest("hex") },
      ],
      tool_files: [
        {
          path: ".easy-coding/tools/easy_coding_java_coverage.py",
          sha256: createHash("sha256").update(tool).digest("hex"),
        },
      ],
      coverage_report_patterns: ["target/site/jacoco/jacoco.xml"],
      changed_line_gate_command:
        "python3 .easy-coding/tools/easy_coding_java_coverage.py check --base $EASY_CODING_TDD_BASE_SHA --threshold $EASY_CODING_TDD_THRESHOLD",
    }),
    "utf8",
  );
}

async function writeTaskFixture(
  taskId: string,
  status: string,
  lastAgent: string,
  extra: Record<string, unknown> = {},
): Promise<void> {
  const workflowFields =
    status === "ANALYSIS"
      ? {
          workflow_mode_proposal: {
            configured_mode: "adaptive",
            selected_mode: "standard",
            minimum_mode: "fast",
            source: "adaptive",
            reasons: ["test-fixture"],
            proposed_at: "2026-06-26T00:00:00Z",
            proposed_by: lastAgent,
          },
        }
      : ["IMPLEMENT", "QUALITY", "MEMORY"].includes(status)
        ? { workflow_mode: "standard" }
        : {};
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
        ...workflowFields,
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
  if (extra.tdd_enabled === true) await writeTddReadinessFixture();
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
      "### 决策闭环",
      "decision_status: closed",
      "- **已解决问题与结论**：无",
      "- **确认依据**：无额外决策",
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
      "### Workflow Mode",
      "项目配置 adaptive；机械最低 fast；选择 standard。",
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
          local_baseline: ["src/example.ts:1 follows the local fixture style"],
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

async function writeConfirmModeConfig(
  mode: "approve" | "guard" | "confirm" | "lite" | "auto",
): Promise<void> {
  await mkdir(path.join(tempDir, ".easy-coding"), { recursive: true });
  await writeFile(
    path.join(tempDir, ".easy-coding", "config.yaml"),
    ["version: 2", "behavior:", `  confirm_mode: ${mode}`, ""].join("\n"),
    "utf8",
  );
}

async function writeVerificationAcceptanceFixture(
  taskId: string,
  mode: "guard" | "auto" = "auto",
  initializeGit = true,
): Promise<{
  executionPath: string;
  sourcePath: string;
  implementationFingerprint: string;
  configFingerprint: string;
  qualityAttempt: number;
}> {
  await writeConfirmModeConfig(mode);
  await writeSessionFixture(taskId);
  await writeTaskFixture(taskId, "QUALITY", "codex", {
    workflow_mode: "fast",
    tdd_enabled: false,
    tdd_coverage_threshold: 90,
  });
  const sourcePath = path.join(tempDir, "src", "example.ts");
  await mkdir(path.dirname(sourcePath), { recursive: true });
  await writeFile(sourcePath, "export const value = 1;\n", "utf8");
  if (initializeGit) {
    execFileSync("git", ["init", "-q"], { cwd: tempDir });
  }
  const executionPath = path.join(
    tempDir,
    ".easy-coding",
    "tasks",
    taskId,
    "execution.jsonl",
  );
  await writeFile(
    executionPath,
    `${JSON.stringify({
      type: "plan",
      strategy: "single",
      units: [
        {
          id: "U1",
          title: "accept verified code",
          type: "backend",
          files: ["src/example.ts"],
          depends_on: [],
        },
      ],
    })}\n`,
    "utf8",
  );
  const fingerprints = JSON.parse(
    execFileSync(
      "python3",
      [
        stateApiPath(),
        "evidence-fingerprints",
        "--session-file",
        ".easy-coding/sessions/test.json",
        "--agent",
        "codex",
      ],
      { cwd: tempDir, encoding: "utf8" },
    ),
  ) as {
    implementation_fingerprint: string;
    config_fingerprint: string;
    quality_attempt: { attempt: number };
  };
  await appendFile(
    executionPath,
    `${[
      {
        type: "review",
        dimension: "combined",
        passed: true,
        implementation_fingerprint: fingerprints.implementation_fingerprint,
        quality_attempt: fingerprints.quality_attempt.attempt,
        reviewer: "codex-reviewer",
        timestamp: "2026-08-13T00:00:00Z",
        findings: [],
      },
      {
        type: "verify",
        check: "targeted-test",
        check_type: "test",
        command: "npm test -- targeted",
        passed: true,
        implementation_fingerprint: fingerprints.implementation_fingerprint,
        config_fingerprint: fingerprints.config_fingerprint,
        quality_attempt: fingerprints.quality_attempt.attempt,
        timestamp: "2026-08-13T00:01:00Z",
      },
    ]
      .map((record) => JSON.stringify(record))
      .join("\n")}\n`,
    "utf8",
  );
  return {
    executionPath,
    sourcePath,
    implementationFingerprint: fingerprints.implementation_fingerprint,
    configFingerprint: fingerprints.config_fingerprint,
    qualityAttempt: fingerprints.quality_attempt.attempt,
  };
}

async function writeQualityDecisionFixture(taskId: string): Promise<{
  executionPath: string;
  sourcePath: string;
  implementationFingerprint: string;
  configFingerprint: string;
  qualityAttempt: number;
}> {
  await writeConfirmModeConfig("guard");
  await writeSessionFixture(taskId);
  await writeTaskFixture(taskId, "QUALITY", "codex", {
    workflow_mode: "fast",
    tdd_enabled: false,
    tdd_coverage_threshold: 90,
  });
  const sourcePath = path.join(tempDir, "src", "quality.ts");
  await mkdir(path.dirname(sourcePath), { recursive: true });
  await writeFile(sourcePath, "export const quality = true;\n", "utf8");
  execFileSync("git", ["init", "-q"], { cwd: tempDir });
  const executionPath = path.join(
    tempDir,
    ".easy-coding",
    "tasks",
    taskId,
    "execution.jsonl",
  );
  await writeFile(
    executionPath,
    `${JSON.stringify({
      type: "plan",
      strategy: "single",
      units: [
        {
          id: "U1",
          title: "quality decision",
          type: "backend",
          files: ["src/quality.ts"],
          depends_on: [],
        },
      ],
    })}\n`,
    "utf8",
  );
  const fingerprints = JSON.parse(
    execFileSync(
      "python3",
      [
        stateApiPath(),
        "evidence-fingerprints",
        "--session-file",
        ".easy-coding/sessions/test.json",
        "--agent",
        "codex",
      ],
      { cwd: tempDir, encoding: "utf8" },
    ),
  ) as {
    implementation_fingerprint: string;
    config_fingerprint: string;
    quality_attempt: { attempt: number };
  };
  return {
    executionPath,
    sourcePath,
    implementationFingerprint: fingerprints.implementation_fingerprint,
    configFingerprint: fingerprints.config_fingerprint,
    qualityAttempt: fingerprints.quality_attempt.attempt,
  };
}

function memoryFixtureId(index: number): string {
  return `SM-019f69d3-5c86-7a10-87a1-${index.toString(16).padStart(12, "0")}`;
}

function memoryFixtureName(index: number): string {
  return `${memoryFixtureId(index)}_20260623_item-${index}.md`;
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
    path.join(tempDir, ".easy-coding", "ABSTRACT.md"),
    "# Architecture\n\nExisting fixture architecture.\n",
    "utf8",
  );
  await writeFile(
    path.join(tempDir, ".easy-coding", "CHANGELOG.md"),
    "# Architecture changelog\n",
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
        memoryFixtureName(index),
      ),
      [
        "---",
        "memory_schema: 2",
        `id: ${memoryFixtureId(index)}`,
        "date: 2026-06-23",
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
      `.easy-coding/memory/short/${memoryFixtureName(checkpointIndex)}`,
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

function recordArchitectureAssessment(
  scriptPath: string,
  action: "no-op" | "backfill" | "update",
  evidence: string,
  affectedSections: string[] = [],
) {
  const args = [
    scriptPath,
    "memory-architecture-assessment",
    "--session-file",
    ".easy-coding/sessions/test.json",
    "--action",
    action,
    "--reason",
    `Fixture ${action} reason`,
    "--evidence",
    evidence,
    "--agent",
    "codex",
  ];
  for (const section of affectedSections) args.push("--affected-section", section);
  return JSON.parse(execFileSync("python3", args, { cwd: tempDir, encoding: "utf8" })) as {
    architecture_assessment: Record<string, unknown>;
  };
}

function readHookSessionIdentity(
  payload: Record<string, unknown>,
  agent: string,
  ppid = 4242,
  environment: NodeJS.ProcessEnv = {},
): Record<string, unknown> {
  const script = [
    "import json,sys",
    "sys.path.insert(0, sys.argv[1])",
    "from easy_coding_state import hook_session_identity",
    "print(json.dumps(hook_session_identity(json.loads(sys.argv[2]), sys.argv[3], int(sys.argv[4]))))",
  ].join(";");
  const output = execFileSync(
    "python3",
    [
      "-c",
      script,
      path.dirname(stateApiPath()),
      JSON.stringify(payload),
      agent,
      String(ppid),
    ],
    { encoding: "utf8", env: cleanAgentEnvironment(environment) },
  );
  return JSON.parse(output) as Record<string, unknown>;
}

function ensureHookSession(
  payload: Record<string, unknown>,
  agent: string,
  ppid = 4242,
  environment: NodeJS.ProcessEnv = {},
): { session: Record<string, unknown>; session_path: string } {
  const script = [
    "import json,sys",
    "from pathlib import Path",
    "sys.path.insert(0, sys.argv[1])",
    "from easy_coding_state import ensure_hook_session",
    "session,session_path=ensure_hook_session(Path(sys.argv[2]), json.loads(sys.argv[3]), sys.argv[4], int(sys.argv[5]))",
    "print(json.dumps({'session': session, 'session_path': str(session_path)}))",
  ].join(";");
  const output = execFileSync(
    "python3",
    [
      "-c",
      script,
      path.dirname(stateApiPath()),
      tempDir,
      JSON.stringify(payload),
      agent,
      String(ppid),
    ],
    { encoding: "utf8", env: cleanAgentEnvironment(environment) },
  );
  return JSON.parse(output) as {
    session: Record<string, unknown>;
    session_path: string;
  };
}

function cleanAgentEnvironment(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const environment = { ...process.env };
  delete environment.CODEX_THREAD_ID;
  delete environment.QODER_PROJECT_DIR;
  delete environment.CLAUDE_PROJECT_DIR;
  return { ...environment, ...overrides };
}

function readDetectedRuntimeAgent(environment: NodeJS.ProcessEnv): string {
  const script = [
    "import sys",
    "sys.path.insert(0, sys.argv[1])",
    "from easy_coding_state import detect_runtime_agent",
    "print(detect_runtime_agent())",
  ].join(";");
  return execFileSync("python3", ["-c", script, path.dirname(stateApiPath())], {
    encoding: "utf8",
    env: cleanAgentEnvironment(environment),
  }).trim();
}

function ensureConcurrentHookSessions(
  payloads: Array<Record<string, unknown>>,
  agent: string,
  ppid = 4242,
): Array<{ session: Record<string, unknown>; session_path: string }> {
  const script = [
    "import json,sys,threading,time",
    "from concurrent.futures import ThreadPoolExecutor",
    "from pathlib import Path",
    "sys.path.insert(0, sys.argv[1])",
    "import easy_coding_state as state",
    "original_migrate=state.migrate_legacy_state",
    "def slow_migrate(root, agent):",
    "    result=original_migrate(root, agent)",
    "    time.sleep(0.2)",
    "    return result",
    "state.migrate_legacy_state=slow_migrate",
    "payloads=json.loads(sys.argv[3])",
    "start=threading.Barrier(len(payloads))",
    "def run(payload):",
    "    start.wait()",
    "    session,session_path=state.ensure_hook_session(Path(sys.argv[2]), payload, sys.argv[4], int(sys.argv[5]))",
    "    return {'session': session, 'session_path': str(session_path)}",
    "with ThreadPoolExecutor(max_workers=len(payloads)) as pool:",
    "    print(json.dumps(list(pool.map(run, payloads))))",
  ].join("\n");
  const output = execFileSync(
    "python3",
    [
      "-c",
      script,
      path.dirname(stateApiPath()),
      tempDir,
      JSON.stringify(payloads),
      agent,
      String(ppid),
    ],
    { encoding: "utf8" },
  );
  return JSON.parse(output) as Array<{
    session: Record<string, unknown>;
    session_path: string;
  }>;
}

describe("easy_coding_state.py hook session identity", () => {
  it("prefers the Qoder environment over its Claude compatibility environment", () => {
    expect(
      readDetectedRuntimeAgent({
        QODER_PROJECT_DIR: tempDir,
        CLAUDE_PROJECT_DIR: tempDir,
      }),
    ).toBe("qoder");
  });

  it("requires project-init completion to keep using the injected logical session", async () => {
    await writeTaskFixture("project-init", "INIT", "codex");
    const sessionsDir = path.join(tempDir, ".easy-coding", "sessions");
    const logicalSessionPath = path.join(sessionsDir, "codex-1200.json");
    await mkdir(sessionsDir, { recursive: true });
    await writeFile(
      logicalSessionPath,
      JSON.stringify({
        current_task: null,
        created_at: "2026-07-01T00:00:00Z",
        agent: "codex",
        external_session_id: "1200",
        session_key: "codex-1200",
        session_source: "hook-session-id",
      }),
      "utf8",
    );

    const missingSession = spawnSync(
      "python3",
      [stateApiPath(), "project-init-complete", "--agent", "codex"],
      { cwd: tempDir, encoding: "utf8" },
    );

    expect(missingSession.status).toBe(1);
    expect(missingSession.stderr).toContain("requires --session-file");
    await expect(
      readFile(path.join(sessionsDir, `codex-ppid-${process.pid}.json`), "utf8"),
    ).rejects.toThrow();

    const completed = JSON.parse(
      execFileSync(
        "python3",
        [
          stateApiPath(),
          "project-init-complete",
          "--session-file",
          ".easy-coding/sessions/codex-1200.json",
          "--agent",
          "codex",
        ],
        { cwd: tempDir, encoding: "utf8" },
      ),
    ) as { status_context: string };

    expect(completed.status_context).toContain(
      "[easy-coding:session-file:.easy-coding/sessions/codex-1200.json]",
    );
    const projectInit = JSON.parse(
      await readFile(
        path.join(tempDir, ".easy-coding", "tasks", "project-init", "task.json"),
        "utf8",
      ),
    ) as { status: string };
    expect(projectInit.status).toBe("COMPLETE");
  });

  it("prefixes the same external session id with the agent namespace", () => {
    const claude = readHookSessionIdentity({ session_id: "1200" }, "claude-code");
    const codex = readHookSessionIdentity({ session_id: "1200" }, "codex");
    const qoder = readHookSessionIdentity({ session_id: "1200" }, "qoder");

    expect(claude.session_key).toBe("claude-code-1200");
    expect(codex.session_key).toBe("codex-1200");
    expect(qoder.session_key).toBe("qoder-1200");
  });

  it("prefers the standard hook session id over the Codex App thread id", () => {
    const identity = readHookSessionIdentity({ session_id: "hook-session" }, "codex", 4242, {
      CODEX_THREAD_ID: "app-thread",
    });

    expect(identity).toMatchObject({
      external_session_id: "hook-session",
      session_key: "codex-hook-session",
      session_source: "hook-session-id",
    });
  });

  it("uses the Codex App thread id when the hook payload omits session_id", () => {
    const identity = readHookSessionIdentity({}, "codex", 4242, {
      CODEX_THREAD_ID: "019f893f-5029-7921-9a2c-444fc7e7ac7e",
    });

    expect(identity).toMatchObject({
      agent: "codex",
      external_session_id: "019f893f-5029-7921-9a2c-444fc7e7ac7e",
      session_key: "codex-019f893f-5029-7921-9a2c-444fc7e7ac7e",
      session_source: "codex-thread-id",
    });
  });

  it("accepts a Codex thread id from the hook payload before consulting the environment", () => {
    const identity = readHookSessionIdentity({ thread_id: "payload-thread" }, "codex", 4242, {
      CODEX_THREAD_ID: "environment-thread",
    });

    expect(identity).toMatchObject({
      external_session_id: "payload-thread",
      session_key: "codex-payload-thread",
      session_source: "codex-thread-id",
    });
  });

  it("hashes unsafe external ids and preserves the original metadata", () => {
    const identity = readHookSessionIdentity({ session_id: "../../escape/session" }, "codex");

    expect(identity.session_key).toMatch(/^codex-sha256-[a-f0-9]{32}$/);
    expect(identity.external_session_id).toBe("../../escape/session");
    expect(identity.session_key).not.toContain("/");
  });

  it("uses an agent-prefixed ppid fallback only when no logical id exists", () => {
    const identity = readHookSessionIdentity({}, "qoder", 2021, {
      CODEX_THREAD_ID: "must-not-leak-across-agent-namespaces",
    });

    expect(identity).toMatchObject({
      agent: "qoder",
      external_session_id: null,
      session_key: "qoder-ppid-2021",
      session_source: "legacy-ppid",
    });
  });

  it("adopts a legacy numeric ppid session into the first canonical logical session", async () => {
    const sessionsDir = path.join(tempDir, ".easy-coding", "sessions");
    await mkdir(sessionsDir, { recursive: true });
    await writeFile(
      path.join(sessionsDir, "4242.json"),
      JSON.stringify({
        current_task: "legacy-task",
        created_at: new Date().toISOString(),
        confirm_mode: "auto",
        harness_disabled: true,
      }),
      "utf8",
    );

    const result = ensureHookSession({ session_id: "1200" }, "codex");

    expect(result.session).toMatchObject({
      current_task: "legacy-task",
      confirm_mode: "auto",
      harness_disabled: true,
      agent: "codex",
      external_session_id: "1200",
      session_key: "codex-1200",
    });
    await expect(readFile(path.join(sessionsDir, "4242.json"), "utf8")).rejects.toThrow();
    await expect(readFile(path.join(sessionsDir, "codex-1200.json"), "utf8")).resolves.toContain(
      '"current_task": "legacy-task"',
    );
  });

  it("merges state.json into an existing empty canonical session before deleting it", async () => {
    const sessionsDir = path.join(tempDir, ".easy-coding", "sessions");
    await mkdir(sessionsDir, { recursive: true });
    await writeTaskFixture("legacy-state-task", "ANALYSIS", "claude-code");
    await writeFile(
      path.join(sessionsDir, "claude-code-1200.json"),
      JSON.stringify({ current_task: null, created_at: "2026-07-01T00:00:00Z" }),
      "utf8",
    );
    await writeFile(
      path.join(tempDir, ".easy-coding", "state.json"),
      JSON.stringify({
        current_task: "legacy-state-task",
        current_stage: "ANALYSIS",
        last_agent: "claude-code",
      }),
      "utf8",
    );

    const result = ensureHookSession({ session_id: "1200" }, "claude-code");

    expect(result.session.current_task).toBe("legacy-state-task");
    await expect(
      readFile(path.join(tempDir, ".easy-coding", "state.json"), "utf8"),
    ).rejects.toThrow();
    await expect(
      readFile(path.join(sessionsDir, "claude-code-1200.json"), "utf8"),
    ).resolves.toContain('"current_task": "legacy-state-task"');
  });

  it("atomically assigns legacy state.json to only one concurrently starting logical session", async () => {
    await mkdir(path.join(tempDir, ".easy-coding", "sessions"), { recursive: true });
    await writeTaskFixture("legacy-concurrent-task", "ANALYSIS", "codex");
    await writeFile(
      path.join(tempDir, ".easy-coding", "state.json"),
      JSON.stringify({
        current_task: "legacy-concurrent-task",
        current_stage: "ANALYSIS",
        last_agent: "codex",
      }),
      "utf8",
    );

    const results = ensureConcurrentHookSessions(
      [{ session_id: "1200" }, { session_id: "1201" }],
      "codex",
    );

    expect(
      results.filter(({ session }) => session.current_task === "legacy-concurrent-task"),
    ).toHaveLength(1);
    expect(results.filter(({ session }) => session.current_task === null)).toHaveLength(1);
    await expect(
      readFile(path.join(tempDir, ".easy-coding", "state.json"), "utf8"),
    ).rejects.toThrow();
  });

  it("cleans expired idle and attached logical sessions", async () => {
    const sessionsDir = path.join(tempDir, ".easy-coding", "sessions");
    await mkdir(sessionsDir, { recursive: true });
    const oldDate = "2020-01-01T00:00:00+00:00";
    await writeFile(
      path.join(sessionsDir, "codex-old-idle.json"),
      JSON.stringify({ current_task: null, created_at: oldDate, last_active_at: oldDate }),
      "utf8",
    );
    await writeFile(
      path.join(sessionsDir, "codex-old-active.json"),
      JSON.stringify({ current_task: "task-active", created_at: oldDate, last_active_at: oldDate }),
      "utf8",
    );
    const recentAttachedDate = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    await writeFile(
      path.join(sessionsDir, "codex-recent-active.json"),
      JSON.stringify({ current_task: "task-recent", created_at: recentAttachedDate }),
      "utf8",
    );
    await writeFile(
      path.join(sessionsDir, "codex-invalid-timestamp.json"),
      JSON.stringify({ created_at: 20200101 }),
      "utf8",
    );
    const malformedPath = path.join(sessionsDir, "legacy-malformed.json");
    await writeFile(malformedPath, "{not-json", "utf8");
    const staleMtime = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    await utimes(malformedPath, staleMtime, staleMtime);
    const script = [
      "import json,sys",
      "from pathlib import Path",
      "sys.path.insert(0, sys.argv[1])",
      "from easy_coding_state import clean_session_runtime",
      "print(json.dumps(clean_session_runtime(Path(sys.argv[2]))))",
    ].join(";");

    const output = execFileSync(
      "python3",
      ["-c", script, path.dirname(stateApiPath()), tempDir],
      { encoding: "utf8" },
    );

    expect(JSON.parse(output)).toEqual({
      sessions_removed: 3,
      acceptance_snapshots_removed: 0,
    });
    await expect(readFile(path.join(sessionsDir, "codex-old-idle.json"), "utf8")).rejects.toThrow();
    await expect(
      readFile(path.join(sessionsDir, "codex-old-active.json"), "utf8"),
    ).rejects.toThrow();
    await expect(
      readFile(path.join(sessionsDir, "codex-recent-active.json"), "utf8"),
    ).resolves.toContain("task-recent");
    await expect(
      readFile(path.join(sessionsDir, "codex-invalid-timestamp.json"), "utf8"),
    ).resolves.toContain("20200101");
    await expect(readFile(malformedPath, "utf8")).rejects.toThrow();
  });

  it("runs session GC only when a new logical hook session is created", async () => {
    const sessionsDir = path.join(tempDir, ".easy-coding", "sessions");
    await mkdir(sessionsDir, { recursive: true });
    const oldDate = "2020-01-01T00:00:00+00:00";
    await writeFile(
      path.join(sessionsDir, "codex-old-idle.json"),
      JSON.stringify({ current_task: null, created_at: oldDate, last_active_at: oldDate }),
      "utf8",
    );
    await writeFile(
      path.join(sessionsDir, "codex-existing.json"),
      JSON.stringify({ current_task: null, created_at: new Date().toISOString() }),
      "utf8",
    );

    ensureHookSession({ session_id: "existing" }, "codex");
    await expect(
      readFile(path.join(sessionsDir, "codex-old-idle.json"), "utf8"),
    ).resolves.toContain("current_task");

    ensureHookSession({ session_id: "new" }, "codex");
    await expect(readFile(path.join(sessionsDir, "codex-old-idle.json"), "utf8")).rejects.toThrow();
    await expect(readFile(path.join(sessionsDir, "codex-new.json"), "utf8")).resolves.toContain(
      '"session_key": "codex-new"',
    );
  });

  it("replaces a non-object logical hook session with a valid session object", async () => {
    const sessionsDir = path.join(tempDir, ".easy-coding", "sessions");
    await mkdir(sessionsDir, { recursive: true });
    await writeFile(path.join(sessionsDir, "codex-invalid.json"), "[]", "utf8");

    const result = ensureHookSession({ session_id: "invalid" }, "codex");

    expect(result.session).toMatchObject({
      current_task: null,
      agent: "codex",
      session_key: "codex-invalid",
    });
    await expect(readFile(path.join(sessionsDir, "codex-invalid.json"), "utf8")).resolves.toContain(
      '"current_task": null',
    );
  });

  it("reserves one slot before creating the 101st logical hook session", async () => {
    const sessionsDir = path.join(tempDir, ".easy-coding", "sessions");
    await mkdir(sessionsDir, { recursive: true });
    for (let index = 0; index < 100; index += 1) {
      const timestamp = new Date(Date.now() - index * 60_000).toISOString();
      await writeFile(
        path.join(sessionsDir, `codex-${index}.json`),
        JSON.stringify({ current_task: null, created_at: timestamp }),
        "utf8",
      );
    }

    ensureHookSession({ session_id: "new" }, "codex");

    const sessionFiles = (await readdir(sessionsDir)).filter((name) => name.endsWith(".json"));
    expect(sessionFiles).toHaveLength(100);
    expect(sessionFiles).toContain("codex-new.json");
    expect(sessionFiles).not.toContain("codex-99.json");
  });

  it("removes orphan acceptance snapshots while preserving active task evidence", async () => {
    const acceptanceDir = path.join(tempDir, ".easy-coding", "sessions", "acceptance");
    await mkdir(acceptanceDir, { recursive: true });
    await writeFile(path.join(acceptanceDir, "active.json"), "{}\n", "utf8");
    await writeFile(path.join(acceptanceDir, "orphan.json"), "{}\n", "utf8");
    await writeFile(path.join(acceptanceDir, "invalid-task.json"), "{}\n", "utf8");
    await writeFile(path.join(acceptanceDir, "terminal.json"), "{}\n", "utf8");
    await writeFile(path.join(acceptanceDir, "unreferenced.json"), "{}\n", "utf8");
    await writeTaskFixture("active", "QUALITY", "codex", {
      verification_checkpoint: {
        snapshot_file: ".easy-coding/sessions/acceptance/active.json",
      },
    });
    const activeTaskPath = path.join(
      tempDir,
      ".easy-coding",
      "tasks",
      "active",
      "task.json",
    );
    const activeTaskBefore = await readFile(activeTaskPath, "utf8");
    await mkdir(path.join(tempDir, ".easy-coding", "tasks", "invalid-task"), { recursive: true });
    await writeFile(
      path.join(tempDir, ".easy-coding", "tasks", "invalid-task", "task.json"),
      "[]",
      "utf8",
    );
    await writeTaskFixture("terminal", "COMPLETE", "codex", {
      verification_checkpoint: {
        snapshot_file: ".easy-coding/sessions/acceptance/terminal.json",
      },
    });
    await writeTaskFixture("unreferenced", "QUALITY", "codex");

    ensureHookSession({ session_id: "new" }, "codex");

    await expect(readFile(path.join(acceptanceDir, "active.json"), "utf8")).resolves.toBe("{}\n");
    await expect(readFile(path.join(acceptanceDir, "invalid-task.json"), "utf8")).resolves.toBe(
      "{}\n",
    );
    await expect(readFile(path.join(acceptanceDir, "orphan.json"), "utf8")).rejects.toThrow();
    await expect(readFile(path.join(acceptanceDir, "terminal.json"), "utf8")).rejects.toThrow();
    await expect(
      readFile(path.join(acceptanceDir, "unreferenced.json"), "utf8"),
    ).rejects.toThrow();
    expect(await readFile(activeTaskPath, "utf8")).toBe(activeTaskBefore);
  });
});

describe("easy_coding_state.py MEMORY instruction", () => {
  it("generates unique UUIDv7 short-memory ids", async () => {
    await writeSessionFixture("06-23-memory-id");

    const generated = Array.from({ length: 32 }, () => {
      const output = execFileSync(
        "python3",
        [
          stateApiPath(),
          "memory-new-id",
          "--session-file",
          ".easy-coding/sessions/test.json",
          "--agent",
          "codex",
        ],
        { cwd: tempDir, encoding: "utf8" },
      );
      return (JSON.parse(output) as { memory_id: string }).memory_id;
    });

    expect(new Set(generated)).toHaveLength(32);
    for (const memoryId of generated) {
      expect(memoryId).toMatch(
        /^SM-[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    }
  });

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
      `.easy-coding/memory/short/${memoryFixtureName(1)}`,
    ]);
  });

  it("keeps legacy numeric memories readable and orders them before UUIDv7 ids on the same date", async () => {
    const scriptPath = await writeMemoryFixture(5);
    const legacyName = "001_20260623_legacy-item.md";
    await writeFile(
      path.join(tempDir, ".easy-coding", "memory", "short", legacyName),
      [
        "---",
        "memory_schema: 2",
        "id: SM-20260623-001",
        "source_task: 06-23-memory",
        "date: 2026-06-23",
        "---",
        "",
        "Legacy short memory",
        "",
      ].join("\n"),
      "utf8",
    );
    await writeMemoryConfig(5, 5);

    const snapshot = readMemoryInstruction(scriptPath);

    expect(snapshot.memory).toMatchObject({ action: "distill", trim_count: 1 });
    expect(snapshot.memory.candidate_files).toEqual([
      `.easy-coding/memory/short/${legacyName}`,
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
    expect(snapshot.memory).not.toHaveProperty("architecture_assessment");
    const completed = JSON.parse(
      execFileSync(
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
      ),
    ) as { memory_progress: { completed: boolean } };
    expect(completed.memory_progress.completed).toBe(true);
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

  it("requires the complete accepted post-verification decision in short memory", async () => {
    const taskId = "08-13-accepted-memory";
    await writeSessionFixture(taskId);
    await writeTaskFixture(taskId, "MEMORY", "codex", { memory_progress: {} });
    const acceptanceDigest = "a".repeat(64);
    await writeFile(
      path.join(tempDir, ".easy-coding", "tasks", taskId, "execution.jsonl"),
      `${JSON.stringify({
        type: "acceptance",
        from_implementation_fingerprint: "before",
        implementation_fingerprint: "after",
        config_fingerprint: "config",
        diff_sha256: acceptanceDigest,
        changed_files: ["src/example.ts"],
        authorization: "explicit-user",
        approval_mode: "auto",
        review_policy: "user-accepted-without-rereview",
        verification_policy: "carry-forward",
        summary: "User accepted a documentation-only edit",
        recorded_by: "codex",
        timestamp: "2026-08-13T00:00:00Z",
      })}\n`,
      "utf8",
    );
    const memoryId = memoryFixtureId(77);
    const memoryName = `${memoryId}_20260813_accepted-diff.md`;
    const memoryPath = path.join(tempDir, ".easy-coding", "memory", "short", memoryName);
    await mkdir(path.dirname(memoryPath), { recursive: true });
    const memoryText = [
      "---",
      "memory_schema: 2",
      `id: ${memoryId}`,
      "date: 2026-08-13",
      `source_task: ${taskId}`,
      "---",
      "",
      "User accepted a documentation-only edit.",
      "",
    ].join("\n");
    await writeFile(memoryPath, memoryText, "utf8");

    const missingDigest = spawnSync(
      "python3",
      [
        stateApiPath(),
        "memory-short-complete",
        "--session-file",
        ".easy-coding/sessions/test.json",
        "--file",
        `.easy-coding/memory/short/${memoryName}`,
        "--agent",
        "codex",
      ],
      { cwd: tempDir, encoding: "utf8" },
    );
    expect(missingDigest.status).toBe(1);
    expect(missingDigest.stderr).toContain(
      "must record the complete accepted post-quality decision",
    );

    await writeFile(memoryPath, `${memoryText}diff_sha256: ${acceptanceDigest}\n`, "utf8");
    const missingDecision = spawnSync(
      "python3",
      [
        stateApiPath(),
        "memory-short-complete",
        "--session-file",
        ".easy-coding/sessions/test.json",
        "--file",
        `.easy-coding/memory/short/${memoryName}`,
        "--agent",
        "codex",
      ],
      { cwd: tempDir, encoding: "utf8" },
    );
    expect(missingDecision.status).toBe(1);
    expect(missingDecision.stderr).toContain("authorization");
    expect(missingDecision.stderr).toContain("changed_file:src/example.ts");

    await writeFile(
      memoryPath,
      [
        memoryText,
        `diff_sha256: ${acceptanceDigest}`,
        "authorization: explicit-user",
        "approval_mode: auto",
        "review_policy: user-accepted-without-rereview",
        "verification_policy: carry-forward",
        "changed_files: src/example.ts",
        "",
      ].join("\n"),
      "utf8",
    );
    const accepted = JSON.parse(
      execFileSync(
        "python3",
        [
          stateApiPath(),
          "memory-short-complete",
          "--session-file",
          ".easy-coding/sessions/test.json",
          "--file",
          `.easy-coding/memory/short/${memoryName}`,
          "--agent",
          "codex",
        ],
        { cwd: tempDir, encoding: "utf8" },
      ),
    ) as { memory_progress: { short_memory_written: boolean } };
    expect(accepted.memory_progress.short_memory_written).toBe(true);
  });

  it("rejects a UUIDv7 id that does not match the filename prefix", async () => {
    await writeSessionFixture("06-23-mismatched-memory-id");
    await writeTaskFixture("06-23-mismatched-memory-id", "MEMORY", "codex", {
      memory_progress: {},
    });
    const memoryId = memoryFixtureId(99);
    const memoryPath = path.join(
      tempDir,
      ".easy-coding",
      "memory",
      "short",
      "wrong-prefix_20260623_summary.md",
    );
    await mkdir(path.dirname(memoryPath), { recursive: true });
    await writeFile(
      memoryPath,
      [
        "---",
        "memory_schema: 2",
        `id: ${memoryId}`,
        "source_task: 06-23-mismatched-memory-id",
        "date: 2026-06-23",
        "---",
        "",
      ].join("\n"),
      "utf8",
    );

    const rejected = spawnSync(
      "python3",
      [
        stateApiPath(),
        "memory-short-complete",
        "--session-file",
        ".easy-coding/sessions/test.json",
        "--file",
        ".easy-coding/memory/short/wrong-prefix_20260623_summary.md",
        "--agent",
        "codex",
      ],
      { cwd: tempDir, encoding: "utf8" },
    );

    expect(rejected.status).toBe(1);
    expect(rejected.stderr).toContain("filename prefix must exactly match");
  });

  it("revalidates the short-memory fingerprint before completion", async () => {
    await writeSessionFixture("06-23-fingerprint");
    await writeTaskFixture("06-23-fingerprint", "MEMORY", "codex", {
      memory_progress: {},
    });
    const memoryId = memoryFixtureId(100);
    const memoryName = `${memoryId}_20260623_fingerprint.md`;
    const memoryPath = path.join(
      tempDir,
      ".easy-coding",
      "memory",
      "short",
      memoryName,
    );
    await mkdir(path.dirname(memoryPath), { recursive: true });
    await writeFile(
      memoryPath,
      [
        "---",
        "memory_schema: 2",
        `id: ${memoryId}`,
        "source_task: 06-23-fingerprint",
        "---",
        "original",
      ].join("\n"),
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
        `.easy-coding/memory/short/${memoryName}`,
        "--agent",
        "codex",
      ],
      { cwd: tempDir, encoding: "utf8" },
    );
    await writeFile(
      path.join(tempDir, ".easy-coding", "ABSTRACT.md"),
      "# Architecture\n\nFingerprint fixture.\n",
      "utf8",
    );
    await writeFile(
      path.join(tempDir, ".easy-coding", "CHANGELOG.md"),
      "# Architecture changelog\n",
      "utf8",
    );
    readMemoryInstruction(stateApiPath());
    await writeFile(
      memoryPath,
      [
        "---",
        "memory_schema: 2",
        `id: ${memoryId}`,
        "source_task: 06-23-fingerprint",
        "---",
        "changed",
      ].join("\n"),
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

    expect(snapshot.memory).toMatchObject({
      short_count: 1,
      short_term_max: 10,
      short_term_keep: 5,
      action: "no-op",
      trim_count: 0,
      candidate_files: [],
      kept_files: [`.easy-coding/memory/short/${memoryFixtureName(1)}`],
      checkpoint_disposition: "kept",
      architecture_assessment: {
        required: false,
        trigger: "none",
        allowed_actions: [],
        abstract: { path: ".easy-coding/ABSTRACT.md", exists: true, non_empty: true },
        changelog: { path: ".easy-coding/CHANGELOG.md", exists: true, non_empty: true },
      },
    });
    expect(snapshot.status_line).toContain(
      "> **Easy Coding** · **Approval: Guard** · **Workflow: Adaptive** · `06-23-memory` · `MEMORY`",
    );
    expect(snapshot.status_context).toContain("[workflow-state:MEMORY]");
  });

  it("returns distill instructions and trim count when threshold is exceeded", async () => {
    const scriptPath = await writeMemoryFixture(12);

    const snapshot = readMemoryInstruction(scriptPath);

    expect(snapshot.memory).toMatchObject({
      short_count: 12,
      short_term_max: 10,
      short_term_keep: 5,
      action: "distill",
      trim_count: 7,
      candidate_files: Array.from(
        { length: 7 },
        (_, index) => `.easy-coding/memory/short/${memoryFixtureName(index + 1)}`,
      ),
      kept_files: Array.from(
        { length: 5 },
        (_, index) => `.easy-coding/memory/short/${memoryFixtureName(index + 8)}`,
      ),
      checkpoint_disposition: "kept",
      architecture_assessment: {
        required: true,
        trigger: "distillation",
        allowed_actions: ["no-op", "update"],
      },
    });
    expect(snapshot.status_line).toContain(
      "> **Easy Coding** · **Approval: Guard** · **Workflow: Adaptive** · `06-23-memory` · `MEMORY`",
    );
    expect(snapshot.status_context).toContain("[workflow-state:MEMORY]");

    const missingAssessment = spawnSync(
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
    expect(missingAssessment.status).toBe(1);
    expect(missingAssessment.stderr).toContain("required architecture assessment");

    recordArchitectureAssessment(
      scriptPath,
      "no-op",
      `.easy-coding/memory/short/${memoryFixtureName(1)}`,
    );

    for (let index = 1; index <= 7; index += 1) {
      await rm(
        path.join(
          tempDir,
          ".easy-coding",
          "memory",
          "short",
          memoryFixtureName(index),
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
    recordArchitectureAssessment(
      scriptPath,
      "no-op",
      `.easy-coding/memory/short/${memoryFixtureName(1)}`,
    );
    for (let index = 1; index <= 7; index += 1) {
      await rm(
        path.join(
          tempDir,
          ".easy-coding",
          "memory",
          "short",
          memoryFixtureName(index),
        ),
      );
    }
    await rm(
      path.join(tempDir, ".easy-coding", "memory", "short", memoryFixtureName(12)),
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
    recordArchitectureAssessment(
      scriptPath,
      "no-op",
      `.easy-coding/memory/short/${memoryFixtureName(1)}`,
    );

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
          memoryFixtureName(index),
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

  it("rejects architecture asset changes when memory and architecture are both no-op", async () => {
    const scriptPath = await writeMemoryFixture(1);
    readMemoryInstruction(scriptPath);
    await appendFile(
      path.join(tempDir, ".easy-coding", "ABSTRACT.md"),
      "\nUnexpected architecture edit.\n",
      "utf8",
    );

    const completed = spawnSync(
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

    expect(completed.status).toBe(1);
    expect(completed.stderr).toContain("Architecture asset changed during a no-op assessment");
  });

  it("backfills a missing ABSTRACT on the first substantive memory even without distillation", async () => {
    const scriptPath = await writeMemoryFixture(1);
    await rm(path.join(tempDir, ".easy-coding", "ABSTRACT.md"));
    await writeFile(
      path.join(tempDir, ".easy-coding", "project.yaml"),
      'mode: "startup" # quoted YAML value\nlanguage: typescript\ntest:\n  framework: vitest\n  command: npm test\n',
      "utf8",
    );
    const snapshot = readMemoryInstruction(scriptPath);
    expect(snapshot.memory).toMatchObject({
      action: "no-op",
      architecture_assessment: {
        required: true,
        trigger: "missing-abstract",
        allowed_actions: ["backfill"],
      },
    });

    await writeFile(
      path.join(tempDir, ".easy-coding", "ABSTRACT.md"),
      "# Architecture\n\nBackfilled from the first substantive task.\n",
      "utf8",
    );
    await appendFile(
      path.join(tempDir, ".easy-coding", "CHANGELOG.md"),
      "\n- Backfilled project architecture.\n",
      "utf8",
    );
    const assessment = recordArchitectureAssessment(
      scriptPath,
      "backfill",
      `.easy-coding/memory/short/${memoryFixtureName(1)}`,
      ["Project architecture"],
    );
    expect(assessment.architecture_assessment).toMatchObject({
      action: "backfill",
      trigger: "missing-abstract",
      affected_sections: ["Project architecture"],
    });

    const completed = JSON.parse(
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
      ),
    ) as { memory_progress: { completed: boolean } };
    expect(completed.memory_progress.completed).toBe(true);
  });

  it("rejects a missing ABSTRACT outside the startup backfill exception", async () => {
    const scriptPath = await writeMemoryFixture(1);
    await rm(path.join(tempDir, ".easy-coding", "ABSTRACT.md"));
    await writeFile(
      path.join(tempDir, ".easy-coding", "project.yaml"),
      "mode: iterative\nlanguage: typescript\ntest:\n  framework: vitest\n  command: npm test\n",
      "utf8",
    );

    const instruction = spawnSync(
      "python3",
      [
        scriptPath,
        "memory-instruction",
        "--session-file",
        ".easy-coding/sessions/test.json",
      ],
      { cwd: tempDir, encoding: "utf8" },
    );

    expect(instruction.status).toBe(1);
    expect(instruction.stderr).toContain("outside the startup backfill exception");
  });

  it("records an evidence-backed architecture update before consuming distillation candidates", async () => {
    const scriptPath = await writeMemoryFixture(12);
    readMemoryInstruction(scriptPath);
    await writeFile(
      path.join(tempDir, ".easy-coding", "ABSTRACT.md"),
      "# Architecture\n\nUpdated module responsibility.\n",
      "utf8",
    );
    await appendFile(
      path.join(tempDir, ".easy-coding", "CHANGELOG.md"),
      "\n- Updated module responsibility.\n",
      "utf8",
    );
    const assessment = recordArchitectureAssessment(
      scriptPath,
      "update",
      `.easy-coding/memory/short/${memoryFixtureName(1)}`,
      ["Module responsibilities"],
    );
    expect(assessment.architecture_assessment).toMatchObject({
      action: "update",
      trigger: "distillation",
      affected_sections: ["Module responsibilities"],
    });

    for (let index = 1; index <= 7; index += 1) {
      await rm(
        path.join(tempDir, ".easy-coding", "memory", "short", memoryFixtureName(index)),
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

  it("refuses architecture assessment after a frozen candidate was consumed early", async () => {
    const scriptPath = await writeMemoryFixture(12);
    readMemoryInstruction(scriptPath);
    await rm(
      path.join(tempDir, ".easy-coding", "memory", "short", memoryFixtureName(1)),
    );

    const assessment = spawnSync(
      "python3",
      [
        scriptPath,
        "memory-architecture-assessment",
        "--session-file",
        ".easy-coding/sessions/test.json",
        "--action",
        "no-op",
        "--reason",
        "No stable architecture change",
        "--evidence",
        `.easy-coding/memory/short/${memoryFixtureName(1)}`,
        "--agent",
        "codex",
      ],
      { cwd: tempDir, encoding: "utf8" },
    );

    expect(assessment.status).toBe(1);
    expect(assessment.stderr).toContain("Keep every frozen distillation candidate");
  });

  it("rejects affected sections on an architecture no-op assessment", async () => {
    const scriptPath = await writeMemoryFixture(12);
    readMemoryInstruction(scriptPath);

    const assessment = spawnSync(
      "python3",
      [
        scriptPath,
        "memory-architecture-assessment",
        "--session-file",
        ".easy-coding/sessions/test.json",
        "--action",
        "no-op",
        "--reason",
        "No stable architecture change",
        "--evidence",
        `.easy-coding/memory/short/${memoryFixtureName(1)}`,
        "--affected-section",
        "Modules",
        "--agent",
        "codex",
      ],
      { cwd: tempDir, encoding: "utf8" },
    );

    expect(assessment.status).toBe(1);
    expect(assessment.stderr).toContain("no-op must not declare affected sections");
  });

  it("rejects architecture evidence outside the frozen memory set", async () => {
    const scriptPath = await writeMemoryFixture(12);
    readMemoryInstruction(scriptPath);

    const assessment = spawnSync(
      "python3",
      [
        scriptPath,
        "memory-architecture-assessment",
        "--session-file",
        ".easy-coding/sessions/test.json",
        "--action",
        "no-op",
        "--reason",
        "No stable architecture change",
        "--evidence",
        ".easy-coding/memory/short/not-frozen.md",
        "--agent",
        "codex",
      ],
      { cwd: tempDir, encoding: "utf8" },
    );

    expect(assessment.status).toBe(1);
    expect(assessment.stderr).toContain("must come from the frozen memory set");
  });

  it("rejects architecture asset drift after a recorded update", async () => {
    const scriptPath = await writeMemoryFixture(12);
    readMemoryInstruction(scriptPath);
    await writeFile(
      path.join(tempDir, ".easy-coding", "ABSTRACT.md"),
      "# Architecture\n\nUpdated module responsibility.\n",
      "utf8",
    );
    await appendFile(
      path.join(tempDir, ".easy-coding", "CHANGELOG.md"),
      "\n- Updated module responsibility.\n",
      "utf8",
    );
    recordArchitectureAssessment(
      scriptPath,
      "update",
      `.easy-coding/memory/short/${memoryFixtureName(1)}`,
      ["Module responsibilities"],
    );
    await appendFile(
      path.join(tempDir, ".easy-coding", "ABSTRACT.md"),
      "\nUnrecorded follow-up edit.\n",
      "utf8",
    );
    for (let index = 1; index <= 7; index += 1) {
      await rm(
        path.join(tempDir, ".easy-coding", "memory", "short", memoryFixtureName(index)),
      );
    }

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
    expect(completed.stderr).toContain("changed after the architecture assessment was recorded");
  });

  it("rejects a corrupted recorded architecture assessment at completion", async () => {
    const scriptPath = await writeMemoryFixture(12);
    readMemoryInstruction(scriptPath);
    recordArchitectureAssessment(
      scriptPath,
      "no-op",
      `.easy-coding/memory/short/${memoryFixtureName(1)}`,
    );
    const taskPath = path.join(
      tempDir,
      ".easy-coding",
      "tasks",
      "06-23-memory",
      "task.json",
    );
    const task = JSON.parse(await readFile(taskPath, "utf8")) as {
      memory_progress: { architecture_assessment: { action: string } };
    };
    task.memory_progress.architecture_assessment.action = "backfill";
    await writeFile(taskPath, JSON.stringify(task, null, 2), "utf8");
    for (let index = 1; index <= 7; index += 1) {
      await rm(
        path.join(tempDir, ".easy-coding", "memory", "short", memoryFixtureName(index)),
      );
    }

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
    expect(completed.stderr).toContain("invalid action");
  });

  it("rejects a recorded update when architecture assets never changed", async () => {
    const scriptPath = await writeMemoryFixture(12);
    readMemoryInstruction(scriptPath);
    recordArchitectureAssessment(
      scriptPath,
      "no-op",
      `.easy-coding/memory/short/${memoryFixtureName(1)}`,
    );
    const taskPath = path.join(
      tempDir,
      ".easy-coding",
      "tasks",
      "06-23-memory",
      "task.json",
    );
    const task = JSON.parse(await readFile(taskPath, "utf8")) as {
      memory_progress: {
        architecture_assessment: { action: string; affected_sections: string[] };
      };
    };
    task.memory_progress.architecture_assessment.action = "update";
    task.memory_progress.architecture_assessment.affected_sections = ["Modules"];
    await writeFile(taskPath, JSON.stringify(task, null, 2), "utf8");
    for (let index = 1; index <= 7; index += 1) {
      await rm(
        path.join(tempDir, ".easy-coding", "memory", "short", memoryFixtureName(index)),
      );
    }

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
    expect(completed.stderr).toContain("ABSTRACT.md did not change after this action");
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

  it("requires acceptance, tests, contracts, and risks in schema 3 plan units", async () => {
    const taskId = "07-27-analysis-contracts";
    await writeSessionFixture(taskId);
    await writeTaskFixture(taskId, "ANALYSIS", "codex");
    await writeAnalysisArtifacts(taskId);
    await mkdir(path.join(tempDir, ".easy-coding"), { recursive: true });
    await writeFile(
      path.join(tempDir, ".easy-coding", "config.yaml"),
      [
        "version: 3",
        "behavior:",
        "  approval_mode: guard",
        "  workflow_mode: adaptive",
        "",
      ].join("\n"),
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

    await writeFile(
      path.join(tempDir, ".easy-coding", "tasks", taskId, "execution.jsonl"),
      `${JSON.stringify({
        type: "plan",
        strategy: "single",
        units: [
          {
            id: "U1",
            title: "complete contract",
            type: "backend",
            files: ["src/example.ts"],
            depends_on: [],
            acceptance_criteria: ["behavior is observable"],
            test_points: ["targeted regression"],
            contracts: ["none"],
            risks: ["none"],
            local_baseline: ["src/example.ts:1 follows the local fixture style"],
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

  it("freezes effective TDD settings atomically on ANALYSIS to IMPLEMENT", async () => {
    const taskId = "08-06-freeze-tdd";
    await writeSessionFixture(taskId, { tdd_enabled: true, tdd_coverage_threshold: 95 });
    await writeTaskFixture(taskId, "ANALYSIS", "codex");
    await writeAnalysisArtifacts(taskId);
    const taskDir = path.join(tempDir, ".easy-coding", "tasks", taskId);
    await mkdir(path.join(tempDir, "src"), { recursive: true });
    await writeFile(path.join(tempDir, "src", "example.java"), "class Example {}\n", "utf8");
    execFileSync("git", ["init", "-q"], { cwd: tempDir });
    execFileSync("git", ["config", "user.email", "fixture@example.com"], { cwd: tempDir });
    execFileSync("git", ["config", "user.name", "Fixture"], { cwd: tempDir });
    execFileSync("git", ["add", "src/example.java"], { cwd: tempDir });
    execFileSync("git", ["commit", "-qm", "baseline"], { cwd: tempDir });
    const baseline = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: tempDir,
      encoding: "utf8",
    }).trim();
    await writeFile(
      path.join(tempDir, ".easy-coding", "config.yaml"),
      [
        "version: 5",
        "behavior:",
        "  approval_mode: guard",
        "  workflow_mode: adaptive",
        "  tdd_enabled: false",
        "  tdd_coverage_threshold: 90",
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
            title: "freeze TDD",
            type: "backend",
            files: ["src/example.java"],
            depends_on: [],
            acceptance_criteria: ["observable"],
            test_points: ["regression"],
            contracts: ["none"],
            risks: ["none"],
            local_baseline: ["src/example.java:1 follows the local fixture style"],
          },
        ],
      })}\n`,
      "utf8",
    );
    await appendFile(
      path.join(taskDir, "dev-spec.md"),
      `\n### TDD Mode\nEnabled; immutable Git baseline ${baseline}; threshold 95%.\n`,
      "utf8",
    );
    await writeFile(
      path.join(taskDir, "test-strategy.md"),
      `# TDD\n\n本地单测和 JaCoCo XML；不可变 Git baseline ${baseline}；远程 CI 不阻塞；阈值 95%。\n`,
      "utf8",
    );
    const missingStructuredContract = spawnSync(
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
    expect(missingStructuredContract.status).toBe(1);
    expect(missingStructuredContract.stderr).toContain("local_test_gate: required");
    expect(missingStructuredContract.stderr).toContain("remote_ci_acceptance: non-blocking");
    await writeFile(
      path.join(taskDir, "test-strategy.md"),
      `# TDD\n\n本地单测和 JaCoCo XML；不可变 Git baseline ${baseline}；阈值 95%。\nlocal_test_gate: required\nremote_ci_acceptance: non-blocking\n`,
      "utf8",
    );

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
    );

    const task = JSON.parse(await readFile(path.join(taskDir, "task.json"), "utf8"));
    expect(task).toMatchObject({
      status: "IMPLEMENT",
      tdd_enabled: true,
      tdd_coverage_threshold: 95,
      tdd_confirmed_by: "codex",
      tdd_baselines: { project: baseline },
    });
  });

  it("rejects TDD-only analysis artifacts when the effective TDD mode is off", async () => {
    const taskId = "08-07-tdd-off-artifacts";
    await writeSessionFixture(taskId);
    await writeTaskFixture(taskId, "ANALYSIS", "codex");
    await writeAnalysisArtifacts(taskId);
    const taskDir = path.join(tempDir, ".easy-coding", "tasks", taskId);
    await appendFile(
      path.join(taskDir, "dev-spec.md"),
      "\n### TDD Mode\nDisabled but planned anyway.\n",
      "utf8",
    );
    await appendFile(
      path.join(taskDir, "test-strategy.md"),
      "\nRun easy_coding_java_coverage.py with RED -> GREEN -> REFACTOR.\n",
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
    expect(rejected.stderr).toContain("must omit the TDD Mode section");
    expect(rejected.stderr).toContain("contains TDD-only planning");
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
        "### 决策闭环",
        "### 影响面分析",
        "### 改动范围",
        "### 修改方案",
        "### 实施拆解",
        "### 测试策略",
        "### Workflow Mode",
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
        "### 决策闭环",
        "decision_status: closed",
        "- **已解决问题与结论**：无",
        "- **确认依据**：无额外决策",
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
        "### Workflow Mode",
        "配置 adaptive，选择 standard。",
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

  it.each(["open", "pending", "unresolved"])(
    "rejects an ANALYSIS transition while decision_status is %s",
    async (decisionStatus) => {
      const taskId = `08-10-analysis-decision-${decisionStatus}`;
      await writeSessionFixture(taskId);
      await writeTaskFixture(taskId, "ANALYSIS", "codex");
      await writeAnalysisArtifacts(taskId);
      const devSpecPath = path.join(tempDir, ".easy-coding", "tasks", taskId, "dev-spec.md");
      const devSpec = await readFile(devSpecPath, "utf8");
      await writeFile(
        devSpecPath,
        devSpec.replace("decision_status: closed", `decision_status: ${decisionStatus}`),
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
      expect(result.stderr).toContain("unresolved material decisions");
      expect(result.stderr).toContain(`decision_status is '${decisionStatus}'`);
    },
  );

  it("requires exactly one closed decision marker before IMPLEMENT", async () => {
    const taskId = "08-10-analysis-decision-marker-count";
    await writeSessionFixture(taskId);
    await writeTaskFixture(taskId, "ANALYSIS", "codex");
    await writeAnalysisArtifacts(taskId);
    const devSpecPath = path.join(tempDir, ".easy-coding", "tasks", taskId, "dev-spec.md");
    const devSpec = await readFile(devSpecPath, "utf8");

    await writeFile(devSpecPath, devSpec.replace("decision_status: closed\n", ""), "utf8");
    const missing = spawnSync(
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
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain("missing the decision closure marker");

    await writeFile(
      devSpecPath,
      devSpec
        .replace("decision_status: closed\n", "")
        .replace("### 风险与注意事项", "### 风险与注意事项\ndecision_status: closed"),
      "utf8",
    );
    const misplaced = spawnSync(
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
    expect(misplaced.status).toBe(1);
    expect(misplaced.stderr).toContain(
      "decision_status marker must be inside the `### 决策闭环` section",
    );

    await writeFile(
      devSpecPath,
      devSpec.replace("decision_status: closed", "decision_status: closed\ndecision_status: closed"),
      "utf8",
    );
    const duplicate = spawnSync(
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
    expect(duplicate.status).toBe(1);
    expect(duplicate.stderr).toContain("exactly one decision_status marker");
  });

  it("rejects decision markers outside the unique decision section", async () => {
    const taskId = "08-10-analysis-decision-marker-location";
    await writeSessionFixture(taskId);
    await writeTaskFixture(taskId, "ANALYSIS", "codex");
    await writeAnalysisArtifacts(taskId);
    const devSpecPath = path.join(tempDir, ".easy-coding", "tasks", taskId, "dev-spec.md");
    const devSpec = await readFile(devSpecPath, "utf8");

    await writeFile(
      devSpecPath,
      devSpec.replace(
        "### 风险与注意事项",
        "### 风险与注意事项\ndecision_status: closed",
      ),
      "utf8",
    );
    const misplacedDuplicate = spawnSync(
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
    expect(misplacedDuplicate.status).toBe(1);
    expect(misplacedDuplicate.stderr).toContain("exactly one decision_status marker");

    await writeFile(
      devSpecPath,
      devSpec.replace("### 影响面分析", "### 决策闭环\n无重复决策。\n### 影响面分析"),
      "utf8",
    );
    const duplicateSection = spawnSync(
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
    expect(duplicateSection.status).toBe(1);
    expect(duplicateSection.stderr).toContain("exactly one `### 决策闭环` section");
  });

  it.each([
    ["fenced-marker", "```yaml\ndecision_status: closed\n```"],
    [
      "nested-fence-marker",
      "````markdown\n```yaml\ndecision_status: closed\n```\n````",
    ],
    ["indented-code-marker", "    decision_status: closed"],
  ])("ignores decision_status examples in %s", async (suffix, markerExample) => {
    const taskId = `08-10-analysis-decision-${suffix}`;
    await writeSessionFixture(taskId);
    await writeTaskFixture(taskId, "ANALYSIS", "codex");
    await writeAnalysisArtifacts(taskId);
    const devSpecPath = path.join(tempDir, ".easy-coding", "tasks", taskId, "dev-spec.md");
    const devSpec = await readFile(devSpecPath, "utf8");
    await writeFile(
      devSpecPath,
      devSpec.replace("decision_status: closed", markerExample),
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
    expect(result.stderr).toContain("missing the decision closure marker");
  });

  it("requires resolved conclusions and confirmation evidence in the decision section", async () => {
    const taskId = "08-10-analysis-decision-evidence";
    await writeSessionFixture(taskId);
    await writeTaskFixture(taskId, "ANALYSIS", "codex");
    await writeAnalysisArtifacts(taskId);
    const devSpecPath = path.join(tempDir, ".easy-coding", "tasks", taskId, "dev-spec.md");
    const devSpec = await readFile(devSpecPath, "utf8");

    await writeFile(
      devSpecPath,
      devSpec.replace("- **已解决问题与结论**：无\n", ""),
      "utf8",
    );
    const missingConclusion = spawnSync(
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
    expect(missingConclusion.status).toBe(1);
    expect(missingConclusion.stderr).toContain("`已解决问题与结论` field; found 0");

    await writeFile(
      devSpecPath,
      devSpec.replace("- **确认依据**：无额外决策", "- **确认依据**：**待确认**"),
      "utf8",
    );
    const unresolvedEvidence = spawnSync(
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
    expect(unresolvedEvidence.status).toBe(1);
    expect(unresolvedEvidence.stderr).toContain("unresolved decision closure evidence");
    expect(unresolvedEvidence.stderr).toContain("`确认依据` is '**待确认**'");
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

  it("rejects empty file scope even when a legacy no-code type is persisted", async () => {
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
    expect(accepted.status).toBe(1);
    expect(accepted.stderr).toContain("execution.jsonl has no valid plan record");

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

  it("does not grant a legacy read-only task a TDD or execution-plan exemption", async () => {
    const taskId = "08-07-read-only-tdd-off";
    await writeSessionFixture(taskId, { tdd_enabled: true, tdd_coverage_threshold: 95 });
    await writeTaskFixture(taskId, "ANALYSIS", "codex", { type: "report" });
    await writeAnalysisArtifacts(taskId);
    const taskDir = path.join(tempDir, ".easy-coding", "tasks", taskId);
    await rm(path.join(taskDir, "test-strategy.md"), { force: true });
    await writeFile(
      path.join(taskDir, "execution.jsonl"),
      `${JSON.stringify({
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

  it("rejects an empty change scope on a persisted legacy read-only task", async () => {
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

    expect(accepted.status).toBe(1);
    expect(accepted.stderr).toContain("execution.jsonl has no valid plan record");
  });

  it("does not exempt a persisted legacy report task from test strategy", async () => {
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
    expect(rejected.stderr).toContain("test-strategy.md is missing or empty");
  });

  it("rejects an empty plan on a persisted legacy analysis task", async () => {
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
    expect(rejected.stderr).toContain("execution.jsonl has no valid plan record");
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
    const taskPath = path.join(
      tempDir,
      ".easy-coding",
      "tasks",
      taskId,
      "task.json",
    );
    const task = JSON.parse(await readFile(taskPath, "utf8")) as {
      workflow_mode_proposal: { minimum_mode: string };
    };
    task.workflow_mode_proposal.minimum_mode = "standard";
    await writeFile(taskPath, JSON.stringify(task, null, 2), "utf8");
    await writeFile(
      path.join(tempDir, ".easy-coding", "tasks", taskId, "execution.jsonl"),
      `${JSON.stringify({
        type: "plan",
        strategy: "parallel",
        units: [
          {
            id: "U1",
            title: "One",
            type: "backend",
            files: ["a.ts"],
            depends_on: [],
            local_baseline: ["a.ts:1 follows the local fixture style"],
          },
          {
            id: "U2",
            title: "Two",
            type: "test",
            files: ["b.ts"],
            depends_on: ["U1"],
            local_baseline: ["b.ts:1 follows the local fixture style"],
          },
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
      status_line: string;
    };

    expect(output.status).toBe("IMPLEMENT");
    expect(output.project_confirm_mode).toBe("approve");
    expect(output.session_confirm_mode).toBe("auto");
    expect(output.effective_confirm_mode).toBe("auto");
    expect(output.status_line).toContain(
      "> **Easy Coding** · **Approval: Auto** · **Workflow: Standard** · `07-11-session-auto` · `IMPLEMENT`",
    );
  });

  it("automatically follows IMPLEMENT to QUALITY in guard mode", async () => {
    const taskId = "07-11-guard-review";
    await writeConfirmModeConfig("guard");
    await writeSessionFixture(taskId);
    await writeTaskFixture(taskId, "IMPLEMENT", "codex");
    await writeFile(
      path.join(tempDir, ".easy-coding", "tasks", taskId, "execution.jsonl"),
      `${JSON.stringify({
        type: "plan",
        strategy: "single",
        units: [
          {
            id: "U1",
            title: "Guard quality transition",
            type: "backend",
            files: ["src/guard.ts"],
            depends_on: [],
          },
        ],
      })}\n`,
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
          "QUALITY",
          "--agent",
          "codex",
        ],
        { cwd: tempDir, encoding: "utf8" },
      ),
    ) as { status: string; effective_confirm_mode: string; status_line: string };

    expect(output.status).toBe("QUALITY");
    expect(output.effective_confirm_mode).toBe("guard");
    expect(output.status_line).toContain(
      "> **Easy Coding** · **Approval: Guard** · **Workflow: Standard** · `07-11-guard-review` · `QUALITY`",
    );
  });

  it("automatically advances QUALITY and MEMORY after confirm approval", async () => {
    const taskId = "07-27-confirm-after-analysis";
    await writeConfirmModeConfig("confirm");
    await writeSessionFixture(taskId);
    await writeTaskFixture(taskId, "IMPLEMENT", "codex", { workflow_mode: "fast" });
    await mkdir(path.join(tempDir, "src"), { recursive: true });
    await writeFile(path.join(tempDir, "src", "confirm.ts"), "export const confirmed = true;\n");
    const executionPath = path.join(
      tempDir,
      ".easy-coding",
      "tasks",
      taskId,
      "execution.jsonl",
    );
    await writeFile(
      executionPath,
      `${JSON.stringify({
        type: "plan",
        strategy: "single",
        units: [
          {
            id: "U1",
            title: "confirm flow",
            type: "backend",
            files: ["src/confirm.ts"],
            depends_on: [],
          },
        ],
      })}\n`,
      "utf8",
    );

    const reviewStage = JSON.parse(
      execFileSync(
        "python3",
        [
          stateApiPath(),
          "auto-transition",
          "--session-file",
          ".easy-coding/sessions/test.json",
          "--stage",
          "QUALITY",
          "--agent",
          "codex",
        ],
        { cwd: tempDir, encoding: "utf8" },
      ),
    ) as { status: string; effective_approval_mode: string };
    expect(reviewStage.status).toBe("QUALITY");
    expect(reviewStage.effective_approval_mode).toBe("confirm");

    const fingerprints = JSON.parse(
      execFileSync(
        "python3",
        [
          stateApiPath(),
          "evidence-fingerprints",
          "--session-file",
          ".easy-coding/sessions/test.json",
          "--agent",
          "codex",
        ],
        { cwd: tempDir, encoding: "utf8" },
      ),
    ) as {
      implementation_fingerprint: string;
      config_fingerprint: string;
      quality_attempt: { attempt: number };
    };
    await appendFile(
      executionPath,
      `${JSON.stringify({
        type: "review",
        dimension: "combined",
        passed: true,
        reviewer: "codex",
        implementation_fingerprint: fingerprints.implementation_fingerprint,
        quality_attempt: fingerprints.quality_attempt.attempt,
        timestamp: "2026-07-27T00:00:00Z",
        findings: [],
      })}\n`,
      "utf8",
    );
    await appendFile(
      executionPath,
      `${JSON.stringify({
        type: "verify",
        check: "targeted-test",
        check_type: "test",
        command: "npm test -- targeted",
        passed: true,
        implementation_fingerprint: fingerprints.implementation_fingerprint,
        config_fingerprint: fingerprints.config_fingerprint,
        quality_attempt: fingerprints.quality_attempt.attempt,
        timestamp: "2026-07-27T00:00:00Z",
      })}\n`,
      "utf8",
    );
    const memoryStage = JSON.parse(
      execFileSync(
        "python3",
        [
          stateApiPath(),
          "auto-transition",
          "--session-file",
          ".easy-coding/sessions/test.json",
          "--stage",
          "MEMORY",
          "--agent",
          "codex",
        ],
        { cwd: tempDir, encoding: "utf8" },
      ),
    ) as { status: string };
    expect(memoryStage.status).toBe("MEMORY");
  });

  it("maps a legacy lite project config to guard plus fast without skipping QUALITY", async () => {
    const taskId = "07-13-lite-verification";
    await writeConfirmModeConfig("lite");
    await writeSessionFixture(taskId);
    await writeTaskFixture(taskId, "IMPLEMENT", "codex", {
      workflow_mode: "fast",
    });
    await writeFile(
      path.join(tempDir, ".easy-coding", "tasks", taskId, "execution.jsonl"),
      `${JSON.stringify({
        type: "plan",
        strategy: "single",
        units: [
          {
            id: "U1",
            title: "Legacy Lite migration",
            type: "backend",
            files: ["src/legacy-lite.ts"],
            depends_on: [],
          },
        ],
      })}\n`,
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
          "QUALITY",
          "--agent",
          "codex",
        ],
        { cwd: tempDir, encoding: "utf8" },
      ),
    ) as {
      status: string;
      effective_approval_mode: string;
      configured_workflow_mode: string;
      status_line: string;
    };

    expect(output.status).toBe("QUALITY");
    expect(output.effective_approval_mode).toBe("guard");
    expect(output.configured_workflow_mode).toBe("fast");
    expect(output.status_line).toContain(
      "> **Easy Coding** · **Approval: Guard** · **Workflow: Fast** · `07-13-lite-verification` · `QUALITY`",
    );
  });

  it("keeps a legacy non-lite session adaptive over a legacy lite project", async () => {
    await writeConfirmModeConfig("lite");
    await writeSessionFixture(null, { confirm_mode: "guard" });

    const output = JSON.parse(
      execFileSync(
        "python3",
        [
          stateApiPath(),
          "snapshot",
          "--session-file",
          ".easy-coding/sessions/test.json",
          "--agent",
          "codex",
        ],
        { cwd: tempDir, encoding: "utf8" },
      ),
    ) as {
      effective_approval_mode: string;
      session_workflow_mode: string;
      configured_workflow_mode: string;
    };

    expect(output.effective_approval_mode).toBe("guard");
    expect(output.session_workflow_mode).toBe("adaptive");
    expect(output.configured_workflow_mode).toBe("adaptive");
  });

  it.each(["approve", "guard", "confirm", "auto"] as const)(
    "shows the effective %s approval mode in the Ready status line",
    async (mode) => {
      await writeConfirmModeConfig("guard");
      await writeSessionFixture(null);

      const output = JSON.parse(
        execFileSync(
          "python3",
          [
            stateApiPath(),
            "set-approval-mode",
            "--session-file",
            ".easy-coding/sessions/test.json",
            "--mode",
            mode,
            "--agent",
            "codex",
          ],
          { cwd: tempDir, encoding: "utf8" },
        ),
      ) as { status_line: string; effective_approval_mode: string };

      expect(output.effective_approval_mode).toBe(mode);
      expect(output.status_line).toContain(
        `> **Easy Coding** · **Approval: ${mode[0].toUpperCase()}${mode.slice(1)}** · **Workflow: Adaptive** · Ready`,
      );
    },
  );

  it("shows TDD only when enabled and honors a frozen task over later session changes", async () => {
    await writeConfirmModeConfig("guard");
    await writeSessionFixture(null);
    await writeTddReadinessFixture();

    const enabled = JSON.parse(
      execFileSync(
        "python3",
        [
          stateApiPath(),
          "set-tdd",
          "--session-file",
          ".easy-coding/sessions/test.json",
          "--enabled",
          "true",
          "--threshold",
          "95",
          "--agent",
          "codex",
        ],
        { cwd: tempDir, encoding: "utf8" },
      ),
    ) as Record<string, unknown>;

    expect(enabled.effective_tdd_enabled).toBe(true);
    expect(enabled.effective_tdd_coverage_threshold).toBe(95);
    expect(enabled.status_line).toContain("**Workflow: Adaptive** · **TDD** · Ready");

    await writeTaskFixture("tdd-frozen", "IMPLEMENT", "codex", {
      tdd_enabled: true,
      tdd_coverage_threshold: 95,
    });
    await writeSessionFixture("tdd-frozen", { tdd_enabled: false, tdd_coverage_threshold: 80 });
    const frozen = JSON.parse(
      execFileSync(
        "python3",
        [
          stateApiPath(),
          "snapshot",
          "--session-file",
          ".easy-coding/sessions/test.json",
          "--agent",
          "codex",
        ],
        { cwd: tempDir, encoding: "utf8" },
      ),
    ) as Record<string, unknown>;

    expect(frozen.effective_tdd_enabled).toBe(false);
    expect(frozen.displayed_tdd_enabled).toBe(true);
    expect(frozen.displayed_tdd_coverage_threshold).toBe(95);

    await rm(path.join(tempDir, ".gitlab-ci.yml"));
    const disabled = JSON.parse(
      execFileSync(
        "python3",
        [
          stateApiPath(),
          "clear-current",
          "--session-file",
          ".easy-coding/sessions/test.json",
          "--agent",
          "codex",
        ],
        { cwd: tempDir, encoding: "utf8" },
      ),
    ) as Record<string, unknown>;
    expect(disabled.status_line).not.toContain("**TDD**");
    expect(disabled.tdd_readiness_status).toBe("not_checked");
    expect(disabled.tdd_readiness_reasons).toEqual([]);
  });

  it("rejects a session TDD enable before ec-tdd-init readiness exists", async () => {
    await writeConfirmModeConfig("guard");
    await writeSessionFixture(null);

    const result = spawnSync(
      "python3",
      [
        stateApiPath(),
        "set-tdd",
        "--session-file",
        ".easy-coding/sessions/test.json",
        "--enabled",
        "true",
        "--agent",
        "codex",
      ],
      { cwd: tempDir, encoding: "utf8" },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("before ec-tdd-init succeeds");
    const session = JSON.parse(
      await readFile(path.join(tempDir, ".easy-coding", "sessions", "test.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(session).not.toHaveProperty("tdd_enabled");
  });

  it("forces a tdd-init task to TDD off even when a stale session requests TDD", async () => {
    const taskId = "08-07-tdd-init-no-cycle";
    await writeConfirmModeConfig("guard");
    await writeSessionFixture(taskId);
    const sessionPath = path.join(tempDir, ".easy-coding", "sessions", "test.json");
    const session = JSON.parse(await readFile(sessionPath, "utf8")) as Record<string, unknown>;
    session.tdd_enabled = true;
    await writeFile(sessionPath, JSON.stringify(session, null, 2), "utf8");
    await writeTaskFixture(taskId, "ANALYSIS", "codex", { type: "tdd-init" });
    await writeAnalysisArtifacts(taskId);
    await writeFile(
      path.join(tempDir, ".easy-coding", "tasks", taskId, "test-strategy.md"),
      [
        "# TDD infrastructure strategy",
        "JaCoCo XML and GitLab TEST infrastructure only.",
        "coverage scope: changed production lines",
        "historical coverage required: no",
        "Record during IMPLEMENT with easy_coding_tdd_readiness.py.",
        "",
      ].join("\n"),
      "utf8",
    );

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
    const output = JSON.parse(
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
    ) as Record<string, unknown>;

    expect(output.status).toBe("IMPLEMENT");
    expect(output.task_tdd_enabled).toBe(false);
    expect(output.displayed_tdd_enabled).toBe(false);
  });

  it("blocks tdd-init verification completion until readiness is ready", async () => {
    const taskId = "08-07-tdd-init-readiness-gate";
    await writeConfirmModeConfig("auto");
    await writeSessionFixture(taskId);
    await writeTaskFixture(taskId, "QUALITY", "codex", {
      type: "tdd-init",
      workflow_mode: "fast",
      workflow_mode_legacy: true,
      tdd_enabled: false,
      tdd_coverage_threshold: 90,
    });
    await writeAnalysisArtifacts(taskId);
    const fingerprints = JSON.parse(
      execFileSync(
        "python3",
        [
          stateApiPath(),
          "evidence-fingerprints",
          "--session-file",
          ".easy-coding/sessions/test.json",
          "--agent",
          "codex",
        ],
        { cwd: tempDir, encoding: "utf8" },
      ),
    ) as {
      implementation_fingerprint: string;
      config_fingerprint: string;
      quality_attempt: { attempt: number };
    };
    await appendFile(
      path.join(tempDir, ".easy-coding", "tasks", taskId, "execution.jsonl"),
      [
        JSON.stringify({
          type: "review",
          dimension: "combined",
          passed: true,
          reviewer: "codex",
          implementation_fingerprint: fingerprints.implementation_fingerprint,
          timestamp: "2026-08-07T00:00:00Z",
          findings: [],
        }),
        JSON.stringify({
          type: "verify",
          check: "infrastructure-test",
          check_type: "test",
          command: "mvn test",
          passed: true,
          timestamp: "2026-08-07T00:00:00Z",
          implementation_fingerprint: fingerprints.implementation_fingerprint,
          config_fingerprint: fingerprints.config_fingerprint,
        }),
        "",
      ].join("\n"),
      "utf8",
    );

    const blocked = spawnSync(
      "python3",
      [
        stateApiPath(),
        "auto-transition",
        "--session-file",
        ".easy-coding/sessions/test.json",
        "--stage",
        "MEMORY",
        "--agent",
        "codex",
      ],
      { cwd: tempDir, encoding: "utf8" },
    );
    expect(blocked.status).toBe(1);
    expect(blocked.stderr).toContain("until readiness passes");

    await writeTddReadinessFixture();
    const ready = JSON.parse(
      execFileSync(
        "python3",
        [
          stateApiPath(),
          "auto-transition",
          "--session-file",
          ".easy-coding/sessions/test.json",
          "--stage",
          "MEMORY",
          "--agent",
          "codex",
        ],
        { cwd: tempDir, encoding: "utf8" },
      ),
    ) as Record<string, unknown>;
    expect(ready.status).toBe("MEMORY");
  });

  it("ignores pre-schema-4 custom TDD keys so legacy projects remain default-off", async () => {
    await mkdir(path.join(tempDir, ".easy-coding"), { recursive: true });
    await writeFile(
      path.join(tempDir, ".easy-coding", "config.yaml"),
      [
        "version: 3",
        "behavior:",
        "  approval_mode: guard",
        "  workflow_mode: adaptive",
        "  tdd_enabled: true",
        "  tdd_coverage_threshold: 99",
        "",
      ].join("\n"),
      "utf8",
    );
    await writeSessionFixture(null);

    const snapshot = JSON.parse(
      execFileSync(
        "python3",
        [
          stateApiPath(),
          "snapshot",
          "--session-file",
          ".easy-coding/sessions/test.json",
          "--agent",
          "codex",
        ],
        { cwd: tempDir, encoding: "utf8" },
      ),
    ) as Record<string, unknown>;

    expect(snapshot.project_tdd_enabled).toBe(false);
    expect(snapshot.project_tdd_coverage_threshold).toBe(90);
  });

  it("maps the legacy set-confirm-mode lite alias to guard plus fast", async () => {
    await writeConfirmModeConfig("approve");
    await writeSessionFixture(null);

    const output = JSON.parse(
      execFileSync(
        "python3",
        [
          stateApiPath(),
          "set-confirm-mode",
          "--session-file",
          ".easy-coding/sessions/test.json",
          "--mode",
          "lite",
          "--agent",
          "codex",
        ],
        { cwd: tempDir, encoding: "utf8" },
      ),
    ) as {
      action: string;
      effective_approval_mode: string;
      configured_workflow_mode: string;
    };

    expect(output.action).toBe("set-confirm-mode");
    expect(output.effective_approval_mode).toBe("guard");
    expect(output.configured_workflow_mode).toBe("fast");
    const session = JSON.parse(
      await readFile(
        path.join(tempDir, ".easy-coding", "sessions", "test.json"),
        "utf8",
      ),
    ) as {
      approval_mode: string;
      workflow_mode: string;
      confirm_mode?: string;
    };
    expect(session).toMatchObject({
      approval_mode: "guard",
      workflow_mode: "fast",
    });
    expect(session.confirm_mode).toBeUndefined();
  });

  it("clears both dimensions created by the legacy lite alias", async () => {
    await writeConfirmModeConfig("approve");
    await writeSessionFixture(null);

    execFileSync(
      "python3",
      [
        stateApiPath(),
        "set-confirm-mode",
        "--session-file",
        ".easy-coding/sessions/test.json",
        "--mode",
        "lite",
        "--agent",
        "codex",
      ],
      { cwd: tempDir, encoding: "utf8" },
    );
    const output = JSON.parse(
      execFileSync(
        "python3",
        [
          stateApiPath(),
          "clear-confirm-mode",
          "--session-file",
          ".easy-coding/sessions/test.json",
          "--agent",
          "codex",
        ],
        { cwd: tempDir, encoding: "utf8" },
      ),
    ) as {
      action: string;
      effective_approval_mode: string;
      configured_workflow_mode: string;
    };

    expect(output.action).toBe("clear-confirm-mode");
    expect(output.effective_approval_mode).toBe("approve");
    expect(output.configured_workflow_mode).toBe("adaptive");
    const session = JSON.parse(
      await readFile(
        path.join(tempDir, ".easy-coding", "sessions", "test.json"),
        "utf8",
      ),
    ) as Record<string, unknown>;
    expect(session).not.toHaveProperty("approval_mode");
    expect(session).not.toHaveProperty("workflow_mode");
    expect(session).not.toHaveProperty("confirm_mode");
    expect(session).not.toHaveProperty("workflow_mode_legacy_confirm_override");
  });

  it("clears the adaptive workflow override created by a legacy non-lite alias", async () => {
    await writeConfirmModeConfig("lite");
    await writeSessionFixture(null);

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
    );
    const output = JSON.parse(
      execFileSync(
        "python3",
        [
          stateApiPath(),
          "clear-confirm-mode",
          "--session-file",
          ".easy-coding/sessions/test.json",
          "--agent",
          "codex",
        ],
        { cwd: tempDir, encoding: "utf8" },
      ),
    ) as {
      effective_approval_mode: string;
      configured_workflow_mode: string;
    };

    expect(output.effective_approval_mode).toBe("guard");
    expect(output.configured_workflow_mode).toBe("fast");
    const session = JSON.parse(
      await readFile(
        path.join(tempDir, ".easy-coding", "sessions", "test.json"),
        "utf8",
      ),
    ) as Record<string, unknown>;
    expect(session).not.toHaveProperty("approval_mode");
    expect(session).not.toHaveProperty("workflow_mode");
    expect(session).not.toHaveProperty("workflow_mode_legacy_alias_override");
    expect(session).not.toHaveProperty("workflow_mode_legacy_confirm_override");
  });

  it("preserves an explicit workflow override when the legacy approval override is cleared", async () => {
    await writeConfirmModeConfig("approve");
    await writeSessionFixture(null);

    execFileSync(
      "python3",
      [
        stateApiPath(),
        "set-confirm-mode",
        "--session-file",
        ".easy-coding/sessions/test.json",
        "--mode",
        "lite",
        "--agent",
        "codex",
      ],
      { cwd: tempDir, encoding: "utf8" },
    );
    execFileSync(
      "python3",
      [
        stateApiPath(),
        "set-workflow-mode",
        "--session-file",
        ".easy-coding/sessions/test.json",
        "--mode",
        "strict",
        "--agent",
        "codex",
      ],
      { cwd: tempDir, encoding: "utf8" },
    );
    const output = JSON.parse(
      execFileSync(
        "python3",
        [
          stateApiPath(),
          "clear-confirm-mode",
          "--session-file",
          ".easy-coding/sessions/test.json",
          "--agent",
          "codex",
        ],
        { cwd: tempDir, encoding: "utf8" },
      ),
    ) as {
      effective_approval_mode: string;
      configured_workflow_mode: string;
    };

    expect(output.effective_approval_mode).toBe("approve");
    expect(output.configured_workflow_mode).toBe("strict");
    const session = JSON.parse(
      await readFile(
        path.join(tempDir, ".easy-coding", "sessions", "test.json"),
        "utf8",
      ),
    ) as Record<string, unknown>;
    expect(session.workflow_mode).toBe("strict");
    expect(session).not.toHaveProperty("approval_mode");
    expect(session).not.toHaveProperty("workflow_mode_legacy_confirm_override");
  });

  it("does not overwrite an explicit workflow override through a non-lite legacy alias", async () => {
    await writeConfirmModeConfig("approve");
    await writeSessionFixture(null, { workflow_mode: "strict" });

    const output = JSON.parse(
      execFileSync(
        "python3",
        [
          stateApiPath(),
          "set-confirm-mode",
          "--session-file",
          ".easy-coding/sessions/test.json",
          "--mode",
          "auto",
          "--agent",
          "codex",
        ],
        { cwd: tempDir, encoding: "utf8" },
      ),
    ) as {
      effective_approval_mode: string;
      configured_workflow_mode: string;
    };

    expect(output.effective_approval_mode).toBe("auto");
    expect(output.configured_workflow_mode).toBe("strict");
    const session = JSON.parse(
      await readFile(
        path.join(tempDir, ".easy-coding", "sessions", "test.json"),
        "utf8",
      ),
    ) as Record<string, unknown>;
    expect(session.approval_mode).toBe("auto");
    expect(session.workflow_mode).toBe("strict");
    expect(session).not.toHaveProperty("workflow_mode_legacy_alias_override");
    expect(session).not.toHaveProperty("workflow_mode_legacy_confirm_override");
  });

  it("remaps the legacy mode workflow override from lite to adaptive", async () => {
    await writeConfirmModeConfig("approve");
    await writeSessionFixture(null);

    for (const mode of ["lite", "guard"]) {
      execFileSync(
        "python3",
        [
          stateApiPath(),
          "set-confirm-mode",
          "--session-file",
          ".easy-coding/sessions/test.json",
          "--mode",
          mode,
          "--agent",
          "codex",
        ],
        { cwd: tempDir, encoding: "utf8" },
      );
    }
    const output = JSON.parse(
      execFileSync(
        "python3",
        [
          stateApiPath(),
          "snapshot",
          "--session-file",
          ".easy-coding/sessions/test.json",
          "--agent",
          "codex",
        ],
        { cwd: tempDir, encoding: "utf8" },
      ),
    ) as {
      effective_approval_mode: string;
      configured_workflow_mode: string;
    };

    expect(output.effective_approval_mode).toBe("guard");
    expect(output.configured_workflow_mode).toBe("adaptive");
    const session = JSON.parse(
      await readFile(
        path.join(tempDir, ".easy-coding", "sessions", "test.json"),
        "utf8",
      ),
    ) as Record<string, unknown>;
    expect(session.approval_mode).toBe("guard");
    expect(session.workflow_mode).toBe("adaptive");
    expect(session).not.toHaveProperty("workflow_mode_legacy_confirm_override");
    expect(session.workflow_mode_legacy_alias_override).toBe(true);
  });

  it("preserves a pending edge when a session mode change makes it automatic", async () => {
    await writeConfirmModeConfig("approve");
    await writeSessionFixture("07-11-mode-change");
    await writeTaskFixture("07-11-mode-change", "IMPLEMENT", "codex", {
      pending_transition: {
        from: "IMPLEMENT",
        to: "QUALITY",
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

    expect(output.pending_transition).toMatchObject({ from: "IMPLEMENT", to: "QUALITY" });
    expect(output.status_context).toContain(
      "[easy-coding:auto-transition-ready:IMPLEMENT->QUALITY]",
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
          "QUALITY",
          "--agent",
          "codex",
        ],
        { cwd: tempDir, encoding: "utf8" },
      ),
    ) as { status: string; pending_transition: null };

    expect(transitioned.status).toBe("QUALITY");
    expect(transitioned.pending_transition).toBeNull();
  });

  it("preserves a pending QUALITY edge when the session workflow mode changes", async () => {
    await writeConfirmModeConfig("approve");
    await writeSessionFixture("07-13-lite-mode-change");
    await writeTaskFixture("07-13-lite-mode-change", "IMPLEMENT", "codex", {
      pending_transition: {
        from: "IMPLEMENT",
        to: "QUALITY",
        requested_at: "2026-07-13T00:00:00Z",
        requested_by: "codex",
      },
    });

    const output = JSON.parse(
      execFileSync(
        "python3",
        [
          stateApiPath(),
          "set-workflow-mode",
          "--session-file",
          ".easy-coding/sessions/test.json",
          "--mode",
          "fast",
          "--agent",
          "codex",
        ],
        { cwd: tempDir, encoding: "utf8" },
      ),
    ) as { status_context: string; configured_workflow_mode: string };

    expect(output.configured_workflow_mode).toBe("fast");
    expect(output.status_context).toContain(
      "[easy-coding:transition-confirmation-required]",
    );
    expect(output.status_context).toContain("[easy-coding:workflow-mode:standard]");
  });

  it("preserves the untouched legacy behavior dimension on session mode changes", async () => {
    await writeConfirmModeConfig("approve");
    await writeSessionFixture(null, { confirm_mode: "lite" });

    const approvalChanged = JSON.parse(
      execFileSync(
        "python3",
        [
          stateApiPath(),
          "set-approval-mode",
          "--session-file",
          ".easy-coding/sessions/test.json",
          "--mode",
          "auto",
          "--agent",
          "codex",
        ],
        { cwd: tempDir, encoding: "utf8" },
      ),
    ) as {
      effective_approval_mode: string;
      configured_workflow_mode: string;
    };
    expect(approvalChanged.effective_approval_mode).toBe("auto");
    expect(approvalChanged.configured_workflow_mode).toBe("fast");

    await writeSessionFixture(null, { confirm_mode: "auto" });
    const workflowChanged = JSON.parse(
      execFileSync(
        "python3",
        [
          stateApiPath(),
          "set-workflow-mode",
          "--session-file",
          ".easy-coding/sessions/test.json",
          "--mode",
          "strict",
          "--agent",
          "codex",
        ],
        { cwd: tempDir, encoding: "utf8" },
      ),
    ) as {
      effective_approval_mode: string;
      configured_workflow_mode: string;
    };
    expect(workflowChanged.effective_approval_mode).toBe("auto");
    expect(workflowChanged.configured_workflow_mode).toBe("strict");

    const persisted = JSON.parse(
      await readFile(
        path.join(tempDir, ".easy-coding", "sessions", "test.json"),
        "utf8",
      ),
    ) as Record<string, unknown>;
    expect(persisted).toMatchObject({
      approval_mode: "auto",
      workflow_mode: "strict",
    });
    expect(persisted).not.toHaveProperty("confirm_mode");
  });

  it("preserves the untouched legacy behavior dimension when clearing a session mode", async () => {
    await writeConfirmModeConfig("approve");
    await writeSessionFixture(null, { confirm_mode: "lite" });

    const approvalCleared = JSON.parse(
      execFileSync(
        "python3",
        [
          stateApiPath(),
          "clear-approval-mode",
          "--session-file",
          ".easy-coding/sessions/test.json",
          "--agent",
          "codex",
        ],
        { cwd: tempDir, encoding: "utf8" },
      ),
    ) as {
      effective_approval_mode: string;
      configured_workflow_mode: string;
    };
    expect(approvalCleared.effective_approval_mode).toBe("approve");
    expect(approvalCleared.configured_workflow_mode).toBe("fast");

    await writeSessionFixture(null, { confirm_mode: "lite" });
    const workflowCleared = JSON.parse(
      execFileSync(
        "python3",
        [
          stateApiPath(),
          "clear-workflow-mode",
          "--session-file",
          ".easy-coding/sessions/test.json",
          "--agent",
          "codex",
        ],
        { cwd: tempDir, encoding: "utf8" },
      ),
    ) as {
      effective_approval_mode: string;
      configured_workflow_mode: string;
    };
    expect(workflowCleared.effective_approval_mode).toBe("guard");
    expect(workflowCleared.configured_workflow_mode).toBe("adaptive");
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

  it("preserves Lite state while no-harness temporarily owns routing", async () => {
    await writeSessionFixture(null, {
      lite_mode: true,
      lite_proposal: {
        summary: "Change one target",
        target_files: ["src/example.ts"],
        digest: "a".repeat(64),
        created_at: "2026-08-19T00:00:00Z",
        confirmed_at: "2026-08-19T00:01:00Z",
      },
    });

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
    ) as { harness_disabled: boolean; lite_mode: boolean; status_context: string };
    expect(disabled).toMatchObject({ harness_disabled: true, lite_mode: true });
    expect(disabled.status_context).toContain("[easy-coding:no-harness]");
    expect(disabled.status_context).not.toContain("[easy-coding:lite-direct]");

    const restored = JSON.parse(
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
    ) as {
      harness_disabled: boolean;
      lite_mode: boolean;
      lite_proposal: { digest: string };
      status_context: string;
    };
    expect(restored).toMatchObject({ harness_disabled: false, lite_mode: true });
    expect(restored.lite_proposal.digest).toBe("a".repeat(64));
    expect(restored.status_context).toContain("[easy-coding:lite-direct]");
  });

  it.each(["approve", "guard", "confirm"] as const)(
    "keeps the %s analysis gate confirmation-required",
    async (confirmMode) => {
      await writeConfirmModeConfig(confirmMode);
      await writeSessionFixture(`07-11-no-auto-bypass-${confirmMode}`);
      await writeTaskFixture(`07-11-no-auto-bypass-${confirmMode}`, "ANALYSIS", "codex");

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
        `Automatic transition is not allowed in ${confirmMode} mode: ANALYSIS -> IMPLEMENT`,
      );
    },
  );

  it.each(["guard", "confirm", "auto"] as const)(
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

  it("allows approve mode to request the IMPLEMENT to QUALITY edge", async () => {
    await writeConfirmModeConfig("approve");
    await writeSessionFixture("07-11-skip-review");
    await writeTaskFixture("07-11-skip-review", "IMPLEMENT", "codex");

    const result = spawnSync(
      "python3",
      [
        stateApiPath(),
        "request-transition",
        "--session-file",
        ".easy-coding/sessions/test.json",
        "--stage",
        "QUALITY",
        "--agent",
        "codex",
      ],
      { cwd: tempDir, encoding: "utf8" },
    );

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).pending_transition).toMatchObject({
      from: "IMPLEMENT",
      to: "QUALITY",
    });
  });

  it("rejects direct completion for a persisted legacy read-only task", async () => {
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
  ])("rejects retired read-only completion before inspecting $name", async ({ result, error }) => {
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
    expect(rejected.stderr).toContain("ILLEGAL TRANSITION: IMPLEMENT -> COMPLETE");
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
    expect(rejected.stderr).toContain("ILLEGAL TRANSITION: IMPLEMENT -> COMPLETE");
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

  it.each(["REVIEW", "VERIFICATION"])(
    "rejects retired %s stages even when a legacy read-only task is persisted",
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
      expect(rejected.stderr).toContain(`Unknown stage: ${target}`);
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
  it("treats stored Codex root ownership as the current codex agent", async () => {
    await writeSessionFixture("06-26-root-owner");
    await writeTaskFixture("06-26-root-owner", "QUALITY", "root");

    const statusContext = execFileSync(
      "python3",
      [
        "-c",
        [
          "import sys",
          "from pathlib import Path",
          "sys.path.insert(0, str(Path(sys.argv[1]).parent))",
          "import easy_coding_state as state",
          "root = Path.cwd()",
          "session = state.load_session(root, '.easy-coding/sessions/test.json')",
          "print(state.build_status_context(root, session, 'codex', '.easy-coding/sessions/test.json'))",
        ].join("; "),
        stateApiPath(),
      ],
      { cwd: tempDir, encoding: "utf8" },
    );

    expect(statusContext).not.toContain("Handoff -> `root`");
    expect(statusContext).not.toContain("[easy-coding:handoff-from:root]");
  });

  it("does not infer a handoff from a legacy display attribution without a handoff record", async () => {
    await writeSessionFixture("08-13-forter-r1-t3");
    await writeTaskFixture("08-13-forter-r1-t3", "IMPLEMENT", "Codex with Easy Coding");

    const statusContext = execFileSync(
      "python3",
      [
        "-c",
        [
          "import sys",
          "from pathlib import Path",
          "sys.path.insert(0, str(Path(sys.argv[1]).parent))",
          "import easy_coding_state as state",
          "root = Path.cwd()",
          "session = state.load_session(root, '.easy-coding/sessions/test.json')",
          "print(state.build_status_context(root, session, 'codex', '.easy-coding/sessions/test.json'))",
        ].join("; "),
        stateApiPath(),
      ],
      { cwd: tempDir, encoding: "utf8" },
    );

    expect(statusContext).not.toContain("Handoff ->");
    expect(statusContext).not.toContain("[easy-coding:handoff-from:");
  });

  it("rejects display attribution as workflow ownership without mutating the task", async () => {
    await writeSessionFixture(null);
    await writeTaskFixture("08-13-display-owner", "IMPLEMENT", "codex");

    const result = spawnSync(
      "python3",
      [
        stateApiPath(),
        "claim-task",
        "--session-file",
        ".easy-coding/sessions/test.json",
        "--task-id",
        "08-13-display-owner",
        "--agent",
        "Codex with Easy Coding",
      ],
      { cwd: tempDir, encoding: "utf8" },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("display attribution");
    const task = JSON.parse(
      await readFile(
        path.join(tempDir, ".easy-coding", "tasks", "08-13-display-owner", "task.json"),
        "utf8",
      ),
    );
    expect(task.last_agent).toBe("codex");
    expect(
      await readFile(path.join(tempDir, ".easy-coding", "sessions", "test.json"), "utf8"),
    ).not.toContain("08-13-display-owner");
  });

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

    await writeSessionFixture("06-26-handoff");
    const pendingContext = execFileSync(
      "python3",
      [
        "-c",
        [
          "import sys",
          "from pathlib import Path",
          "sys.path.insert(0, str(Path(sys.argv[1]).parent))",
          "import easy_coding_state as state",
          "root = Path.cwd()",
          "session = state.load_session(root, '.easy-coding/sessions/test.json')",
          "print(state.build_status_context(root, session, 'qoder', '.easy-coding/sessions/test.json'))",
        ].join("; "),
        stateApiPath(),
      ],
      { cwd: tempDir, encoding: "utf8" },
    );
    expect(pendingContext).toContain("Handoff -> `codex`");
    expect(pendingContext).toContain("[easy-coding:handoff-from:codex]");
  });

  it("marks task list entries as continue or takeover for the current agent", async () => {
    await writeSessionFixture(null);
    await writeTaskFixture("06-26-continue", "ANALYSIS", "codex");
    await writeTaskFixture("06-26-root-continue", "QUALITY", "/root/reviewer");
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
    const rootContinued = listed.tasks.find((task) => task.id === "06-26-root-continue");
    const takeover = listed.tasks.find((task) => task.id === "06-26-takeover");
    expect(continued?.action).toBe("continue");
    expect(continued?.previous_agent).toBeNull();
    expect(rootContinued?.action).toBe("continue");
    expect(rootContinued?.previous_agent).toBeNull();
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
    expect(snapshot.status_context).not.toContain("Handoff ->");

    const task = JSON.parse(
      await readFile(path.join(tempDir, ".easy-coding", "tasks", "06-26-claim", "task.json"), "utf8"),
    );
    const session = JSON.parse(
      await readFile(path.join(tempDir, ".easy-coding", "sessions", "test.json"), "utf8"),
    );
    expect(task.last_agent).toBe("codex");
    expect(session.current_task).toBe("06-26-claim");
    const execution = (
      await readFile(
        path.join(tempDir, ".easy-coding", "tasks", "06-26-claim", "execution.jsonl"),
        "utf8",
      )
    )
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(execution.at(-1)).toMatchObject({
      type: "claim",
      agent: "codex",
      previous_agent: "claude-code",
      action: "takeover",
    });
  });

  it("canonicalizes a Codex root caller for session resolution and persisted ownership", async () => {
    await writeSessionFixture(null);
    await writeTaskFixture("06-26-root-claim", "IMPLEMENT", "root");

    const output = execFileSync(
      "python3",
      [
        stateApiPath(),
        "claim-task",
        "--task-id",
        "06-26-root-claim",
        "--agent",
        "root",
      ],
      { cwd: tempDir, encoding: "utf8" },
    );
    const snapshot = JSON.parse(output) as {
      action: string;
      previous_agent: string;
      status_context: string;
    };

    expect(snapshot.action).toBe("continue");
    expect(snapshot.previous_agent).toBe("root");
    expect(snapshot.status_context).not.toContain("Handoff -> `root`");

    const task = JSON.parse(
      await readFile(
        path.join(tempDir, ".easy-coding", "tasks", "06-26-root-claim", "task.json"),
        "utf8",
      ),
    );
    expect(task.last_agent).toBe("codex");
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

describe("easy_coding_state.py workflow mode and evidence gates", () => {
  it("continues a migrated legacy ANALYSIS task without requiring a new proposal", async () => {
    const taskId = "07-27-legacy-analysis";
    await writeConfirmModeConfig("guard");
    await writeSessionFixture(taskId);
    await writeTaskFixture(taskId, "ANALYSIS", "codex", {
      workflow_mode: "strict",
      workflow_mode_legacy: true,
      workflow_mode_proposal: undefined,
      pending_transition: {
        from: "ANALYSIS",
        to: "IMPLEMENT",
        requested_at: "2026-07-27T00:00:00Z",
        requested_by: "upgrade-migration",
      },
    });
    await writeAnalysisArtifacts(taskId);

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
    ) as { status: string; concrete_workflow_mode: string };

    expect(confirmed.status).toBe("IMPLEMENT");
    expect(confirmed.concrete_workflow_mode).toBe("strict");
    const migratedTask = JSON.parse(
      await readFile(
        path.join(tempDir, ".easy-coding", "tasks", taskId, "task.json"),
        "utf8",
      ),
    ) as Record<string, unknown>;
    expect(migratedTask).not.toHaveProperty("workflow_mode_legacy");

    execFileSync(
      "python3",
      [
        stateApiPath(),
        "auto-transition",
        "--session-file",
        ".easy-coding/sessions/test.json",
        "--stage",
        "QUALITY",
        "--agent",
        "codex",
      ],
      { cwd: tempDir, encoding: "utf8" },
    );
    const bypassAttempt = spawnSync(
      "python3",
      [
        stateApiPath(),
        "request-transition",
        "--session-file",
        ".easy-coding/sessions/test.json",
        "--stage",
        "MEMORY",
        "--agent",
        "codex",
      ],
      { cwd: tempDir, encoding: "utf8" },
    );
    expect(bypassAttempt.status).toBe(1);
    expect(bypassAttempt.stderr).toContain(
      "without review evidence for the current implementation fingerprint",
    );
  });

  it("does not let legacy direct-edge flags bypass QUALITY evidence", async () => {
    const taskId = "07-27-legacy-review-edge";
    await writeConfirmModeConfig("guard");
    await writeSessionFixture(taskId);
    await writeTaskFixture(taskId, "IMPLEMENT", "codex", {
      workflow_mode: "fast",
      workflow_mode_legacy: true,
      workflow_mode_legacy_direct_edge: true,
      pending_transition: {
        from: "IMPLEMENT",
        to: "QUALITY",
        requested_at: "2026-07-27T00:00:00Z",
        requested_by: "upgrade-migration",
      },
    });
    await mkdir(path.join(tempDir, "src"), { recursive: true });
    await writeFile(path.join(tempDir, "src", "example.ts"), "export const value = 1;\n", "utf8");
    await writeFile(
      path.join(tempDir, ".easy-coding", "tasks", taskId, "execution.jsonl"),
      `${JSON.stringify({
        type: "plan",
        strategy: "single",
        units: [
          {
            id: "U1",
            title: "legacy implementation",
            type: "backend",
            files: ["src/example.ts"],
            depends_on: [],
          },
        ],
      })}\n`,
      "utf8",
    );

    const migratedSnapshot = JSON.parse(
      execFileSync(
        "python3",
        [
          stateApiPath(),
          "set-current",
          "--session-file",
          ".easy-coding/sessions/test.json",
          "--task-id",
          taskId,
          "--agent",
          "codex",
        ],
        { cwd: tempDir, encoding: "utf8" },
      ),
    ) as { status_context: string };
    expect(migratedSnapshot.status_context).not.toContain(
      "[easy-coding:lite-review-bypass-required:IMPLEMENT->QUALITY]",
    );
    expect(migratedSnapshot.status_context).toContain(
      "[easy-coding:auto-transition-ready:IMPLEMENT->QUALITY]",
    );

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
          "QUALITY",
          "--agent",
          "codex",
        ],
        { cwd: tempDir, encoding: "utf8" },
      ),
    ) as { status: string };
    expect(transitioned.status).toBe("QUALITY");

    const task = JSON.parse(
      await readFile(
        path.join(tempDir, ".easy-coding", "tasks", taskId, "task.json"),
        "utf8",
      ),
    ) as Record<string, unknown>;
    expect(task).not.toHaveProperty("workflow_mode_legacy");
    expect(task).not.toHaveProperty("workflow_mode_legacy_direct_edge");
    expect(task).not.toHaveProperty("workflow_mode_legacy_review_bypass_fingerprint");

    const memoryAttempt = spawnSync(
      "python3",
      [
        stateApiPath(),
        "request-transition",
        "--session-file",
        ".easy-coding/sessions/test.json",
        "--stage",
        "MEMORY",
        "--agent",
        "codex",
      ],
      { cwd: tempDir, encoding: "utf8" },
    );
    expect(memoryAttempt.status).toBe(1);
    expect(memoryAttempt.stderr).toContain(
      "without review evidence for the current implementation fingerprint",
    );

    const changedFingerprints = JSON.parse(
      execFileSync(
        "python3",
        [
          stateApiPath(),
          "evidence-fingerprints",
          "--session-file",
          ".easy-coding/sessions/test.json",
          "--agent",
          "codex",
        ],
        { cwd: tempDir, encoding: "utf8" },
      ),
    ) as {
      implementation_fingerprint: string;
      config_fingerprint: string;
      quality_attempt: { attempt: number };
    };
    await appendFile(
      path.join(tempDir, ".easy-coding", "tasks", taskId, "execution.jsonl"),
      `${JSON.stringify({
        type: "verify",
        check: "legacy-targeted-test",
        check_type: "test",
        command: "npm test -- legacy-targeted",
        passed: true,
        implementation_fingerprint: changedFingerprints.implementation_fingerprint,
        config_fingerprint: changedFingerprints.config_fingerprint,
        quality_attempt: changedFingerprints.quality_attempt.attempt,
        timestamp: "2026-07-27T00:00:00Z",
      })}\n`,
      "utf8",
    );
    const changedImplementationAttempt = spawnSync(
      "python3",
      [
        stateApiPath(),
        "request-transition",
        "--session-file",
        ".easy-coding/sessions/test.json",
        "--stage",
        "MEMORY",
        "--agent",
        "codex",
      ],
      { cwd: tempDir, encoding: "utf8" },
    );
    expect(changedImplementationAttempt.status).toBe(1);
    expect(changedImplementationAttempt.stderr).toContain(
      "without review evidence for the current implementation fingerprint",
    );
  });

  it("routes a generic migrated task through the normal QUALITY edge", async () => {
    const taskId = "07-27-legacy-without-direct-edge";
    await writeConfirmModeConfig("guard");
    await writeSessionFixture(taskId);
    await writeTaskFixture(taskId, "IMPLEMENT", "codex", {
      workflow_mode: "strict",
      workflow_mode_legacy: true,
    });
    await writeFile(
      path.join(tempDir, ".easy-coding", "tasks", taskId, "execution.jsonl"),
      `${JSON.stringify({
        type: "plan",
        strategy: "single",
        units: [
          {
            id: "U1",
            title: "Migrate through quality",
            type: "backend",
            files: ["src/legacy.ts"],
            depends_on: [],
          },
        ],
      })}\n`,
      "utf8",
    );

    const result = spawnSync(
      "python3",
      [
        stateApiPath(),
        "auto-transition",
        "--session-file",
        ".easy-coding/sessions/test.json",
        "--stage",
        "QUALITY",
        "--agent",
        "codex",
      ],
      { cwd: tempDir, encoding: "utf8" },
    );

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).status).toBe("QUALITY");
  });

  it("requires fresh verification evidence for a migrated task already in QUALITY", async () => {
    const taskId = "07-27-legacy-verification";
    await writeConfirmModeConfig("guard");
    await writeSessionFixture(taskId);
    await writeTaskFixture(taskId, "QUALITY", "codex", {
      workflow_mode: "fast",
      workflow_mode_legacy: true,
    });
    await mkdir(path.join(tempDir, "src"), { recursive: true });
    await writeFile(path.join(tempDir, "src", "legacy.ts"), "export const legacy = true;\n");
    const executionPath = path.join(
      tempDir,
      ".easy-coding",
      "tasks",
      taskId,
      "execution.jsonl",
    );
    await writeFile(
      executionPath,
      `${JSON.stringify({
        type: "plan",
        strategy: "single",
        units: [
          {
            id: "U1",
            title: "legacy verification",
            type: "backend",
            files: ["src/legacy.ts"],
            depends_on: [],
          },
        ],
      })}\n`,
      "utf8",
    );

    const missingEvidence = spawnSync(
      "python3",
      [
        stateApiPath(),
        "request-transition",
        "--session-file",
        ".easy-coding/sessions/test.json",
        "--stage",
        "MEMORY",
        "--agent",
        "codex",
      ],
      { cwd: tempDir, encoding: "utf8" },
    );
    expect(missingEvidence.status).toBe(1);
    expect(missingEvidence.stderr).toContain(
      "without verification evidence for the current implementation and config fingerprints",
    );

    const fingerprints = JSON.parse(
      execFileSync(
        "python3",
        [
          stateApiPath(),
          "evidence-fingerprints",
          "--session-file",
          ".easy-coding/sessions/test.json",
          "--agent",
          "codex",
        ],
        { cwd: tempDir, encoding: "utf8" },
      ),
    ) as {
      implementation_fingerprint: string;
      config_fingerprint: string;
      quality_attempt: { attempt: number };
    };
    await appendFile(
      executionPath,
      `${JSON.stringify({
        type: "review",
        dimension: "combined",
        passed: true,
        reviewer: "codex",
        implementation_fingerprint: fingerprints.implementation_fingerprint,
        timestamp: "2026-07-27T00:00:00Z",
        findings: [],
      })}\n`,
      "utf8",
    );
    await appendFile(
      executionPath,
      `${JSON.stringify({
        type: "verify",
        check: "legacy-regression",
        check_type: "test",
        passed: true,
        implementation_fingerprint: fingerprints.implementation_fingerprint,
        quality_attempt: fingerprints.quality_attempt.attempt,
        config_fingerprint: fingerprints.config_fingerprint,
      })}\n`,
      "utf8",
    );

    const requested = JSON.parse(
      execFileSync(
        "python3",
        [
          stateApiPath(),
          "request-transition",
          "--session-file",
          ".easy-coding/sessions/test.json",
          "--stage",
          "MEMORY",
          "--agent",
          "codex",
        ],
        { cwd: tempDir, encoding: "utf8" },
      ),
    ) as { pending_transition: { from: string; to: string } };
    expect(requested.pending_transition).toMatchObject({
      from: "QUALITY",
      to: "MEMORY",
    });
  });

  it("rejects a proposal below the mechanical floor and atomically freezes a valid proposal", async () => {
    const taskId = "07-27-workflow-freeze";
    await writeConfirmModeConfig("guard");
    await writeSessionFixture(taskId);
    await writeTaskFixture(taskId, "ANALYSIS", "codex", {
      title: "schema migration workflow",
    });
    await writeAnalysisArtifacts(taskId);
    await writeFile(
      path.join(tempDir, ".easy-coding", "tasks", taskId, "execution.jsonl"),
      `${JSON.stringify({
        type: "plan",
        strategy: "single",
        units: [
          {
            id: "U1",
            title: "migrate public schema",
            type: "backend",
            files: ["src/example.ts"],
            depends_on: [],
            risks: ["high-risk irreversible schema migration can cause data loss"],
            contracts: ["public contract compatibility"],
            local_baseline: ["src/example.ts:1 is the nearest comparable implementation"],
          },
        ],
      })}\n`,
      "utf8",
    );

    const calculatedFloor = JSON.parse(
      execFileSync(
        "python3",
        [
          stateApiPath(),
          "workflow-floor",
          "--session-file",
          ".easy-coding/sessions/test.json",
          "--agent",
          "codex",
        ],
        { cwd: tempDir, encoding: "utf8" },
      ),
    ) as { minimum_mode: string; reasons: string[] };
    expect(calculatedFloor.minimum_mode).toBe("strict");
    expect(calculatedFloor.reasons).toContain("compound-high-risk-and-complexity");
    expect(calculatedFloor.reasons).toContain("explicit-high-risk-signal");

    const understatedFloor = spawnSync(
      "python3",
      [
        stateApiPath(),
        "propose-workflow-mode",
        "--session-file",
        ".easy-coding/sessions/test.json",
        "--configured",
        "adaptive",
        "--selected",
        "fast",
        "--minimum",
        "fast",
        "--source",
        "adaptive",
        "--reason",
        "single unit",
        "--agent",
        "codex",
      ],
      { cwd: tempDir, encoding: "utf8" },
    );
    expect(understatedFloor.status).toBe(1);
    expect(understatedFloor.stderr).toContain("below calculated floor strict");

    const rejected = spawnSync(
      "python3",
      [
        stateApiPath(),
        "propose-workflow-mode",
        "--session-file",
        ".easy-coding/sessions/test.json",
        "--configured",
        "adaptive",
        "--selected",
        "fast",
        "--minimum",
        "strict",
        "--source",
        "adaptive",
        "--reason",
        "schema migration",
        "--agent",
        "codex",
      ],
      { cwd: tempDir, encoding: "utf8" },
    );
    expect(rejected.status).toBe(1);
    expect(rejected.stderr).toContain("below the allowed minimum");

    execFileSync(
      "python3",
      [
        stateApiPath(),
        "propose-workflow-mode",
        "--session-file",
        ".easy-coding/sessions/test.json",
        "--configured",
        "adaptive",
        "--selected",
        "strict",
        "--minimum",
        "strict",
        "--source",
        "adaptive",
        "--reason",
        "cross-platform state migration",
        "--agent",
        "codex",
      ],
      { cwd: tempDir, encoding: "utf8" },
    );
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
    ) as { status: string; concrete_workflow_mode: string };

    expect(confirmed.status).toBe("IMPLEMENT");
    expect(confirmed.concrete_workflow_mode).toBe("strict");
    const task = JSON.parse(
      await readFile(
        path.join(tempDir, ".easy-coding", "tasks", taskId, "task.json"),
        "utf8",
      ),
    ) as {
      workflow_mode: string;
      workflow_mode_confirmed_at: string;
      workflow_mode_confirmed_by: string;
    };
    expect(task.workflow_mode).toBe("strict");
    expect(task.workflow_mode_confirmed_at).toBeTruthy();
    expect(task.workflow_mode_confirmed_by).toBe("codex");

    const downgrade = spawnSync(
      "python3",
      [
        stateApiPath(),
        "raise-workflow-mode",
        "--session-file",
        ".easy-coding/sessions/test.json",
        "--mode",
        "standard",
        "--reason",
        "try downgrade",
        "--agent",
        "codex",
      ],
      { cwd: tempDir, encoding: "utf8" },
    );
    expect(downgrade.status).toBe(1);
    expect(downgrade.stderr).toContain("can only be raised above strict");
  });

  it("classifies an actual multi-repository change as standard without a high-risk signal", async () => {
    const taskId = "07-27-actual-cross-repo";
    await writeConfirmModeConfig("guard");
    await writeSessionFixture(taskId);
    await writeTaskFixture(taskId, "ANALYSIS", "codex");
    await mkdir(path.join(tempDir, "src"), { recursive: true });
    await mkdir(path.join(tempDir, "packages", "child"), { recursive: true });
    await writeFile(path.join(tempDir, "src", "root.ts"), "export const root = true;\n", "utf8");
    await writeFile(
      path.join(tempDir, "packages", "child", "child.ts"),
      "export const child = true;\n",
      "utf8",
    );
    execFileSync("git", ["init", "-q"], { cwd: tempDir });
    execFileSync("git", ["init", "-q"], { cwd: path.join(tempDir, "packages", "child") });
    await writeFile(
      path.join(tempDir, ".easy-coding", "tasks", taskId, "execution.jsonl"),
      `${JSON.stringify({
        type: "plan",
        strategy: "single",
        units: [
          {
            id: "U1",
            title: "bounded change",
            type: "backend",
            files: ["src/root.ts", "packages/child/child.ts"],
            depends_on: [],
            local_baseline: ["src/root.ts:1 and packages/child/child.ts:1 define the local style"],
          },
        ],
      })}\n`,
      "utf8",
    );

    const floor = JSON.parse(
      execFileSync(
        "python3",
        [
          stateApiPath(),
          "workflow-floor",
          "--session-file",
          ".easy-coding/sessions/test.json",
          "--agent",
          "codex",
        ],
        { cwd: tempDir, encoding: "utf8" },
      ),
    ) as { minimum_mode: string; reasons: string[] };
    expect(floor.minimum_mode).toBe("standard");
    expect(floor.reasons).toContain("cross-repository-change");
  });

  it("keeps bounded changes at fast through eight files and defaults broader work to standard", async () => {
    await writeConfirmModeConfig("guard");
    execFileSync("git", ["init", "-q"], { cwd: tempDir });
    await mkdir(path.join(tempDir, "src"), { recursive: true });
    for (let index = 1; index <= 10; index += 1) {
      await writeFile(path.join(tempDir, "src", `Model${index}.ts`), `export interface M${index} {}\n`);
    }

    for (const scenario of [
      {
        taskId: "07-27-five-models",
        files: Array.from({ length: 5 }, (_, index) => `src/Model${index + 1}.ts`),
        risks: ["none"],
        contracts: ["none"],
        localBaseline: ["src/Model1.ts:1 is the nearest comparable model"],
        expected: "fast",
        reason: "single-bounded-unit",
      },
      {
        taskId: "07-27-six-models",
        files: Array.from({ length: 6 }, (_, index) => `src/Model${index + 1}.ts`),
        risks: ["none"],
        contracts: ["none"],
        localBaseline: ["src/Model1.ts:1 is the nearest comparable model"],
        expected: "fast",
        reason: "single-bounded-unit",
      },
      {
        taskId: "07-27-broad-low-risk",
        files: Array.from({ length: 10 }, (_, index) => `src/Model${index + 1}.ts`),
        risks: ["none"],
        contracts: ["none"],
        localBaseline: ["src/Model1.ts:1 is the nearest comparable model"],
        expected: "standard",
        reason: "multi-file-impact",
      },
      {
        taskId: "07-27-domain-keywords-only",
        title: "payment schema parameter",
        files: ["src/Model1.ts"],
        risks: ["none"],
        contracts: ["none"],
        localBaseline: ["src/Model1.ts:1 is the nearest comparable model"],
        expected: "fast",
        reason: "single-bounded-unit",
      },
      {
        taskId: "07-27-payment-keyword-risk",
        files: ["src/Model1.ts"],
        risks: ["payment compatibility risk"],
        contracts: ["local model"],
        localBaseline: ["src/Model1.ts:1 is the nearest comparable model"],
        expected: "fast",
        reason: "single-bounded-unit",
      },
      {
        taskId: "07-27-negated-risk-words",
        files: ["src/Model1.ts"],
        risks: ["non-critical payment change with no risk of data loss"],
        contracts: ["local model"],
        localBaseline: ["src/Model1.ts:1 is the nearest comparable model"],
        expected: "fast",
        reason: "single-bounded-unit",
      },
      {
        taskId: "07-27-criticality-keyword",
        files: ["src/Model1.ts"],
        risks: ["low criticality payment parameter"],
        contracts: ["local model"],
        localBaseline: ["src/Model1.ts:1 is the nearest comparable model"],
        expected: "fast",
        reason: "single-bounded-unit",
      },
      {
        taskId: "07-27-bounded-high-risk",
        files: ["src/Model1.ts"],
        risks: ["high-risk financial loss exposure"],
        contracts: ["local model"],
        localBaseline: ["src/Model1.ts:1 is the nearest comparable model"],
        expected: "standard",
        reason: "bounded-high-risk-change",
      },
      {
        taskId: "07-27-bounded-high-risk-zh",
        files: ["src/Model1.ts"],
        risks: ["变更不可逆并可能导致资损"],
        contracts: ["local model"],
        localBaseline: ["src/Model1.ts:1 is the nearest comparable model"],
        expected: "standard",
        reason: "bounded-high-risk-change",
      },
      {
        taskId: "07-27-wide-contract-low-risk",
        files: ["src/Model1.ts"],
        risks: ["none"],
        contracts: ["public API compatibility"],
        localBaseline: ["src/Model1.ts:1 is the nearest comparable model"],
        expected: "standard",
        reason: "wide-contract-impact",
      },
    ]) {
      await writeSessionFixture(scenario.taskId);
      await writeTaskFixture(scenario.taskId, "ANALYSIS", "codex", {
        ...(scenario.title ? { title: scenario.title } : {}),
      });
      const taskDir = path.join(tempDir, ".easy-coding", "tasks", scenario.taskId);
      await writeFile(
        path.join(taskDir, "execution.jsonl"),
        `${JSON.stringify({
          type: "plan",
          strategy: "single",
          units: [
            {
              id: "U1",
              title: "bounded business change",
              type: "backend",
              files: scenario.files,
              depends_on: [],
              risks: scenario.risks,
              contracts: scenario.contracts,
              local_baseline: scenario.localBaseline,
            },
          ],
        })}\n`,
        "utf8",
      );
      const floor = JSON.parse(
        execFileSync(
          "python3",
          [
            stateApiPath(),
            "workflow-floor",
            "--session-file",
            ".easy-coding/sessions/test.json",
            "--agent",
            "codex",
          ],
          { cwd: tempDir, encoding: "utf8" },
        ),
      ) as { minimum_mode: string; reasons: string[] };
      expect(floor.minimum_mode).toBe(scenario.expected);
      expect(floor.reasons).toContain(scenario.reason);
    }
  });

  it("requires a local baseline and keeps two-unit parallel work at fast", async () => {
    const taskId = "07-27-parallel-local-baseline";
    await writeConfirmModeConfig("guard");
    await writeSessionFixture(taskId);
    await writeTaskFixture(taskId, "ANALYSIS", "codex");
    await mkdir(path.join(tempDir, "src"), { recursive: true });
    await writeFile(path.join(tempDir, "src", "ModelA.ts"), "export interface ModelA {}\n");
    await writeFile(path.join(tempDir, "src", "ModelB.ts"), "export interface ModelB {}\n");
    execFileSync("git", ["init", "-q"], { cwd: tempDir });
    const executionPath = path.join(
      tempDir,
      ".easy-coding",
      "tasks",
      taskId,
      "execution.jsonl",
    );
    const units = [
      {
        id: "U1",
        title: "adjust model A",
        type: "backend",
        files: ["src/ModelA.ts"],
        depends_on: [],
        risks: ["none"],
        contracts: ["none"],
      },
      {
        id: "U2",
        title: "adjust model B",
        type: "backend",
        files: ["src/ModelB.ts"],
        depends_on: [],
        risks: ["none"],
        contracts: ["none"],
      },
    ];
    const plan = {
      type: "plan",
      strategy: "parallel",
      units,
      parallel_groups: [{ level: 0, units: ["U1", "U2"] }],
    };
    await writeFile(executionPath, `${JSON.stringify(plan)}\n`, "utf8");

    const missingBaseline = spawnSync(
      "python3",
      [
        stateApiPath(),
        "workflow-floor",
        "--session-file",
        ".easy-coding/sessions/test.json",
        "--agent",
        "codex",
      ],
      { cwd: tempDir, encoding: "utf8" },
    );
    expect(missingBaseline.status).toBe(1);
    expect(missingBaseline.stderr).toContain("non-empty local_baseline: U1, U2");

    await writeFile(
      executionPath,
      `${JSON.stringify({
        ...plan,
        units: units.map((unit) => ({
          ...unit,
          local_baseline: [`${unit.files[0]}:1 is the nearest comparable model`],
        })),
      })}\n`,
      "utf8",
    );
    const floor = JSON.parse(
      execFileSync(
        "python3",
        [
          stateApiPath(),
          "workflow-floor",
          "--session-file",
          ".easy-coding/sessions/test.json",
          "--agent",
          "codex",
        ],
        { cwd: tempDir, encoding: "utf8" },
      ),
    ) as { minimum_mode: string; reasons: string[] };
    expect(floor.minimum_mode).toBe("fast");
    expect(floor.reasons).toContain("single-bounded-unit");
  });

  it("ignores unmodified Canonical and supermodule repositories when calculating the floor", async () => {
    await writeConfirmModeConfig("guard");
    const repoA = path.join(tempDir, "repos", "service-a");
    const repoB = path.join(tempDir, "repos", "service-b");
    await mkdir(path.join(repoA, "src"), { recursive: true });
    await mkdir(path.join(repoB, "src"), { recursive: true });
    execFileSync("git", ["init", "-q"], { cwd: repoA });
    execFileSync("git", ["init", "-q"], { cwd: repoB });
    await writeFile(path.join(repoA, "src", "model.ts"), "export interface Model {}\n");
    await writeFile(path.join(repoB, "src", "unused.ts"), "export const unused = true;\n");

    const scenarios = [
      {
        taskId: "07-27-canonical-one-repo",
        task: {
          spec_source: { path: "/tmp/spec.md" },
          repo_paths: { R1: "repos/service-a", R2: "repos/service-b" },
        },
        unit: { repo_id: "R1", files: ["src/model.ts"] },
      },
      {
        taskId: "07-27-supermodule-one-child",
        task: { repo_paths: { parent: ".", childA: "repos/service-a", childB: "repos/service-b" } },
        unit: { files: ["repos/service-a/src/model.ts"] },
      },
    ];

    for (const scenario of scenarios) {
      await writeSessionFixture(scenario.taskId);
      await writeTaskFixture(scenario.taskId, "ANALYSIS", "codex", scenario.task);
      const taskDir = path.join(tempDir, ".easy-coding", "tasks", scenario.taskId);
      await writeFile(
        path.join(taskDir, "execution.jsonl"),
        `${JSON.stringify({
          type: "plan",
          strategy: "single",
          units: [
            {
              id: "U1",
              title: "change one repository",
              type: "backend",
              depends_on: [],
              risks: ["none"],
              contracts: ["none"],
              local_baseline: ["src/model.ts:1 is the nearest comparable model"],
              ...scenario.unit,
            },
          ],
        })}\n`,
        "utf8",
      );
      const floor = JSON.parse(
        execFileSync(
          "python3",
          [
            stateApiPath(),
            "workflow-floor",
            "--session-file",
            ".easy-coding/sessions/test.json",
            "--agent",
            "codex",
          ],
          { cwd: tempDir, encoding: "utf8" },
        ),
      ) as { minimum_mode: string; reasons: string[] };
      expect(floor.minimum_mode).toBe("fast");
      expect(floor.reasons).toEqual(["single-bounded-unit"]);
    }
  });

  it("invalidates evidence for modified and added unplanned Git worktree files", async () => {
    const taskId = "07-27-unplanned-worktree-change";
    await writeConfirmModeConfig("guard");
    await writeSessionFixture(taskId);
    await writeTaskFixture(taskId, "IMPLEMENT", "codex", { workflow_mode: "fast" });
    await mkdir(path.join(tempDir, "src"), { recursive: true });
    await writeFile(
      path.join(tempDir, "src", "planned.ts"),
      "export const planned = true;\n",
      "utf8",
    );
    await writeFile(
      path.join(tempDir, "src", "outside-plan.ts"),
      "export const outsidePlan = 1;\n",
      "utf8",
    );
    execFileSync("git", ["init", "-q"], { cwd: tempDir });
    execFileSync("git", ["add", "src/planned.ts", "src/outside-plan.ts"], {
      cwd: tempDir,
    });
    const executionPath = path.join(
      tempDir,
      ".easy-coding",
      "tasks",
      taskId,
      "execution.jsonl",
    );
    await writeFile(
      executionPath,
      `${JSON.stringify({
        type: "plan",
        strategy: "single",
        units: [
          {
            id: "U1",
            title: "planned file only",
            type: "backend",
            files: ["src/planned.ts"],
            depends_on: [],
          },
        ],
      })}\n`,
      "utf8",
    );
    const fingerprint = (): string =>
      (
        JSON.parse(
          execFileSync(
            "python3",
            [
              stateApiPath(),
              "evidence-fingerprints",
              "--session-file",
              ".easy-coding/sessions/test.json",
              "--agent",
              "codex",
            ],
            { cwd: tempDir, encoding: "utf8" },
          ),
        ) as { implementation_fingerprint: string }
      ).implementation_fingerprint;

    const beforeRuntimeRecord = fingerprint();
    await appendFile(
      executionPath,
      `${JSON.stringify({ type: "note", message: "runtime state only" })}\n`,
      "utf8",
    );
    expect(fingerprint()).toBe(beforeRuntimeRecord);

    await writeFile(
      path.join(tempDir, "src", "outside-plan.ts"),
      "export const outsidePlan = 2;\n",
      "utf8",
    );
    expect(fingerprint()).not.toBe(beforeRuntimeRecord);
    await writeFile(
      path.join(tempDir, "src", "outside-plan.ts"),
      "export const outsidePlan = 1;\n",
      "utf8",
    );
    expect(fingerprint()).toBe(beforeRuntimeRecord);

    await writeFile(
      path.join(tempDir, "src", "unplanned.ts"),
      "export const unplanned = true;\n",
      "utf8",
    );
    expect(fingerprint()).not.toBe(beforeRuntimeRecord);
  });

  it("excludes runtime evidence when the project is nested inside a parent Git repository", async () => {
    const taskId = "07-27-nested-project-fingerprint";
    const projectRoot = path.join(tempDir, "apps", "nested-project");
    const plannedFile = path.join(projectRoot, "src", "planned.ts");
    await mkdir(path.dirname(plannedFile), { recursive: true });
    await writeFile(plannedFile, "export const planned = true;\n", "utf8");
    execFileSync("git", ["init", "-q"], { cwd: tempDir });
    execFileSync("git", ["add", "apps/nested-project/src/planned.ts"], {
      cwd: tempDir,
    });
    execFileSync(
      "git",
      [
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@example.com",
        "commit",
        "-qm",
        "nested project baseline",
      ],
      { cwd: tempDir },
    );

    const taskDir = path.join(projectRoot, ".easy-coding", "tasks", taskId);
    const executionPath = path.join(taskDir, "execution.jsonl");
    await mkdir(taskDir, { recursive: true });
    await mkdir(path.join(projectRoot, ".easy-coding", "sessions"), { recursive: true });
    await writeFile(
      path.join(projectRoot, ".easy-coding", "sessions", "test.json"),
      JSON.stringify({
        current_task: taskId,
        created_at: "2026-07-27T00:00:00Z",
      }),
      "utf8",
    );
    await writeFile(
      path.join(taskDir, "task.json"),
      JSON.stringify({
        type: "feature",
        title: "nested project fingerprint",
        status: "IMPLEMENT",
        created_at: "2026-07-27T00:00:00Z",
        created_by: "codex",
        last_agent: "codex",
        stage_history: [{ stage: "IMPLEMENT", agent: "codex" }],
        workflow_mode: "fast",
      }),
      "utf8",
    );
    await writeFile(
      executionPath,
      `${JSON.stringify({
        type: "plan",
        strategy: "single",
        units: [
          {
            id: "U1",
            title: "nested project file",
            type: "backend",
            files: ["src/planned.ts"],
            depends_on: [],
          },
        ],
      })}\n`,
      "utf8",
    );
    await writeFile(plannedFile, "export const planned = false;\n", "utf8");

    const fingerprint = (): string =>
      (
        JSON.parse(
          execFileSync(
            "python3",
            [
              stateApiPath(),
              "evidence-fingerprints",
              "--session-file",
              ".easy-coding/sessions/test.json",
              "--agent",
              "codex",
            ],
            { cwd: projectRoot, encoding: "utf8" },
          ),
        ) as { implementation_fingerprint: string }
      ).implementation_fingerprint;

    const beforeEvidence = fingerprint();
    await appendFile(
      executionPath,
      `${JSON.stringify({
        type: "review",
        dimension: "combined",
        passed: true,
        reviewer: "codex",
        implementation_fingerprint: beforeEvidence,
        timestamp: "2026-07-27T00:00:00Z",
        findings: [],
      })}\n`,
      "utf8",
    );
    expect(fingerprint()).toBe(beforeEvidence);

    execFileSync("git", ["add", "apps/nested-project/src/planned.ts"], {
      cwd: tempDir,
    });
    expect(fingerprint()).toBe(beforeEvidence);
    execFileSync(
      "git",
      [
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@example.com",
        "commit",
        "-qm",
        "commit reviewed implementation",
      ],
      { cwd: tempDir },
    );
    expect(fingerprint()).toBe(beforeEvidence);

    await writeFile(
      path.join(tempDir, "parent-only.ts"),
      "export const parentOnly = true;\n",
      "utf8",
    );
    execFileSync("git", ["add", "parent-only.ts"], { cwd: tempDir });
    execFileSync(
      "git",
      [
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@example.com",
        "commit",
        "-qm",
        "unrelated parent change",
      ],
      { cwd: tempDir },
    );
    expect(fingerprint()).toBe(beforeEvidence);

    await writeFile(
      path.join(projectRoot, "src", "unplanned.ts"),
      "export const unplanned = true;\n",
      "utf8",
    );
    expect(fingerprint()).not.toBe(beforeEvidence);
  });

  it("invalidates evidence for a dirty ignored submodule outside the plan", async () => {
    const taskId = "07-27-dirty-submodule";
    const childSource = path.join(tempDir, "submodule-source");
    await mkdir(childSource, { recursive: true });
    execFileSync("git", ["init", "-q"], { cwd: childSource });
    await writeFile(
      path.join(childSource, "child.ts"),
      "export const child = 1;\n",
      "utf8",
    );
    execFileSync("git", ["add", "child.ts"], { cwd: childSource });
    execFileSync(
      "git",
      [
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@example.com",
        "commit",
        "-qm",
        "child baseline",
      ],
      { cwd: childSource },
    );

    execFileSync("git", ["init", "-q"], { cwd: tempDir });
    execFileSync(
      "git",
      [
        "-c",
        "protocol.file.allow=always",
        "submodule",
        "add",
        "-q",
        "./submodule-source",
        "packages/child",
      ],
      { cwd: tempDir },
    );
    await rm(childSource, { recursive: true, force: true });
    execFileSync(
      "git",
      ["config", "-f", ".gitmodules", "submodule.packages/child.ignore", "all"],
      { cwd: tempDir },
    );
    await mkdir(path.join(tempDir, "src"), { recursive: true });
    await writeFile(
      path.join(tempDir, "src", "planned.ts"),
      "export const planned = true;\n",
      "utf8",
    );
    execFileSync("git", ["add", ".gitmodules", "packages/child", "src/planned.ts"], {
      cwd: tempDir,
    });
    execFileSync(
      "git",
      [
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@example.com",
        "commit",
        "-qm",
        "parent baseline",
      ],
      { cwd: tempDir },
    );

    await writeConfirmModeConfig("guard");
    await writeSessionFixture(taskId);
    await writeTaskFixture(taskId, "IMPLEMENT", "codex", { workflow_mode: "fast" });
    await writeFile(
      path.join(tempDir, ".easy-coding", "tasks", taskId, "execution.jsonl"),
      `${JSON.stringify({
        type: "plan",
        strategy: "single",
        units: [
          {
            id: "U1",
            title: "parent file only",
            type: "backend",
            files: ["src/planned.ts"],
            depends_on: [],
          },
        ],
      })}\n`,
      "utf8",
    );
    const fingerprint = (): string =>
      (
        JSON.parse(
          execFileSync(
            "python3",
            [
              stateApiPath(),
              "evidence-fingerprints",
              "--session-file",
              ".easy-coding/sessions/test.json",
              "--agent",
              "codex",
            ],
            { cwd: tempDir, encoding: "utf8" },
          ),
        ) as { implementation_fingerprint: string }
      ).implementation_fingerprint;

    const beforeChange = fingerprint();
    await writeFile(
      path.join(tempDir, "packages", "child", "child.ts"),
      "export const child = 2;\n",
      "utf8",
    );
    expect(fingerprint()).not.toBe(beforeChange);
  });

  it("invalidates stale review and verification evidence by fingerprint", async () => {
    const taskId = "07-27-fingerprint-gates";
    await writeConfirmModeConfig("guard");
    await writeSessionFixture(taskId);
    await writeTaskFixture(taskId, "QUALITY", "codex", {
      workflow_mode: "fast",
      tdd_enabled: false,
      tdd_coverage_threshold: 90,
    });
    await mkdir(path.join(tempDir, "src"), { recursive: true });
    await writeFile(path.join(tempDir, "src", "example.ts"), "export const value = 1;\n", "utf8");
    const executionPath = path.join(
      tempDir,
      ".easy-coding",
      "tasks",
      taskId,
      "execution.jsonl",
    );
    await writeFile(
      executionPath,
      `${JSON.stringify({
        type: "plan",
        strategy: "single",
        units: [
          {
            id: "U1",
            title: "fingerprint",
            type: "backend",
            files: ["src/example.ts"],
            depends_on: [],
          },
        ],
      })}\n`,
      "utf8",
    );

    const missingReview = spawnSync(
      "python3",
      [
        stateApiPath(),
        "request-transition",
        "--session-file",
        ".easy-coding/sessions/test.json",
        "--stage",
        "MEMORY",
        "--agent",
        "codex",
      ],
      { cwd: tempDir, encoding: "utf8" },
    );
    expect(missingReview.status).toBe(1);
    expect(missingReview.stderr).toContain("without review evidence");

    const fingerprints = JSON.parse(
      execFileSync(
        "python3",
        [
          stateApiPath(),
          "evidence-fingerprints",
          "--session-file",
          ".easy-coding/sessions/test.json",
          "--agent",
          "codex",
        ],
        { cwd: tempDir, encoding: "utf8" },
      ),
    ) as {
      implementation_fingerprint: string;
      config_fingerprint: string;
      quality_attempt: { attempt: number };
    };
    await appendFile(
      path.join(tempDir, ".easy-coding", "config.yaml"),
      "  tdd_enabled: true\n  tdd_coverage_threshold: 99\n",
      "utf8",
    );
    const afterProjectTddChange = JSON.parse(
      execFileSync(
        "python3",
        [
          stateApiPath(),
          "evidence-fingerprints",
          "--session-file",
          ".easy-coding/sessions/test.json",
          "--agent",
          "codex",
        ],
        { cwd: tempDir, encoding: "utf8" },
      ),
    ) as {
      implementation_fingerprint: string;
      config_fingerprint: string;
      quality_attempt: { attempt: number };
    };
    expect(afterProjectTddChange).toEqual(fingerprints);
    await appendFile(
      executionPath,
      `${JSON.stringify({
        type: "review",
        dimension: "combined",
        passed: true,
        implementation_fingerprint: fingerprints.implementation_fingerprint,
        quality_attempt: fingerprints.quality_attempt.attempt,
      })}\n`,
      "utf8",
    );
    const malformedReview = spawnSync(
      "python3",
      [
        stateApiPath(),
        "request-transition",
        "--session-file",
        ".easy-coding/sessions/test.json",
        "--stage",
        "MEMORY",
        "--agent",
        "codex",
      ],
      { cwd: tempDir, encoding: "utf8" },
    );
    expect(malformedReview.status).toBe(1);
    expect(malformedReview.stderr).toContain(
      "must include dimension, boolean passed, reviewer",
    );

    for (const findings of [
      ["missing structured finding fields"],
      [
        {
          file: "src/example.ts",
          line: 1,
          issue: "unsupported severity",
          severity: "critical",
        },
      ],
    ]) {
      await appendFile(
        executionPath,
        `${JSON.stringify({
          type: "review",
          dimension: "combined",
          passed: true,
          reviewer: "codex",
          implementation_fingerprint: fingerprints.implementation_fingerprint,
          quality_attempt: fingerprints.quality_attempt.attempt,
          timestamp: "2026-07-27T00:00:00Z",
          findings,
        })}\n`,
        "utf8",
      );
      const malformedFinding = spawnSync(
        "python3",
        [
          stateApiPath(),
          "request-transition",
          "--session-file",
          ".easy-coding/sessions/test.json",
          "--stage",
          "MEMORY",
          "--agent",
          "codex",
        ],
        { cwd: tempDir, encoding: "utf8" },
      );
      expect(malformedFinding.status).toBe(1);
      expect(malformedFinding.stderr).toContain(
        "timestamp, and valid structured findings",
      );
    }

    await appendFile(
      executionPath,
      `${JSON.stringify({
        type: "review",
        dimension: "combined",
        passed: true,
        reviewer: "codex",
        implementation_fingerprint: fingerprints.implementation_fingerprint,
        quality_attempt: fingerprints.quality_attempt.attempt,
        timestamp: "2026-07-27T00:00:00Z",
        findings: [],
      })}\n`,
      "utf8",
    );
    await appendFile(
      executionPath,
      `${JSON.stringify({
        type: "verify",
        check: "targeted-test",
        check_type: "test",
        command: "npm test -- targeted",
        passed: true,
        implementation_fingerprint: fingerprints.implementation_fingerprint,
        config_fingerprint: fingerprints.config_fingerprint,
        quality_attempt: fingerprints.quality_attempt.attempt,
        timestamp: "2026-07-27T00:00:00Z",
      })}\n`,
      "utf8",
    );
    await appendFile(
      executionPath,
      `${JSON.stringify({
        type: "verify",
        check: "unexpected-coverage",
        check_type: "coverage",
        command:
          "python3 .easy-coding/tools/easy_coding_java_coverage.py check --base HEAD --threshold 90",
        passed: true,
        implementation_fingerprint: fingerprints.implementation_fingerprint,
        config_fingerprint: fingerprints.config_fingerprint,
        quality_attempt: fingerprints.quality_attempt.attempt,
        timestamp: "2026-07-27T00:00:30Z",
      })}\n`,
      "utf8",
    );
    const disabledCoverage = spawnSync(
      "python3",
      [
        stateApiPath(),
        "request-transition",
        "--session-file",
        ".easy-coding/sessions/test.json",
        "--stage",
        "MEMORY",
        "--agent",
        "codex",
      ],
      { cwd: tempDir, encoding: "utf8" },
    );
    expect(disabledCoverage.status).toBe(1);
    expect(disabledCoverage.stderr).toContain("not allowed when the frozen TDD mode is off");
    await appendFile(
      executionPath,
      `${JSON.stringify({
        type: "verify",
        check: "unexpected-coverage",
        check_type: "test",
        command: "npm test -- targeted",
        passed: true,
        implementation_fingerprint: fingerprints.implementation_fingerprint,
        config_fingerprint: fingerprints.config_fingerprint,
        quality_attempt: fingerprints.quality_attempt.attempt,
        timestamp: "2026-07-27T00:00:45Z",
      })}\n`,
      "utf8",
    );
    await appendFile(
      path.join(tempDir, ".easy-coding", "config.yaml"),
      "# config changed after verification\n",
      "utf8",
    );

    const staleVerify = spawnSync(
      "python3",
      [
        stateApiPath(),
        "request-transition",
        "--session-file",
        ".easy-coding/sessions/test.json",
        "--stage",
        "MEMORY",
        "--agent",
        "codex",
      ],
      { cwd: tempDir, encoding: "utf8" },
    );
    expect(staleVerify.status).toBe(1);
    expect(staleVerify.stderr).toContain("no longer matches the current config");

    const refreshed = JSON.parse(
      execFileSync(
        "python3",
        [
          stateApiPath(),
          "evidence-fingerprints",
          "--session-file",
          ".easy-coding/sessions/test.json",
          "--agent",
          "codex",
        ],
        { cwd: tempDir, encoding: "utf8" },
      ),
    ) as {
      implementation_fingerprint: string;
      config_fingerprint: string;
      quality_attempt: { attempt: number };
    };
    await appendFile(
      executionPath,
      `${JSON.stringify({
        type: "review",
        dimension: "combined",
        passed: true,
        reviewer: "codex",
        implementation_fingerprint: refreshed.implementation_fingerprint,
        quality_attempt: refreshed.quality_attempt.attempt,
        timestamp: "2026-07-27T00:01:00Z",
        findings: [],
      })}\n`,
      "utf8",
    );
    await appendFile(
      executionPath,
      `${JSON.stringify({
        type: "verify",
        check: "targeted-test",
        check_type: "test",
        command: "npm test -- targeted",
        passed: true,
        implementation_fingerprint: refreshed.implementation_fingerprint,
        config_fingerprint: refreshed.config_fingerprint,
        quality_attempt: refreshed.quality_attempt.attempt,
        timestamp: "2026-07-27T00:01:00Z",
      })}\n`,
      "utf8",
    );
    const requested = JSON.parse(
      execFileSync(
        "python3",
        [
          stateApiPath(),
          "request-transition",
          "--session-file",
          ".easy-coding/sessions/test.json",
          "--stage",
          "MEMORY",
          "--agent",
          "codex",
        ],
        { cwd: tempDir, encoding: "utf8" },
      ),
    ) as { pending_transition: { from: string; to: string } };
    expect(requested.pending_transition).toMatchObject({
      from: "QUALITY",
      to: "MEMORY",
    });
  });

  it("keeps auto mode automatic when the verified implementation is unchanged", async () => {
    const taskId = "08-13-auto-acceptance";
    const fixture = await writeVerificationAcceptanceFixture(taskId);

    const transitioned = JSON.parse(
      execFileSync(
        "python3",
        [
          stateApiPath(),
          "auto-transition",
          "--session-file",
          ".easy-coding/sessions/test.json",
          "--stage",
          "MEMORY",
          "--agent",
          "codex",
        ],
        { cwd: tempDir, encoding: "utf8" },
      ),
    ) as { status: string; action: string };

    expect(transitioned).toMatchObject({ status: "MEMORY", action: "auto-transition" });
    const task = JSON.parse(
      await readFile(
        path.join(tempDir, ".easy-coding", "tasks", taskId, "task.json"),
        "utf8",
      ),
    );
    expect(task.verification_checkpoint).toBeUndefined();
    const records = (await readFile(fixture.executionPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(records.filter((record) => record.type === "acceptance")).toEqual([
      expect.objectContaining({
        changed_files: [],
        authorization: "approval-policy",
        approval_mode: "auto",
        review_policy: "current",
        verification_policy: "current",
      }),
    ]);
  }, 15_000);

  it("finalizes exactly one state-owned QUALITY record and rejects malformed records", async () => {
    const taskId = "08-19-quality-record";
    const fixture = await writeVerificationAcceptanceFixture(taskId, "guard");
    const checkpointArgs = [
      stateApiPath(),
      "quality-checkpoint",
      "--session-file",
      ".easy-coding/sessions/test.json",
      "--agent",
      "codex",
    ];

    execFileSync("python3", checkpointArgs, { cwd: tempDir, encoding: "utf8" });
    execFileSync("python3", checkpointArgs, { cwd: tempDir, encoding: "utf8" });
    const records = (await readFile(fixture.executionPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(records.filter((record) => record.type === "quality")).toEqual([
      expect.objectContaining({
        type: "quality",
        attempt: 1,
        implementation_fingerprint: fixture.implementationFingerprint,
        config_fingerprint: fixture.configFingerprint,
        repair_count: 0,
        outcome: "passed",
        review_gate: "passed",
        verification_gate: "passed",
        summary: "QUALITY gates passed for the current candidate.",
        evidence_start_index: 1,
        evidence_end_index: 3,
        failure_classes: [],
      }),
    ]);

    const malformedTaskId = "08-19-malformed-quality-record";
    const malformed = await writeVerificationAcceptanceFixture(malformedTaskId, "guard");
    await appendFile(
      malformed.executionPath,
      `${JSON.stringify({ type: "quality", attempt: 1 })}\n`,
      "utf8",
    );
    const rejected = spawnSync("python3", checkpointArgs, {
      cwd: tempDir,
      encoding: "utf8",
    });
    expect(rejected.status).toBe(1);
    expect(rejected.stderr).toContain(
      "QUALITY record outcome must be passed, repair, replan, or cancelled",
    );
  }, 20_000);

  it("requires both QUALITY gates to reach a terminal state before repair", async () => {
    const taskId = "08-19-quality-terminal-gates";
    const fixture = await writeQualityDecisionFixture(taskId);
    await appendFile(
      fixture.executionPath,
      `${JSON.stringify({
        type: "review",
        dimension: "correctness",
        passed: false,
        reviewer: "codex-reviewer",
        implementation_fingerprint: fixture.implementationFingerprint,
        quality_attempt: fixture.qualityAttempt,
        failure_classes: ["code-defect"],
        timestamp: "2026-08-19T00:00:00Z",
        findings: [
          {
            file: "src/quality.ts",
            line: 1,
            issue: "repair required",
            severity: "error",
          },
        ],
      })}\n`,
      "utf8",
    );
    const decisionArgs = [
      stateApiPath(),
      "finalize-quality",
      "--session-file",
      ".easy-coding/sessions/test.json",
      "--outcome",
      "repair",
      "--review-gate",
      "failed",
      "--verification-gate",
      "passed",
      "--failure-class",
      "code-defect",
      "--summary",
      "Review found a code defect",
      "--agent",
      "codex",
    ];
    const incomplete = spawnSync("python3", decisionArgs, {
      cwd: tempDir,
      encoding: "utf8",
    });
    expect(incomplete.status).toBe(1);
    expect(incomplete.stderr).toContain(
      "The Verification Gate has no evidence for this QUALITY attempt",
    );

    decisionArgs[decisionArgs.indexOf("passed")] = "cancelled";
    const finalized = JSON.parse(
      execFileSync("python3", decisionArgs, { cwd: tempDir, encoding: "utf8" }),
    );
    expect(finalized.quality).toMatchObject({
      outcome: "repair",
      review_gate: "failed",
      verification_gate: "cancelled",
      failure_classes: ["code-defect"],
    });
    execFileSync("python3", decisionArgs, { cwd: tempDir, encoding: "utf8" });
    const records = (await readFile(fixture.executionPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(records.filter((record) => record.type === "quality")).toHaveLength(1);
  });

  it("keeps environmental verification failures in QUALITY", async () => {
    const taskId = "08-19-quality-environment";
    const fixture = await writeQualityDecisionFixture(taskId);
    await appendFile(
      fixture.executionPath,
      `${[
        {
          type: "review",
          dimension: "combined",
          passed: true,
          reviewer: "codex-reviewer",
          implementation_fingerprint: fixture.implementationFingerprint,
          quality_attempt: fixture.qualityAttempt,
          timestamp: "2026-08-19T00:00:00Z",
          findings: [],
        },
        {
          type: "verify",
          check: "targeted-test",
          check_type: "test",
          command: "mvn test",
          passed: false,
          failures: ["mvn: command not found"],
          implementation_fingerprint: fixture.implementationFingerprint,
          config_fingerprint: fixture.configFingerprint,
          quality_attempt: fixture.qualityAttempt,
          failure_classes: ["environment"],
          timestamp: "2026-08-19T00:01:00Z",
        },
      ]
        .map((record) => JSON.stringify(record))
        .join("\n")}\n`,
      "utf8",
    );
    const rejected = spawnSync(
      "python3",
      [
        stateApiPath(),
        "finalize-quality",
        "--session-file",
        ".easy-coding/sessions/test.json",
        "--outcome",
        "repair",
        "--review-gate",
        "passed",
        "--verification-gate",
        "failed",
        "--failure-class",
        "environment",
        "--summary",
        "Build tool unavailable",
        "--agent",
        "codex",
      ],
      { cwd: tempDir, encoding: "utf8" },
    );
    expect(rejected.status).toBe(1);
    expect(rejected.stderr).toContain(
      "QUALITY repair requires a code-defect or test-defect classification only",
    );
    const misclassified = spawnSync(
      "python3",
      [
        stateApiPath(),
        "finalize-quality",
        "--session-file",
        ".easy-coding/sessions/test.json",
        "--outcome",
        "repair",
        "--review-gate",
        "passed",
        "--verification-gate",
        "failed",
        "--failure-class",
        "code-defect",
        "--summary",
        "Misclassify the environment as code",
        "--agent",
        "codex",
      ],
      { cwd: tempDir, encoding: "utf8" },
    );
    expect(misclassified.status).toBe(1);
    expect(misclassified.stderr).toContain(
      "failure classes must exactly match the blocking gate evidence",
    );
    const task = JSON.parse(
      await readFile(
        path.join(tempDir, ".easy-coding", "tasks", taskId, "task.json"),
        "utf8",
      ),
    );
    expect(task).toMatchObject({ status: "QUALITY", quality_attempt: { attempt: 1 } });
  });

  it("prioritizes contract ambiguity in a mixed replan and starts a fresh QUALITY attempt later", async () => {
    const taskId = "08-19-quality-replan";
    const fixture = await writeQualityDecisionFixture(taskId);
    await appendFile(
      fixture.executionPath,
      `${JSON.stringify({
        type: "review",
        dimension: "contract",
        passed: false,
        reviewer: "codex-reviewer",
        implementation_fingerprint: fixture.implementationFingerprint,
        quality_attempt: fixture.qualityAttempt,
        failure_classes: ["contract-ambiguity", "code-defect"],
        timestamp: "2026-08-19T00:00:00Z",
        findings: [
          {
            file: "src/quality.ts",
            line: 1,
            issue: "contract is ambiguous",
            severity: "error",
          },
        ],
      })}\n`,
      "utf8",
    );
    execFileSync(
      "python3",
      [
        stateApiPath(),
        "finalize-quality",
        "--session-file",
        ".easy-coding/sessions/test.json",
        "--outcome",
        "replan",
        "--review-gate",
        "failed",
        "--verification-gate",
        "cancelled",
        "--failure-class",
        "contract-ambiguity",
        "--failure-class",
        "code-defect",
        "--summary",
        "Clarify the contract before implementation",
        "--agent",
        "codex",
      ],
      { cwd: tempDir, encoding: "utf8" },
    );
    const analysis = JSON.parse(
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
    );
    expect(analysis.status).toBe("ANALYSIS");

    const taskPath = path.join(tempDir, ".easy-coding", "tasks", taskId, "task.json");
    const task = JSON.parse(await readFile(taskPath, "utf8"));
    task.status = "IMPLEMENT";
    await writeFile(taskPath, JSON.stringify(task, null, 2), "utf8");
    await writeFile(fixture.sourcePath, "export const quality = 'replanned';\n", "utf8");
    execFileSync(
      "python3",
      [
        stateApiPath(),
        "auto-transition",
        "--session-file",
        ".easy-coding/sessions/test.json",
        "--stage",
        "QUALITY",
        "--agent",
        "codex",
      ],
      { cwd: tempDir, encoding: "utf8" },
    );
    const next = JSON.parse(
      execFileSync(
        "python3",
        [
          stateApiPath(),
          "evidence-fingerprints",
          "--session-file",
          ".easy-coding/sessions/test.json",
          "--agent",
          "codex",
        ],
        { cwd: tempDir, encoding: "utf8" },
      ),
    );
    expect(next.quality_attempt.attempt).toBe(2);
  });

  it("cancels an active QUALITY attempt when the implementation returns to IMPLEMENT", async () => {
    const taskId = "08-19-quality-candidate-drift";
    const fixture = await writeQualityDecisionFixture(taskId);
    await writeFile(fixture.sourcePath, "export const quality = false;\n", "utf8");
    const fingerprintArgs = [
      stateApiPath(),
      "evidence-fingerprints",
      "--session-file",
      ".easy-coding/sessions/test.json",
      "--agent",
      "codex",
    ];
    const detected = spawnSync("python3", fingerprintArgs, {
      cwd: tempDir,
      encoding: "utf8",
    });
    expect(detected.status).toBe(1);
    expect(detected.stderr).toContain("return to IMPLEMENT before collecting new evidence");

    const repeated = spawnSync("python3", fingerprintArgs, {
      cwd: tempDir,
      encoding: "utf8",
    });
    expect(repeated.status).toBe(1);
    expect(repeated.stderr).toContain("requires a return to IMPLEMENT");

    const blockedTask = JSON.parse(
      await readFile(
        path.join(tempDir, ".easy-coding", "tasks", taskId, "task.json"),
        "utf8",
      ),
    );
    expect(blockedTask).toMatchObject({
      status: "QUALITY",
      quality_return_required: { reason: "implementation-drift" },
    });
    const transitioned = JSON.parse(
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
    );
    expect(transitioned.status).toBe("IMPLEMENT");
    expect(
      JSON.parse(
        await readFile(
          path.join(tempDir, ".easy-coding", "tasks", taskId, "task.json"),
          "utf8",
        ),
      ),
    ).not.toHaveProperty("quality_return_required");
    const records = (await readFile(fixture.executionPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(records.filter((record) => record.type === "quality")).toEqual([
      expect.objectContaining({ attempt: 1, outcome: "cancelled" }),
    ]);
  });

  it("finalizes a new QUALITY attempt after an unchanged candidate was cancelled", async () => {
    const taskId = "08-19-quality-cancelled-retry";
    const fixture = await writeQualityDecisionFixture(taskId);
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
    );
    await appendFile(
      fixture.executionPath,
      `${[
        {
          type: "dispatch",
          unit_id: "U1",
          timestamp: "2026-08-19T00:01:00Z",
        },
        {
          type: "result",
          unit_id: "U1",
          status: "completed",
          changed_files: ["src/quality.ts"],
          summary: "No implementation change was needed",
          issues: [],
          needs_attention: [],
        },
      ]
        .map((record) => JSON.stringify(record))
        .join("\n")}\n`,
      "utf8",
    );
    execFileSync(
      "python3",
      [
        stateApiPath(),
        "auto-transition",
        "--session-file",
        ".easy-coding/sessions/test.json",
        "--stage",
        "QUALITY",
        "--agent",
        "codex",
      ],
      { cwd: tempDir, encoding: "utf8" },
    );
    const fingerprints = JSON.parse(
      execFileSync(
        "python3",
        [
          stateApiPath(),
          "evidence-fingerprints",
          "--session-file",
          ".easy-coding/sessions/test.json",
          "--agent",
          "codex",
        ],
        { cwd: tempDir, encoding: "utf8" },
      ),
    );
    expect(fingerprints.quality_attempt.attempt).toBe(2);
    await appendFile(
      fixture.executionPath,
      `${[
        {
          type: "review",
          dimension: "combined",
          passed: true,
          reviewer: "codex-reviewer",
          implementation_fingerprint: fingerprints.implementation_fingerprint,
          quality_attempt: fingerprints.quality_attempt.attempt,
          timestamp: "2026-08-19T00:02:00Z",
          findings: [],
        },
        {
          type: "verify",
          check: "targeted-test",
          check_type: "test",
          command: "npm test -- targeted",
          passed: true,
          implementation_fingerprint: fingerprints.implementation_fingerprint,
          config_fingerprint: fingerprints.config_fingerprint,
          quality_attempt: fingerprints.quality_attempt.attempt,
          timestamp: "2026-08-19T00:03:00Z",
        },
      ]
        .map((record) => JSON.stringify(record))
        .join("\n")}\n`,
      "utf8",
    );
    const checkpoint = JSON.parse(
      execFileSync(
        "python3",
        [
          stateApiPath(),
          "quality-checkpoint",
          "--session-file",
          ".easy-coding/sessions/test.json",
          "--agent",
          "codex",
        ],
        { cwd: tempDir, encoding: "utf8" },
      ),
    );
    expect(checkpoint).toHaveProperty("quality_checkpoint");
  });

  it("reconciles task state when a finalized QUALITY record survived an interrupted write", async () => {
    const taskId = "08-19-quality-finalize-reconcile";
    const fixture = await writeQualityDecisionFixture(taskId);
    await appendFile(
      fixture.executionPath,
      `${[
        {
          type: "review",
          dimension: "combined",
          passed: true,
          reviewer: "codex-reviewer",
          implementation_fingerprint: fixture.implementationFingerprint,
          quality_attempt: fixture.qualityAttempt,
          timestamp: "2026-08-19T00:02:00Z",
          findings: [],
        },
        {
          type: "verify",
          check: "targeted-test",
          check_type: "test",
          command: "npm test -- targeted",
          passed: true,
          implementation_fingerprint: fixture.implementationFingerprint,
          config_fingerprint: fixture.configFingerprint,
          quality_attempt: fixture.qualityAttempt,
          timestamp: "2026-08-19T00:03:00Z",
        },
      ]
        .map((record) => JSON.stringify(record))
        .join("\n")}\n`,
      "utf8",
    );
    const script = [
      "import sys",
      "from pathlib import Path",
      "sys.path.insert(0, sys.argv[1])",
      "import easy_coding_state as state",
      "root = Path(sys.argv[2])",
      `task_id = ${JSON.stringify(taskId)}`,
      "task = state.load_task(root, task_id)",
      "state.write_task = lambda *_args, **_kwargs: (_ for _ in ()).throw(RuntimeError('interrupted'))",
      "try:",
      "    state.finalize_quality_attempt(root, task_id, task, 'passed', 'codex')",
      "except RuntimeError:",
      "    pass",
    ].join("\n");
    execFileSync("python3", ["-c", script, path.dirname(stateApiPath()), tempDir], {
      cwd: tempDir,
    });

    const taskPath = path.join(tempDir, ".easy-coding", "tasks", taskId, "task.json");
    expect(JSON.parse(await readFile(taskPath, "utf8"))).toHaveProperty(
      "quality_attempt.attempt",
      1,
    );
    const checkpoint = JSON.parse(
      execFileSync(
        "python3",
        [
          stateApiPath(),
          "quality-checkpoint",
          "--session-file",
          ".easy-coding/sessions/test.json",
          "--agent",
          "codex",
        ],
        { cwd: tempDir, encoding: "utf8" },
      ),
    );
    expect(checkpoint).toHaveProperty("quality_checkpoint");
    expect(JSON.parse(await readFile(taskPath, "utf8"))).not.toHaveProperty(
      "quality_attempt",
    );
  });

  it("reconciles an interrupted cancelled QUALITY record before starting the next attempt", async () => {
    const taskId = "08-19-quality-cancel-reconcile";
    await writeQualityDecisionFixture(taskId);
    const script = [
      "import sys",
      "from pathlib import Path",
      "sys.path.insert(0, sys.argv[1])",
      "import easy_coding_state as state",
      "root = Path(sys.argv[2])",
      `task_id = ${JSON.stringify(taskId)}`,
      "task = state.load_task(root, task_id)",
      "state.write_task = lambda *_args, **_kwargs: (_ for _ in ()).throw(RuntimeError('interrupted'))",
      "try:",
      "    state.cancel_active_quality_attempt(root, task_id, task, 'codex', 'Interrupted cancellation', 'manual-return')",
      "except RuntimeError:",
      "    pass",
    ].join("\n");
    execFileSync("python3", ["-c", script, path.dirname(stateApiPath()), tempDir], {
      cwd: tempDir,
    });

    const fingerprints = JSON.parse(
      execFileSync(
        "python3",
        [
          stateApiPath(),
          "evidence-fingerprints",
          "--session-file",
          ".easy-coding/sessions/test.json",
          "--agent",
          "codex",
        ],
        { cwd: tempDir, encoding: "utf8" },
      ),
    );
    expect(fingerprints.quality_attempt.attempt).toBe(2);
  });

  it("restores the IMPLEMENT return gate after an interrupted drift cancellation", async () => {
    const taskId = "08-19-quality-drift-cancel-reconcile";
    const fixture = await writeQualityDecisionFixture(taskId);
    await writeFile(fixture.sourcePath, "export const quality = false;\n", "utf8");
    const script = [
      "import sys",
      "from pathlib import Path",
      "sys.path.insert(0, sys.argv[1])",
      "import easy_coding_state as state",
      "root = Path(sys.argv[2])",
      `task_id = ${JSON.stringify(taskId)}`,
      "task = state.load_task(root, task_id)",
      "state.write_task = lambda *_args, **_kwargs: (_ for _ in ()).throw(RuntimeError('interrupted'))",
      "try:",
      "    state.ensure_quality_attempt_context(root, task_id, task, 'codex', persist=True)",
      "except (RuntimeError, state.StateError):",
      "    pass",
    ].join("\n");
    execFileSync("python3", ["-c", script, path.dirname(stateApiPath()), tempDir], {
      cwd: tempDir,
    });

    const fingerprints = spawnSync(
      "python3",
      [
        stateApiPath(),
        "evidence-fingerprints",
        "--session-file",
        ".easy-coding/sessions/test.json",
        "--agent",
        "codex",
      ],
      { cwd: tempDir, encoding: "utf8" },
    );
    expect(fingerprints.status).toBe(1);
    expect(fingerprints.stderr).toContain("requires a return to IMPLEMENT");

    const task = JSON.parse(
      await readFile(
        path.join(tempDir, ".easy-coding", "tasks", taskId, "task.json"),
        "utf8",
      ),
    );
    expect(task).not.toHaveProperty("quality_attempt");
    expect(task).toMatchObject({
      quality_return_required: { reason: "implementation-drift" },
    });
    const records = (await readFile(fixture.executionPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(records.at(-1)).toMatchObject({
      type: "quality",
      outcome: "cancelled",
      cancellation_reason: "implementation-drift",
    });
  });

  it("rejects malformed failed Gate evidence before finalizing repair", async () => {
    const taskId = "08-19-quality-failed-schema";
    const fixture = await writeQualityDecisionFixture(taskId);
    await appendFile(
      fixture.executionPath,
      `${JSON.stringify({
        type: "review",
        dimension: "correctness",
        passed: false,
        implementation_fingerprint: fixture.implementationFingerprint,
        quality_attempt: fixture.qualityAttempt,
        failure_classes: ["code-defect"],
      })}\n`,
      "utf8",
    );
    const rejected = spawnSync(
      "python3",
      [
        stateApiPath(),
        "finalize-quality",
        "--session-file",
        ".easy-coding/sessions/test.json",
        "--outcome",
        "repair",
        "--review-gate",
        "failed",
        "--verification-gate",
        "cancelled",
        "--failure-class",
        "code-defect",
        "--summary",
        "Malformed review must not become a repair decision",
        "--agent",
        "codex",
      ],
      { cwd: tempDir, encoding: "utf8" },
    );
    expect(rejected.status).toBe(1);
    expect(rejected.stderr).toContain("Review Gate evidence must include");
  });

  it("does not combine Strict Gate coverage across QUALITY attempts", async () => {
    const taskId = "08-19-quality-attempt-isolation";
    const fixture = await writeVerificationAcceptanceFixture(taskId, "guard");
    const taskPath = path.join(tempDir, ".easy-coding", "tasks", taskId, "task.json");
    const task = JSON.parse(await readFile(taskPath, "utf8"));
    task.workflow_mode = "strict";
    await writeFile(taskPath, JSON.stringify(task, null, 2), "utf8");

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
    );
    execFileSync(
      "python3",
      [
        stateApiPath(),
        "auto-transition",
        "--session-file",
        ".easy-coding/sessions/test.json",
        "--stage",
        "QUALITY",
        "--agent",
        "codex",
      ],
      { cwd: tempDir, encoding: "utf8" },
    );
    const fingerprints = JSON.parse(
      execFileSync(
        "python3",
        [
          stateApiPath(),
          "evidence-fingerprints",
          "--session-file",
          ".easy-coding/sessions/test.json",
          "--agent",
          "codex",
        ],
        { cwd: tempDir, encoding: "utf8" },
      ),
    );
    await appendFile(
      fixture.executionPath,
      `${[
        {
          type: "review",
          dimension: "correctness",
          passed: true,
          reviewer: "codex-reviewer",
          implementation_fingerprint: fingerprints.implementation_fingerprint,
          quality_attempt: fingerprints.quality_attempt.attempt,
          timestamp: "2026-08-19T00:02:00Z",
          findings: [],
        },
        ...["lint", "typecheck", "test", "build"].map((checkType) => ({
          type: "verify",
          check: `strict-${checkType}`,
          check_type: checkType,
          command: `npm run ${checkType}`,
          passed: true,
          implementation_fingerprint: fingerprints.implementation_fingerprint,
          config_fingerprint: fingerprints.config_fingerprint,
          quality_attempt: fingerprints.quality_attempt.attempt,
          timestamp: "2026-08-19T00:03:00Z",
        })),
      ]
        .map((record) => JSON.stringify(record))
        .join("\n")}\n`,
      "utf8",
    );
    const rejected = spawnSync(
      "python3",
      [
        stateApiPath(),
        "quality-checkpoint",
        "--session-file",
        ".easy-coding/sessions/test.json",
        "--agent",
        "codex",
      ],
      { cwd: tempDir, encoding: "utf8" },
    );
    expect(rejected.status, rejected.stderr).toBe(1);
    expect(rejected.stderr).toContain(
      "Strict workflow requires at least two passed review dimensions",
    );
  });

  it("audits a post-checkpoint return to IMPLEMENT as a cancelled QUALITY attempt", async () => {
    const taskId = "08-19-quality-checkpoint-return";
    const fixture = await writeVerificationAcceptanceFixture(taskId, "guard");
    execFileSync(
      "python3",
      [
        stateApiPath(),
        "quality-checkpoint",
        "--session-file",
        ".easy-coding/sessions/test.json",
        "--agent",
        "codex",
      ],
      { cwd: tempDir, encoding: "utf8" },
    );
    await writeFile(fixture.sourcePath, "export const value = 2;\n", "utf8");
    const transitioned = JSON.parse(
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
    );
    expect(transitioned.status).toBe("IMPLEMENT");
    const records = (await readFile(fixture.executionPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(records.filter((record) => record.type === "quality").map((record) => record.outcome)).toEqual([
      "passed",
      "cancelled",
    ]);
  });

  it("restarts QUALITY in place after checkpoint config drift", async () => {
    const taskId = "08-19-quality-checkpoint-config-drift";
    const fixture = await writeVerificationAcceptanceFixture(taskId, "guard");
    const checkpointArgs = [
      stateApiPath(),
      "quality-checkpoint",
      "--session-file",
      ".easy-coding/sessions/test.json",
      "--agent",
      "codex",
    ];
    execFileSync("python3", checkpointArgs, { cwd: tempDir, encoding: "utf8" });
    await writeConfirmModeConfig("auto");

    const fingerprints = JSON.parse(
      execFileSync(
        "python3",
        [
          stateApiPath(),
          "evidence-fingerprints",
          "--session-file",
          ".easy-coding/sessions/test.json",
          "--agent",
          "codex",
        ],
        { cwd: tempDir, encoding: "utf8" },
      ),
    );
    expect(fingerprints.quality_attempt.attempt).toBe(2);
    const taskPath = path.join(tempDir, ".easy-coding", "tasks", taskId, "task.json");
    expect(JSON.parse(await readFile(taskPath, "utf8"))).not.toHaveProperty(
      "quality_checkpoint",
    );
    await appendFile(
      fixture.executionPath,
      `${[
        {
          type: "review",
          dimension: "combined",
          passed: true,
          reviewer: "codex-reviewer",
          implementation_fingerprint: fingerprints.implementation_fingerprint,
          quality_attempt: fingerprints.quality_attempt.attempt,
          timestamp: "2026-08-19T00:04:00Z",
          findings: [],
        },
        {
          type: "verify",
          check: "targeted-test",
          check_type: "test",
          command: "npm test -- targeted",
          passed: true,
          implementation_fingerprint: fingerprints.implementation_fingerprint,
          config_fingerprint: fingerprints.config_fingerprint,
          quality_attempt: fingerprints.quality_attempt.attempt,
          timestamp: "2026-08-19T00:05:00Z",
        },
      ]
        .map((record) => JSON.stringify(record))
        .join("\n")}\n`,
      "utf8",
    );
    const checkpoint = JSON.parse(
      execFileSync("python3", checkpointArgs, { cwd: tempDir, encoding: "utf8" }),
    );
    expect(checkpoint.quality_checkpoint.config_fingerprint).toBe(
      fingerprints.config_fingerprint,
    );
  });

  it("cancels an active QUALITY attempt when the task closes", async () => {
    const taskId = "08-19-quality-close";
    const fixture = await writeQualityDecisionFixture(taskId);
    execFileSync(
      "python3",
      [
        stateApiPath(),
        "close-current",
        "--session-file",
        ".easy-coding/sessions/test.json",
        "--reason",
        "user cancelled the task",
        "--agent",
        "codex",
      ],
      { cwd: tempDir, encoding: "utf8" },
    );
    const task = JSON.parse(
      await readFile(
        path.join(tempDir, ".easy-coding", "tasks", taskId, "task.json"),
        "utf8",
      ),
    );
    expect(task.status).toBe("CLOSED");
    expect(task.quality_attempt).toBeUndefined();
    const records = (await readFile(fixture.executionPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(records.filter((record) => record.type === "quality")).toEqual([
      expect.objectContaining({ attempt: 1, outcome: "cancelled" }),
    ]);
  });

  it("pauses auto mode on exact post-verification drift and honors user acceptance without rereview", async () => {
    const taskId = "08-13-drift-acceptance";
    const fixture = await writeVerificationAcceptanceFixture(taskId);
    execFileSync(
      "python3",
      [
        stateApiPath(),
        "verification-checkpoint",
        "--session-file",
        ".easy-coding/sessions/test.json",
        "--agent",
        "codex",
      ],
      { cwd: tempDir, encoding: "utf8" },
    );
    await writeFile(
      fixture.sourcePath,
      "export const value = 1;\n// user-approved documentation\n",
      "utf8",
    );
    const repeatedCheckpoint = JSON.parse(
      execFileSync(
        "python3",
        [
          stateApiPath(),
          "verification-checkpoint",
          "--session-file",
          ".easy-coding/sessions/test.json",
          "--agent",
          "codex",
        ],
        { cwd: tempDir, encoding: "utf8" },
      ),
    ) as { checkpoint_unchanged: boolean };
    expect(repeatedCheckpoint.checkpoint_unchanged).toBe(true);

    const paused = JSON.parse(
      execFileSync(
        "python3",
        [
          stateApiPath(),
          "auto-transition",
          "--session-file",
          ".easy-coding/sessions/test.json",
          "--stage",
          "MEMORY",
          "--agent",
          "codex",
        ],
        { cwd: tempDir, encoding: "utf8" },
      ),
    ) as {
      status: string;
      action: string;
      status_context: string;
      pending_transition: { confirmation_override: string };
      acceptance_drift: {
        diff_sha256: string;
        changed_files: string[];
        changes: Array<{ patch: string }>;
      };
    };
    expect(paused).toMatchObject({
      status: "QUALITY",
      action: "acceptance-drift",
      pending_transition: { confirmation_override: "evidence-drift" },
    });
    expect(paused.acceptance_drift.changed_files).toHaveLength(1);
    expect(paused.acceptance_drift.changes[0].patch).toContain(
      "+// user-approved documentation",
    );
    expect(paused.status_context).toContain(
      "[easy-coding:acceptance-drift-confirmation-required]",
    );
    expect(paused.status_context).not.toContain(
      "[easy-coding:auto-transition-ready:QUALITY->MEMORY]",
    );

    const accepted = JSON.parse(
      execFileSync(
        "python3",
        [
          stateApiPath(),
          "confirm-transition",
          "--session-file",
          ".easy-coding/sessions/test.json",
          "--stage",
          "MEMORY",
          "--diff-sha256",
          paused.acceptance_drift.diff_sha256,
          "--verification-policy",
          "carry-forward",
          "--decision-summary",
          "User accepted the documentation-only edit",
          "--agent",
          "codex",
        ],
        { cwd: tempDir, encoding: "utf8" },
      ),
    ) as { status: string };
    expect(accepted.status).toBe("MEMORY");

    const records = (await readFile(fixture.executionPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(records.filter((record) => record.type === "review")).toHaveLength(1);
    expect(records.filter((record) => record.type === "acceptance")).toEqual([
      expect.objectContaining({
        from_implementation_fingerprint: fixture.implementationFingerprint,
        changed_files: expect.arrayContaining([expect.stringContaining("src/example.ts")]),
        authorization: "explicit-user",
        review_policy: "user-accepted-without-rereview",
        verification_policy: "carry-forward",
        summary: "User accepted the documentation-only edit",
      }),
    ]);
  }, 15_000);

  it("returns per-file hashes for an exact binary acceptance diff", async () => {
    const taskId = "08-13-binary-acceptance";
    const fixture = await writeVerificationAcceptanceFixture(taskId);
    execFileSync(
      "python3",
      [
        stateApiPath(),
        "verification-checkpoint",
        "--session-file",
        ".easy-coding/sessions/test.json",
        "--agent",
        "codex",
      ],
      { cwd: tempDir, encoding: "utf8" },
    );
    const binary = Buffer.from([0, 1, 2, 3, 255]);
    await writeFile(fixture.sourcePath, binary);

    const paused = JSON.parse(
      execFileSync(
        "python3",
        [
          stateApiPath(),
          "auto-transition",
          "--session-file",
          ".easy-coding/sessions/test.json",
          "--stage",
          "MEMORY",
          "--agent",
          "codex",
        ],
        { cwd: tempDir, encoding: "utf8" },
      ),
    ) as {
      acceptance_drift: {
        changes: Array<{
          binary: boolean;
          old_sha256: string;
          new_sha256: string;
          repository: string;
          path: string;
        }>;
      };
    };

    expect(paused.acceptance_drift.changes).toEqual([
      expect.objectContaining({
        binary: true,
        old_sha256: createHash("sha256")
          .update("export const value = 1;\n")
          .digest("hex"),
        new_sha256: createHash("sha256").update(binary).digest("hex"),
        repository: ".",
        path: "src/example.ts",
      }),
    ]);
  }, 15_000);

  it("shows and accepts exact post-verification drift outside a Git repository", async () => {
    const taskId = "08-13-non-git-acceptance";
    const fixture = await writeVerificationAcceptanceFixture(taskId, "auto", false);
    execFileSync(
      "python3",
      [
        stateApiPath(),
        "verification-checkpoint",
        "--session-file",
        ".easy-coding/sessions/test.json",
        "--agent",
        "codex",
      ],
      { cwd: tempDir, encoding: "utf8" },
    );
    await writeFile(fixture.sourcePath, "export const value = 2;\n", "utf8");

    const paused = JSON.parse(
      execFileSync(
        "python3",
        [
          stateApiPath(),
          "auto-transition",
          "--session-file",
          ".easy-coding/sessions/test.json",
          "--stage",
          "MEMORY",
          "--agent",
          "codex",
        ],
        { cwd: tempDir, encoding: "utf8" },
      ),
    ) as {
      status: string;
      acceptance_drift: {
        diff_sha256: string;
        metadata_changed: boolean;
        changes: Array<{ file: string; patch: string }>;
      };
    };

    expect(paused.status).toBe("QUALITY");
    expect(paused.acceptance_drift.metadata_changed).toBe(false);
    expect(paused.acceptance_drift.changes).toEqual([
      expect.objectContaining({
        file: ".:src/example.ts",
        patch: expect.stringContaining("+export const value = 2;"),
      }),
    ]);
    const accepted = JSON.parse(
      execFileSync(
        "python3",
        [
          stateApiPath(),
          "confirm-transition",
          "--session-file",
          ".easy-coding/sessions/test.json",
          "--stage",
          "MEMORY",
          "--diff-sha256",
          paused.acceptance_drift.diff_sha256,
          "--verification-policy",
          "waived",
          "--decision-summary",
          "User accepted the non-Git executable edit risk",
          "--agent",
          "codex",
        ],
        { cwd: tempDir, encoding: "utf8" },
      ),
    ) as { status: string };
    expect(accepted.status).toBe("MEMORY");
  });

  it("requires targeted verification for every affected Canonical source task", async () => {
    const moduleDir = path.join(
      process.cwd(),
      "src",
      "templates",
      "shared-hooks",
    );
    const output = execFileSync(
      "python3",
      [
        "-c",
        [
          "import json, sys",
          "from pathlib import Path",
          `sys.path.insert(0, ${JSON.stringify(moduleDir)})`,
          "import easy_coding_state as state",
          "root = Path(sys.argv[1])",
          "task = {'spec_source': {}, 'tdd_enabled': False, 'workflow_mode': 'fast'}",
          "current = 'c' * 64",
          "config = 'd' * 64",
          "acceptance = {'verification_policy': 'targeted', 'required_targeted_source_tasks': ['R1-T1', 'R2-T1']}",
          "records = [{'type': 'verify', 'check': 'r1-targeted', 'check_type': 'test', 'command': 'test-r1', 'passed': True, 'implementation_fingerprint': current, 'config_fingerprint': config, 'timestamp': '2026-08-13T00:00:00Z', 'repo_id': 'R1', 'source_task_id': 'R1-T1'}]",
          "plan = {'type': 'plan', 'strategy': 'single', 'units': [{'id': 'U1', 'title': 'R1', 'type': 'backend', 'files': ['a.ts'], 'depends_on': [], 'repo_id': 'R1', 'source_task_id': 'R1-T1'}, {'id': 'U2', 'title': 'R2', 'type': 'backend', 'files': ['b.ts'], 'depends_on': [], 'repo_id': 'R2', 'source_task_id': 'R2-T1'}]}",
          "state.evidence_fingerprints = lambda *_: {'implementation_fingerprint': current, 'config_fingerprint': config}",
          "state.accepted_verification_fingerprints = lambda *_: ({current}, acceptance)",
          "state.validate_review_readiness = lambda *_: None",
          "state.execution_records = lambda *_: records",
          "state.latest_execution_plan = lambda *_: plan",
          "mapping_task = {'spec_source': {}, 'repo_paths': {'R1': str(root / 'repo-r1'), 'R2': str(root / 'repo-r2')}}",
          "mapped = state.targeted_source_tasks_for_changes(root, 'task', mapping_task, [{'repository': 'repo-r2', 'path': 'b.ts'}])",
          "print(json.dumps(mapped))",
          "try:",
          "    state.validate_verification_readiness(root, 'task', task)",
          "except state.StateError as exc:",
          "    print(str(exc))",
          "else:",
          "    raise SystemExit('expected affected source-task coverage failure')",
        ].join("\n"),
        tempDir,
      ],
      { cwd: tempDir, encoding: "utf8" },
    );

    expect(output).toContain('["R2-T1"]');
    expect(output).toContain("affected source tasks: R2-T1");
  });

  it("requires current-fingerprint targeted verification for accepted executable drift", async () => {
    const taskId = "08-13-targeted-acceptance";
    const fixture = await writeVerificationAcceptanceFixture(taskId);
    execFileSync(
      "python3",
      [
        stateApiPath(),
        "verification-checkpoint",
        "--session-file",
        ".easy-coding/sessions/test.json",
        "--agent",
        "codex",
      ],
      { cwd: tempDir, encoding: "utf8" },
    );
    await writeFile(fixture.sourcePath, "export const value = 2;\n", "utf8");
    const paused = JSON.parse(
      execFileSync(
        "python3",
        [
          stateApiPath(),
          "auto-transition",
          "--session-file",
          ".easy-coding/sessions/test.json",
          "--stage",
          "MEMORY",
          "--agent",
          "codex",
        ],
        { cwd: tempDir, encoding: "utf8" },
      ),
    ) as { acceptance_drift: { diff_sha256: string } };
    const confirmationArgs = [
      stateApiPath(),
      "confirm-transition",
      "--session-file",
      ".easy-coding/sessions/test.json",
      "--stage",
      "MEMORY",
      "--diff-sha256",
      paused.acceptance_drift.diff_sha256,
      "--verification-policy",
      "targeted",
      "--decision-summary",
      "User accepted the executable edit after a targeted check",
      "--agent",
      "codex",
    ];
    const missingTargetedCheck = spawnSync("python3", confirmationArgs, {
      cwd: tempDir,
      encoding: "utf8",
    });
    expect(missingTargetedCheck.status).toBe(1);
    expect(missingTargetedCheck.stderr).toContain(
      "requires at least one passed targeted verification record",
    );

    const current = JSON.parse(
      execFileSync(
        "python3",
        [
          stateApiPath(),
          "evidence-fingerprints",
          "--session-file",
          ".easy-coding/sessions/test.json",
          "--agent",
          "codex",
        ],
        { cwd: tempDir, encoding: "utf8" },
      ),
    ) as {
      implementation_fingerprint: string;
      config_fingerprint: string;
      quality_attempt: { attempt: number };
    };
    await appendFile(
      fixture.executionPath,
      `${JSON.stringify({
        type: "verify",
        check: "accepted-drift-targeted-test",
        check_type: "test",
        command: "npm test -- accepted-drift",
        passed: true,
        implementation_fingerprint: current.implementation_fingerprint,
        config_fingerprint: current.config_fingerprint,
        timestamp: "2026-08-13T00:02:00Z",
      })}\n`,
      "utf8",
    );
    const accepted = JSON.parse(
      execFileSync("python3", confirmationArgs, { cwd: tempDir, encoding: "utf8" }),
    ) as { status: string };
    expect(accepted.status).toBe("MEMORY");
  }, 20_000);

  it("rejects verification-contract drift instead of offering code-diff acceptance", async () => {
    const taskId = "08-13-contract-drift";
    const fixture = await writeVerificationAcceptanceFixture(taskId);
    execFileSync(
      "python3",
      [
        stateApiPath(),
        "verification-checkpoint",
        "--session-file",
        ".easy-coding/sessions/test.json",
        "--agent",
        "codex",
      ],
      { cwd: tempDir, encoding: "utf8" },
    );
    await appendFile(
      fixture.executionPath,
      `${JSON.stringify({
        type: "plan",
        strategy: "single",
        units: [
          {
            id: "U1",
            title: "changed execution contract",
            type: "backend",
            files: ["src/example.ts"],
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
        "auto-transition",
        "--session-file",
        ".easy-coding/sessions/test.json",
        "--stage",
        "MEMORY",
        "--agent",
        "codex",
      ],
      { cwd: tempDir, encoding: "utf8" },
    );
    expect(rejected.status).toBe(1);
    expect(rejected.stderr).toContain("Quality metadata changed");
  });

  it("requires auditable verification fields for new tasks and accepts a corrected latest record", async () => {
    const taskId = "07-27-verification-evidence-schema";
    await writeConfirmModeConfig("guard");
    await writeSessionFixture(taskId);
    await writeTaskFixture(taskId, "QUALITY", "codex", {
      workflow_mode: "fast",
    });
    await mkdir(path.join(tempDir, "src"), { recursive: true });
    await writeFile(path.join(tempDir, "src", "example.ts"), "export const value = 1;\n");
    const executionPath = path.join(
      tempDir,
      ".easy-coding",
      "tasks",
      taskId,
      "execution.jsonl",
    );
    await writeFile(
      executionPath,
      `${JSON.stringify({
        type: "plan",
        strategy: "single",
        units: [
          {
            id: "U1",
            title: "verification evidence schema",
            type: "backend",
            files: ["src/example.ts"],
            depends_on: [],
          },
        ],
      })}\n`,
      "utf8",
    );
    const fingerprints = JSON.parse(
      execFileSync(
        "python3",
        [
          stateApiPath(),
          "evidence-fingerprints",
          "--session-file",
          ".easy-coding/sessions/test.json",
          "--agent",
          "codex",
        ],
        { cwd: tempDir, encoding: "utf8" },
      ),
    ) as {
      implementation_fingerprint: string;
      config_fingerprint: string;
      quality_attempt: { attempt: number };
    };
    await appendFile(
      executionPath,
      `${JSON.stringify({
        type: "review",
        dimension: "combined",
        passed: true,
        reviewer: "codex",
        implementation_fingerprint: fingerprints.implementation_fingerprint,
        quality_attempt: fingerprints.quality_attempt.attempt,
        timestamp: "2026-07-27T00:00:00Z",
        findings: [],
      })}\n${JSON.stringify({
        type: "verify",
        check: "targeted-test",
        check_type: "test",
        passed: true,
        implementation_fingerprint: fingerprints.implementation_fingerprint,
        config_fingerprint: fingerprints.config_fingerprint,
        quality_attempt: fingerprints.quality_attempt.attempt,
      })}\n`,
      "utf8",
    );

    const malformed = spawnSync(
      "python3",
      [
        stateApiPath(),
        "request-transition",
        "--session-file",
        ".easy-coding/sessions/test.json",
        "--stage",
        "MEMORY",
        "--agent",
        "codex",
      ],
      { cwd: tempDir, encoding: "utf8" },
    );
    expect(malformed.status).toBe(1);
    expect(malformed.stderr).toContain(
      "Verification Gate evidence must include check, check_type, boolean passed",
    );

    await appendFile(
      executionPath,
      `${JSON.stringify({
        type: "verify",
        check: "targeted-test",
        check_type: "test",
        command: "npm test -- targeted",
        passed: true,
        implementation_fingerprint: fingerprints.implementation_fingerprint,
        config_fingerprint: fingerprints.config_fingerprint,
        quality_attempt: fingerprints.quality_attempt.attempt,
        timestamp: "2026-07-27T00:00:00Z",
      })}\n`,
      "utf8",
    );
    const requested = JSON.parse(
      execFileSync(
        "python3",
        [
          stateApiPath(),
          "request-transition",
          "--session-file",
          ".easy-coding/sessions/test.json",
          "--stage",
          "MEMORY",
          "--agent",
          "codex",
        ],
        { cwd: tempDir, encoding: "utf8" },
      ),
    ) as { pending_transition: { from: string; to: string } };
    expect(requested.pending_transition).toMatchObject({
      from: "QUALITY",
      to: "MEMORY",
    });
  });

  it("invalidates review evidence when the frozen workflow mode is raised", async () => {
    const taskId = "07-27-workflow-mode-fingerprint";
    await writeConfirmModeConfig("guard");
    await writeSessionFixture(taskId);
    await writeTaskFixture(taskId, "IMPLEMENT", "codex", { workflow_mode: "fast" });
    await mkdir(path.join(tempDir, "src"), { recursive: true });
    await writeFile(path.join(tempDir, "src", "mode.ts"), "export const mode = true;\n");
    const executionPath = path.join(
      tempDir,
      ".easy-coding",
      "tasks",
      taskId,
      "execution.jsonl",
    );
    await writeFile(
      executionPath,
      `${JSON.stringify({
        type: "plan",
        strategy: "single",
        units: [
          {
            id: "U1",
            title: "mode fingerprint",
            type: "backend",
            files: ["src/mode.ts"],
            depends_on: [],
          },
        ],
      })}\n`,
      "utf8",
    );
    const beforeRaise = JSON.parse(
      execFileSync(
        "python3",
        [
          stateApiPath(),
          "evidence-fingerprints",
          "--session-file",
          ".easy-coding/sessions/test.json",
          "--agent",
          "codex",
        ],
        { cwd: tempDir, encoding: "utf8" },
      ),
    ) as { implementation_fingerprint: string };
    await appendFile(
      executionPath,
      `${JSON.stringify({
        type: "review",
        dimension: "combined",
        passed: true,
        reviewer: "codex",
        implementation_fingerprint: beforeRaise.implementation_fingerprint,
        timestamp: "2026-07-27T00:00:00Z",
        findings: [],
      })}\n`,
      "utf8",
    );

    execFileSync(
      "python3",
      [
        stateApiPath(),
        "raise-workflow-mode",
        "--session-file",
        ".easy-coding/sessions/test.json",
        "--mode",
        "standard",
        "--reason",
        "new impact discovered",
        "--agent",
        "codex",
      ],
      { cwd: tempDir, encoding: "utf8" },
    );
    const afterRaise = JSON.parse(
      execFileSync(
        "python3",
        [
          stateApiPath(),
          "evidence-fingerprints",
          "--session-file",
          ".easy-coding/sessions/test.json",
          "--agent",
          "codex",
        ],
        { cwd: tempDir, encoding: "utf8" },
      ),
    ) as { implementation_fingerprint: string };
    expect(afterRaise.implementation_fingerprint).not.toBe(
      beforeRaise.implementation_fingerprint,
    );

    execFileSync(
      "python3",
      [
        stateApiPath(),
        "auto-transition",
        "--session-file",
        ".easy-coding/sessions/test.json",
        "--stage",
        "QUALITY",
        "--agent",
        "codex",
      ],
      { cwd: tempDir, encoding: "utf8" },
    );
    const staleReview = spawnSync(
      "python3",
      [
        stateApiPath(),
        "request-transition",
        "--session-file",
        ".easy-coding/sessions/test.json",
        "--stage",
        "MEMORY",
        "--agent",
        "codex",
      ],
      { cwd: tempDir, encoding: "utf8" },
    );
    expect(staleReview.status).toBe(1);
    expect(staleReview.stderr).toContain("without review evidence");
  });

  it("rejects a workflow mode raise in QUALITY before mutating the frozen mode", async () => {
    const taskId = "07-27-verification-mode-raise";
    await writeConfirmModeConfig("guard");
    await writeSessionFixture(taskId);
    await writeTaskFixture(taskId, "QUALITY", "codex", { workflow_mode: "fast" });

    const rejected = spawnSync(
      "python3",
      [
        stateApiPath(),
        "raise-workflow-mode",
        "--session-file",
        ".easy-coding/sessions/test.json",
        "--mode",
        "standard",
        "--reason",
        "new verification risk",
        "--agent",
        "codex",
      ],
      { cwd: tempDir, encoding: "utf8" },
    );

    expect(rejected.status).toBe(1);
    expect(rejected.stderr).toContain(
      "Return to IMPLEMENT before raising workflow mode from QUALITY",
    );
    const task = JSON.parse(
      await readFile(
        path.join(tempDir, ".easy-coding", "tasks", taskId, "task.json"),
        "utf8",
      ),
    ) as Record<string, unknown>;
    expect(task.status).toBe("QUALITY");
    expect(task.workflow_mode).toBe("fast");
    expect(task).not.toHaveProperty("workflow_mode_escalations");
  });

  it("invalidates evidence when plan contracts change without file changes", async () => {
    const taskId = "07-27-plan-fingerprint";
    await writeConfirmModeConfig("guard");
    await writeSessionFixture(taskId);
    await writeTaskFixture(taskId, "IMPLEMENT", "codex", { workflow_mode: "standard" });
    await mkdir(path.join(tempDir, "src"), { recursive: true });
    await writeFile(path.join(tempDir, "src", "plan.ts"), "export const plan = true;\n");
    const executionPath = path.join(
      tempDir,
      ".easy-coding",
      "tasks",
      taskId,
      "execution.jsonl",
    );
    const plan = {
      type: "plan",
      strategy: "single",
      units: [
        {
          id: "U1",
          title: "plan fingerprint",
          type: "backend",
          files: ["src/plan.ts"],
          depends_on: [],
          contracts: ["preserve contract A"],
        },
      ],
    };
    await writeFile(executionPath, `${JSON.stringify(plan)}\n`, "utf8");
    const beforeChange = JSON.parse(
      execFileSync(
        "python3",
        [
          stateApiPath(),
          "evidence-fingerprints",
          "--session-file",
          ".easy-coding/sessions/test.json",
          "--agent",
          "codex",
        ],
        { cwd: tempDir, encoding: "utf8" },
      ),
    ) as { implementation_fingerprint: string };

    await appendFile(
      executionPath,
      `${JSON.stringify({
        ...plan,
        units: [{ ...plan.units[0], contracts: ["preserve contract B"] }],
      })}\n`,
      "utf8",
    );
    const afterChange = JSON.parse(
      execFileSync(
        "python3",
        [
          stateApiPath(),
          "evidence-fingerprints",
          "--session-file",
          ".easy-coding/sessions/test.json",
          "--agent",
          "codex",
        ],
        { cwd: tempDir, encoding: "utf8" },
      ),
    ) as { implementation_fingerprint: string };

    expect(afterChange.implementation_fingerprint).not.toBe(
      beforeChange.implementation_fingerprint,
    );
  });

  it("requires a passed local unit-test record for a frozen TDD task", async () => {
    const taskId = "08-07-tdd-local-test";
    await writeConfirmModeConfig("guard");
    await writeSessionFixture(taskId);
    await writeTddReadinessFixture();
    await writeTaskFixture(taskId, "QUALITY", "codex", {
      workflow_mode: "fast",
      tdd_enabled: true,
      tdd_coverage_threshold: 95,
      tdd_baselines: { project: "0".repeat(40) },
    });
    await mkdir(path.join(tempDir, "src"), { recursive: true });
    await writeFile(path.join(tempDir, "src", "Example.java"), "class Example {}\n", "utf8");
    const executionPath = path.join(
      tempDir,
      ".easy-coding",
      "tasks",
      taskId,
      "execution.jsonl",
    );
    await writeFile(
      executionPath,
      `${JSON.stringify({
        type: "plan",
        strategy: "single",
        units: [
          {
            id: "U1",
            title: "TDD local test gate",
            type: "backend",
            files: ["src/Example.java"],
            depends_on: [],
          },
        ],
      })}\n`,
      "utf8",
    );
    const fingerprints = JSON.parse(
      execFileSync(
        "python3",
        [
          stateApiPath(),
          "evidence-fingerprints",
          "--session-file",
          ".easy-coding/sessions/test.json",
          "--agent",
          "codex",
        ],
        { cwd: tempDir, encoding: "utf8" },
      ),
    ) as {
      implementation_fingerprint: string;
      config_fingerprint: string;
      quality_attempt: { attempt: number };
    };
    for (const dimension of ["combined", "tdd"]) {
      await appendFile(
        executionPath,
        `${JSON.stringify({
          type: "review",
          dimension,
          passed: true,
          reviewer: "codex",
          implementation_fingerprint: fingerprints.implementation_fingerprint,
          quality_attempt: fingerprints.quality_attempt.attempt,
          timestamp: "2026-08-07T00:00:00Z",
          findings: [],
        })}\n`,
        "utf8",
      );
    }
    await appendFile(
      executionPath,
      `${JSON.stringify({
        type: "verify",
        check: "changed-line-coverage",
        check_type: "coverage",
        coverage_scope: "local",
        command:
          "python3 .easy-coding/tools/easy_coding_java_coverage.py check --base 0000000000000000000000000000000000000000 --threshold 95",
        passed: true,
        implementation_fingerprint: fingerprints.implementation_fingerprint,
        config_fingerprint: fingerprints.config_fingerprint,
        quality_attempt: fingerprints.quality_attempt.attempt,
        timestamp: "2026-08-07T00:01:00Z",
        coverage: {
          baseline_sha: "0".repeat(40),
          covered_lines: 20,
          total_lines: 20,
          percentage: 100,
          threshold: 95,
          report_paths: ["target/site/jacoco/jacoco.xml"],
          report_sha256: "a".repeat(64),
        },
      })}\n`,
      "utf8",
    );

    const missingLocalTest = spawnSync(
      "python3",
      [
        stateApiPath(),
        "request-transition",
        "--session-file",
        ".easy-coding/sessions/test.json",
        "--stage",
        "MEMORY",
        "--agent",
        "codex",
      ],
      { cwd: tempDir, encoding: "utf8" },
    );
    expect(missingLocalTest.status).toBe(1);
    expect(missingLocalTest.stderr).toContain("requires passed local unit-test evidence");
  });

  it("requires TDD review, local unit tests, and local changed-line coverage only for a frozen TDD task", async () => {
    const taskId = "08-06-tdd-verification";
    await writeConfirmModeConfig("guard");
    await writeSessionFixture(taskId);
    await writeTddReadinessFixture();
    await writeTaskFixture(taskId, "QUALITY", "codex", {
      workflow_mode: "fast",
      tdd_enabled: true,
      tdd_coverage_threshold: 95,
      tdd_baselines: { project: "0".repeat(40) },
    });
    await mkdir(path.join(tempDir, "src"), { recursive: true });
    await writeFile(path.join(tempDir, "src", "Example.java"), "class Example {}\n", "utf8");
    const executionPath = path.join(
      tempDir,
      ".easy-coding",
      "tasks",
      taskId,
      "execution.jsonl",
    );
    await writeFile(
      executionPath,
      `${JSON.stringify({
        type: "plan",
        strategy: "single",
        units: [
          {
            id: "U1",
            title: "TDD verification",
            type: "backend",
            files: ["src/Example.java"],
            depends_on: [],
          },
        ],
      })}\n`,
      "utf8",
    );
    const fingerprints = JSON.parse(
      execFileSync(
        "python3",
        [
          stateApiPath(),
          "evidence-fingerprints",
          "--session-file",
          ".easy-coding/sessions/test.json",
          "--agent",
          "codex",
        ],
        { cwd: tempDir, encoding: "utf8" },
      ),
    ) as {
      implementation_fingerprint: string;
      config_fingerprint: string;
      quality_attempt: { attempt: number };
    };
    for (const dimension of ["combined", "tdd"]) {
      await appendFile(
        executionPath,
        `${JSON.stringify({
          type: "review",
          dimension,
          passed: true,
          reviewer: "codex",
          implementation_fingerprint: fingerprints.implementation_fingerprint,
          quality_attempt: fingerprints.quality_attempt.attempt,
          timestamp: "2026-08-06T00:00:00Z",
          findings: [],
        })}\n`,
        "utf8",
      );
    }
    await appendFile(
      executionPath,
      `${JSON.stringify({
        type: "verify",
        check: "unit-test",
        check_type: "test",
        command: "mvn test",
        passed: true,
        implementation_fingerprint: fingerprints.implementation_fingerprint,
        config_fingerprint: fingerprints.config_fingerprint,
        quality_attempt: fingerprints.quality_attempt.attempt,
        timestamp: "2026-08-06T00:01:00Z",
      })}\n`,
      "utf8",
    );

    const missingCoverage = spawnSync(
      "python3",
      [
        stateApiPath(),
        "request-transition",
        "--session-file",
        ".easy-coding/sessions/test.json",
        "--stage",
        "MEMORY",
        "--agent",
        "codex",
      ],
      { cwd: tempDir, encoding: "utf8" },
    );
    expect(missingCoverage.status).toBe(1);
    expect(missingCoverage.stderr).toContain("requires changed-production-line JaCoCo coverage");

    await appendFile(
      executionPath,
      `${JSON.stringify({
        type: "verify",
        check: "changed-line-coverage",
        check_type: "coverage",
        coverage_scope: "local",
        command:
          "python3 .easy-coding/tools/easy_coding_java_coverage.py check --base 1111111111111111111111111111111111111111 --threshold 95",
        passed: true,
        implementation_fingerprint: fingerprints.implementation_fingerprint,
        config_fingerprint: fingerprints.config_fingerprint,
        quality_attempt: fingerprints.quality_attempt.attempt,
        timestamp: "2026-08-06T00:01:30Z",
        coverage: {
          baseline_sha: "1".repeat(40),
          covered_lines: 20,
          total_lines: 20,
          percentage: 100,
          threshold: 95,
          report_paths: ["target/site/jacoco/jacoco.xml"],
          report_sha256: "a".repeat(64),
        },
      })}\n`,
      "utf8",
    );
    const wrongBaseline = spawnSync(
      "python3",
      [
        stateApiPath(),
        "request-transition",
        "--session-file",
        ".easy-coding/sessions/test.json",
        "--stage",
        "MEMORY",
        "--agent",
        "codex",
      ],
      { cwd: tempDir, encoding: "utf8" },
    );
    expect(wrongBaseline.status).toBe(1);
    expect(wrongBaseline.stderr).toContain("frozen threshold, reports, and report fingerprint");

    await appendFile(
      executionPath,
      `${JSON.stringify({
        type: "verify",
        check: "changed-line-coverage",
        check_type: "coverage",
        coverage_scope: "local",
        command:
          "python3 .easy-coding/tools/easy_coding_java_coverage.py check --base HEAD --threshold 95",
        passed: true,
        implementation_fingerprint: fingerprints.implementation_fingerprint,
        config_fingerprint: fingerprints.config_fingerprint,
        quality_attempt: fingerprints.quality_attempt.attempt,
        timestamp: "2026-08-06T00:01:45Z",
        coverage: {
          baseline_sha: "0".repeat(40),
          covered_lines: 20,
          total_lines: 20,
          percentage: 100,
          threshold: 95,
          report_paths: ["target/site/jacoco/jacoco.xml"],
          report_sha256: "a".repeat(64),
        },
      })}\n`,
      "utf8",
    );
    const mutableCommand = spawnSync(
      "python3",
      [
        stateApiPath(),
        "request-transition",
        "--session-file",
        ".easy-coding/sessions/test.json",
        "--stage",
        "MEMORY",
        "--agent",
        "codex",
      ],
      { cwd: tempDir, encoding: "utf8" },
    );
    expect(mutableCommand.status).toBe(1);
    expect(mutableCommand.stderr).toContain("exact gate command");

    await appendFile(
      executionPath,
      `${JSON.stringify({
        type: "verify",
        check: "changed-line-coverage",
        check_type: "coverage",
        coverage_scope: "local",
        command:
          "python3 .easy-coding/tools/easy_coding_java_coverage.py check --base 0000000000000000000000000000000000000000 --threshold 95",
        passed: true,
        implementation_fingerprint: fingerprints.implementation_fingerprint,
        config_fingerprint: fingerprints.config_fingerprint,
        quality_attempt: fingerprints.quality_attempt.attempt,
        timestamp: "2026-08-06T00:02:00Z",
        coverage: {
          baseline_sha: "0".repeat(40),
          covered_lines: 20,
          total_lines: 20,
          percentage: 100,
          threshold: 95,
          report_paths: ["target/site/jacoco/jacoco.xml"],
          report_sha256: "a".repeat(64),
        },
      })}\n`,
      "utf8",
    );
    const gitlabCoverage = {
      baseline_sha: "0".repeat(40),
      covered_lines: 20,
      total_lines: 20,
      percentage: 100,
      threshold: 95,
      report_paths: ["target/site/jacoco/jacoco.xml"],
      report_sha256: "b".repeat(64),
    };
    await appendFile(
      executionPath,
      `${JSON.stringify({
        type: "verify",
        check: "changed-line-coverage",
        check_type: "coverage",
        coverage_scope: "gitlab",
        command:
          "python3 .easy-coding/tools/easy_coding_java_coverage.py check --base 0000000000000000000000000000000000000000 --threshold 95",
        passed: false,
        implementation_fingerprint: fingerprints.implementation_fingerprint,
        config_fingerprint: fingerprints.config_fingerprint,
        quality_attempt: fingerprints.quality_attempt.attempt,
        timestamp: "2026-08-06T00:03:00Z",
        coverage: gitlabCoverage,
      })}\n`,
      "utf8",
    );
    await writeFile(path.join(tempDir, ".gitlab-ci.yml"), "drifted\n", "utf8");
    const driftedReadiness = spawnSync(
      "python3",
      [
        stateApiPath(),
        "request-transition",
        "--session-file",
        ".easy-coding/sessions/test.json",
        "--stage",
        "MEMORY",
        "--agent",
        "codex",
      ],
      { cwd: tempDir, encoding: "utf8" },
    );
    expect(driftedReadiness.status).toBe(1);
    expect(driftedReadiness.stderr).toContain("before ec-tdd-init succeeds");
    await writeTddReadinessFixture();
    const requested = JSON.parse(
      execFileSync(
        "python3",
        [
          stateApiPath(),
          "request-transition",
          "--session-file",
          ".easy-coding/sessions/test.json",
          "--stage",
          "MEMORY",
          "--agent",
          "codex",
        ],
        { cwd: tempDir, encoding: "utf8" },
      ),
    ) as { pending_transition: { from: string; to: string } };
    expect(requested.pending_transition).toMatchObject({ from: "QUALITY", to: "MEMORY" });
  });

  it("requires every latest review dimension to pass and preserves two-dimensional strict review", async () => {
    const taskId = "07-27-strict-review";
    await writeConfirmModeConfig("guard");
    await writeSessionFixture(taskId);
    await writeTaskFixture(taskId, "QUALITY", "codex", { workflow_mode: "strict" });
    await mkdir(path.join(tempDir, "src"), { recursive: true });
    await writeFile(path.join(tempDir, "src", "strict.ts"), "export const strict = true;\n", "utf8");
    const executionPath = path.join(
      tempDir,
      ".easy-coding",
      "tasks",
      taskId,
      "execution.jsonl",
    );
    await writeFile(
      executionPath,
      `${JSON.stringify({
        type: "plan",
        strategy: "single",
        units: [
          {
            id: "U1",
            title: "strict review",
            type: "backend",
            files: ["src/strict.ts"],
            depends_on: [],
          },
        ],
      })}\n`,
      "utf8",
    );
    const fingerprints = JSON.parse(
      execFileSync(
        "python3",
        [
          stateApiPath(),
          "evidence-fingerprints",
          "--session-file",
          ".easy-coding/sessions/test.json",
          "--agent",
          "codex",
        ],
        { cwd: tempDir, encoding: "utf8" },
      ),
    ) as {
      implementation_fingerprint: string;
      config_fingerprint: string;
      quality_attempt: { attempt: number };
    };
    await appendFile(
      executionPath,
      `${JSON.stringify({
        type: "review",
        dimension: "correctness-contracts",
        passed: true,
        reviewer: "correctness-reviewer",
        implementation_fingerprint: fingerprints.implementation_fingerprint,
        quality_attempt: fingerprints.quality_attempt.attempt,
        timestamp: "2026-07-27T00:00:00Z",
        findings: [],
      })}\n`,
      "utf8",
    );

    const oneDimension = spawnSync(
      "python3",
      [
        stateApiPath(),
        "request-transition",
        "--session-file",
        ".easy-coding/sessions/test.json",
        "--stage",
        "MEMORY",
        "--agent",
        "codex",
      ],
      { cwd: tempDir, encoding: "utf8" },
    );
    expect(oneDimension.status).toBe(1);
    expect(oneDimension.stderr).toContain("at least two passed review dimensions");

    await appendFile(
      executionPath,
      `${JSON.stringify({
        type: "review",
        dimension: "compliance-tests-security",
        passed: false,
        reviewer: "compliance-reviewer",
        implementation_fingerprint: fingerprints.implementation_fingerprint,
        quality_attempt: fingerprints.quality_attempt.attempt,
        failure_classes: ["test-defect"],
        timestamp: "2026-07-27T00:01:00Z",
        findings: [
          {
            file: "src/example.ts",
            line: 1,
            issue: "missing regression",
            severity: "error",
          },
        ],
      })}\n`,
      "utf8",
    );
    const failedDimension = spawnSync(
      "python3",
      [
        stateApiPath(),
        "request-transition",
        "--session-file",
        ".easy-coding/sessions/test.json",
        "--stage",
        "MEMORY",
        "--agent",
        "codex",
      ],
      { cwd: tempDir, encoding: "utf8" },
    );
    expect(failedDimension.status).toBe(1);
    expect(failedDimension.stderr).toContain("a review dimension is not passed");

    await appendFile(
      executionPath,
      `${JSON.stringify({
        type: "review",
        dimension: "compliance-tests-security",
        passed: true,
        reviewer: "compliance-reviewer",
        implementation_fingerprint: fingerprints.implementation_fingerprint,
        quality_attempt: fingerprints.quality_attempt.attempt,
        timestamp: "2026-07-27T00:02:00Z",
        findings: [],
      })}\n`,
      "utf8",
    );
    await appendFile(
      executionPath,
      `${JSON.stringify({
        type: "verify",
        check: "targeted-test",
        check_type: "test",
        command: "npm test -- targeted",
        passed: true,
        implementation_fingerprint: fingerprints.implementation_fingerprint,
        config_fingerprint: fingerprints.config_fingerprint,
        quality_attempt: fingerprints.quality_attempt.attempt,
        timestamp: "2026-07-27T00:00:00Z",
      })}\n`,
      "utf8",
    );
    const incompleteStrictGate = spawnSync(
      "python3",
      [
        stateApiPath(),
        "request-transition",
        "--session-file",
        ".easy-coding/sessions/test.json",
        "--stage",
        "MEMORY",
        "--agent",
        "codex",
      ],
      { cwd: tempDir, encoding: "utf8" },
    );
    expect(incompleteStrictGate.status).toBe(1);
    expect(incompleteStrictGate.stderr).toContain(
      "current verification evidence for every check type",
    );
    expect(incompleteStrictGate.stderr).toContain("build, lint, typecheck");

    for (const record of [
      { check: "full-lint", check_type: "lint", passed: true },
      { check: "full-typecheck", check_type: "typecheck", passed: true },
      {
        check: "build-not-applicable",
        check_type: "build",
        passed: false,
        applicable: false,
      },
    ]) {
      await appendFile(
        executionPath,
        `${JSON.stringify({
          type: "verify",
          ...record,
          ...(record.applicable === false
            ? {}
            : { command: `npm run ${record.check_type}` }),
          implementation_fingerprint: fingerprints.implementation_fingerprint,
          config_fingerprint: fingerprints.config_fingerprint,
          quality_attempt: fingerprints.quality_attempt.attempt,
          timestamp: "2026-07-27T00:01:00Z",
        })}\n`,
        "utf8",
      );
    }
    const unexplainedNotApplicable = spawnSync(
      "python3",
      [
        stateApiPath(),
        "request-transition",
        "--session-file",
        ".easy-coding/sessions/test.json",
        "--stage",
        "MEMORY",
        "--agent",
        "codex",
      ],
      { cwd: tempDir, encoding: "utf8" },
    );
    expect(unexplainedNotApplicable.status).toBe(1);
    expect(unexplainedNotApplicable.stderr).toContain(
      "command or an explicit not-applicable reason",
    );

    await appendFile(
      executionPath,
      `${JSON.stringify({
        type: "verify",
        check: "build-not-applicable",
        check_type: "build",
        passed: false,
        applicable: false,
        not_applicable_reason: "project has no build command",
        implementation_fingerprint: fingerprints.implementation_fingerprint,
        config_fingerprint: fingerprints.config_fingerprint,
        quality_attempt: fingerprints.quality_attempt.attempt,
        timestamp: "2026-07-27T00:02:00Z",
      })}\n`,
      "utf8",
    );
    await appendFile(
      executionPath,
      `${JSON.stringify({
        type: "verify",
        check: "full-lint",
        check_type: "lint",
        command: "npm run lint",
        passed: false,
        implementation_fingerprint: fingerprints.implementation_fingerprint,
        config_fingerprint: fingerprints.config_fingerprint,
        quality_attempt: fingerprints.quality_attempt.attempt,
        timestamp: "2026-07-27T00:03:00Z",
      })}\n`,
      "utf8",
    );
    await appendFile(
      executionPath,
      `${JSON.stringify({
        type: "verify",
        check: "full-lint",
        check_type: "lint",
        passed: false,
        applicable: false,
        not_applicable_reason: "attempted reclassification after execution",
        implementation_fingerprint: fingerprints.implementation_fingerprint,
        config_fingerprint: fingerprints.config_fingerprint,
        quality_attempt: fingerprints.quality_attempt.attempt,
        timestamp: "2026-07-27T00:04:00Z",
      })}\n`,
      "utf8",
    );
    const hiddenFailure = spawnSync(
      "python3",
      [
        stateApiPath(),
        "request-transition",
        "--session-file",
        ".easy-coding/sessions/test.json",
        "--stage",
        "MEMORY",
        "--agent",
        "codex",
      ],
      { cwd: tempDir, encoding: "utf8" },
    );
    expect(hiddenFailure.status).toBe(1);
    expect(hiddenFailure.stderr).toContain("verification evidence contains failures");

    await appendFile(
      executionPath,
      `${JSON.stringify({
        type: "verify",
        check: "full-lint",
        check_type: "lint",
        command: "npm run lint",
        passed: true,
        implementation_fingerprint: fingerprints.implementation_fingerprint,
        config_fingerprint: fingerprints.config_fingerprint,
        quality_attempt: fingerprints.quality_attempt.attempt,
        timestamp: "2026-07-27T00:05:00Z",
      })}\n`,
      "utf8",
    );
    const completeStrictGate = JSON.parse(
      execFileSync(
        "python3",
        [
          stateApiPath(),
          "request-transition",
          "--session-file",
          ".easy-coding/sessions/test.json",
          "--stage",
          "MEMORY",
          "--agent",
          "codex",
        ],
        { cwd: tempDir, encoding: "utf8" },
      ),
    ) as { pending_transition: { from: string; to: string } };
    expect(completeStrictGate.pending_transition).toMatchObject({
      from: "QUALITY",
      to: "MEMORY",
    });
  });
});
