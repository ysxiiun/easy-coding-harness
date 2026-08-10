import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const pythonCmd = process.platform === "win32" ? "python" : "python3";
let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "ec-dev-spec-"));
  await mkdir(path.join(tempDir, ".easy-coding", "spec", "dev"), { recursive: true });
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

function stateApiPath(): string {
  return path.join(process.cwd(), "src", "templates", "shared-hooks", "easy_coding_state.py");
}

function runState(args: string[]): string {
  return execFileSync(pythonCmd, [stateApiPath(), ...args, "--cwd", tempDir], {
    cwd: tempDir,
    encoding: "utf8",
  });
}

async function createRepository(
  relativePath: string,
  remote: string,
  files: Record<string, string>,
): Promise<{ root: string; commit: string }> {
  const root = path.join(tempDir, relativePath);
  await mkdir(root, { recursive: true });
  execFileSync("git", ["init", root], { stdio: "ignore" });
  execFileSync("git", ["-C", root, "config", "user.email", "fixture@example.com"]);
  execFileSync("git", ["-C", root, "config", "user.name", "Fixture"]);
  execFileSync("git", ["-C", root, "remote", "add", "origin", remote]);
  for (const [fileName, content] of Object.entries(files)) {
    const destination = path.join(root, fileName);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, content, "utf8");
  }
  execFileSync("git", ["-C", root, "add", "."]);
  execFileSync("git", ["-C", root, "commit", "-m", "fixture"], { stdio: "ignore" });
  const commit = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  return { root, commit };
}

async function writeCanonicalFixture(): Promise<{
  specPath: string;
  repoA: string;
  repoB: string;
}> {
  const first = await createRepository(
    "repos/service-a",
    "git@example.com:demo/order-service.git",
    {
      "order-domain/src/main/java/com/example/order/OrderEventPublisher.java":
        "package com.example.order;\npublic interface OrderEventPublisher {}\n",
      "order-api/src/main/java/com/example/order/api/DeliveryStatusController.java":
        "package com.example.order.api;\npublic class DeliveryStatusController {}\n",
    },
  );
  const second = await createRepository(
    "repos/service-b",
    "https://example.com/demo/notification-service.git",
    {
      "notification-app/src/main/java/com/example/notification/OrderEventConsumer.java":
        "package com.example.notification;\npublic class OrderEventConsumer {}\n",
    },
  );
  const source = await readFile(
    path.join(process.cwd(), "test", "fixtures", "canonical-v1-valid.md"),
    "utf8",
  );
  const specPath = path.join(tempDir, ".easy-coding", "spec", "dev", "fixture.md");
  await writeFile(
    specPath,
    source
      .replaceAll("1111111111111111111111111111111111111111", first.commit)
      .replaceAll("2222222222222222222222222222222222222222", second.commit),
    "utf8",
  );
  return { specPath, repoA: first.root, repoB: second.root };
}

