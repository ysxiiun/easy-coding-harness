import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { configureClaude } from "../../src/configurators/claude.js";
import { configureCodex } from "../../src/configurators/codex.js";
import { configureQoder } from "../../src/configurators/qoder.js";

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

function runStateAt(root: string, args: string[]): string {
  return execFileSync(pythonCmd, [stateApiPath(), ...args, "--cwd", root], {
    cwd: root,
    encoding: "utf8",
  });
}

function initializeSpecExecution(specPath: string): void {
  runState(["initialize-spec-execution", "--spec", specPath]);
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
  it.each([
    ["codex", ".codex"], ["claude-code", ".claude"], ["qoder", ".qoder"],
  ])("restores external selected Spec context and pending changes after takeover by %s", async (agent, directory) => {
    const fixture = await writeCanonicalFixture();
    initializeSpecExecution(fixture.specPath);
    const harnessRoot = path.join(tempDir, "harness");
    await mkdir(path.join(harnessRoot, ".easy-coding"), { recursive: true });
    await configureCodex(harnessRoot);
    await configureClaude(harnessRoot);
    await configureQoder(harnessRoot);
    const installed = (owner: string, platformDir: string, session: string, args: string[]) =>
      spawnSync(pythonCmd, ["-B", path.join(harnessRoot, platformDir, "hooks", "easy_coding_state.py"),
        ...args, "--agent", owner, "--session-file", `.easy-coding/sessions/${session}.json`,
        "--cwd", harnessRoot,
      ], { cwd: harnessRoot, encoding: "utf8" });
    const call = (args: string[]) => installed(agent, directory, `${agent}-new`, args);
    const created = installed("codex", ".codex", "codex-old", [
      "create-task-from-spec", "--spec", fixture.specPath, "--spec-task", "R1-T1",
      "--task-id", "handoff-spec", "--type", "feature", "--title", "External Spec handoff",
      "--repo-path", `R1=${fixture.repoA}`,
    ]);
    expect(created.status, created.stderr).toBe(0);
    const initial = JSON.parse(created.stdout);
    expect(initial.task.spec_source.path_mode).toBe("absolute");
    expect(initial.spec_context).toMatchObject({ status: "ready", consumption: {
      selected_task_ids: ["R1-T1"], revision: 1,
    } });
    const withoutContext = call(["request-transition", "--task-id", "handoff-spec", "--stage", "IMPLEMENT"]);
    expect(withoutContext.stderr).toContain("resume-spec-context");
    const claimed = call(["claim-task", "--task-id", "handoff-spec"]);
    expect(claimed.status, claimed.stderr).toBe(0);
    const claim = JSON.parse(claimed.stdout);
    expect(claim.task.last_agent).toBe(agent);
    expect(claim.spec_context.consumption.design_sha256).toBe(initial.task.spec_source.design_sha256);
    expect(claim.spec_context.consumption.selected_task_ids).toEqual(["R1-T1"]);
    expect(claim.spec_context.consumption.scopes).toHaveLength(1);
    expect(JSON.stringify(claim.spec_context.consumption)).toContain("OrderEventPublisher");
    const begun = call(["begin-spec-change", "--affected-task", "R1-T1", "--summary", "Confirmed reliability change"]);
    expect(begun.status, begun.stderr).toBe(0);
    expect(JSON.parse(begun.stdout).task.spec_change).toMatchObject({ revision: 1, affected_task_ids: ["R1-T1"] });
    const pendingClaim = installed("codex", ".codex", "codex-resumed", ["claim-task", "--task-id", "handoff-spec"]);
    expect(JSON.parse(pendingClaim.stdout).spec_context.status).toBe("blocked");
    for (const stage of ["IMPLEMENT", "QUALITY", "MEMORY"]) {
      const blocked = call(["request-transition", "--task-id", "handoff-spec", "--stage", stage]);
      expect(blocked.status).toBe(1);
      expect(blocked.stderr).toContain("Confirmed Spec change is pending");
    }
    const revised = (await readFile(fixture.specPath, "utf8"))
      .replace('"revision": 1', '"revision": 2')
      .replace("总目标：订单成功提交后发布事件，通知服务消费同一冻结契约。", "总目标：订单成功提交后可靠发布事件，通知服务消费同一冻结契约。");
    await writeFile(fixture.specPath, revised);
    const sync = call(["sync-spec-design", "--task-id", "handoff-spec", "--affected-task", "R1-T1",
      "--summary", "Confirmed reliability change", "--idempotency-key", "handoff-spec:revision:2"]);
    expect(sync.status, sync.stderr).toBe(0);
    expect(JSON.parse(sync.stdout).task).not.toHaveProperty("spec_change");
    expect(JSON.parse(sync.stdout).task.status).toBe("ANALYSIS");
    const missingReload = call(["request-transition", "--task-id", "handoff-spec", "--stage", "IMPLEMENT"]);
    expect(missingReload.stderr).toContain("resume-spec-context");
    const resumed = call(["resume-spec-context", "--task-id", "handoff-spec"]);
    expect(JSON.parse(resumed.stdout).spec_context).toMatchObject({ status: "ready", consumption: { revision: 2 } });
    const preservedContext = JSON.parse(resumed.stdout).task.spec_context;
    const progress = call(["writeback-spec-task", "--task-id", "handoff-spec", "--spec-task", "R1-T1",
      "--status", "in_progress", "--summary", "Implement revised design", "--idempotency-key", "handoff-spec:start:2"]);
    expect(progress.status, progress.stderr).toBe(0);
    expect(JSON.parse(progress.stdout).task.spec_context).toEqual(preservedContext);
    const nextChange = call(["begin-spec-change", "--affected-task", "R1-T1", "--summary", "Next confirmed requirement"]);
    expect(nextChange.status, nextChange.stderr).toBe(0);
    const oldSync = call(["sync-spec-design", "--task-id", "handoff-spec", "--affected-task", "R1-T1",
      "--summary", "Confirmed reliability change", "--idempotency-key", "handoff-spec:revision:2"]);
    expect(oldSync.status).toBe(1);
    expect(oldSync.stderr).toContain("Old design sync cannot resolve");
    const afterReplay = JSON.parse(call(["snapshot"]).stdout);
    expect(afterReplay.task.spec_change).toMatchObject({ revision: 2, summary: "Next confirmed requirement" });
    expect(afterReplay.task.spec_writeback_progress).not.toHaveProperty("pending_action");
    await rm(fixture.specPath);
    const unavailable = call(["claim-task", "--task-id", "handoff-spec"]);
    expect(unavailable.status).toBe(0);
    expect(JSON.parse(unavailable.stdout).spec_context).toMatchObject({ status: "blocked" });
    expect(JSON.parse(unavailable.stdout).task).not.toHaveProperty("spec_context");
  }, 30_000);

  it("pins the final easy-dev-spec protocol implementation and READY fixture", async () => {
    const protocol = await readFile(
      path.join(process.cwd(), "src", "templates", "shared-hooks", "easy_dev_spec_protocol.py"),
    );
    const fixture = await readFile(
      path.join(process.cwd(), "test", "fixtures", "canonical-v1-valid.md"),
    );
    expect(createHash("sha256").update(protocol).digest("hex")).toBe(
      "a6016f04b4ce18794038ebcdbcab6e400a8a08aa2929a3e777c2b35ee3f7e7a1",
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

  it("routes from the current worktree without resolving unrelated repository paths", async () => {
    const fixture = await writeCanonicalFixture();
    await mkdir(path.join(fixture.repoA, ".easy-coding"), { recursive: true });
    const oldCheckout = await createRepository(
      "old-checkouts/order-service",
      "git@example.com:demo/order-service.git",
      {
        "order-domain/src/main/java/com/example/order/OrderEventPublisher.java":
          "package com.example.order;\npublic interface OrderEventPublisher {}\n",
      },
    );
    const source = await readFile(fixture.specPath, "utf8");
    await writeFile(
      fixture.specPath,
      source.replace("/workspace/order-service", oldCheckout.root),
      "utf8",
    );
    runStateAt(fixture.repoA, ["initialize-spec-execution", "--spec", fixture.specPath]);

    const routing = JSON.parse(
      runStateAt(fixture.repoA, [
        "inspect-dev-spec",
        "--spec",
        fixture.specPath,
        "--manifest-only",
      ]),
    );

    expect(routing.inspection_mode).toBe("manifest-only");
    expect(routing.repositories).toBeUndefined();
    expect(routing.tasks).toBeUndefined();
    expect(routing.dependency_edges).toBeUndefined();
    expect(routing.execution.tasks).toBeUndefined();
    expect(routing.repository_match).toEqual({
      repo_id: "R1",
      name: "order-service",
      path: ".",
      binding_source: "current-root-remote",
      path_hint_status: "different",
    });
    expect(routing.unresolved_repositories).toEqual([]);
    expect(routing.task_catalog).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          task_id: "R1-T1",
          repository_name: "order-service",
          baseline_status: "not-inspected",
        }),
        expect.objectContaining({ task_id: "R1-T2", baseline_status: "not-inspected" }),
        expect.objectContaining({ task_id: "R2-T1", baseline_status: "not-inspected" }),
      ]),
    );
    expect(routing.task_catalog).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          task_id: "R1-T2",
          depends_on: expect.arrayContaining([
            expect.objectContaining({
              task_id: "R1-T1",
              status: "pending",
              basis: "pending",
              shared_status: "pending",
              dependency_task_status: "not_started",
            }),
          ]),
        }),
      ]),
    );
    expect(routing.task_catalog[0]).not.toHaveProperty("change_paths");
    expect(routing.task_catalog[0]).not.toHaveProperty("test_files");

    const selected = JSON.parse(
      runStateAt(fixture.repoA, [
        "inspect-dev-spec",
        "--spec",
        fixture.specPath,
        "--spec-task",
        "R1-T2",
      ]),
    );
    expect(selected).toMatchObject({
      inspection_mode: "selected",
      selected_task_ids: ["R1-T2"],
      matched_repo_paths: { R1: "." },
      unresolved_repositories: [],
      baseline_status: { R1: "exact" },
    });
    expect(selected.repository_bindings).toEqual([
      expect.objectContaining({
        repo_id: "R1",
        binding_source: "current-root",
        path_hint_status: "different",
      }),
    ]);
    expect(selected.dependency_edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source_task_id: "R1-T2",
          task_id: "R1-T1",
          dependency_type: "hard",
          status: "pending",
          basis: "pending",
          shared_status: "pending",
          dependency_task_status: "not_started",
        }),
      ]),
    );

    const selectedLeaf = JSON.parse(
      runStateAt(fixture.repoA, [
        "inspect-dev-spec",
        "--spec",
        fixture.specPath,
        "--spec-task",
        "R1-T1",
      ]),
    );
    expect(selectedLeaf.repositories.map((item: { repo_id: string }) => item.repo_id)).toEqual([
      "R1",
    ]);
    expect(selectedLeaf.tasks.map((item: { task_id: string }) => item.task_id)).toEqual(["R1-T1"]);
    expect(selectedLeaf.dependency_edges).toEqual([]);
    expect(
      selectedLeaf.execution.tasks.map((item: { task_id: string }) => item.task_id),
    ).toEqual(["R1-T1"]);
  });

  it("never treats a matching directory name as repository identity without a remote", async () => {
    const fixture = await writeCanonicalFixture();
    await mkdir(path.join(fixture.repoA, ".easy-coding"), { recursive: true });
    execFileSync("git", ["-C", fixture.repoA, "remote", "remove", "origin"]);
    const source = await readFile(fixture.specPath, "utf8");
    await writeFile(
      fixture.specPath,
      source
        .replace('"name": "order-service"', '"name": "service-a"')
        .replace("仓库 R1：order-service", "仓库 R1：service-a"),
      "utf8",
    );

    const result = spawnSync(
      pythonCmd,
      [
        stateApiPath(),
        "inspect-dev-spec",
        "--spec",
        fixture.specPath,
        "--manifest-only",
        "--cwd",
        fixture.repoA,
      ],
      { cwd: fixture.repoA, encoding: "utf8" },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Current worktree has no Git remote");
  });

  it("routes a READY manifest before shared execution is initialized", async () => {
    const fixture = await writeCanonicalFixture();
    await mkdir(path.join(fixture.repoA, ".easy-coding"), { recursive: true });

    const routing = JSON.parse(
      runStateAt(fixture.repoA, [
        "inspect-dev-spec",
        "--spec",
        fixture.specPath,
        "--manifest-only",
      ]),
    );

    expect(routing).toMatchObject({
      protocol: "canonical-v1",
      status: "READY",
      execution_revision: null,
      execution: null,
      selection_required: true,
    });
    expect(routing.task_catalog).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          task_id: "R1-T2",
          execution_status: null,
          depends_on: expect.arrayContaining([
            expect.objectContaining({
              task_id: "R1-T1",
              status: "pending",
              basis: "pending",
              shared_status: null,
              dependency_task_status: null,
            }),
          ]),
        }),
      ]),
    );
  });

  it("creates a selected current-worktree task without an explicit repository path", async () => {
    const fixture = await writeCanonicalFixture();
    await mkdir(path.join(fixture.repoA, ".easy-coding"), { recursive: true });
    runStateAt(fixture.repoA, ["initialize-spec-execution", "--spec", fixture.specPath]);

    const created = JSON.parse(
      runStateAt(fixture.repoA, [
        "create-task-from-spec",
        "--spec",
        fixture.specPath,
        "--spec-task",
        "R1-T1",
        "--task-id",
        "worktree-auto-binding",
        "--type",
        "feature",
        "--title",
        "Worktree auto binding",
        "--agent",
        "codex",
      ]),
    );

    expect(created.task.repo_paths).toEqual({ R1: "." });
    expect(created.task.spec_repositories).toEqual([
      expect.objectContaining({
        repo_id: "R1",
        binding_source: "current-root",
        path_hint_status: "different",
      }),
    ]);
  });

  it("rejects combining manifest routing with an explicit task selection", async () => {
    const fixture = await writeCanonicalFixture();
    const result = spawnSync(
      pythonCmd,
      [
        stateApiPath(),
        "inspect-dev-spec",
        "--spec",
        fixture.specPath,
        "--manifest-only",
        "--spec-task",
        "R1-T1",
        "--cwd",
        fixture.repoA,
      ],
      { cwd: fixture.repoA, encoding: "utf8" },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("--manifest-only cannot be combined with --spec-task");
  });

  it("keeps manifest routing compatible with a legacy Dev-Spec", async () => {
    const legacySpec = path.join(tempDir, ".easy-coding", "spec", "dev", "legacy.md");
    await writeFile(legacySpec, "# Legacy Dev-Spec\n\nNo Canonical manifest.\n", "utf8");

    const inspected = JSON.parse(
      runState(["inspect-dev-spec", "--spec", legacySpec, "--manifest-only"]),
    );
    expect(inspected).toMatchObject({
      inspection_mode: "manifest-only",
      protocol: "legacy",
      selection_required: false,
      task_catalog: [],
    });
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
    initializeSpecExecution(fixture.specPath);
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
    initializeSpecExecution(fixture.specPath);
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
        task_id: "R1-T1",
        dependency_type: "hard",
      }),
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
    expect(satisfied.spec_summary.pending_dependencies).toEqual([
      expect.objectContaining({
        source_task_id: "R1-T2",
        task_id: "R1-T1",
        dependency_type: "hard",
      }),
    ]);
    expect(
      satisfied.task.spec_dependency_evidence.find(
        (record: { source_task_id: string; task_id: string }) =>
          record.source_task_id === "R1-T2" && record.task_id === "R2-T1",
      ),
    ).toMatchObject({
      status: "satisfied",
      shared_status: "satisfied",
      dependency_task_status: "not_started",
      basis: "recorded-evidence",
    });
  });

  it("treats an explicit repository path as authoritative", async () => {
    const fixture = await writeCanonicalFixture();
    initializeSpecExecution(fixture.specPath);
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
    initializeSpecExecution(fixture.specPath);
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
    initializeSpecExecution(fixture.specPath);
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
    initializeSpecExecution(fixture.specPath);
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

  it("carries QUALITY evidence only for dependency-independent stable sources", () => {
    const plan = {
      units: [
        { id: "U1", source_task_id: "R1-T1", repo_id: "R1", depends_on: [] },
        { id: "U2", source_task_id: "R2-T1", repo_id: "R2", depends_on: ["U1"] },
        { id: "U3", source_task_id: "R3-T1", repo_id: "R3", depends_on: [] },
        { id: "U4", source_task_id: "R4-T1", repo_id: "R4", depends_on: [] },
      ],
    };
    const snapshots = {
      "R1-T1": { dependencies: [] },
      "R2-T1": { dependencies: [] },
      "R3-T1": {
        dependencies: [{ task_id: "R1-T1", type: "contract" }],
      },
      "R4-T1": { dependencies: [] },
    };
    const script = [
      "import json, pathlib, sys",
      `sys.path.insert(0, ${JSON.stringify(path.dirname(stateApiPath()))})`,
      "import easy_coding_state as state",
      "plan = json.loads(sys.argv[1])",
      "snapshots = json.loads(sys.argv[2])",
      "state.inspect_task_spec = lambda root, task: ({}, None)",
      "state._selected_execution_snapshots = lambda inspection, task: snapshots",
      "eligible = state.canonical_carry_forward_sources(",
      "    pathlib.Path.cwd(), 'task', {'spec_source': {}}, plan, {'R2', 'R3', 'R4'}, {}",
      ")",
      "print(json.dumps(sorted(eligible)))",
    ].join("\n");
    const result = execFileSync(
      pythonCmd,
      ["-c", script, JSON.stringify(plan), JSON.stringify(snapshots)],
      { cwd: tempDir, encoding: "utf8" },
    );

    expect(JSON.parse(result)).toEqual(["R4-T1"]);
  });

  it("invalidates per-repository carry-forward when local or shared TDD tools change", async () => {
    const fixture = await writeCanonicalFixture();
    for (const repository of [tempDir, fixture.repoA]) {
      await mkdir(path.join(repository, ".easy-coding", "tools"), { recursive: true });
      await mkdir(path.join(repository, ".easy-coding", "tdd"), { recursive: true });
      await writeFile(path.join(repository, "pom.xml"), "<project/>\n");
      await writeFile(path.join(repository, ".easy-coding", "tools", "easy_coding_java_coverage.py"), "# coverage v1\n");
      await writeFile(path.join(repository, ".easy-coding", "tdd", "readiness.json"), JSON.stringify({
        build_files: [{ path: "pom.xml" }],
        tool_files: [{ path: ".easy-coding/tools/easy_coding_java_coverage.py" }],
      }));
    }
    const plan = { units: [
      { id: "U1", repo_id: "R1", files: ["order-domain/src/main/java/com/example/order/OrderEventPublisher.java"] },
      { id: "U2", repo_id: "R2", files: ["notification-app/src/main/java/com/example/notification/OrderEventConsumer.java"] },
    ] };
    const task = { spec_source: {}, tdd_enabled: true, repo_paths: { R1: fixture.repoA, R2: fixture.repoB } };
    const script = [
      "import json,pathlib,sys",
      `sys.path.insert(0, ${JSON.stringify(path.dirname(stateApiPath()))})`,
      "import easy_coding_state as state",
      "state.latest_execution_plan = lambda root, task_id: json.loads(sys.argv[1])",
      "print(json.dumps(state.canonical_repository_fingerprints(pathlib.Path.cwd(), 'task', json.loads(sys.argv[2]))))",
    ].join("\n");
    const fingerprints = () => JSON.parse(execFileSync(pythonCmd, ["-B", "-c", script, JSON.stringify(plan), JSON.stringify(task)], {
      cwd: tempDir, encoding: "utf8",
    }));
    const initial = fingerprints();
    await appendFile(path.join(fixture.repoB, plan.units[1].files[0]), "// repair R2\n");
    const repaired = fingerprints();
    expect(repaired.R1).toBe(initial.R1);
    expect(repaired.R2).not.toBe(initial.R2);
    await appendFile(path.join(fixture.repoA, ".easy-coding", "tools", "easy_coding_java_coverage.py"), "# local upgrade\n");
    const localToolChanged = fingerprints();
    expect(localToolChanged.R1).not.toBe(repaired.R1);
    expect(localToolChanged.R2).toBe(repaired.R2);
    await appendFile(path.join(tempDir, ".easy-coding", "tools", "easy_coding_java_coverage.py"), "# shared upgrade\n");
    const sharedToolChanged = fingerprints();
    expect(sharedToolChanged.R1).not.toBe(localToolChanged.R1);
    expect(sharedToolChanged.R2).not.toBe(localToolChanged.R2);
  });

  it("requires source-traceable units and blocks MEMORY while integration evidence is pending", async () => {
    const fixture = await writeCanonicalFixture();
    initializeSpecExecution(fixture.specPath);
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
      created.task.spec_source.design_sha256,
      created.task.spec_source.document_sha256,
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
        local_baseline: [
          "order-domain/src/main/java/com/example/order/OrderEventPublisher.java follows the local publisher style",
        ],
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
        local_baseline: [
          "notification-app/src/main/java/com/example/notification/OrderEventConsumer.java follows the local consumer style",
        ],
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
        local_baseline: [
          "order-api/src/main/java/com/example/order/api/DeliveryStatusController.java follows the local controller style",
        ],
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
    task.status = "QUALITY";
    task.workflow_mode = "fast";
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
            quality_attempt: fingerprints.quality_attempt.attempt,
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
            quality_attempt: fingerprints.quality_attempt.attempt,
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
        quality_attempt: fingerprints.quality_attempt.attempt,
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
        quality_attempt: fingerprints.quality_attempt.attempt,
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
    strictTask.quality_attempt = undefined;
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
              quality_attempt: strictFingerprints.quality_attempt.attempt,
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
            quality_attempt: strictFingerprints.quality_attempt.attempt,
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
            quality_attempt: strictFingerprints.quality_attempt.attempt,
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
    expect(ready.pending_transition).toMatchObject({ from: "QUALITY", to: "MEMORY" });
  }, 40_000);

  it("stores an explicit external Spec locator and rebinds only an identical Canonical design", async () => {
    const fixture = await writeCanonicalFixture();
    const externalDir = await mkdtemp(path.join(os.tmpdir(), "ec-shared-spec-"));
    try {
      const externalSpec = path.join(externalDir, "shared.md");
      await writeFile(externalSpec, await readFile(fixture.specPath, "utf8"), "utf8");
      initializeSpecExecution(externalSpec);
      const inspected = JSON.parse(
        runState(["inspect-dev-spec", "--spec", externalSpec]),
      );
      expect(inspected).toMatchObject({ status: "READY", execution_revision: 0 });
      const selected = JSON.parse(
        runState([
          "select-dev-spec-scope",
          "--spec",
          externalSpec,
          "--spec-task",
          "R1-T1",
        ]),
      );
      expect(selected.selected_task_ids).toEqual(["R1-T1"]);
      const created = JSON.parse(
        runState([
          "create-task-from-spec",
          "--spec",
          externalSpec,
          "--spec-task",
          "R1-T1",
          "--task-id",
          "external-spec",
          "--type",
          "feature",
          "--title",
          "External Spec",
          "--repo-path",
          `R1=${fixture.repoA}`,
          "--agent",
          "codex",
        ]),
      );
      expect(created.task.spec_source).toMatchObject({
        path: await realpath(externalSpec),
        path_mode: "absolute",
        execution_revision: 0,
      });

      const reboundSpec = path.join(externalDir, "rebound.md");
      await writeFile(reboundSpec, await readFile(externalSpec, "utf8"), "utf8");
      await rm(externalSpec);
      const rebound = JSON.parse(
        runState([
          "rebind-spec-source",
          "--spec",
          reboundSpec,
          "--task-id",
          "external-spec",
          "--agent",
          "codex",
        ]),
      );
      expect(rebound.task.spec_source).toMatchObject({
        path: await realpath(reboundSpec),
        path_mode: "absolute",
      });
      runState([
        "writeback-spec-task",
        "--task-id",
        "external-spec",
        "--spec-task",
        "R1-T1",
        "--status",
        "in_progress",
        "--summary",
        "External Spec writeback",
        "--idempotency-key",
        "external-spec:start",
        "--agent",
        "codex",
      ]);
      const written = JSON.parse(runState(["inspect-dev-spec", "--spec", reboundSpec]));
      expect(
        written.execution.tasks.find((task: { task_id: string }) => task.task_id === "R1-T1"),
      ).toMatchObject({ status: "in_progress" });

      const changed = (await readFile(reboundSpec, "utf8")).replace(
        "总目标：订单成功提交后发布事件，通知服务消费同一冻结契约。",
        "总目标：修改后的静态设计。",
      );
      const differentDir = path.join(externalDir, "different");
      await mkdir(differentDir);
      const changedSpec = path.join(differentDir, "rebound.md");
      await writeFile(changedSpec, changed, "utf8");
      const rejected = spawnSync(
        pythonCmd,
        [
          stateApiPath(),
          "rebind-spec-source",
          "--spec",
          changedSpec,
          "--task-id",
          "external-spec",
          "--agent",
          "codex",
          "--cwd",
          tempDir,
        ],
        { cwd: tempDir, encoding: "utf8" },
      );
      expect(rejected.status).toBe(1);
      expect(rejected.stderr).toContain("execution.design_sha256");
    } finally {
      await rm(externalDir, { recursive: true, force: true });
    }
  });

  it.each(["auto", "guard"])("requires loaded context before recording MEMORY acceptance in %s mode", async (approvalMode) => {
    const fixture = await writeCanonicalFixture();
    initializeSpecExecution(fixture.specPath);
    runState([
      "create-task-from-spec",
      "--spec",
      fixture.specPath,
      "--spec-task",
      "R1-T1",
      "--task-id",
      "accepted-memory-boundary",
      "--type",
      "feature",
      "--title",
      "Accepted memory boundary",
      "--repo-path",
      `R1=${fixture.repoA}`,
      "--agent",
      "codex",
    ]);
    await writeFile(
      path.join(tempDir, ".easy-coding", "config.yaml"),
      `version: 3\nbehavior:\n  approval_mode: ${approvalMode}\n  workflow_mode: adaptive\n`,
      "utf8",
    );
    const taskDir = path.join(
      tempDir,
      ".easy-coding",
      "tasks",
      "accepted-memory-boundary",
    );
    const executionPath = path.join(taskDir, "execution.jsonl");
    const unit = {
      id: "U1",
      title: "Publish event",
      type: "backend",
      files: ["order-domain/src/main/java/com/example/order/OrderEventPublisher.java"],
      depends_on: [],
      acceptance_criteria: ["event publisher is available"],
      test_points: ["publisher contract test"],
      contracts: ["C1"],
      risks: ["none"],
      local_baseline: [
        "order-domain/src/main/java/com/example/order/OrderEventPublisher.java follows the local publisher style",
      ],
      repo_id: "R1",
      source_task_id: "R1-T1",
      source_step_ids: ["S1"],
      symbols: ["OrderEventPublisher#publish"],
      test_commands: ["mvn -Dtest=OrderEventPublisherTest test"],
    };
    await writeFile(
      executionPath,
      `${JSON.stringify({ type: "plan", strategy: "single", units: [unit] })}\n`,
      "utf8",
    );
    runState([
      "writeback-spec-task",
      "--spec-task",
      "R1-T1",
      "--status",
      "in_progress",
      "--summary",
      "Implementation started",
      "--idempotency-key",
      "accepted-memory-boundary:start",
      "--agent",
      "codex",
    ]);
    runState([
      "writeback-spec-step",
      "--spec-task",
      "R1-T1",
      "--step",
      "S1",
      "--status",
      "completed",
      "--summary",
      "Publisher test passed",
      "--evidence",
      JSON.stringify({
        kind: "test",
        status: "passed",
        ref: "execution.jsonl#verify",
        test_id: "T1",
      }),
      "--idempotency-key",
      "accepted-memory-boundary:step:S1",
      "--agent",
      "codex",
    ]);
    runState([
      "writeback-spec-task",
      "--spec-task",
      "R1-T1",
      "--status",
      "implemented",
      "--summary",
      "Implementation and local checks completed",
      "--idempotency-key",
      "accepted-memory-boundary:implemented",
      "--agent",
      "codex",
    ]);

    const beforeBoundary = JSON.parse(
      runState(["inspect-dev-spec", "--spec", fixture.specPath]),
    );
    expect(
      beforeBoundary.execution.tasks.find(
        (task: { task_id: string }) => task.task_id === "R1-T1",
      ),
    ).toMatchObject({ status: "implemented" });

    const taskPath = path.join(taskDir, "task.json");
    const task = JSON.parse(await readFile(taskPath, "utf8"));
    task.status = "QUALITY";
    task.workflow_mode = "fast";
    task.tdd_enabled = false;
    task.tdd_coverage_threshold = 90;
    task.stage_history.push({
      stage: "QUALITY",
      agent: "codex",
      entered_at: "2026-08-13T00:00:00Z",
    });
    await writeFile(taskPath, JSON.stringify(task, null, 2), "utf8");
    const fingerprints = JSON.parse(
      runState(["evidence-fingerprints", "--agent", "codex"]),
    );
    await appendFile(
      executionPath,
      `${[
        {
          type: "dispatch",
          unit_id: "U1",
          timestamp: "2026-08-13T00:00:00Z",
          repo_id: "R1",
          source_task_id: "R1-T1",
        },
        {
          type: "result",
          unit_id: "U1",
          status: "completed",
          changed_files: unit.files,
          summary: "Publisher completed",
          issues: [],
          needs_attention: [],
          repo_id: "R1",
          source_task_id: "R1-T1",
        },
        {
          type: "review",
          dimension: "combined",
          passed: true,
          implementation_fingerprint: fingerprints.implementation_fingerprint,
          quality_attempt: fingerprints.quality_attempt.attempt,
          reviewer: "codex-reviewer",
          timestamp: "2026-08-13T00:01:00Z",
          findings: [],
          repo_id: "R1",
          source_task_id: "R1-T1",
        },
        {
          type: "verify",
          check: "publisher-test",
          check_type: "test",
          command: "mvn -Dtest=OrderEventPublisherTest test",
          passed: true,
          implementation_fingerprint: fingerprints.implementation_fingerprint,
          config_fingerprint: fingerprints.config_fingerprint,
          quality_attempt: fingerprints.quality_attempt.attempt,
          timestamp: "2026-08-13T00:02:00Z",
          repo_id: "R1",
          source_task_id: "R1-T1",
        },
      ]
        .map((record) => JSON.stringify(record))
        .join("\n")}\n`,
      "utf8",
    );

    if (approvalMode === "guard") {
      runState(["request-transition", "--stage", "MEMORY", "--agent", "codex"]);
    }
    const transitionCommand = approvalMode === "auto" ? "auto-transition" : "confirm-transition";
    const unloaded = JSON.parse(await readFile(taskPath, "utf8"));
    const sessionFile = unloaded.spec_context.session_file;
    delete unloaded.spec_context;
    await writeFile(taskPath, JSON.stringify(unloaded, null, 2));
    const protectedFiles = [taskPath, executionPath, fixture.specPath];
    const beforeRejected = await Promise.all(protectedFiles.map((file) => readFile(file, "utf8")));
    const rejected = spawnSync(pythonCmd, ["-B", stateApiPath(), transitionCommand,
      "--stage", "MEMORY", "--agent", "codex", "--cwd", tempDir],
    { cwd: tempDir, encoding: "utf8" });
    expect(rejected.status).toBe(1);
    expect(rejected.stderr).toContain("resume-spec-context");
    const directCall = approvalMode === "auto"
      ? "state.auto_transition(root, 'MEMORY', 'codex', task_id, session_file)"
      : "state.confirm_transition(root, 'codex', 'MEMORY', task_id, session_file)";
    const direct = spawnSync(pythonCmd, ["-B", "-c", [
      "import sys",
      "from pathlib import Path",
      `sys.path.insert(0, ${JSON.stringify(path.dirname(stateApiPath()))})`,
      "import easy_coding_state as state",
      `root = Path(${JSON.stringify(tempDir)})`,
      "task_id = 'accepted-memory-boundary'",
      `session_file = ${JSON.stringify(sessionFile)}`,
      "calls = [",
      ` lambda: ${directCall},`,
      " lambda: state.record_verification_checkpoint(root, 'codex', task_id, session_file),",
      " lambda: state.finalize_quality_decision(root, 'passed', 'passed', 'passed', [], 'QUALITY passed', 'codex', task_id, session_file),",
      "]",
      "for call in calls:",
      " try:",
      "  call()",
      " except state.StateError as error:",
      "  assert 'resume-spec-context' in str(error), str(error)",
      " else:",
      "  raise AssertionError('Unloaded context allowed acceptance side effects')",
    ].join("\n")], { cwd: tempDir, encoding: "utf8" });
    expect(direct.status, direct.stderr).toBe(0);
    expect(await Promise.all(protectedFiles.map((file) => readFile(file, "utf8")))).toEqual(beforeRejected);
    runState(["resume-spec-context", "--agent", "codex"]);
    const transitioned = JSON.parse(runState([transitionCommand, "--stage", "MEMORY", "--agent", "codex"]));
    expect(transitioned.status).toBe("MEMORY");
    const afterBoundary = JSON.parse(
      runState(["inspect-dev-spec", "--spec", fixture.specPath]),
    );
    const canonicalTask = afterBoundary.execution.tasks.find(
      (item: { task_id: string }) => item.task_id === "R1-T1",
    );
    expect(canonicalTask).toMatchObject({ status: "verified" });
    expect(canonicalTask.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "acceptance",
          status: "recorded",
          sha256: expect.any(String),
        }),
      ]),
    );
  });

  it("writes the complete shared task lifecycle idempotently without changing the design digest", async () => {
    const fixture = await writeCanonicalFixture();
    initializeSpecExecution(fixture.specPath);
    const initial = JSON.parse(runState(["inspect-dev-spec", "--spec", fixture.specPath]));
    runState([
      "create-task-from-spec",
      "--spec",
      fixture.specPath,
      "--spec-task",
      "R1-T1",
      "--task-id",
      "shared-lifecycle",
      "--type",
      "feature",
      "--title",
      "Shared lifecycle",
      "--repo-path",
      `R1=${fixture.repoA}`,
      "--agent",
      "codex",
    ]);
    const lifecycleTaskDir = path.join(
      tempDir,
      ".easy-coding",
      "tasks",
      "shared-lifecycle",
    );
    await writeFile(
      path.join(lifecycleTaskDir, "execution.jsonl"),
      `${JSON.stringify({
        type: "plan",
        strategy: "single",
        units: [
          {
            id: "U1",
            title: "Publish event",
            type: "backend",
            files: ["order-domain/src/main/java/com/example/order/OrderEventPublisher.java"],
            depends_on: [],
            repo_id: "R1",
            source_task_id: "R1-T1",
            source_step_ids: ["S1"],
            symbols: ["OrderEventPublisher#publish"],
            test_commands: ["mvn -Dtest=OrderEventPublisherTest test"],
          },
        ],
      })}\n`,
      "utf8",
    );
    const fingerprintBeforeWriteback = JSON.parse(
      runState(["evidence-fingerprints", "--task-id", "shared-lifecycle", "--agent", "codex"]),
    ).implementation_fingerprint;
    const writeTask = (status: string, key: string, evidence: string[] = []) =>
      runState([
        "writeback-spec-task",
        "--spec-task",
        "R1-T1",
        "--status",
        status,
        "--summary",
        `Shared status ${status}`,
        ...evidence.flatMap((value) => ["--evidence", value]),
        "--idempotency-key",
        key,
        "--agent",
        "codex",
      ]);
    writeTask("in_progress", "shared-lifecycle:start");
    runState([
      "writeback-spec-step",
      "--spec-task",
      "R1-T1",
      "--step",
      "S1",
      "--status",
      "completed",
      "--summary",
      "Step S1 tests passed",
      "--evidence",
      JSON.stringify({ kind: "test", status: "passed", ref: "execution.jsonl#U1", test_id: "T1" }),
      "--idempotency-key",
      "shared-lifecycle:step:S1",
      "--agent",
      "codex",
    ]);
    writeTask("implemented", "shared-lifecycle:implemented");
    writeTask("verified", "shared-lifecycle:verified");
    writeTask("completed", "shared-lifecycle:completed");
    writeTask("completed", "shared-lifecycle:completed");

    const updated = JSON.parse(runState(["inspect-dev-spec", "--spec", fixture.specPath]));
    expect(updated.design_sha256).toBe(initial.design_sha256);
    expect(updated.document_sha256).not.toBe(initial.document_sha256);
    expect(updated.execution_revision).toBe(5);
    const fingerprintAfterWriteback = JSON.parse(
      runState(["evidence-fingerprints", "--task-id", "shared-lifecycle", "--agent", "codex"]),
    ).implementation_fingerprint;
    expect(fingerprintAfterWriteback).toBe(fingerprintBeforeWriteback);
    expect(updated.execution.tasks.find((task: { task_id: string }) => task.task_id === "R1-T1"))
      .toMatchObject({ status: "completed", completed_step_ids: ["S1"] });
    const records = (await readFile(
      path.join(tempDir, ".easy-coding", "tasks", "shared-lifecycle", "execution.jsonl"),
      "utf8",
    ))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(
      records.filter(
        (record) =>
          record.type === "spec-writeback" &&
          record.idempotency_key === "shared-lifecycle:completed",
      ),
    ).toHaveLength(1);
    const moduleRoot = path.dirname(stateApiPath());
    const executionEvents = JSON.parse(
      execFileSync(
        pythonCmd,
        [
          "-c",
          [
            "import json, sys",
            "sys.path.insert(0, sys.argv[1])",
            "from easy_dev_spec_execution import show_execution",
            "print(json.dumps(show_execution(sys.argv[2])['execution']['events']))",
          ].join("\n"),
          moduleRoot,
          fixture.specPath,
        ],
        { cwd: tempDir, encoding: "utf8" },
      ),
    ) as Array<{ app: string; agent: string }>;
    expect(executionEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ app: "easy-coding", agent: "Codex with Easy Coding" }),
      ]),
    );

    await rm(lifecycleTaskDir, { recursive: true, force: true });
    const downstream = JSON.parse(
      runState([
        "create-task-from-spec",
        "--spec",
        fixture.specPath,
        "--spec-task",
        "R1-T2",
        "--task-id",
        "shared-dependency-consumer",
        "--type",
        "feature",
        "--title",
        "Shared dependency consumer",
        "--repo-path",
        `R1=${fixture.repoA}`,
        "--agent",
        "codex",
        "--no-set-current",
      ]),
    );
    expect(
      downstream.task.spec_dependency_evidence.find(
        (record: { source_task_id: string; task_id: string }) =>
          record.source_task_id === "R1-T2" && record.task_id === "R1-T1",
      ),
    ).toMatchObject({
      status: "satisfied",
      shared_status: "pending",
      dependency_task_status: "completed",
      basis: "dependency-task-completed",
    });
  }, 15_000);

  it("allows only one bundled writer to commit from the same execution revision", async () => {
    const fixture = await writeCanonicalFixture();
    initializeSpecExecution(fixture.specPath);
    const moduleRoot = path.dirname(stateApiPath());
    const result = JSON.parse(
      execFileSync(
        pythonCmd,
        [
          "-c",
          [
            "import json, sys",
            "from concurrent.futures import ThreadPoolExecutor",
            "sys.path.insert(0, sys.argv[1])",
            "from easy_dev_spec_execution import ExecutionConflictError, record_task_status, show_execution",
            "spec_path = sys.argv[2]",
            "details = show_execution(spec_path)",
            "def write(index):",
            "    try:",
            "        record_task_status(spec_path, 'R1-T1', 'in_progress', f'writer {index}', 'easy-coding', f'writer-{index}', details['design_sha256'], 0, run_id=f'run-{index}', idempotency_key=f'concurrent-{index}')",
            "        return 'ok'",
            "    except ExecutionConflictError:",
            "        return 'conflict'",
            "with ThreadPoolExecutor(max_workers=2) as pool:",
            "    outcomes = list(pool.map(write, [1, 2]))",
            "after = show_execution(spec_path)['execution']",
            "print(json.dumps({'outcomes': sorted(outcomes), 'revision': after['execution_revision'], 'events': len(after['events'])}))",
          ].join("\n"),
          moduleRoot,
          fixture.specPath,
        ],
        { cwd: tempDir, encoding: "utf8" },
      ),
    );
    expect(result).toEqual({ outcomes: ["conflict", "ok"], revision: 1, events: 1 });
  }, 20_000);

  it("projects a failed Step as blocked and refuses implemented until a new attempt", async () => {
    const fixture = await writeCanonicalFixture();
    initializeSpecExecution(fixture.specPath);
    runState([
      "create-task-from-spec",
      "--spec",
      fixture.specPath,
      "--spec-task",
      "R1-T1",
      "--task-id",
      "failed-step",
      "--type",
      "bugfix",
      "--title",
      "Failed step",
      "--repo-path",
      `R1=${fixture.repoA}`,
      "--agent",
      "codex",
    ]);
    runState([
      "writeback-spec-task",
      "--spec-task",
      "R1-T1",
      "--status",
      "in_progress",
      "--summary",
      "Implementation started",
      "--idempotency-key",
      "failed-step:start",
      "--agent",
      "codex",
    ]);
    runState([
      "writeback-spec-step",
      "--spec-task",
      "R1-T1",
      "--step",
      "S1",
      "--status",
      "failed",
      "--summary",
      "Targeted test failed",
      "--evidence",
      JSON.stringify({ kind: "result", status: "failed", ref: "execution.jsonl#U1" }),
      "--idempotency-key",
      "failed-step:S1",
      "--agent",
      "codex",
    ]);
    const blocked = JSON.parse(runState(["inspect-dev-spec", "--spec", fixture.specPath]));
    expect(
      blocked.execution.tasks.find((task: { task_id: string }) => task.task_id === "R1-T1"),
    ).toMatchObject({ status: "blocked", failed_step_ids: ["S1"] });
    const rejected = spawnSync(
      pythonCmd,
      [
        stateApiPath(),
        "writeback-spec-task",
        "--task-id",
        "failed-step",
        "--spec-task",
        "R1-T1",
        "--status",
        "implemented",
        "--summary",
        "Must not bypass the failed Step",
        "--idempotency-key",
        "failed-step:invalid-implemented",
        "--agent",
        "codex",
        "--cwd",
        tempDir,
      ],
      { cwd: tempDir, encoding: "utf8" },
    );
    expect(rejected.status).toBe(1);
    expect(rejected.stderr).toContain("blocked -> implemented");
    const failedTaskPath = path.join(
      tempDir,
      ".easy-coding",
      "tasks",
      "failed-step",
      "task.json",
    );
    const afterRejectedWrite = JSON.parse(await readFile(failedTaskPath, "utf8"));
    expect(afterRejectedWrite.spec_writeback_progress).toMatchObject({ status: "error" });
    expect(afterRejectedWrite.spec_writeback_progress.pending_action).toBeUndefined();
    runState([
      "writeback-spec-task",
      "--task-id",
      "failed-step",
      "--spec-task",
      "R1-T1",
      "--status",
      "in_progress",
      "--summary",
      "Start corrected repair attempt",
      "--idempotency-key",
      "failed-step:repair",
      "--agent",
      "codex",
    ]);
    const repaired = JSON.parse(runState(["inspect-dev-spec", "--spec", fixture.specPath]));
    expect(
      repaired.execution.tasks.find((task: { task_id: string }) => task.task_id === "R1-T1"),
    ).toMatchObject({ status: "in_progress" });
  }, 20_000);

  it("refuses to overwrite a different pending shared writeback action", async () => {
    const fixture = await writeCanonicalFixture();
    initializeSpecExecution(fixture.specPath);
    runState([
      "create-task-from-spec",
      "--spec",
      fixture.specPath,
      "--spec-task",
      "R1-T1",
      "--task-id",
      "pending-writeback",
      "--type",
      "feature",
      "--title",
      "Pending writeback",
      "--repo-path",
      `R1=${fixture.repoA}`,
      "--agent",
      "codex",
    ]);
    const taskPath = path.join(
      tempDir,
      ".easy-coding",
      "tasks",
      "pending-writeback",
      "task.json",
    );
    const task = JSON.parse(await readFile(taskPath, "utf8"));
    const pendingAction = {
      kind: "task",
      source_task_id: "R1-T1",
      status: "in_progress",
      summary: "Interrupted start",
      evidence: [],
      idempotency_key: "pending-writeback:interrupted",
      agent: "codex",
    };
    task.spec_writeback_progress.pending_action = JSON.stringify(pendingAction, Object.keys(pendingAction).sort());
    task.spec_writeback_progress.status = "pending";
    await writeFile(taskPath, JSON.stringify(task, null, 2), "utf8");

    const rejected = spawnSync(
      pythonCmd,
      [
        stateApiPath(),
        "writeback-spec-task",
        "--task-id",
        "pending-writeback",
        "--spec-task",
        "R1-T1",
        "--status",
        "blocked",
        "--summary",
        "Different action",
        "--idempotency-key",
        "pending-writeback:different",
        "--agent",
        "codex",
        "--cwd",
        tempDir,
      ],
      { cwd: tempDir, encoding: "utf8" },
    );
    expect(rejected.status).toBe(1);
    expect(rejected.stderr).toContain("different Canonical Spec writeback is pending");
    const preserved = JSON.parse(await readFile(taskPath, "utf8"));
    expect(JSON.parse(preserved.spec_writeback_progress.pending_action)).toEqual(pendingAction);
  }, 20_000);

  it("clears an obsolete pending writeback so a revised design can synchronize", async () => {
    const fixture = await writeCanonicalFixture();
    initializeSpecExecution(fixture.specPath);
    runState([
      "create-task-from-spec",
      "--spec",
      fixture.specPath,
      "--spec-task",
      "R1-T1",
      "--task-id",
      "obsolete-pending",
      "--type",
      "feature",
      "--title",
      "Obsolete pending",
      "--repo-path",
      `R1=${fixture.repoA}`,
      "--agent",
      "codex",
    ]);
    const taskPath = path.join(
      tempDir,
      ".easy-coding",
      "tasks",
      "obsolete-pending",
      "task.json",
    );
    const task = JSON.parse(await readFile(taskPath, "utf8"));
    task.spec_writeback_progress.pending_action = JSON.stringify({
      kind: "task",
      source_task_id: "R1-T1",
      status: "in_progress",
      summary: "Interrupted old-design start",
      evidence: [],
      idempotency_key: "obsolete-pending:start",
      agent: "codex",
    });
    task.spec_writeback_progress.status = "pending";
    await writeFile(taskPath, JSON.stringify(task, null, 2), "utf8");
    const revised = (await readFile(fixture.specPath, "utf8"))
      .replace('"revision": 1', '"revision": 2')
      .replace(
        "总目标：订单成功提交后发布事件，通知服务消费同一冻结契约。",
        "总目标：订单成功提交后按新设计发布可靠事件。",
      );
    await writeFile(fixture.specPath, revised, "utf8");

    const reconciliation = spawnSync(
      pythonCmd,
      [
        stateApiPath(),
        "reconcile-spec-execution",
        "--task-id",
        "obsolete-pending",
        "--agent",
        "codex",
        "--cwd",
        tempDir,
      ],
      { cwd: tempDir, encoding: "utf8" },
    );
    expect(reconciliation.status).toBe(1);
    expect(reconciliation.stderr).toContain("obsolete design");
    const unlocked = JSON.parse(await readFile(taskPath, "utf8"));
    expect(unlocked.spec_writeback_progress).toMatchObject({ status: "error" });
    expect(unlocked.spec_writeback_progress.pending_action).toBeUndefined();

    const synchronized = JSON.parse(
      runState([
        "sync-spec-design",
        "--affected-task",
        "R1-T1",
        "--summary",
        "Synchronize revised design after discarding stale progress",
        "--idempotency-key",
        "obsolete-pending:revision:2",
        "--agent",
        "codex",
      ]),
    );
    expect(synchronized.task.spec_source).toMatchObject({ revision: 2, execution_revision: 1 });
  }, 20_000);

  it("clears a terminal idempotency-key conflict instead of retaining an unreplayable action", async () => {
    const fixture = await writeCanonicalFixture();
    initializeSpecExecution(fixture.specPath);
    runState([
      "create-task-from-spec",
      "--spec",
      fixture.specPath,
      "--spec-task",
      "R1-T1",
      "--task-id",
      "idempotency-conflict",
      "--type",
      "feature",
      "--title",
      "Idempotency conflict",
      "--repo-path",
      `R1=${fixture.repoA}`,
      "--agent",
      "codex",
    ]);
    const taskPath = path.join(
      tempDir,
      ".easy-coding",
      "tasks",
      "idempotency-conflict",
      "task.json",
    );
    const firstWrite = [
      "writeback-spec-task",
      "--task-id",
      "idempotency-conflict",
      "--spec-task",
      "R1-T1",
      "--status",
      "in_progress",
      "--summary",
      "First payload",
      "--idempotency-key",
      "idempotency-conflict:shared-key",
      "--agent",
      "codex",
    ];
    runState(firstWrite);
    const rejected = spawnSync(
      pythonCmd,
      [
        stateApiPath(),
        "writeback-spec-task",
        "--task-id",
        "idempotency-conflict",
        "--spec-task",
        "R1-T1",
        "--status",
        "in_progress",
        "--summary",
        "Second payload",
        "--idempotency-key",
        "idempotency-conflict:shared-key",
        "--agent",
        "codex",
        "--cwd",
        tempDir,
      ],
      { cwd: tempDir, encoding: "utf8" },
    );
    expect(rejected.status).toBe(1);
    expect(rejected.stderr).toContain("CAS retry failed");
    const unlocked = JSON.parse(await readFile(taskPath, "utf8"));
    expect(unlocked.spec_writeback_progress).toMatchObject({ status: "error" });
    expect(unlocked.spec_writeback_progress.pending_action).toBeUndefined();
  }, 20_000);

  it("reopens only blocked source tasks during a multi-source repair", async () => {
    const fixture = await writeCanonicalFixture();
    initializeSpecExecution(fixture.specPath);
    runState([
      "create-task-from-spec",
      "--spec",
      fixture.specPath,
      "--spec-task",
      "R1-T1",
      "--spec-task",
      "R2-T1",
      "--task-id",
      "scoped-repair",
      "--type",
      "bugfix",
      "--title",
      "Scoped repair",
      "--repo-path",
      `R1=${fixture.repoA}`,
      "--repo-path",
      `R2=${fixture.repoB}`,
      "--agent",
      "codex",
    ]);
    for (const sourceTask of ["R1-T1", "R2-T1"]) {
      runState([
        "writeback-spec-task",
        "--spec-task",
        sourceTask,
        "--status",
        "in_progress",
        "--summary",
        `Started ${sourceTask}`,
        "--idempotency-key",
        `scoped-repair:${sourceTask}:start`,
        "--agent",
        "codex",
      ]);
    }
    runState([
      "writeback-spec-step",
      "--spec-task",
      "R1-T1",
      "--step",
      "S1",
      "--status",
      "failed",
      "--summary",
      "R1 review failure",
      "--evidence",
      JSON.stringify({ kind: "review", status: "failed", ref: "execution.jsonl#R1" }),
      "--idempotency-key",
      "scoped-repair:R1-T1:failed",
      "--agent",
      "codex",
    ]);
    runState([
      "writeback-spec-step",
      "--spec-task",
      "R2-T1",
      "--step",
      "S2",
      "--status",
      "completed",
      "--summary",
      "R2 implementation complete",
      "--evidence",
      JSON.stringify({ kind: "test", status: "passed", ref: "local", test_id: "T2" }),
      "--idempotency-key",
      "scoped-repair:R2-T1:S2",
      "--agent",
      "codex",
    ]);
    runState([
      "writeback-spec-task",
      "--spec-task",
      "R2-T1",
      "--status",
      "blocked",
      "--summary",
      "R2 has an unrelated blocker",
      "--idempotency-key",
      "scoped-repair:R2-T1:blocked",
      "--agent",
      "codex",
    ]);
    const moduleRoot = path.dirname(stateApiPath());
    execFileSync(
      pythonCmd,
      [
        "-c",
        [
          "import pathlib, sys",
          `sys.path.insert(0, ${JSON.stringify(moduleRoot)})`,
          "import easy_coding_state as state",
          `root = pathlib.Path(${JSON.stringify(tempDir)})`,
          "task = state.load_task(root, 'scoped-repair')",
          "state.writeback_ready_tasks_for_implement(root, 'scoped-repair', task, 'codex', {'blocked'}, {'R1-T1'})",
        ].join("; "),
      ],
      { cwd: tempDir },
    );
    const inspection = JSON.parse(runState(["inspect-dev-spec", "--spec", fixture.specPath]));
    expect(
      inspection.execution.tasks.find(
        (task: { task_id: string }) => task.task_id === "R1-T1",
      ),
    ).toMatchObject({ status: "in_progress" });
    expect(
      inspection.execution.tasks.find(
        (task: { task_id: string }) => task.task_id === "R2-T1",
      ),
    ).toMatchObject({ status: "blocked" });
  }, 25_000);

  it("projects a Canonical QUALITY failure before reopening only its source task", async () => {
    const fixture = await writeCanonicalFixture();
    initializeSpecExecution(fixture.specPath);
    runState([
      "create-task-from-spec",
      "--spec",
      fixture.specPath,
      "--spec-task",
      "R1-T1",
      "--spec-task",
      "R2-T1",
      "--task-id",
      "quality-repair-projection",
      "--type",
      "bugfix",
      "--title",
      "Quality repair projection",
      "--repo-path",
      `R1=${fixture.repoA}`,
      "--repo-path",
      `R2=${fixture.repoB}`,
      "--agent",
      "codex",
    ]);

    const completeSourceTask = (sourceTask: string, step: string, testId: string) => {
      runState([
        "writeback-spec-task",
        "--spec-task",
        sourceTask,
        "--status",
        "in_progress",
        "--summary",
        `Started ${sourceTask}`,
        "--idempotency-key",
        `quality-repair-projection:${sourceTask}:start`,
        "--agent",
        "codex",
      ]);
      runState([
        "writeback-spec-step",
        "--spec-task",
        sourceTask,
        "--step",
        step,
        "--status",
        "completed",
        "--summary",
        `Completed ${sourceTask}`,
        "--evidence",
        JSON.stringify({
          kind: "test",
          status: "passed",
          ref: `execution.jsonl#${sourceTask}`,
          test_id: testId,
        }),
        "--idempotency-key",
        `quality-repair-projection:${sourceTask}:${step}`,
        "--agent",
        "codex",
      ]);
      runState([
        "writeback-spec-task",
        "--spec-task",
        sourceTask,
        "--status",
        "implemented",
        "--summary",
        `Implemented ${sourceTask}`,
        "--idempotency-key",
        `quality-repair-projection:${sourceTask}:implemented`,
        "--agent",
        "codex",
      ]);
    };
    completeSourceTask("R1-T1", "S1", "T1");
    completeSourceTask("R2-T1", "S2", "T2");
    runState([
      "writeback-spec-task",
      "--spec-task",
      "R2-T1",
      "--status",
      "blocked",
      "--summary",
      "Independent external blocker",
      "--idempotency-key",
      "quality-repair-projection:R2-T1:external-blocker",
      "--agent",
      "codex",
    ]);

    const taskDir = path.join(
      tempDir,
      ".easy-coding",
      "tasks",
      "quality-repair-projection",
    );
    const units = [
      {
        id: "U1",
        title: "Publish event",
        type: "backend",
        files: ["order-domain/src/main/java/com/example/order/OrderEventPublisher.java"],
        depends_on: [],
        repo_id: "R1",
        source_task_id: "R1-T1",
        source_step_ids: ["S1"],
        symbols: ["OrderEventPublisher#publish"],
        test_commands: ["mvn -Dtest=OrderEventPublisherTest test"],
      },
      {
        id: "U2",
        title: "Consume event",
        type: "backend",
        files: [
          "notification-app/src/main/java/com/example/notification/OrderEventConsumer.java",
        ],
        depends_on: [],
        repo_id: "R2",
        source_task_id: "R2-T1",
        source_step_ids: ["S2"],
        symbols: ["OrderEventConsumer#onMessage"],
        test_commands: ["mvn -Dtest=OrderEventConsumerTest test"],
      },
    ];
    await writeFile(
      path.join(taskDir, "execution.jsonl"),
      `${JSON.stringify({ type: "plan", strategy: "sequential", units })}\n`,
      "utf8",
    );
    const taskPath = path.join(taskDir, "task.json");
    const task = JSON.parse(await readFile(taskPath, "utf8"));
    task.status = "QUALITY";
    task.workflow_mode = "strict";
    task.tdd_enabled = false;
    await writeFile(taskPath, JSON.stringify(task, null, 2), "utf8");
    const fingerprints = JSON.parse(
      runState([
        "evidence-fingerprints",
        "--task-id",
        "quality-repair-projection",
        "--agent",
        "codex",
      ]),
    );
    await appendFile(
      path.join(taskDir, "execution.jsonl"),
      `${JSON.stringify({
        type: "review",
        dimension: "correctness",
        passed: false,
        implementation_fingerprint: fingerprints.implementation_fingerprint,
        quality_attempt: fingerprints.quality_attempt.attempt,
        failure_classes: ["code-defect"],
        reviewer: "codex-reviewer",
        timestamp: "2026-08-19T00:00:00Z",
        findings: [
          {
            severity: "error",
            file: "order-domain/src/main/java/com/example/order/OrderEventPublisher.java",
            line: 1,
            issue: "Repair the publisher contract",
          },
        ],
        source_task_id: "R1-T1",
        repo_id: "R1",
      })}\n`,
      "utf8",
    );
    await appendFile(
      path.join(taskDir, "execution.jsonl"),
      `${[
        ...units.flatMap((unit) => [
          {
            type: "dispatch",
            unit_id: unit.id,
            timestamp: "2026-08-19T00:01:00Z",
            repo_id: unit.repo_id,
            source_task_id: unit.source_task_id,
          },
          {
            type: "result",
            unit_id: unit.id,
            status: "completed",
            changed_files: unit.files,
            summary: `${unit.id} repair completed`,
            issues: [],
            needs_attention: [],
            repo_id: unit.repo_id,
            source_task_id: unit.source_task_id,
          },
        ]),
        ...["correctness", "compliance"].map((dimension) => ({
          type: "review",
          dimension,
          passed: true,
          implementation_fingerprint: fingerprints.implementation_fingerprint,
          quality_attempt: fingerprints.quality_attempt.attempt,
          reviewer: `${dimension}-reviewer`,
          timestamp: "2026-08-19T00:00:10Z",
          findings: [],
          source_task_id: "R2-T1",
          repo_id: "R2",
        })),
        ...["lint", "typecheck", "test", "build"].map((checkType) => ({
          type: "verify",
          check: `r2-${checkType}`,
          check_type: checkType,
          command:
            checkType === "test"
              ? "mvn -Dtest=OrderEventConsumerTest test"
              : `npm run ${checkType}`,
          passed: true,
          implementation_fingerprint: fingerprints.implementation_fingerprint,
          config_fingerprint: fingerprints.config_fingerprint,
          quality_attempt: fingerprints.quality_attempt.attempt,
          timestamp: "2026-08-19T00:00:20Z",
          source_task_id: "R2-T1",
          repo_id: "R2",
        })),
      ]
        .map((record) => JSON.stringify(record))
        .join("\n")}\n`,
      "utf8",
    );

    runState([
      "finalize-quality",
      "--task-id",
      "quality-repair-projection",
      "--outcome",
      "repair",
      "--review-gate",
      "failed",
      "--verification-gate",
      "cancelled",
      "--failure-class",
      "code-defect",
      "--summary",
      "Correctness review requires a localized repair",
      "--agent",
      "codex",
    ]);

    const unprojected = spawnSync(
      pythonCmd,
      [
        stateApiPath(),
        "auto-transition",
        "--stage",
        "IMPLEMENT",
        "--task-id",
        "quality-repair-projection",
        "--agent",
        "codex",
        "--cwd",
        tempDir,
      ],
      { cwd: tempDir, encoding: "utf8" },
    );
    expect(unprojected.status).toBe(1);
    expect(unprojected.stderr).toContain(
      "must write affected source tasks blocked before returning to IMPLEMENT",
    );

    runState([
      "writeback-spec-task",
      "--task-id",
      "quality-repair-projection",
      "--spec-task",
      "R1-T1",
      "--status",
      "blocked",
      "--summary",
      "Unrelated external block",
      "--idempotency-key",
      "external-run:R1-T1:blocked",
      "--agent",
      "codex",
    ]);
    const unrelatedBlock = spawnSync(
      pythonCmd,
      [
        stateApiPath(),
        "auto-transition",
        "--stage",
        "IMPLEMENT",
        "--task-id",
        "quality-repair-projection",
        "--agent",
        "codex",
        "--cwd",
        tempDir,
      ],
      { cwd: tempDir, encoding: "utf8" },
    );
    expect(unrelatedBlock.status).toBe(1);
    expect(unrelatedBlock.stderr).toContain(
      "must belong to the current Harness task and QUALITY attempt",
    );
    runState([
      "writeback-spec-task",
      "--task-id",
      "quality-repair-projection",
      "--spec-task",
      "R1-T1",
      "--status",
      "in_progress",
      "--summary",
      "Resume after unrelated block",
      "--idempotency-key",
      "external-run:R1-T1:resume",
      "--agent",
      "codex",
    ]);
    runState([
      "writeback-spec-task",
      "--task-id",
      "quality-repair-projection",
      "--spec-task",
      "R1-T1",
      "--status",
      "implemented",
      "--summary",
      "Restore implemented projection",
      "--idempotency-key",
      "external-run:R1-T1:implemented",
      "--agent",
      "codex",
    ]);

    runState([
      "writeback-spec-task",
      "--task-id",
      "quality-repair-projection",
      "--spec-task",
      "R1-T1",
      "--status",
      "blocked",
      "--summary",
      "Current correctness review failed",
      "--evidence",
      JSON.stringify({
        kind: "review",
        status: "failed",
        ref: `execution.jsonl#quality-attempt=${fingerprints.quality_attempt.attempt};implementation=${fingerprints.implementation_fingerprint};source-task=R1-T1;kind=review`,
      }),
      "--idempotency-key",
      `quality-repair-projection:R1-T1:${fingerprints.implementation_fingerprint}:quality-${fingerprints.quality_attempt.attempt}:blocked`,
      "--agent",
      "codex",
    ]);
    runState([
      "set-approval-mode",
      "--mode",
      "approve",
      "--agent",
      "codex",
    ]);
    expect(
      JSON.parse(
        runState([
          "request-transition",
          "--stage",
          "IMPLEMENT",
          "--task-id",
          "quality-repair-projection",
          "--agent",
          "codex",
        ]),
      ).pending_transition,
    ).toMatchObject({
      quality_attempt: fingerprints.quality_attempt.attempt,
      implementation_fingerprint: fingerprints.implementation_fingerprint,
      source_task_ids: ["R1-T1"],
    });
    await writeFile(
      path.join(
        fixture.repoA,
        "order-domain/src/main/java/com/example/order/OrderEventPublisher.java",
      ),
      "package com.example.order;\npublic interface OrderEventPublisher { void changed(); }\n",
      "utf8",
    );
    expect(
      JSON.parse(
        runState([
          "confirm-transition",
          "--stage",
          "IMPLEMENT",
          "--task-id",
          "quality-repair-projection",
          "--agent",
          "codex",
        ]),
      ),
    ).toMatchObject({ status: "IMPLEMENT" });
    runState([
      "set-approval-mode",
      "--mode",
      "auto",
      "--agent",
      "codex",
    ]);

    const inspection = JSON.parse(runState(["inspect-dev-spec", "--spec", fixture.specPath]));
    expect(
      inspection.execution.tasks.find(
        (sourceTask: { task_id: string }) => sourceTask.task_id === "R1-T1",
      ),
    ).toMatchObject({ status: "in_progress" });
    expect(
      inspection.execution.tasks.find(
        (sourceTask: { task_id: string }) => sourceTask.task_id === "R2-T1",
      ),
    ).toMatchObject({ status: "blocked" });
    const executionEvents = JSON.parse(
      execFileSync(
        pythonCmd,
        [
          "-c",
          [
            "import json, sys",
            "sys.path.insert(0, sys.argv[1])",
            "from easy_dev_spec_execution import show_execution",
            "print(json.dumps(show_execution(sys.argv[2])['execution']['events']))",
          ].join("\n"),
          path.dirname(stateApiPath()),
          fixture.specPath,
        ],
        { cwd: tempDir, encoding: "utf8" },
      ),
    ) as Array<{ task_id?: string; type?: string; to_status?: string }>;
    expect(
      executionEvents
        .filter(
          (event) => event.type === "task_status_changed" && event.task_id === "R1-T1",
        )
        .map((event) => event.to_status),
    ).toEqual([
      "in_progress",
      "implemented",
      "blocked",
      "in_progress",
      "implemented",
      "blocked",
      "in_progress",
    ]);

    runState([
      "auto-transition",
      "--stage",
      "QUALITY",
      "--task-id",
      "quality-repair-projection",
      "--agent",
      "codex",
    ]);
    const repairedFingerprints = JSON.parse(
      runState([
        "evidence-fingerprints",
        "--task-id",
        "quality-repair-projection",
        "--agent",
        "codex",
      ]),
    );
    const carryRecords = (await readFile(path.join(taskDir, "execution.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line))
      .filter((record) => record.type === "quality-carry-forward");
    expect(carryRecords).toEqual([]);
    await appendFile(
      path.join(taskDir, "execution.jsonl"),
      `${[
        ...["correctness", "compliance"].map((dimension) => ({
          type: "review",
          dimension,
          passed: true,
          implementation_fingerprint: repairedFingerprints.implementation_fingerprint,
          quality_attempt: repairedFingerprints.quality_attempt.attempt,
          reviewer: `${dimension}-reviewer`,
          timestamp: "2026-08-19T00:01:10Z",
          findings: [],
          source_task_id: "R1-T1",
          repo_id: "R1",
        })),
        ...["correctness", "compliance"].map((dimension) => ({
          type: "review",
          dimension,
          passed: true,
          implementation_fingerprint: repairedFingerprints.implementation_fingerprint,
          quality_attempt: repairedFingerprints.quality_attempt.attempt,
          reviewer: `${dimension}-reviewer`,
          timestamp: "2026-08-19T00:01:10Z",
          findings: [],
          source_task_id: "R2-T1",
          repo_id: "R2",
        })),
        ...["lint", "typecheck", "test", "build"].map((checkType) => ({
          type: "verify",
          check: `r1-${checkType}`,
          check_type: checkType,
          command:
            checkType === "test"
              ? "mvn -Dtest=OrderEventPublisherTest test"
              : `npm run ${checkType}`,
          passed: true,
          implementation_fingerprint: repairedFingerprints.implementation_fingerprint,
          config_fingerprint: repairedFingerprints.config_fingerprint,
          quality_attempt: repairedFingerprints.quality_attempt.attempt,
          timestamp: "2026-08-19T00:01:20Z",
          source_task_id: "R1-T1",
          repo_id: "R1",
        })),
        ...["lint", "typecheck", "test", "build"].map((checkType) => ({
          type: "verify",
          check: `r2-${checkType}`,
          check_type: checkType,
          command:
            checkType === "test"
              ? "mvn -Dtest=OrderEventConsumerTest test"
              : `npm run ${checkType}`,
          passed: true,
          implementation_fingerprint: repairedFingerprints.implementation_fingerprint,
          config_fingerprint: repairedFingerprints.config_fingerprint,
          quality_attempt: repairedFingerprints.quality_attempt.attempt,
          timestamp: "2026-08-19T00:01:20Z",
          source_task_id: "R2-T1",
          repo_id: "R2",
        })),
      ]
        .map((record) => JSON.stringify(record))
        .join("\n")}\n`,
      "utf8",
    );
    expect(
      JSON.parse(
        runState([
          "quality-checkpoint",
          "--task-id",
          "quality-repair-projection",
          "--agent",
          "codex",
        ]),
      ),
    ).toHaveProperty("quality_checkpoint");
  }, 30_000);

  it("rejects Canonical QUALITY failure evidence with invalid source ownership", async () => {
    const fixture = await writeCanonicalFixture();
    initializeSpecExecution(fixture.specPath);
    runState([
      "create-task-from-spec",
      "--spec",
      fixture.specPath,
      "--spec-task",
      "R1-T1",
      "--task-id",
      "quality-invalid-ownership",
      "--type",
      "bugfix",
      "--title",
      "Invalid quality ownership",
      "--repo-path",
      `R1=${fixture.repoA}`,
      "--agent",
      "codex",
    ]);

    const taskDir = path.join(
      tempDir,
      ".easy-coding",
      "tasks",
      "quality-invalid-ownership",
    );
    await writeFile(
      path.join(taskDir, "execution.jsonl"),
      `${JSON.stringify({
        type: "plan",
        strategy: "single",
        units: [
          {
            id: "U1",
            title: "Publish event",
            type: "backend",
            files: ["order-domain/src/main/java/com/example/order/OrderEventPublisher.java"],
            depends_on: [],
            repo_id: "R1",
            source_task_id: "R1-T1",
            source_step_ids: ["S1"],
            symbols: ["OrderEventPublisher#publish"],
            test_commands: ["mvn -Dtest=OrderEventPublisherTest test"],
          },
        ],
      })}\n`,
      "utf8",
    );
    const taskPath = path.join(taskDir, "task.json");
    const task = JSON.parse(await readFile(taskPath, "utf8"));
    task.status = "QUALITY";
    task.workflow_mode = "fast";
    task.tdd_enabled = false;
    await writeFile(taskPath, JSON.stringify(task, null, 2), "utf8");

    const fingerprints = JSON.parse(
      runState([
        "evidence-fingerprints",
        "--task-id",
        "quality-invalid-ownership",
        "--agent",
        "codex",
      ]),
    );
    await appendFile(
      path.join(taskDir, "execution.jsonl"),
      `${JSON.stringify({
        type: "review",
        dimension: "correctness",
        passed: false,
        implementation_fingerprint: fingerprints.implementation_fingerprint,
        quality_attempt: fingerprints.quality_attempt.attempt,
        reviewer: "codex-reviewer",
        timestamp: "2026-08-19T00:00:00Z",
        findings: [
          {
            severity: "error",
            file: "order-domain/src/main/java/com/example/order/OrderEventPublisher.java",
            line: 1,
            issue: "Missing Canonical ownership",
          },
        ],
      })}\n`,
      "utf8",
    );

    const result = spawnSync(
      pythonCmd,
      [
        stateApiPath(),
        "auto-transition",
        "--stage",
        "IMPLEMENT",
        "--task-id",
        "quality-invalid-ownership",
        "--agent",
        "codex",
        "--cwd",
        tempDir,
      ],
      { cwd: tempDir, encoding: "utf8" },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "must preserve a valid repository/source-task/dimension ownership",
    );
  }, 20_000);

  it("resumes a partially applied multi-source Canonical repair transition", async () => {
    const fixture = await writeCanonicalFixture();
    initializeSpecExecution(fixture.specPath);
    const taskId = "quality-repair-resume";
    runState([
      "create-task-from-spec",
      "--spec",
      fixture.specPath,
      "--spec-task",
      "R1-T1",
      "--spec-task",
      "R2-T1",
      "--task-id",
      taskId,
      "--type",
      "bugfix",
      "--title",
      "Resume quality repair",
      "--repo-path",
      `R1=${fixture.repoA}`,
      "--repo-path",
      `R2=${fixture.repoB}`,
      "--agent",
      "codex",
    ]);

    for (const [sourceTask, step, testId] of [
      ["R1-T1", "S1", "T1"],
      ["R2-T1", "S2", "T2"],
    ]) {
      runState([
        "writeback-spec-task",
        "--spec-task",
        sourceTask,
        "--status",
        "in_progress",
        "--summary",
        `Started ${sourceTask}`,
        "--idempotency-key",
        `${taskId}:${sourceTask}:start`,
        "--agent",
        "codex",
      ]);
      runState([
        "writeback-spec-step",
        "--spec-task",
        sourceTask,
        "--step",
        step,
        "--status",
        "completed",
        "--summary",
        `Completed ${sourceTask}`,
        "--evidence",
        JSON.stringify({ kind: "test", status: "passed", ref: "local", test_id: testId }),
        "--idempotency-key",
        `${taskId}:${sourceTask}:${step}`,
        "--agent",
        "codex",
      ]);
      runState([
        "writeback-spec-task",
        "--spec-task",
        sourceTask,
        "--status",
        "implemented",
        "--summary",
        `Implemented ${sourceTask}`,
        "--idempotency-key",
        `${taskId}:${sourceTask}:implemented`,
        "--agent",
        "codex",
      ]);
    }

    const taskDir = path.join(tempDir, ".easy-coding", "tasks", taskId);
    const executionPath = path.join(taskDir, "execution.jsonl");
    await writeFile(
      executionPath,
      `${JSON.stringify({
        type: "plan",
        strategy: "sequential",
        units: [
          {
            id: "U1",
            title: "Publish event",
            type: "backend",
            files: ["order-domain/src/main/java/com/example/order/OrderEventPublisher.java"],
            depends_on: [],
            repo_id: "R1",
            source_task_id: "R1-T1",
            source_step_ids: ["S1"],
            symbols: ["OrderEventPublisher#publish"],
            test_commands: ["mvn -Dtest=OrderEventPublisherTest test"],
          },
          {
            id: "U2",
            title: "Consume event",
            type: "backend",
            files: [
              "notification-app/src/main/java/com/example/notification/OrderEventConsumer.java",
            ],
            depends_on: [],
            repo_id: "R2",
            source_task_id: "R2-T1",
            source_step_ids: ["S2"],
            symbols: ["OrderEventConsumer#onMessage"],
            test_commands: ["mvn -Dtest=OrderEventConsumerTest test"],
          },
        ],
      })}\n`,
      "utf8",
    );
    const taskPath = path.join(taskDir, "task.json");
    const task = JSON.parse(await readFile(taskPath, "utf8"));
    task.status = "QUALITY";
    task.workflow_mode = "standard";
    task.tdd_enabled = false;
    await writeFile(taskPath, JSON.stringify(task, null, 2), "utf8");
    const fingerprints = JSON.parse(
      runState(["evidence-fingerprints", "--task-id", taskId, "--agent", "codex"]),
    );
    for (const [sourceTask, repoId, file] of [
      [
        "R1-T1",
        "R1",
        "order-domain/src/main/java/com/example/order/OrderEventPublisher.java",
      ],
      [
        "R2-T1",
        "R2",
        "notification-app/src/main/java/com/example/notification/OrderEventConsumer.java",
      ],
    ]) {
      await appendFile(
        executionPath,
        `${JSON.stringify({
          type: "review",
          dimension: "correctness",
          passed: false,
          implementation_fingerprint: fingerprints.implementation_fingerprint,
          quality_attempt: fingerprints.quality_attempt.attempt,
          failure_classes: ["code-defect"],
          reviewer: "codex-reviewer",
          timestamp: "2026-08-19T00:00:00Z",
          findings: [
            {
              severity: "error",
              file,
              line: 1,
              issue: `Repair ${sourceTask}`,
            },
          ],
          source_task_id: sourceTask,
          repo_id: repoId,
        })}\n`,
        "utf8",
      );
    }

    runState([
      "finalize-quality",
      "--task-id",
      taskId,
      "--outcome",
      "repair",
      "--review-gate",
      "failed",
      "--verification-gate",
      "cancelled",
      "--failure-class",
      "code-defect",
      "--summary",
      "Both source tasks require correctness repairs",
      "--agent",
      "codex",
    ]);

    const unprojected = spawnSync(
      pythonCmd,
      [
        stateApiPath(),
        "auto-transition",
        "--stage",
        "IMPLEMENT",
        "--task-id",
        taskId,
        "--agent",
        "codex",
        "--cwd",
        tempDir,
      ],
      { cwd: tempDir, encoding: "utf8" },
    );
    expect(unprojected.status).toBe(1);
    for (const sourceTask of ["R1-T1", "R2-T1"]) {
      runState([
        "writeback-spec-task",
        "--task-id",
        taskId,
        "--spec-task",
        sourceTask,
        "--status",
        "blocked",
        "--summary",
        `Quality failed for ${sourceTask}`,
        "--evidence",
        JSON.stringify({
          kind: "review",
          status: "failed",
          ref: `execution.jsonl#quality-attempt=${fingerprints.quality_attempt.attempt};implementation=${fingerprints.implementation_fingerprint};source-task=${sourceTask};kind=review`,
        }),
        "--idempotency-key",
        `${taskId}:${sourceTask}:${fingerprints.implementation_fingerprint}:quality-${fingerprints.quality_attempt.attempt}:blocked`,
        "--agent",
        "codex",
      ]);
    }

    const moduleRoot = path.dirname(stateApiPath());
    const failedApply = execFileSync(
      pythonCmd,
      [
        "-c",
        [
          "import pathlib, sys",
          "sys.path.insert(0, sys.argv[1])",
          "import easy_coding_state as state",
          "root = pathlib.Path(sys.argv[2])",
          "original = state._execute_spec_writeback",
          "def flaky(root, harness_task_id, task, action, key, invoke):",
          "    if action.get('source_task_id') == 'R2-T1' and action.get('status') == 'in_progress':",
          "        raise state.StateError('injected second source failure')",
          "    return original(root, harness_task_id, task, action, key, invoke)",
          "state._execute_spec_writeback = flaky",
          "try:",
          `    session_file = state.load_task(root, ${JSON.stringify(taskId)})['spec_context']['session_file']`,
          `    state.apply_transition(root, 'IMPLEMENT', 'codex', ${JSON.stringify(taskId)}, session_file)`,
          "except state.StateError as error:",
          "    print(str(error))",
          "else:",
          "    raise RuntimeError('expected injected failure')",
        ].join("\n"),
        moduleRoot,
        tempDir,
      ],
      { cwd: tempDir, encoding: "utf8" },
    );
    expect(failedApply).toContain("injected second source failure");
    expect(JSON.parse(await readFile(taskPath, "utf8"))).toMatchObject({
      status: "QUALITY",
      canonical_repair_transition: {
        source_task_ids: ["R1-T1", "R2-T1"],
      },
    });
    let inspection = JSON.parse(runState(["inspect-dev-spec", "--spec", fixture.specPath]));
    expect(
      inspection.execution.tasks.find(
        (sourceTask: { task_id: string }) => sourceTask.task_id === "R1-T1",
      ),
    ).toMatchObject({ status: "in_progress" });
    expect(
      inspection.execution.tasks.find(
        (sourceTask: { task_id: string }) => sourceTask.task_id === "R2-T1",
      ),
    ).toMatchObject({ status: "blocked" });

    const driftPath = path.join(
      fixture.repoA,
      "order-domain/src/main/java/com/example/order/OrderEventPublisher.java",
    );
    const originalCandidate = await readFile(driftPath, "utf8");
    await writeFile(driftPath, `${originalCandidate}// concurrent drift\n`, "utf8");
    expect(
      JSON.parse(
        runState([
          "auto-transition",
          "--stage",
          "IMPLEMENT",
          "--task-id",
          taskId,
          "--agent",
          "codex",
        ]),
      ),
    ).toMatchObject({ status: "IMPLEMENT" });
    expect(JSON.parse(await readFile(taskPath, "utf8"))).not.toHaveProperty(
      "canonical_repair_transition",
    );
    inspection = JSON.parse(runState(["inspect-dev-spec", "--spec", fixture.specPath]));
    for (const sourceTask of ["R1-T1", "R2-T1"]) {
      expect(
        inspection.execution.tasks.find(
          (candidate: { task_id: string }) => candidate.task_id === sourceTask,
        ),
      ).toMatchObject({ status: "in_progress" });
    }
  }, 40_000);

  it.each(["normal", "pending-change", "unloaded-context"])("checks context before reconciling local results: %s", async (mode) => {
    const fixture = await writeCanonicalFixture();
    initializeSpecExecution(fixture.specPath);
    runState([
      "create-task-from-spec",
      "--spec",
      fixture.specPath,
      "--spec-task",
      "R1-T1",
      "--task-id",
      "result-reconcile",
      "--type",
      "feature",
      "--title",
      "Result reconcile",
      "--repo-path",
      `R1=${fixture.repoA}`,
      "--agent",
      "codex",
    ]);
    runState([
      "writeback-spec-task",
      "--spec-task",
      "R1-T1",
      "--status",
      "in_progress",
      "--summary",
      "Implementation started before the local result",
      "--idempotency-key",
      "result-reconcile:start",
      "--agent",
      "codex",
    ]);
    const taskDir = path.join(tempDir, ".easy-coding", "tasks", "result-reconcile");
    const unit = {
      id: "U1",
      title: "Publish event",
      type: "backend",
      files: ["order-domain/src/main/java/com/example/order/OrderEventPublisher.java"],
      depends_on: [],
      repo_id: "R1",
      source_task_id: "R1-T1",
      source_step_ids: ["S1"],
      symbols: ["OrderEventPublisher#publish"],
      test_commands: ["mvn -Dtest=OrderEventPublisherTest test"],
    };
    await appendFile(
      path.join(taskDir, "execution.jsonl"),
      [
        JSON.stringify({ type: "plan", strategy: "single", units: [unit] }),
        JSON.stringify({
          type: "dispatch",
          unit_id: "U1",
          repo_id: "R1",
          source_task_id: "R1-T1",
        }),
        JSON.stringify({
          type: "result",
          unit_id: "U1",
          status: "completed",
          changed_files: unit.files,
          summary: "Implemented and tested",
          checks: [
            { command: "mvn -Dtest=OrderEventPublisherTest test", passed: true, failures: [] },
          ],
          issues: [],
          needs_attention: [],
          repo_id: "R1",
          source_task_id: "R1-T1",
        }),
        "",
      ].join("\n"),
      "utf8",
    );
    if (mode !== "normal") {
      const taskPath = path.join(taskDir, "task.json");
      const before = JSON.parse(await readFile(taskPath, "utf8"));
      const sessionFile = before.spec_context.session_file;
      if (mode === "pending-change") {
        runState(["begin-spec-change", "--task-id", "result-reconcile", "--affected-task", "R1-T1",
          "--summary", "Confirmed change before result writeback", "--agent", "codex"]);
      } else {
        delete before.spec_context;
        await writeFile(taskPath, JSON.stringify(before, null, 2));
      }
      const paths = [taskPath, path.join(taskDir, "execution.jsonl"), fixture.specPath];
      const expectedFiles = await Promise.all(paths.map((file) => readFile(file, "utf8")));
      const expectedError = mode === "pending-change" ? "Confirmed Spec change is pending" : "resume-spec-context";
      const blocked = spawnSync(pythonCmd, ["-B", stateApiPath(), "reconcile-spec-execution",
        "--task-id", "result-reconcile", "--agent", "codex", "--cwd", tempDir],
      { cwd: tempDir, encoding: "utf8" });
      expect(blocked.status).toBe(1);
      expect(blocked.stderr).toContain(expectedError);
      const direct = spawnSync(pythonCmd, ["-B", "-c", [
        "import sys",
        "from pathlib import Path",
        `sys.path.insert(0, ${JSON.stringify(path.dirname(stateApiPath()))})`,
        "import easy_coding_state as state",
        `root = Path(${JSON.stringify(tempDir)})`,
        `session_file = ${JSON.stringify(sessionFile)}`,
        "calls = [",
        " lambda: state.writeback_spec_task(root, 'R1-T1', 'in_progress', 'Premature progress', [], 'blocked:task', 'codex', 'result-reconcile', session_file),",
        " lambda: state.writeback_spec_step(root, 'R1-T1', 'S1', 'completed', 'Premature result', [{'kind':'test','status':'passed','ref':'report','test_id':'T1'}], 'blocked:step', 'codex', 'result-reconcile', session_file),",
        "]",
        "for call in calls:",
        " try:",
        "  call()",
        " except state.StateError as error:",
        `  assert ${JSON.stringify(expectedError)} in str(error), str(error)`,
        " else:",
        "  raise AssertionError('Pending or unloaded context allowed shared progress')",
      ].join("\n")], { cwd: tempDir, encoding: "utf8" });
      expect(direct.status, direct.stderr).toBe(0);
      expect(await Promise.all(paths.map((file) => readFile(file, "utf8")))).toEqual(expectedFiles);
      return;
    }
    const reconciled = JSON.parse(
      runState([
        "reconcile-spec-execution",
        "--task-id",
        "result-reconcile",
        "--agent",
        "codex",
      ]),
    );
    expect(reconciled).toMatchObject({
      reconciled: true,
      reconciled_actions: 2,
      unresolved_local_evidence: [],
    });
    const inspection = JSON.parse(runState(["inspect-dev-spec", "--spec", fixture.specPath]));
    expect(
      inspection.execution.tasks.find((task: { task_id: string }) => task.task_id === "R1-T1"),
    ).toMatchObject({ status: "implemented", completed_step_ids: ["S1"] });
    const repeated = JSON.parse(
      runState([
        "reconcile-spec-execution",
        "--task-id",
        "result-reconcile",
        "--agent",
        "codex",
      ]),
    );
    expect(repeated).toMatchObject({
      reconciled: false,
      reconciled_actions: 0,
      unresolved_local_evidence: ["U1:shared-task-status=implemented"],
    });
    const repeatedInspection = JSON.parse(
      runState(["inspect-dev-spec", "--spec", fixture.specPath]),
    );
    expect(repeatedInspection.execution_revision).toBe(3);
    const moduleRoot = path.dirname(stateApiPath());
    execFileSync(
      pythonCmd,
      [
        "-c",
        [
          "import pathlib, sys",
          `sys.path.insert(0, ${JSON.stringify(moduleRoot)})`,
          "import easy_coding_state as state",
          `root = pathlib.Path(${JSON.stringify(tempDir)})`,
          "task = state.load_task(root, 'result-reconcile')",
          "state.writeback_ready_tasks_for_implement(root, 'result-reconcile', task, 'codex')",
        ].join("; "),
      ],
      { cwd: tempDir },
    );
    const noFreshResult = JSON.parse(
      runState([
        "reconcile-spec-execution",
        "--task-id",
        "result-reconcile",
        "--agent",
        "codex",
      ]),
    );
    expect(noFreshResult).toMatchObject({
      reconciled: false,
      reconciled_actions: 0,
      unresolved_local_evidence: ["U1:no-result-for-current-attempt"],
    });
    const repairInspection = JSON.parse(
      runState(["inspect-dev-spec", "--spec", fixture.specPath]),
    );
    expect(repairInspection.execution_revision).toBe(4);
    expect(
      repairInspection.execution.tasks.find(
        (task: { task_id: string }) => task.task_id === "R1-T1",
      ),
    ).toMatchObject({ status: "in_progress" });

    await appendFile(
      path.join(taskDir, "execution.jsonl"),
      [
        JSON.stringify({
          type: "dispatch",
          unit_id: "U1",
          repo_id: "R1",
          source_task_id: "R1-T1",
        }),
        JSON.stringify({
          type: "result",
          unit_id: "U1",
          status: "completed",
          changed_files: unit.files,
          summary: "Completed with unresolved issues",
          checks: [
            { command: "mvn -Dtest=OrderEventPublisherTest test", passed: true, failures: [] },
          ],
          issues: ["unresolved contract mismatch"],
          needs_attention: [],
          repo_id: "R1",
          source_task_id: "R1-T1",
        }),
        "",
      ].join("\n"),
      "utf8",
    );
    const malformed = JSON.parse(
      runState([
        "reconcile-spec-execution",
        "--task-id",
        "result-reconcile",
        "--agent",
        "codex",
      ]),
    );
    expect(malformed).toMatchObject({
      reconciled: false,
      reconciled_actions: 0,
      unresolved_local_evidence: ["U1:invalid-result-status-or-issues"],
    });
    const afterMalformed = JSON.parse(
      runState(["inspect-dev-spec", "--spec", fixture.specPath]),
    );
    expect(afterMalformed.execution_revision).toBe(4);
  }, 20_000);

  it("rejects an execution revision rollback while preserving the static design binding", async () => {
    const fixture = await writeCanonicalFixture();
    initializeSpecExecution(fixture.specPath);
    const initialized = await readFile(fixture.specPath, "utf8");
    runState([
      "create-task-from-spec",
      "--spec",
      fixture.specPath,
      "--spec-task",
      "R1-T1",
      "--task-id",
      "rollback-guard",
      "--type",
      "feature",
      "--title",
      "Rollback guard",
      "--repo-path",
      `R1=${fixture.repoA}`,
      "--agent",
      "codex",
    ]);
    runState([
      "writeback-spec-task",
      "--spec-task",
      "R1-T1",
      "--status",
      "in_progress",
      "--summary",
      "Started",
      "--idempotency-key",
      "rollback-guard:start",
      "--agent",
      "codex",
    ]);
    await writeFile(fixture.specPath, initialized, "utf8");
    const result = spawnSync(
      pythonCmd,
      [
        stateApiPath(),
        "reconcile-spec-execution",
        "--task-id",
        "rollback-guard",
        "--agent",
        "codex",
        "--cwd",
        tempDir,
      ],
      { cwd: tempDir, encoding: "utf8" },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("execution revision moved backwards");
  }, 20_000);

  it("migrates a legacy whole-document digest after the execution ledger is initialized", async () => {
    const fixture = await writeCanonicalFixture();
    initializeSpecExecution(fixture.specPath);
    runState([
      "create-task-from-spec",
      "--spec",
      fixture.specPath,
      "--spec-task",
      "R1-T1",
      "--task-id",
      "legacy-digest",
      "--type",
      "feature",
      "--title",
      "Legacy digest",
      "--repo-path",
      `R1=${fixture.repoA}`,
      "--agent",
      "codex",
    ]);
    const taskPath = path.join(
      tempDir,
      ".easy-coding",
      "tasks",
      "legacy-digest",
      "task.json",
    );
    const task = JSON.parse(await readFile(taskPath, "utf8"));
    const document = await readFile(fixture.specPath, "utf8");
    const designText = `${document.split("<!-- EDS:EXECUTION:BEGIN -->", 1)[0].trimEnd()}\n`;
    task.spec_source.sha256 = createHash("sha256").update(designText).digest("hex");
    delete task.spec_source.path_mode;
    delete task.spec_source.design_sha256;
    delete task.spec_source.document_sha256;
    delete task.spec_source.execution_revision;
    await writeFile(taskPath, JSON.stringify(task, null, 2), "utf8");

    runState([
      "reconcile-spec-execution",
      "--task-id",
      "legacy-digest",
      "--agent",
      "codex",
    ]);
    const migrated = JSON.parse(await readFile(taskPath, "utf8"));
    expect(migrated.spec_source).toMatchObject({
      path_mode: "project-relative",
      design_sha256: expect.any(String),
      document_sha256: expect.any(String),
      execution_revision: 0,
    });
    expect(migrated.spec_source.sha256).toBeUndefined();
  }, 20_000);

  it("uses a new automatic in-progress event when an implemented task enters a repair attempt", async () => {
    const fixture = await writeCanonicalFixture();
    initializeSpecExecution(fixture.specPath);
    runState([
      "create-task-from-spec",
      "--spec",
      fixture.specPath,
      "--spec-task",
      "R1-T1",
      "--task-id",
      "repair-attempt",
      "--type",
      "feature",
      "--title",
      "Repair attempt",
      "--repo-path",
      `R1=${fixture.repoA}`,
      "--agent",
      "codex",
    ]);
    runState([
      "writeback-spec-task",
      "--spec-task",
      "R1-T1",
      "--status",
      "in_progress",
      "--summary",
      "Initial implementation",
      "--idempotency-key",
      "repair-attempt:initial",
      "--agent",
      "codex",
    ]);
    runState([
      "writeback-spec-step",
      "--spec-task",
      "R1-T1",
      "--step",
      "S1",
      "--status",
      "completed",
      "--summary",
      "Initial step complete",
      "--evidence",
      JSON.stringify({ kind: "test", status: "passed", ref: "local", test_id: "T1" }),
      "--idempotency-key",
      "repair-attempt:step",
      "--agent",
      "codex",
    ]);
    runState([
      "writeback-spec-task",
      "--spec-task",
      "R1-T1",
      "--status",
      "implemented",
      "--summary",
      "Initial implementation complete",
      "--idempotency-key",
      "repair-attempt:implemented",
      "--agent",
      "codex",
    ]);
    const taskPath = path.join(
      tempDir,
      ".easy-coding",
      "tasks",
      "repair-attempt",
      "task.json",
    );
    const task = JSON.parse(await readFile(taskPath, "utf8"));
    task.stage_history.push({ stage: "IMPLEMENT", agent: "codex", entered_at: "2026-08-11" });
    await writeFile(taskPath, JSON.stringify(task, null, 2), "utf8");
    const moduleRoot = path.dirname(stateApiPath());
    execFileSync(
      pythonCmd,
      [
        "-c",
        [
          "import pathlib, sys",
          `sys.path.insert(0, ${JSON.stringify(moduleRoot)})`,
          "import easy_coding_state as state",
          `root = pathlib.Path(${JSON.stringify(tempDir)})`,
          "task = state.load_task(root, 'repair-attempt')",
          "state.writeback_ready_tasks_for_implement(root, 'repair-attempt', task, 'codex')",
        ].join("; "),
      ],
      { cwd: tempDir },
    );
    const inspection = JSON.parse(runState(["inspect-dev-spec", "--spec", fixture.specPath]));
    expect(
      inspection.execution.tasks.find((item: { task_id: string }) => item.task_id === "R1-T1"),
    ).toMatchObject({ status: "in_progress" });
    const records = (await readFile(
      path.join(tempDir, ".easy-coding", "tasks", "repair-attempt", "execution.jsonl"),
      "utf8",
    ))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(
      records.some(
        (record) =>
          record.type === "spec-writeback" &&
          record.idempotency_key === "repair-attempt:R1-T1:enter-implement:1:attempt-2",
      ),
    ).toBe(true);
    const unit = {
      id: "U1",
      title: "Repair event publishing",
      type: "backend",
      files: ["order-domain/src/main/java/com/example/order/OrderEventPublisher.java"],
      depends_on: [],
      repo_id: "R1",
      source_task_id: "R1-T1",
      source_step_ids: ["S1"],
      symbols: ["OrderEventPublisher#publish"],
      test_commands: ["mvn -Dtest=OrderEventPublisherTest test"],
    };
    await appendFile(
      path.join(tempDir, ".easy-coding", "tasks", "repair-attempt", "execution.jsonl"),
      [
        JSON.stringify({ type: "plan", strategy: "single", units: [unit] }),
        JSON.stringify({
          type: "dispatch",
          unit_id: "U1",
          repo_id: "R1",
          source_task_id: "R1-T1",
        }),
        JSON.stringify({
          type: "result",
          unit_id: "U1",
          status: "completed",
          changed_files: unit.files,
          summary: "Repair completed",
          checks: [
            { command: "mvn -Dtest=OrderEventPublisherTest test", passed: true, failures: [] },
          ],
          issues: [],
          needs_attention: [],
          repo_id: "R1",
          source_task_id: "R1-T1",
        }),
        "",
      ].join("\n"),
      "utf8",
    );
    runState([
      "reconcile-spec-execution",
      "--task-id",
      "repair-attempt",
      "--agent",
      "codex",
    ]);
    const repaired = JSON.parse(runState(["inspect-dev-spec", "--spec", fixture.specPath]));
    expect(
      repaired.execution.tasks.find((item: { task_id: string }) => item.task_id === "R1-T1"),
    ).toMatchObject({ status: "implemented" });
    const repairedRecords = (await readFile(
      path.join(tempDir, ".easy-coding", "tasks", "repair-attempt", "execution.jsonl"),
      "utf8",
    ))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(
      repairedRecords.filter(
        (record) => record.type === "spec-writeback" && record.action?.kind === "step",
      ),
    ).toHaveLength(2);
  }, 20_000);

  it("synchronizes a confirmed static revision and resets the affected shared task closure", async () => {
    const fixture = await writeCanonicalFixture();
    initializeSpecExecution(fixture.specPath);
    runState([
      "create-task-from-spec",
      "--spec",
      fixture.specPath,
      "--spec-task",
      "R1-T1",
      "--task-id",
      "design-sync",
      "--type",
      "feature",
      "--title",
      "Design sync",
      "--repo-path",
      `R1=${fixture.repoA}`,
      "--agent",
      "codex",
    ]);
    runState(["auto-transition", "--stage", "ANALYSIS", "--agent", "codex"]);
    const designSyncTaskDir = path.join(
      tempDir,
      ".easy-coding",
      "tasks",
      "design-sync",
    );
    await writeFile(
      path.join(designSyncTaskDir, "execution.jsonl"),
      `${JSON.stringify({
        type: "plan",
        strategy: "single",
        units: [
          {
            id: "U1",
            title: "Publish event",
            type: "backend",
            files: ["order-domain/src/main/java/com/example/order/OrderEventPublisher.java"],
            depends_on: [],
            repo_id: "R1",
            source_task_id: "R1-T1",
            source_step_ids: ["S1"],
            symbols: ["OrderEventPublisher#publish"],
            test_commands: ["mvn -Dtest=OrderEventPublisherTest test"],
          },
        ],
      })}\n`,
      "utf8",
    );
    const oldFingerprint = JSON.parse(
      runState(["evidence-fingerprints", "--task-id", "design-sync", "--agent", "codex"]),
    ).implementation_fingerprint;
    expect(oldFingerprint).toEqual(expect.any(String));
    runState([
      "writeback-spec-task",
      "--spec-task",
      "R1-T1",
      "--status",
      "in_progress",
      "--summary",
      "Started old design",
      "--idempotency-key",
      "design-sync:start",
      "--agent",
      "codex",
    ]);
    const revised = (await readFile(fixture.specPath, "utf8"))
      .replace('"revision": 1', '"revision": 2')
      .replace(
        "总目标：订单成功提交后发布事件，通知服务消费同一冻结契约。",
        "总目标：订单成功提交后可靠发布事件，通知服务消费同一冻结契约。",
      );
    await writeFile(fixture.specPath, revised, "utf8");
    const synchronized = JSON.parse(
      runState([
        "sync-spec-design",
        "--affected-task",
        "R1-T1",
        "--summary",
        "Confirmed reliability wording",
        "--idempotency-key",
        "design-sync:revision:2",
        "--agent",
        "codex",
      ]),
    );
    expect(synchronized.task.status).toBe("ANALYSIS");
    expect(synchronized.task.spec_source).toMatchObject({ revision: 2, execution_revision: 2 });
    const inspection = JSON.parse(runState(["inspect-dev-spec", "--spec", fixture.specPath]));
    expect(
      inspection.execution.tasks.find((task: { task_id: string }) => task.task_id === "R1-T1"),
    ).toMatchObject({ status: "not_started", completed_step_ids: [] });
    runState(["resume-spec-context", "--task-id", "design-sync", "--agent", "codex"]);
    const staleFingerprint = spawnSync(
      pythonCmd,
      [
        stateApiPath(),
        "evidence-fingerprints",
        "--task-id",
        "design-sync",
        "--agent",
        "codex",
        "--cwd",
        tempDir,
      ],
      { cwd: tempDir, encoding: "utf8" },
    );
    expect(staleFingerprint.status).toBe(1);
    expect(staleFingerprint.stderr).toContain("without a valid plan");
  }, 20_000);

  it("invalidates affected dependency evidence on design sync and accepts fresh revision evidence", async () => {
    const fixture = await writeCanonicalFixture();
    initializeSpecExecution(fixture.specPath);
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
      "dependency-sync",
      "--type",
      "feature",
      "--title",
      "Dependency sync",
      "--repo-path",
      `R1=${fixture.repoA}`,
      "--repo-path",
      `R2=${fixture.repoB}`,
      "--agent",
      "codex",
    ]);
    runState(["auto-transition", "--stage", "ANALYSIS", "--agent", "codex"]);
    const evidenceArgs = [
      "satisfy-spec-dependency",
      "--spec-task",
      "R2-T1",
      "--source-task",
      "R1-T2",
      "--evidence",
      "integration report 42",
      "--agent",
      "codex",
    ];
    const initiallySatisfied = JSON.parse(runState(evidenceArgs));
    expect(
      initiallySatisfied.task.spec_dependency_evidence.find(
        (record: { source_task_id: string; task_id: string }) =>
          record.source_task_id === "R1-T2" && record.task_id === "R2-T1",
      ),
    ).toMatchObject({ status: "satisfied", evidence: "integration report 42" });

    const revised = (await readFile(fixture.specPath, "utf8"))
      .replace('"revision": 1', '"revision": 2')
      .replace(
        "总目标：订单成功提交后发布事件，通知服务消费同一冻结契约。",
        "总目标：订单成功提交后按修订契约发布事件。",
      );
    await writeFile(fixture.specPath, revised, "utf8");
    const synchronized = JSON.parse(
      runState([
        "sync-spec-design",
        "--affected-task",
        "R1-T2",
        "--summary",
        "Revised integration contract",
        "--idempotency-key",
        "dependency-sync:revision:2",
        "--agent",
        "codex",
      ]),
    );
    expect(
      synchronized.task.spec_dependency_evidence.find(
        (record: { source_task_id: string; task_id: string }) =>
          record.source_task_id === "R1-T2" && record.task_id === "R2-T1",
      ),
    ).toMatchObject({ status: "pending", shared_status: "pending" });
    expect(
      synchronized.task.spec_dependency_evidence.find(
        (record: { source_task_id: string; task_id: string; evidence?: string }) =>
          record.source_task_id === "R1-T2" &&
          record.task_id === "R2-T1" &&
          record.evidence !== undefined,
      ),
    ).toBeUndefined();

    runState(["resume-spec-context", "--agent", "codex"]);
    const freshlySatisfied = JSON.parse(runState(evidenceArgs));
    expect(
      freshlySatisfied.task.spec_dependency_evidence.find(
        (record: { source_task_id: string; task_id: string }) =>
          record.source_task_id === "R1-T2" && record.task_id === "R2-T1",
      ),
    ).toMatchObject({ status: "satisfied", evidence: "integration report 42" });
  }, 30_000);

  it("preserves unaffected manual hard dependency evidence across design synchronization", async () => {
    const fixture = await writeCanonicalFixture();
    const independent = (await readFile(fixture.specPath, "utf8")).replace(
      ',\n        {"task_id": "R2-T1", "type": "integration", "required_evidence": "Consumer contract test passes before end-to-end verification"}',
      "",
    );
    await writeFile(fixture.specPath, independent);
    initializeSpecExecution(fixture.specPath);
    runState(["create-task-from-spec", "--spec", fixture.specPath, "--spec-task", "R1-T2", "--spec-task", "R2-T1",
      "--task-id", "manual-dependency-sync", "--type", "feature", "--title", "Preserve dependency evidence",
      "--repo-path", `R1=${fixture.repoA}`, "--repo-path", `R2=${fixture.repoB}`,
      "--dependency-evidence", "R1-T2->R1-T1=publisher test report 42", "--agent", "codex"]);
    runState(["begin-spec-change", "--affected-task", "R2-T1", "--summary", "Revise independent consumer", "--agent", "codex"]);
    await writeFile(fixture.specPath, (await readFile(fixture.specPath, "utf8"))
      .replace('"revision": 1', '"revision": 2')
      .replace("总目标：订单成功提交后发布事件，通知服务消费同一冻结契约。", "总目标：订单成功提交后发布事件，通知服务可靠消费同一冻结契约。"));
    const synchronized = JSON.parse(runState(["sync-spec-design", "--affected-task", "R2-T1",
      "--summary", "Revise independent consumer", "--idempotency-key", "manual-dependency-sync:2", "--agent", "codex"]));
    expect(synchronized.task).not.toHaveProperty("spec_change");
    expect(synchronized.task.spec_dependency_evidence.find((item: { source_task_id: string }) => item.source_task_id === "R1-T2"))
      .toMatchObject({ task_id: "R1-T1", status: "satisfied", evidence: "publisher test report 42" });
  });

  it.each([
    ["claude-code", "revise"], ["claude-code", "cancel"],
    ["claude-code", "cancel-before-write"], ["claude-code", "cancel-after-write"],
    ["qoder", "revise"], ["qoder", "cancel"],
    ["qoder", "cancel-before-write"], ["qoder", "cancel-after-write"],
  ])("recovers a revised hard dependency under %s before %s", async (newOwner, resolution) => {
    const fixture = await writeCanonicalFixture();
    initializeSpecExecution(fixture.specPath);
    runState(["create-task-from-spec", "--spec", fixture.specPath, "--spec-task", "R1-T2",
      "--task-id", "hard-dependency-sync", "--type", "feature", "--title", "Revise hard dependency",
      "--repo-path", `R1=${fixture.repoA}`, "--dependency-evidence", "R1-T2->R1-T1=old publisher report",
      "--agent", "codex"]);
    runState(["begin-spec-change", "--affected-task", "R1-T2", "--summary", "Revise query requirement", "--agent", "codex"]);
    const taskPath = path.join(tempDir, ".easy-coding", "tasks", "hard-dependency-sync", "task.json");
    const logPath = path.join(path.dirname(taskPath), "execution.jsonl");
    const staleTask = JSON.parse(await readFile(taskPath, "utf8"));
    const staleLog = await readFile(logPath, "utf8").catch(() => "");
    await writeFile(fixture.specPath, (await readFile(fixture.specPath, "utf8"))
      .replace('"revision": 1', '"revision": 2')
      .replace("总目标：订单成功提交后发布事件，通知服务消费同一冻结契约。", "总目标：订单成功提交后可靠发布事件，并提供投递状态查询。"));
    const synchronized = JSON.parse(runState(["sync-spec-design", "--affected-task", "R1-T2",
      "--summary", "Revise query requirement", "--idempotency-key", "hard-dependency-sync:2", "--agent", "codex"]));
    const pendingEdge = synchronized.task.spec_dependency_evidence.find((item: { task_id: string }) => item.task_id === "R1-T1");
    expect(synchronized.task.spec_source.revision).toBe(2);
    expect(synchronized.task).not.toHaveProperty("spec_change");
    expect(pendingEdge).toMatchObject({ status: "pending", shared_status: "pending" });
    expect(pendingEdge).not.toHaveProperty("evidence");

    // 模拟原稿已提交新设计、本地尚未收到同步回执时移交。
    staleTask.spec_writeback_progress = {
      ...staleTask.spec_writeback_progress,
      status: "pending",
      pending_action: JSON.stringify({ kind: "sync-design", affected_task_ids: ["R1-T2"],
        summary: "Revise query requirement", idempotency_key: "hard-dependency-sync:2", agent: "codex" }),
    };
    await writeFile(taskPath, JSON.stringify(staleTask, null, 2));
    await writeFile(logPath, staleLog);
    const claimed = JSON.parse(runState(["claim-task", "--task-id", "hard-dependency-sync", "--agent", newOwner]));
    expect(claimed.spec_context.status).toBe("blocked");
    const recovered = JSON.parse(runState(["reconcile-spec-execution", "--agent", newOwner]));
    expect(recovered.task.spec_source.revision).toBe(2);
    expect(recovered.task.last_agent).toBe(newOwner);
    expect(recovered.task).not.toHaveProperty("spec_change");
    expect(recovered.task.spec_writeback_progress).not.toHaveProperty("pending_action");
    const resumed = JSON.parse(runState(["resume-spec-context", "--agent", newOwner]));
    expect(resumed.spec_context).toMatchObject({ status: "ready", consumption: { revision: 2 } });
    for (const stage of ["IMPLEMENT", "QUALITY", "MEMORY", "COMPLETE"]) {
      const blocked = spawnSync(pythonCmd, ["-B", stateApiPath(), "request-transition", "--stage", stage,
        "--agent", newOwner, "--cwd", tempDir], { cwd: tempDir, encoding: "utf8" });
      expect(blocked.status).toBe(1);
      expect(blocked.stderr).toContain("omit hard dependencies without evidence");
    }
    if (resolution.startsWith("cancel")) {
      if (resolution !== "cancel") {
        const originalOwner = JSON.parse(runState(["claim-task", "--task-id", "hard-dependency-sync", "--agent", "codex"]));
        const interrupted = spawnSync(pythonCmd, ["-B", "-c", [
          "import sys",
          "from pathlib import Path",
          `sys.path.insert(0, ${JSON.stringify(path.dirname(stateApiPath()))})`,
          "import easy_coding_state as state",
          `root = Path(${JSON.stringify(tempDir)})`,
          `session_file = ${JSON.stringify(originalOwner.task.spec_context.session_file)}`,
          "original_writer = state.record_task_status",
          "def interrupt_writer(*args, **kwargs):",
          " if args[2] == 'cancelled':",
          ...(resolution === "cancel-after-write" ? ["  original_writer(*args, **kwargs)"] : []),
          "  raise OSError('Simulated cancellation interruption')",
          " return original_writer(*args, **kwargs)",
          "state.record_task_status = interrupt_writer",
          "try:",
          " state.close_current_task(root, 'User cancelled pending dependency', 'codex', session_file)",
          "except OSError as error:",
          " assert 'Simulated cancellation interruption' in str(error), str(error)",
          "else:",
          " raise AssertionError('Cancellation interruption was not reached')",
        ].join("\n")], { cwd: tempDir, encoding: "utf8" });
        expect(interrupted.status, interrupted.stderr).toBe(0);
        const pending = JSON.parse(await readFile(taskPath, "utf8"));
        expect(JSON.parse(pending.spec_writeback_progress.pending_action)).toMatchObject({
          kind: "task", status: "cancelled", agent: "codex", idempotency_key: "hard-dependency-sync:R1-T2:cancel",
        });
        runState(["claim-task", "--task-id", "hard-dependency-sync", "--agent", newOwner]);
        const recoveredCancel = JSON.parse(runState(["reconcile-spec-execution", "--agent", newOwner]));
        expect(recoveredCancel.task.last_agent).toBe(newOwner);
        expect(recoveredCancel.task.spec_writeback_progress).not.toHaveProperty("pending_action");
        const rawExecution = (await readFile(fixture.specPath, "utf8"))
          .split("<!-- EDS:EXECUTION:BEGIN -->")[1].split("```json")[1].split("```")[0];
        expect(JSON.parse(rawExecution).events.filter((event: { idempotency_key: string }) =>
          event.idempotency_key === "hard-dependency-sync:R1-T2:cancel"))
          .toEqual([expect.objectContaining({ agent: "Codex with Easy Coding", to_status: "cancelled" })]);
      }
      runState(["close-current", "--reason", "User cancelled while dependency evidence is pending", "--agent", newOwner]);
      expect(JSON.parse(await readFile(taskPath, "utf8"))).toMatchObject({ status: "CLOSED", last_agent: newOwner });
      const cancelled = JSON.parse(runState(["inspect-dev-spec", "--spec", fixture.specPath]));
      expect(cancelled.execution.tasks.find((item: { task_id: string }) => item.task_id === "R1-T2"))
        .toMatchObject({ status: "cancelled" });
      return;
    }
    runState(["begin-spec-change", "--affected-task", "R1-T2", "--summary", "Refine query retry requirement", "--agent", newOwner]);
    await writeFile(fixture.specPath, (await readFile(fixture.specPath, "utf8"))
      .replace('"revision": 2', '"revision": 3').replace("并提供投递状态查询。", "并提供可重试的投递状态查询。"));
    const revisedAgain = JSON.parse(runState(["sync-spec-design", "--affected-task", "R1-T2",
      "--summary", "Refine query retry requirement", "--idempotency-key", "hard-dependency-sync:3", "--agent", newOwner]));
    expect(revisedAgain.task.spec_source.revision).toBe(3);
    expect(revisedAgain.task.spec_dependency_evidence.find((item: { task_id: string }) => item.task_id === "R1-T1"))
      .toMatchObject({ status: "pending", shared_status: "pending" });
    runState(["resume-spec-context", "--agent", newOwner]);
    const satisfied = JSON.parse(runState(["satisfy-spec-dependency", "--source-task", "R1-T2", "--spec-task", "R1-T1",
      "--evidence", "new publisher report for revision 3", "--agent", newOwner]));
    expect(satisfied.task.spec_dependency_evidence.find((item: { task_id: string }) => item.task_id === "R1-T1"))
      .toMatchObject({ status: "satisfied", shared_status: "satisfied", evidence: "new publisher report for revision 3" });
    const started = JSON.parse(runState(["writeback-spec-task", "--spec-task", "R1-T2", "--status", "in_progress",
      "--summary", "Implement revised query", "--idempotency-key", "hard-dependency-sync:start:3", "--agent", newOwner]));
    expect(started.task.last_agent).toBe(newOwner);
  }, 30_000);

  it.each(["task", "step", "dependency"])("replays pending %s writeback with the original actor and current owner", async (kind) => {
    const fixture = await writeCanonicalFixture();
    initializeSpecExecution(fixture.specPath);
    runState(["create-task-from-spec", "--spec", fixture.specPath, "--spec-task", "R1-T1", "--spec-task", "R1-T2",
      "--task-id", "pending-owner", "--type", "feature", "--title", "Pending writeback owner",
      "--repo-path", `R1=${fixture.repoA}`, "--agent", "codex"]);
    if (kind === "step") {
      runState(["writeback-spec-task", "--spec-task", "R1-T1", "--status", "in_progress",
        "--summary", "Start source task", "--idempotency-key", "pending-owner:start", "--agent", "codex"]);
    }
    const taskPath = path.join(tempDir, ".easy-coding", "tasks", "pending-owner", "task.json");
    const logPath = path.join(path.dirname(taskPath), "execution.jsonl");
    const staleTask = JSON.parse(await readFile(taskPath, "utf8"));
    const staleLog = await readFile(logPath, "utf8").catch(() => "");
    const evidence = kind === "step"
      ? [{ kind: "test", status: "passed", ref: "publisher report", test_id: "T1" }]
      : kind === "dependency" ? [{ kind: "dependency", status: "passed", ref: "publisher report" }] : [];
    const status = kind === "task" ? "in_progress" : kind === "step" ? "completed" : "satisfied";
    const sourceTask = kind === "dependency" ? "R1-T2" : "R1-T1";
    const sourceOption = kind === "dependency" ? "--source-task" : "--spec-task";
    const options = kind === "step" ? ["--step", "S1"] : kind === "dependency" ? ["--dependency-task", "R1-T1"] : [];
    const key = `pending-owner:${kind}:result`;
    runState([`writeback-spec-${kind}`, sourceOption, sourceTask, ...options, "--status", status,
      "--summary", "Original writer action", ...evidence.flatMap((item) => ["--evidence", JSON.stringify(item)]),
      "--idempotency-key", key, "--agent", "codex"]);
    staleTask.spec_writeback_progress = {
      ...staleTask.spec_writeback_progress,
      status: "pending",
      pending_action: JSON.stringify({ kind, source_task_id: sourceTask, status,
        summary: "Original writer action", evidence, idempotency_key: key, agent: "codex",
        ...(kind === "step" ? { step_id: "S1" } : {}),
        ...(kind === "dependency" ? { dependency_task_id: "R1-T1" } : {}),
      }),
    };
    await writeFile(taskPath, JSON.stringify(staleTask, null, 2));
    await writeFile(logPath, staleLog);
    runState(["claim-task", "--task-id", "pending-owner", "--agent", "claude-code"]);
    const recovered = JSON.parse(runState(["reconcile-spec-execution", "--agent", "claude-code"]));
    expect(recovered.task.last_agent).toBe("claude-code");
    expect(recovered.task.spec_writeback_progress).not.toHaveProperty("pending_action");
    const rawExecution = (await readFile(fixture.specPath, "utf8"))
      .split("<!-- EDS:EXECUTION:BEGIN -->")[1].split("```json")[1].split("```")[0];
    expect(JSON.parse(rawExecution).events.filter((event: { idempotency_key: string }) => event.idempotency_key === key))
      .toEqual([expect.objectContaining({ agent: "Codex with Easy Coding" })]);
  }, 30_000);

  it.each(["claude-code", "qoder"])("reconciles an acknowledged-lost design sync under new owner %s", async (newOwner) => {
    const fixture = await writeCanonicalFixture();
    initializeSpecExecution(fixture.specPath);
    runState([
      "create-task-from-spec",
      "--spec",
      fixture.specPath,
      "--spec-task",
      "R2-T1",
      "--task-id",
      "design-sync-recovery",
      "--type",
      "feature",
      "--title",
      "Design sync recovery",
      "--repo-path",
      `R2=${fixture.repoB}`,
      "--agent",
      "codex",
    ]);
    runState(["auto-transition", "--stage", "ANALYSIS", "--agent", "codex"]);
    const taskDir = path.join(tempDir, ".easy-coding", "tasks", "design-sync-recovery");
    const taskPath = path.join(taskDir, "task.json");
    const logPath = path.join(taskDir, "execution.jsonl");
    runState(["begin-spec-change", "--affected-task", "R2-T1", "--summary", "Revised dependency contract", "--agent", "codex"]);
    const staleTask = JSON.parse(await readFile(taskPath, "utf8"));
    const staleLog = await readFile(logPath, "utf8").catch(() => "");
    const revised = (await readFile(fixture.specPath, "utf8"))
      .replace('"revision": 1', '"revision": 2')
      .replace("C1 signature is frozen in revision 1", "C1 signature and schema are frozen in revision 2")
      .replace(
        "总目标：订单成功提交后发布事件，通知服务消费同一冻结契约。",
        "总目标：订单成功提交后支持可恢复的可靠事件发布。",
      );
    await writeFile(fixture.specPath, revised, "utf8");
    const syncArgs = [
      "sync-spec-design",
      "--affected-task",
      "R2-T1",
      "--summary",
      "Recoverable design sync",
      "--idempotency-key",
      "design-sync-recovery:revision:2",
      "--agent",
      "codex",
    ];
    runState(syncArgs);

    staleTask.spec_writeback_progress.pending_action = JSON.stringify({
      kind: "sync-design",
      affected_task_ids: ["R2-T1"],
      summary: "Recoverable design sync",
      idempotency_key: "design-sync-recovery:revision:2",
      agent: "codex",
    });
    staleTask.spec_writeback_progress.status = "pending";
    await writeFile(taskPath, JSON.stringify(staleTask, null, 2), "utf8");
    await writeFile(logPath, staleLog, "utf8");

    const takeover = JSON.parse(runState(["claim-task", "--task-id", "design-sync-recovery", "--agent", newOwner]));
    expect(takeover.task.last_agent).toBe(newOwner);
    expect(takeover.spec_context.status).toBe("blocked");

    const reconciled = JSON.parse(
      runState([
        "reconcile-spec-execution",
        "--task-id",
        "design-sync-recovery",
        "--agent",
        newOwner,
      ]),
    );
    expect(reconciled).toMatchObject({ reconciled: true });
    expect(reconciled.task.last_agent).toBe(newOwner);
    expect(reconciled.task).not.toHaveProperty("spec_change");
    expect(reconciled.task.spec_dependency_evidence[0].required_evidence).toBe("C1 signature and schema are frozen in revision 2");
    expect(reconciled.task.spec_source).toMatchObject({ revision: 2, execution_revision: 1 });
    const records = (await readFile(logPath, "utf8"))
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    expect(records.filter((record) => record.type === "spec-design-sync")).toHaveLength(1);
    const executionBlock = (await readFile(fixture.specPath, "utf8"))
      .split("<!-- EDS:EXECUTION:BEGIN -->")[1].split("```json")[1].split("```")[0];
    const events = JSON.parse(executionBlock).events.filter((event: { type: string }) => event.type === "spec_revised");
    expect(events).toHaveLength(1);
    expect(events[0].agent).toBe("Codex with Easy Coding");
  }, 20_000);
});