describe("Canonical Spec v1 runtime integration", () => {
  it("pins the final easy-dev-spec protocol implementation and READY fixture", async () => {
    const protocol = await readFile(
      path.join(process.cwd(), "src", "templates", "shared-hooks", "easy_dev_spec_protocol.py"),
    );
    const fixture = await readFile(
      path.join(process.cwd(), "test", "fixtures", "canonical-v1-valid.md"),
    );
    expect(createHash("sha256").update(protocol).digest("hex")).toBe(
      "9c01b94771a5d8d760ede748cd98b1dabfa792c168a57d2eea71afc4bc00dfd1",
    );
    expect(createHash("sha256").update(fixture).digest("hex")).toBe(
      "57171e63a5d2149866999276e10f1aa829c5f92ed77f8db5d8419443002f8022",
    );
  });

  it("inspects a READY multi-repository Spec without creating runtime state", async () => {
    const fixture = await writeCanonicalFixture();
    const inspection = JSON.parse(
      runState([
        "inspect-dev-spec",
        "--spec",
        fixture.specPath,
        "--repo-path",
        `R1=${fixture.repoA}`,
        "--repo-path",
        `R2=${fixture.repoB}`,
      ]),
    );

    expect(inspection.protocol).toBe("canonical-v1");
    expect(inspection.status).toBe("READY");
    expect(inspection.tasks.map((task: { task_id: string }) => task.task_id)).toEqual([
      "R1-T1",
      "R2-T1",
      "R1-T2",
    ]);
    expect(inspection.unresolved_repositories).toEqual([]);
    expect(inspection.baseline_status).toEqual({ R1: "exact", R2: "exact" });
    expect(inspection.changes).toBeUndefined();
    await expect(
      readFile(path.join(tempDir, ".easy-coding", "sessions", "codex-ppid.json")),
    ).rejects.toThrow();
  });

  it("recognizes a structurally valid DRAFT but refuses to select it for execution", async () => {
    const fixture = await writeCanonicalFixture();
    const source = await readFile(fixture.specPath, "utf8");
    await writeFile(
      fixture.specPath,
      source.replace('"status": "READY"', '"status": "DRAFT"'),
      "utf8",
    );
    const inspection = JSON.parse(runState(["inspect-dev-spec", "--spec", fixture.specPath]));
    expect(inspection.status).toBe("DRAFT");

    const selection = spawnSync(
      pythonCmd,
      [
        stateApiPath(),
        "select-dev-spec-scope",
        "--spec",
        fixture.specPath,
        "--spec-task",
        "R1-T1",
        "--cwd",
        tempDir,
      ],
      { cwd: tempDir, encoding: "utf8" },
    );
    expect(selection.status).toBe(1);
    expect(selection.stderr).toContain("ready.required");
  });

  it("rejects unsafe Canonical repository-relative paths", async () => {
    const fixture = await writeCanonicalFixture();
    const source = await readFile(fixture.specPath, "utf8");
    await writeFile(
      fixture.specPath,
      source.replace(
        "order-api/src/main/java/com/example/order/api/DeliveryStatusController.java",
        "https://example.com/api.ts",
      ),
      "utf8",
    );
    const result = spawnSync(
      pythonCmd,
      [
        stateApiPath(),
        "inspect-dev-spec",
        "--spec",
        fixture.specPath,
        "--repo-path",
        `R1=${fixture.repoA}`,
        "--repo-path",
        `R2=${fixture.repoB}`,
        "--cwd",
        tempDir,
      ],
      { cwd: tempDir, encoding: "utf8" },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("path.invalid");
  });

  it("rejects a READY document that fails the final producer semantic gate", async () => {
    const fixture = await writeCanonicalFixture();
    const source = await readFile(fixture.specPath, "utf8");
    await writeFile(
      fixture.specPath,
      source.replace("总目标：订单成功提交后发布事件，通知服务消费同一冻结契约。", "总目标：TODO"),
      "utf8",
    );
    const result = spawnSync(
      pythonCmd,
      [stateApiPath(), "inspect-dev-spec", "--spec", fixture.specPath, "--cwd", tempDir],
      { cwd: tempDir, encoding: "utf8" },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("placeholder.todo");
  });

  it("returns deterministic per-repository consumption closures", async () => {
    const fixture = await writeCanonicalFixture();
    const selected = JSON.parse(
      runState([
        "select-dev-spec-scope",
        "--spec",
        fixture.specPath,
        "--spec-task",
        "R1-T2",
        "--spec-task",
        "R2-T1",
      ]),
    );

    expect(selected.selected_task_ids).toEqual(["R1-T2", "R2-T1"]);
    expect(
      selected.scopes.map((scope: { repo: { repo_id: string } }) => scope.repo.repo_id),
    ).toEqual(["R1", "R2"]);
    expect(selected.scopes[0].selected_task_ids).toEqual(["R1-T2"]);
    expect(
      selected.scopes[0].direct_dependency_summaries.map(
        (item: { task_id: string }) => item.task_id,
      ),
    ).toEqual(["R1-T1", "R2-T1"]);
    expect(
      selected.scopes[0].sections.map((section: { section_id: string }) => section.section_id),
    ).toEqual(["global-context", "repo-r1", "task-r1-t2"]);
    expect(JSON.stringify(selected.scopes[0].sections)).not.toContain("task-r1-t1");
    expect(
      selected.scopes[1].sections.map((section: { section_id: string }) => section.section_id),
    ).toEqual(["global-context", "repo-r2", "contract-c1", "task-r2-t1"]);
  });

  it("creates one Harness task for a selected task set and tracks dependencies", async () => {
    const fixture = await writeCanonicalFixture();
    const created = JSON.parse(
      runState([
        "create-task-from-spec",
        "--spec",
        fixture.specPath,
        "--spec-task",
        "R1-T1",
        "--spec-task",
        "R2-T1",
        "--spec-task",
        "R1-T2",
        "--task-id",
        "canonical-task",
        "--type",
        "feature",
        "--title",
        "Canonical task",
        "--repo-path",
        `R1=${fixture.repoA}`,
        "--repo-path",
        `R2=${fixture.repoB}`,
        "--agent",
        "codex",
      ]),
    );

    expect(created.current_task).toBe("canonical-task");
    expect(created.task.selected_spec_tasks).toEqual(["R1-T1", "R2-T1", "R1-T2"]);
    expect(created.task.repo_paths).toEqual({
      R1: "repos/service-a",
      R2: "repos/service-b",
    });
    expect(created.spec_summary.pending_dependencies).toEqual([
      expect.objectContaining({
        source_task_id: "R1-T2",
        task_id: "R2-T1",
        dependency_type: "integration",
      }),
    ]);

    const taskFiles = await readFile(
      path.join(tempDir, ".easy-coding", "tasks", "canonical-task", "task.json"),
      "utf8",
    );
    expect(taskFiles).not.toContain(tempDir);

    const satisfied = JSON.parse(
      runState([
        "satisfy-spec-dependency",
        "--spec-task",
        "R2-T1",
        "--source-task",
        "R1-T2",
        "--evidence",
        "integration report 42",
        "--agent",
        "codex",
      ]),
    );
    expect(satisfied.spec_summary.pending_dependencies).toEqual([]);
  });

  it("treats an explicit repository path as authoritative", async () => {
    const fixture = await writeCanonicalFixture();
    const result = spawnSync(
      pythonCmd,
      [
        stateApiPath(),
        "create-task-from-spec",
        "--spec",
        fixture.specPath,
        "--spec-task",
        "R1-T1",
        "--task-id",
        "wrong-explicit-repository",
        "--type",
        "feature",
        "--title",
        "Wrong explicit repository",
        "--repo-path",
        `R1=${fixture.repoB}`,
        "--agent",
        "codex",
        "--cwd",
        tempDir,
      ],
      { cwd: tempDir, encoding: "utf8" },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("unresolved repository paths: R1");
  });

  it("rejects a selected task that omits its hard dependency", async () => {
    const fixture = await writeCanonicalFixture();
    const result = spawnSync(
      pythonCmd,
      [
        stateApiPath(),
        "create-task-from-spec",
        "--spec",
        fixture.specPath,
        "--spec-task",
        "R1-T2",
        "--task-id",
        "missing-hard",
        "--type",
        "feature",
        "--title",
        "Missing hard dependency",
        "--repo-path",
        `R1=${fixture.repoA}`,
        "--agent",
        "codex",
        "--cwd",
        tempDir,
      ],
      { cwd: tempDir, encoding: "utf8" },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("omit hard dependencies");
  });

  it("classifies selected file drift without treating unrelated repositories as resolved", async () => {
    const fixture = await writeCanonicalFixture();
    await writeFile(
      path.join(
        fixture.repoA,
        "order-api/src/main/java/com/example/order/api/DeliveryStatusController.java",
      ),
      "package com.example.order.api;\npublic class Drifted {}\n",
      "utf8",
    );
    const inspection = JSON.parse(
      runState([
        "inspect-dev-spec",
        "--spec",
        fixture.specPath,
        "--repo-path",
        `R1=${fixture.repoA}`,
        "--repo-path",
        `R2=${fixture.repoB}`,
      ]),
    );
    expect(inspection.baseline_status.R1).toBe("scope-drifted");
    expect(inspection.baseline_status.R2).toBe("exact");
  });

  it("classifies source test-file drift as selected scope drift", async () => {
    const fixture = await writeCanonicalFixture();
    const testFile = path.join(
      fixture.repoA,
      "order-domain/src/test/java/com/example/order/OrderEventPublisherTest.java",
    );
    await mkdir(path.dirname(testFile), { recursive: true });
    await writeFile(
      testFile,
      "package com.example.order;\nclass OrderEventPublisherTest {}\n",
      "utf8",
    );

    const inspection = JSON.parse(
      runState([
        "inspect-dev-spec",
        "--spec",
        fixture.specPath,
        "--repo-path",
        `R1=${fixture.repoA}`,
        "--repo-path",
        `R2=${fixture.repoB}`,
      ]),
    );
    expect(inspection.baseline_status.R1).toBe("scope-drifted");
    expect(inspection.baseline_status.R2).toBe("exact");
  });

  it("rejects dependency metadata that no longer matches the source selection", async () => {
    const fixture = await writeCanonicalFixture();
    runState([
      "create-task-from-spec",
      "--spec",
      fixture.specPath,
      "--spec-task",
      "R1-T1",
      "--spec-task",
      "R2-T1",
      "--spec-task",
      "R1-T2",
      "--task-id",
      "tampered-dependencies",
      "--type",
      "feature",
      "--title",
      "Tampered dependencies",
      "--repo-path",
      `R1=${fixture.repoA}`,
      "--repo-path",
      `R2=${fixture.repoB}`,
      "--agent",
      "codex",
    ]);
    const taskPath = path.join(
      tempDir,
      ".easy-coding",
      "tasks",
      "tampered-dependencies",
      "task.json",
    );
    const task = JSON.parse(await readFile(taskPath, "utf8"));
    task.spec_dependency_evidence = task.spec_dependency_evidence.filter(
      (record: { dependency_type: string }) => record.dependency_type !== "integration",
    );
    await writeFile(taskPath, JSON.stringify(task, null, 2), "utf8");

    const result = spawnSync(
      pythonCmd,
      [
        stateApiPath(),
        "satisfy-spec-dependency",
        "--spec-task",
        "R2-T1",
        "--source-task",
        "R1-T2",
        "--evidence",
        "forged report",
        "--agent",
        "codex",
        "--cwd",
        tempDir,
      ],
      { cwd: tempDir, encoding: "utf8" },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "Canonical Spec dependency metadata no longer matches source selection",
    );
  });

  it("rejects stored repository bindings that drift from their resolved checkout", async () => {
    const fixture = await writeCanonicalFixture();
    runState([
      "create-task-from-spec",
      "--spec",
      fixture.specPath,
      "--spec-task",
      "R1-T1",
      "--spec-task",
      "R2-T1",
      "--spec-task",
      "R1-T2",
      "--task-id",
      "tampered-repository-binding",
      "--type",
      "feature",
      "--title",
      "Tampered repository binding",
      "--repo-path",
      `R1=${fixture.repoA}`,
      "--repo-path",
      `R2=${fixture.repoB}`,
      "--agent",
      "codex",
    ]);
    const taskPath = path.join(
      tempDir,
      ".easy-coding",
      "tasks",
      "tampered-repository-binding",
      "task.json",
    );
    const task = JSON.parse(await readFile(taskPath, "utf8"));
    task.spec_repositories[0].path = "repos/service-b";
    await writeFile(taskPath, JSON.stringify(task, null, 2), "utf8");

    const result = spawnSync(
      pythonCmd,
      [
        stateApiPath(),
        "satisfy-spec-dependency",
        "--spec-task",
        "R2-T1",
        "--source-task",
        "R1-T2",
        "--evidence",
        "forged report",
        "--agent",
        "codex",
        "--cwd",
        tempDir,
      ],
      { cwd: tempDir, encoding: "utf8" },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Canonical Spec repository bindings no longer match task.json");
  });

  it("binds every Unit to its exact source Step mapping and Step dependency", () => {
    const inspection = { dependency_edges: [] };
    const selection = {
      selected_task_ids: ["R1-T1"],
      selected_repo_ids: ["R1"],
      selected_tasks: [{ task_id: "R1-T1", repo_id: "R1", step_ids: ["S1", "S2"] }],
      selected_changes: [
        { change_id: "F1", task_id: "R1-T1", path: "src/a.ts", symbols: ["A#run"] },
        { change_id: "F2", task_id: "R1-T1", path: "src/b.ts", symbols: ["B#run"] },
      ],
      selected_steps: [
        {
          step_id: "S1",
          task_id: "R1-T1",
          change_ids: ["F1"],
          depends_on_step_ids: [],
          test_ids: ["T1"],
        },
        {
          step_id: "S2",
          task_id: "R1-T1",
          change_ids: ["F2"],
          depends_on_step_ids: ["S1"],
          test_ids: ["T2"],
        },
      ],
      selected_tests: [
        { test_id: "T1", task_id: "R1-T1", file: "test/a.test.ts", command: "npm test -- a" },
        { test_id: "T2", task_id: "R1-T1", file: "test/b.test.ts", command: "npm test -- b" },
      ],
      dependency_records: [],
    };
    const valid = {
      type: "plan",
      strategy: "parallel",
      units: [
        {
          id: "U1",
          repo_id: "R1",
          source_task_id: "R1-T1",
          source_step_ids: ["S1"],
          files: ["src/a.ts"],
          symbols: ["A#run"],
          test_commands: ["npm test -- a"],
          depends_on: [],
        },
        {
          id: "U2",
          repo_id: "R1",
          source_task_id: "R1-T1",
          source_step_ids: ["S2"],
          files: ["src/b.ts"],
          symbols: ["B#run"],
          test_commands: ["npm test -- b"],
          depends_on: ["U1"],
        },
      ],
    };
    const swapped = structuredClone(valid);
    [swapped.units[0].files, swapped.units[1].files] = [
      swapped.units[1].files,
      swapped.units[0].files,
    ];
    [swapped.units[0].symbols, swapped.units[1].symbols] = [
      swapped.units[1].symbols,
      swapped.units[0].symbols,
    ];
    [swapped.units[0].test_commands, swapped.units[1].test_commands] = [
      swapped.units[1].test_commands,
      swapped.units[0].test_commands,
    ];
    const missingDependency = structuredClone(valid);
    missingDependency.units[1].depends_on = [];
    const script = [
      "import json, pathlib, sys",
      `sys.path.insert(0, ${JSON.stringify(path.dirname(stateApiPath()))})`,
      "import easy_coding_state as state",
      "inspection = json.loads(sys.argv[1])",
      "selection = json.loads(sys.argv[2])",
      "plans = json.loads(sys.argv[3])",
      "state.inspect_task_spec = lambda root, task: (inspection, selection)",
      "print(json.dumps([state.is_valid_spec_execution_plan(pathlib.Path.cwd(), {'spec_source': {}}, plan) for plan in plans]))",
    ].join("\n");
    const result = JSON.parse(
      execFileSync(
        pythonCmd,
        [
          "-c",
          script,
          JSON.stringify(inspection),
          JSON.stringify(selection),
          JSON.stringify([valid, swapped, missingDependency]),
        ],
        { cwd: tempDir, encoding: "utf8" },
      ),
    );

    expect(result).toEqual([true, false, false]);
  });

  it("does not reuse implementation lifecycle evidence from an older plan", () => {
    const plan = {
      type: "plan",
      strategy: "single",
      units: [{ id: "U1" }],
    };
    const records = [
      plan,
      { type: "dispatch", unit_id: "U1" },
      { type: "result", unit_id: "U1" },
      plan,
    ];
    const script = [
      "import json, pathlib, sys",
      `sys.path.insert(0, ${JSON.stringify(path.dirname(stateApiPath()))})`,
      "import easy_coding_state as state",
      "records = json.loads(sys.argv[1])",
      "plan = records[-1]",
      "state.latest_execution_plan = lambda root, task_id: plan",
      "state.is_valid_spec_execution_plan = lambda root, task, candidate: True",
      "state.execution_records = lambda root, task_id: records",
      "try:",
      "    state.validate_spec_implementation_results(pathlib.Path.cwd(), 'task', {'spec_source': {}})",
      "except state.StateError as error:",
      "    print(str(error))",
      "else:",
      "    raise SystemExit('stale lifecycle evidence was accepted')",
    ].join("\n");
    const result = execFileSync(pythonCmd, ["-c", script, JSON.stringify(records)], {
      cwd: tempDir,
      encoding: "utf8",
    });

    expect(result).toContain("missing dispatch records for units: U1");
  });

  it("requires source-traceable units and blocks MEMORY while integration evidence is pending", async () => {
    const fixture = await writeCanonicalFixture();
    const created = JSON.parse(
      runState([
        "create-task-from-spec",
        "--spec",
        fixture.specPath,
        "--spec-task",
        "R1-T1",
        "--spec-task",
        "R2-T1",
        "--spec-task",
        "R1-T2",
        "--task-id",
        "traceable-plan",
        "--type",
        "feature",
        "--title",
        "Traceable plan",
        "--repo-path",
        `R1=${fixture.repoA}`,
        "--repo-path",
        `R2=${fixture.repoB}`,
        "--agent",
        "codex",
      ]),
    );
    runState(["auto-transition", "--stage", "ANALYSIS", "--agent", "codex"]);

    const taskDir = path.join(tempDir, ".easy-coding", "tasks", "traceable-plan");
    await mkdir(path.join(tempDir, ".easy-coding", "templates"), { recursive: true });
    await writeFile(
      path.join(tempDir, ".easy-coding", "templates", "dev-spec-skeleton.md"),
      "[[EC_TODO:fixture]]\n",
      "utf8",
    );
    const traceability = [
      created.task.spec_source.path,
      created.task.spec_source.spec_id,
      `revision: ${created.task.spec_source.revision}`,
      created.task.spec_source.sha256,
      ...created.task.selected_spec_tasks,
      ...created.task.spec_repositories.map(
        (repository: { repo_id: string }) => repository.repo_id,
      ),
      ...created.task.spec_repositories.map(
        (repository: { repo_id: string; baseline_status: string }) =>
          `${repository.repo_id}=${repository.baseline_status}`,
      ),
    ].join(" ");
    await writeFile(
      path.join(taskDir, "dev-spec.md"),
      [
        "## 技术方案：Canonical fixture",
        "### 项目模式",
        "迭代项目",
        "### 任务类型",
        "新功能",
        "### 需求解析",
        traceability,
        "### 现状",
        "已核对当前代码。",
        "### 冲突摘要",
        "无冲突。",
        "### 决策闭环",
        "decision_status: closed",
        "- **已解决问题与结论**：无",
        "- **确认依据**：无额外决策",
        "### 影响面分析",
        "双仓任务。",
        "### 改动范围",
        "三个来源文件。",
        "### 修改方案",
        "按来源任务实施。",
        "### 实施拆解",
        "三个追踪单元。",
        "### 测试策略",
        "执行三个来源测试。",
        "### Workflow Mode",
        "strict。",
        "### 风险与注意事项",
        "integration 证据必须闭合。",
        "",
      ].join("\n"),
      "utf8",
    );
    await writeFile(
      path.join(taskDir, "test-strategy.md"),
      "# Tests\n\nRun source tests.\n",
      "utf8",
    );
    await writeFile(
      path.join(tempDir, ".easy-coding", "config.yaml"),
      "version: 3\nbehavior:\n  approval_mode: guard\n  workflow_mode: adaptive\n",
      "utf8",
    );

    const baseUnits = [
      {
        id: "U1",
        title: "Define contract",
        type: "backend",
        files: ["order-domain/src/main/java/com/example/order/OrderEventPublisher.java"],
        depends_on: [],
        acceptance_criteria: ["contract exists"],
        test_points: ["contract test"],
        contracts: ["C1"],
        risks: ["public contract"],
      },
      {
        id: "U2",
        title: "Consume contract",
        type: "backend",
        files: ["notification-app/src/main/java/com/example/notification/OrderEventConsumer.java"],
        depends_on: [],
        acceptance_criteria: ["consumer handles event"],
        test_points: ["consumer test"],
        contracts: ["C1"],
        risks: ["integration"],
      },
      {
        id: "U3",
        title: "Expose endpoint",
        type: "backend",
        files: ["order-api/src/main/java/com/example/order/api/DeliveryStatusController.java"],
        depends_on: ["U1"],
        acceptance_criteria: ["endpoint responds"],
        test_points: ["api test"],
        contracts: ["C1"],
        risks: ["integration"],
      },
    ];
    await writeFile(
      path.join(taskDir, "execution.jsonl"),
      `${JSON.stringify({
        type: "plan",
        strategy: "parallel",
        units: baseUnits,
        parallel_groups: [
          { level: 0, units: ["U1", "U2"] },
          { level: 1, units: ["U3"] },
        ],
      })}\n`,
      "utf8",
    );
    const invalid = spawnSync(
      pythonCmd,
      [
        stateApiPath(),
        "request-transition",
        "--stage",
        "IMPLEMENT",
        "--agent",
        "codex",
        "--cwd",
        tempDir,
      ],
      { cwd: tempDir, encoding: "utf8" },
    );
    expect(invalid.status).toBe(1);
    expect(invalid.stderr).toContain("no valid plan record");

    const tracedUnits = [
      {
        ...baseUnits[0],
        repo_id: "R1",
        source_task_id: "R1-T1",
        source_step_ids: ["S1"],
        symbols: ["OrderEventPublisher#publish"],
        test_commands: ["mvn -Dtest=OrderEventPublisherTest test"],
      },
      {
        ...baseUnits[1],
        repo_id: "R2",
        source_task_id: "R2-T1",
        source_step_ids: ["S2"],
        symbols: ["OrderEventConsumer#onMessage"],
        test_commands: ["mvn -Dtest=OrderEventConsumerTest test"],
      },
      {
        ...baseUnits[2],
        repo_id: "R1",
        source_task_id: "R1-T2",
        source_step_ids: ["S3"],
        symbols: ["DeliveryStatusController#getStatus"],
        test_commands: ["mvn -Dtest=DeliveryStatusControllerTest test"],
      },
    ];
    const plan = {
      type: "plan",
      strategy: "parallel",
      units: tracedUnits,
      parallel_groups: [
        { level: 0, units: ["U1", "U2"] },
        { level: 1, units: ["U3"] },
      ],
    };
    await writeFile(path.join(taskDir, "execution.jsonl"), `${JSON.stringify(plan)}\n`, "utf8");
    runState([
      "propose-workflow-mode",
      "--configured",
      "adaptive",
      "--selected",
      "strict",
      "--minimum",
      "strict",
      "--source",
      "adaptive",
      "--reason",
      "cross-repository-contract",
      "--agent",
      "codex",
    ]);
    const missingTestMapping = spawnSync(
      pythonCmd,
      [
        stateApiPath(),
        "request-transition",
        "--stage",
        "IMPLEMENT",
        "--agent",
        "codex",
        "--cwd",
        tempDir,
      ],
      { cwd: tempDir, encoding: "utf8" },
    );
    expect(missingTestMapping.status).toBe(1);
    expect(missingTestMapping.stderr).toContain(
      "test-strategy.md is missing Canonical Spec markers",
    );
    expect(missingTestMapping.stderr).toContain(
      "dev-spec.md is missing Canonical Spec Unit/dependency markers",
    );
    await appendFile(
      path.join(taskDir, "dev-spec.md"),
      [
        "",
        "Canonical Unit mapping: U1 / S1; U2 / S2; U3 / S3.",
        "Pending integration: R1-T2->R2-T1.",
        "Required evidence: Consumer contract test passes before end-to-end verification.",
        "",
      ].join("\n"),
      "utf8",
    );
    await writeFile(
      path.join(taskDir, "test-strategy.md"),
      [
        "# Tests",
        "",
        "## T1",
        "- Source task: R1-T1",
        "- Unit: U1",
        "- File: order-domain/src/test/java/com/example/order/OrderEventPublisherTest.java",
        "- Command: `mvn -Dtest=OrderEventPublisherTest test`",
        "",
        "## T2",
        "- Source task: R2-T1",
        "- Unit: U2",
        "- File: notification-app/src/test/java/com/example/notification/OrderEventConsumerTest.java",
        "- Command: `mvn -Dtest=OrderEventConsumerTest test`",
        "",
        "## T3",
        "- Source task: R1-T2",
        "- Unit: U3",
        "- File: order-api/src/test/java/com/example/order/api/DeliveryStatusControllerTest.java",
        "- Command: `mvn -Dtest=DeliveryStatusControllerTest test`",
        "",
      ].join("\n"),
      "utf8",
    );
    const requested = JSON.parse(
      runState(["request-transition", "--stage", "IMPLEMENT", "--agent", "codex"]),
    );
    expect(requested.pending_transition).toMatchObject({ from: "ANALYSIS", to: "IMPLEMENT" });

    const taskPath = path.join(taskDir, "task.json");
    const task = JSON.parse(await readFile(taskPath, "utf8"));
    task.status = "VERIFICATION";
    task.workflow_mode = "standard";
    task.pending_transition = undefined;
    await writeFile(taskPath, JSON.stringify(task, null, 2), "utf8");
    await appendFile(
      path.join(taskDir, "execution.jsonl"),
      `${tracedUnits
        .flatMap((unit) => [
          ...(unit.id === "U3"
            ? []
            : [
                JSON.stringify({
                  type: "dispatch",
                  unit_id: unit.id,
                  timestamp: "2026-08-06T00:00:00Z",
                  repo_id: unit.repo_id,
                  source_task_id: unit.source_task_id,
                }),
              ]),
          JSON.stringify({
            type: "result",
            unit_id: unit.id,
            status: "completed",
            changed_files: unit.files,
            summary: `${unit.id} completed`,
            issues: [],
            needs_attention: [],
            repo_id: unit.repo_id,
            source_task_id: unit.source_task_id,
          }),
        ])
        .join("\n")}\n`,
      "utf8",
    );
    const fingerprints = JSON.parse(runState(["evidence-fingerprints", "--agent", "codex"]));
    await appendFile(
      path.join(taskDir, "execution.jsonl"),
      `${[
        { source_task_id: "R1-T1", repo_id: "R1" },
        { source_task_id: "R2-T1", repo_id: "R2" },
      ]
        .map((ownership) =>
          JSON.stringify({
            type: "review",
            dimension: "correctness",
            passed: true,
            implementation_fingerprint: fingerprints.implementation_fingerprint,
            reviewer: "codex-reviewer",
            timestamp: "2026-08-06T00:01:00Z",
            findings: [],
            ...ownership,
          }),
        )
        .join("\n")}\n`,
      "utf8",
    );
    const verificationOwnership = [
      {
        command: "mvn -Dtest=OrderEventPublisherTest test",
        source_task_id: "R1-T1",
        repo_id: "R1",
      },
      {
        command: "mvn -Dtest=OrderEventConsumerTest test",
        source_task_id: "R2-T1",
        repo_id: "R2",
      },
      {
        command: "mvn -Dtest=DeliveryStatusControllerTest test",
        source_task_id: "R1-T2",
        repo_id: "R2",
      },
    ];
    await appendFile(
      path.join(taskDir, "execution.jsonl"),
      `${verificationOwnership
        .map((ownership, index) =>
          JSON.stringify({
            type: "verify",
            check: `source-test-${index + 1}`,
            check_type: "test",
            command: ownership.command,
            passed: true,
            timestamp: "2026-08-06T00:02:00Z",
            implementation_fingerprint: fingerprints.implementation_fingerprint,
            config_fingerprint: fingerprints.config_fingerprint,
            source_task_id: ownership.source_task_id,
            repo_id: ownership.repo_id,
          }),
        )
        .join("\n")}\n`,
      "utf8",
    );
    const dispatchBlocked = spawnSync(
      pythonCmd,
      [
        stateApiPath(),
        "request-transition",
        "--stage",
        "MEMORY",
        "--agent",
        "codex",
        "--cwd",
        tempDir,
      ],
      { cwd: tempDir, encoding: "utf8" },
    );
    expect(dispatchBlocked.status).toBe(1);
    expect(dispatchBlocked.stderr).toContain("missing dispatch records for units: U3");

    await appendFile(
      path.join(taskDir, "execution.jsonl"),
      `${[
        {
          type: "dispatch",
          unit_id: "U3",
          timestamp: "2026-08-06T00:02:30Z",
          repo_id: "R1",
          source_task_id: "R1-T2",
        },
        {
          type: "result",
          unit_id: "U3",
          status: "completed",
          changed_files: tracedUnits[2].files,
          summary: "U3 completed after dispatch",
          issues: [],
          needs_attention: [],
          repo_id: "R1",
          source_task_id: "R1-T2",
        },
        {
          type: "dispatch",
          unit_id: "U1",
          timestamp: "2026-08-06T00:02:40Z",
          repo_id: "R1",
          source_task_id: "R1-T1",
        },
        {
          type: "result",
          unit_id: "U1",
          status: "failed",
          changed_files: tracedUnits[0].files,
          summary: "U1 retry failed",
          issues: ["targeted test failed"],
          needs_attention: [],
          repo_id: "R1",
          source_task_id: "R1-T1",
        },
      ]
        .map((record) => JSON.stringify(record))
        .join("\n")}\n`,
      "utf8",
    );
    const failedResultBlocked = spawnSync(
      pythonCmd,
      [
        stateApiPath(),
        "request-transition",
        "--stage",
        "MEMORY",
        "--agent",
        "codex",
        "--cwd",
        tempDir,
      ],
      { cwd: tempDir, encoding: "utf8" },
    );
    expect(failedResultBlocked.status).toBe(1);
    expect(failedResultBlocked.stderr).toContain(
      "result U1 must be completed without unresolved issues",
    );
    await appendFile(
      path.join(taskDir, "execution.jsonl"),
      `${[
        {
          type: "dispatch",
          unit_id: "U1",
          timestamp: "2026-08-06T00:02:45Z",
          repo_id: "R1",
          source_task_id: "R1-T1",
        },
        {
          type: "result",
          unit_id: "U1",
          status: "completed",
          changed_files: tracedUnits[0].files,
          summary: "U1 retry recovered",
          issues: [],
          needs_attention: [],
          repo_id: "R1",
          source_task_id: "R1-T1",
        },
      ]
        .map((record) => JSON.stringify(record))
        .join("\n")}\n`,
      "utf8",
    );
    const reviewBlocked = spawnSync(
      pythonCmd,
      [
        stateApiPath(),
        "request-transition",
        "--stage",
        "MEMORY",
        "--agent",
        "codex",
        "--cwd",
        tempDir,
      ],
      { cwd: tempDir, encoding: "utf8" },
    );
    expect(reviewBlocked.status).toBe(1);
    expect(reviewBlocked.stderr).toContain(
      "review evidence does not cover selected source tasks: R1-T2",
    );

    await appendFile(
      path.join(taskDir, "execution.jsonl"),
      `${JSON.stringify({
        type: "review",
        dimension: "correctness",
        passed: true,
        implementation_fingerprint: fingerprints.implementation_fingerprint,
        reviewer: "codex-reviewer",
        timestamp: "2026-08-06T00:03:00Z",
        findings: [],
        source_task_id: "R1-T2",
        repo_id: "R1",
      })}\n`,
      "utf8",
    );
    const verificationOwnershipBlocked = spawnSync(
      pythonCmd,
      [
        stateApiPath(),
        "request-transition",
        "--stage",
        "MEMORY",
        "--agent",
        "codex",
        "--cwd",
        tempDir,
      ],
      { cwd: tempDir, encoding: "utf8" },
    );
    expect(verificationOwnershipBlocked.status).toBe(1);
    expect(verificationOwnershipBlocked.stderr).toContain(
      "verification evidence must preserve repository/source-task ownership",
    );

    await appendFile(
      path.join(taskDir, "execution.jsonl"),
      `${JSON.stringify({
        type: "verify",
        check: "source-test-3",
        check_type: "test",
        command: "mvn -Dtest=DeliveryStatusControllerTest test",
        passed: true,
        timestamp: "2026-08-06T00:03:30Z",
        implementation_fingerprint: fingerprints.implementation_fingerprint,
        config_fingerprint: fingerprints.config_fingerprint,
        source_task_id: "R1-T2",
        repo_id: "R1",
      })}\n`,
      "utf8",
    );
    const integrationBlocked = spawnSync(
      pythonCmd,
      [
        stateApiPath(),
        "request-transition",
        "--stage",
        "MEMORY",
        "--agent",
        "codex",
        "--cwd",
        tempDir,
      ],
      { cwd: tempDir, encoding: "utf8" },
    );
    expect(integrationBlocked.status).toBe(1);
    expect(integrationBlocked.stderr).toContain("integration dependencies are pending");

    const strictTask = JSON.parse(await readFile(taskPath, "utf8"));
    strictTask.workflow_mode = "strict";
    await writeFile(taskPath, JSON.stringify(strictTask, null, 2), "utf8");
    const strictFingerprints = JSON.parse(runState(["evidence-fingerprints", "--agent", "codex"]));
    await appendFile(
      path.join(taskDir, "execution.jsonl"),
      `${["correctness", "maintainability"]
        .flatMap((dimension) =>
          [
            { source_task_id: "R1-T1", repo_id: "R1" },
            { source_task_id: "R2-T1", repo_id: "R2" },
            { source_task_id: "R1-T2", repo_id: "R1" },
          ].map((ownership) =>
            JSON.stringify({
              type: "review",
              dimension,
              passed: true,
              implementation_fingerprint: strictFingerprints.implementation_fingerprint,
              reviewer: "codex-reviewer",
              timestamp: "2026-08-06T00:03:40Z",
              findings: [],
              ...ownership,
            }),
          ),
        )
        .join("\n")}\n`,
      "utf8",
    );
    await appendFile(
      path.join(taskDir, "execution.jsonl"),
      `${[
        ...verificationOwnership.map((ownership, index) => ({
          check: `strict-source-test-${index + 1}`,
          check_type: "test",
          ...ownership,
          ...(ownership.source_task_id === "R1-T2" ? { repo_id: "R1" } : {}),
        })),
        ...["lint", "typecheck", "build"].map((checkType) => ({
          check: `r1-${checkType}`,
          check_type: checkType,
          command: `npm run ${checkType}`,
          source_task_id: "R1-T1",
          repo_id: "R1",
        })),
      ]
        .map((check) =>
          JSON.stringify({
            type: "verify",
            passed: true,
            timestamp: "2026-08-06T00:03:50Z",
            implementation_fingerprint: strictFingerprints.implementation_fingerprint,
            config_fingerprint: strictFingerprints.config_fingerprint,
            ...check,
          }),
        )
        .join("\n")}\n`,
      "utf8",
    );

    runState([
      "satisfy-spec-dependency",
      "--spec-task",
      "R2-T1",
      "--source-task",
      "R1-T2",
      "--evidence",
      "integration report 42",
      "--agent",
      "codex",
    ]);
    const strictRepositoryBlocked = spawnSync(
      pythonCmd,
      [
        stateApiPath(),
        "request-transition",
        "--stage",
        "MEMORY",
        "--agent",
        "codex",
        "--cwd",
        tempDir,
      ],
      { cwd: tempDir, encoding: "utf8" },
    );
    expect(strictRepositoryBlocked.status).toBe(1);
    expect(strictRepositoryBlocked.stderr).toContain("R2 missing build, lint, typecheck");
    await appendFile(
      path.join(taskDir, "execution.jsonl"),
      `${["lint", "typecheck", "build"]
        .map((checkType) =>
          JSON.stringify({
            type: "verify",
            check: `r2-${checkType}`,
            check_type: checkType,
            command: `npm run ${checkType}`,
            passed: true,
            timestamp: "2026-08-06T00:04:00Z",
            implementation_fingerprint: strictFingerprints.implementation_fingerprint,
            config_fingerprint: strictFingerprints.config_fingerprint,
            source_task_id: "R2-T1",
            repo_id: "R2",
          }),
        )
        .join("\n")}\n`,
      "utf8",
    );
    const ready = JSON.parse(
      runState(["request-transition", "--stage", "MEMORY", "--agent", "codex"]),
    );
    expect(ready.pending_transition).toMatchObject({ from: "VERIFICATION", to: "MEMORY" });
  }, 20_000);
});
