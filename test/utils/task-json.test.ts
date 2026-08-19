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
    expect(waiting.workflow_mode).toBe("standard");
    expect(waiting.workflow_mode_legacy).toBe(true);
    expect(waiting).not.toHaveProperty("workflow_mode_legacy_direct_edge");

    const memory = JSON.parse(await readFile(memoryPath, "utf8"));
    expect(memory.status).toBe("MEMORY");
    expect(memory.stage_history.map((entry: { stage: string }) => entry.stage)).toEqual([
      "MEMORY",
    ]);
    expect(memory.memory_progress.short_memory_written).toBe(true);
    expect(memory.memory_progress.legacy_short_memory_assumed).toBe(true);
    expect(memory.workflow_mode).toBe("standard");

    const session = JSON.parse(await readFile(sessionPath, "utf8"));
    expect(session.last_seen_stage).toBe("ANALYSIS");
  });

  it("migrates legacy owner aliases without rewriting immutable execution attribution", async () => {
    const taskPath = getTaskJsonPath(tempDir, "legacy-owner");
    const executionPath = path.join(path.dirname(taskPath), "execution.jsonl");
    await mkdir(path.dirname(taskPath), { recursive: true });
    await writeFile(
      taskPath,
      JSON.stringify({
        type: "feature",
        status: "REVIEW",
        created_at: "2026-08-14T00:00:00Z",
        created_by: "Codex with Easy Coding",
        last_agent: "Codex with Easy Coding",
        stage_history: [
          {
            stage: "REVIEW",
            agent: "/root/reviewer",
            entered_at: "2026-08-14T00:00:00Z",
          },
        ],
        pending_transition: {
          from: "REVIEW",
          to: "VERIFICATION",
          requested_at: "2026-08-14T00:01:00Z",
          requested_by: "Codex with Easy Coding",
        },
        workflow_mode: "standard",
        workflow_mode_confirmed_by: "Codex with Easy Coding",
        workflow_mode_proposal: { proposed_by: "Codex with Easy Coding" },
        workflow_mode_escalations: [{ raised_by: "Qoder with Easy Coding" }],
        tdd_enabled: false,
        tdd_confirmed_by: "Codex with Easy Coding",
        verification_checkpoint: { recorded_by: "Codex with Easy Coding" },
        memory_progress: {
          architecture_assessment: { recorded_by: "Claude with Easy Coding" },
        },
        spec_dependency_evidence: [{ satisfied_by: "Codex with Easy Coding" }],
      }),
      "utf8",
    );
    const executionRecord = `${JSON.stringify({
      type: "handoff",
      from: "Codex with Easy Coding",
      stage: "REVIEW",
      summary: "Historical audit attribution",
      timestamp: "2026-08-14T00:02:00Z",
    })}\n`;
    await writeFile(executionPath, executionRecord, "utf8");
    const sessionPath = path.join(tempDir, ".easy-coding", "sessions", "legacy-owner.json");
    await mkdir(path.dirname(sessionPath), { recursive: true });
    await writeFile(
      sessionPath,
      JSON.stringify({
        current_task: "legacy-owner",
        agent: "/root",
        last_agent: "Codex with Easy Coding",
      }),
      "utf8",
    );

    expect(await hasLegacyWorkflowState(tempDir)).toBe(true);
    expect(await migrateLegacyWorkflowState(tempDir)).toEqual({
      tasksUpdated: 1,
      sessionsUpdated: 1,
    });
    expect(await migrateLegacyWorkflowState(tempDir)).toEqual({
      tasksUpdated: 0,
      sessionsUpdated: 0,
    });
    expect(await hasLegacyWorkflowState(tempDir)).toBe(false);

    const task = JSON.parse(await readFile(taskPath, "utf8"));
    expect(task).toMatchObject({
      created_by: "codex",
      last_agent: "codex",
      workflow_mode_confirmed_by: "codex",
      tdd_confirmed_by: "codex",
    });
    expect(task.stage_history[0].agent).toBe("codex");
    expect(task.pending_transition).toBeUndefined();
    expect(task.workflow_mode_proposal.proposed_by).toBe("codex");
    expect(task.workflow_mode_escalations[0].raised_by).toBe("qoder");
    expect(task.quality_checkpoint.recorded_by).toBe("codex");
    expect(task.verification_checkpoint).toBeUndefined();
    expect(task.memory_progress.architecture_assessment.recorded_by).toBe("claude-code");
    expect(task.spec_dependency_evidence[0].satisfied_by).toBe("codex");
    expect(JSON.parse(await readFile(sessionPath, "utf8"))).toMatchObject({
      agent: "codex",
      last_agent: "codex",
    });
    expect(await readFile(executionPath, "utf8")).toBe(executionRecord);
  });

  it("removes legacy checkpoints when a quality checkpoint already exists or legacy data is invalid", async () => {
    const fixtures = [
      {
        taskId: "checkpoint-both",
        quality: { implementation_fingerprint: "current" },
        legacy: { implementation_fingerprint: "legacy" },
      },
      {
        taskId: "checkpoint-invalid",
        quality: undefined,
        legacy: null,
      },
    ];
    for (const fixture of fixtures) {
      const taskPath = getTaskJsonPath(tempDir, fixture.taskId);
      await mkdir(path.dirname(taskPath), { recursive: true });
      await writeFile(
        taskPath,
        JSON.stringify({
          type: "feature",
          status: "QUALITY",
          created_at: "2026-08-14T00:00:00Z",
          created_by: "codex",
          last_agent: "codex",
          stage_history: [],
          workflow_mode: "standard",
          tdd_enabled: false,
          quality_checkpoint: fixture.quality,
          verification_checkpoint: fixture.legacy,
        }),
        "utf8",
      );
    }

    expect(await migrateLegacyWorkflowState(tempDir)).toEqual({
      tasksUpdated: 2,
      sessionsUpdated: 0,
    });
    expect(await migrateLegacyWorkflowState(tempDir)).toEqual({
      tasksUpdated: 0,
      sessionsUpdated: 0,
    });
    expect(await hasLegacyWorkflowState(tempDir)).toBe(false);

    const both = JSON.parse(await readFile(getTaskJsonPath(tempDir, "checkpoint-both"), "utf8"));
    expect(both.quality_checkpoint).toEqual({ implementation_fingerprint: "current" });
    expect(both).not.toHaveProperty("verification_checkpoint");
    const invalid = JSON.parse(
      await readFile(getTaskJsonPath(tempDir, "checkpoint-invalid"), "utf8"),
    );
    expect(invalid).not.toHaveProperty("quality_checkpoint");
    expect(invalid).not.toHaveProperty("verification_checkpoint");
  });

  it("does not let one stale lite session downgrade a shared migrated task", async () => {
    const taskPath = getTaskJsonPath(tempDir, "shared-task");
    await mkdir(path.dirname(taskPath), { recursive: true });
    await writeFile(
      taskPath,
      JSON.stringify({
        type: "feature",
        status: "IMPLEMENT",
        created_at: "2026-07-27T00:00:00Z",
        created_by: "codex",
        last_agent: "codex",
        stage_history: [
          { stage: "IMPLEMENT", agent: "codex", entered_at: "2026-07-27T00:00:00Z" },
        ],
      }),
      "utf8",
    );
    const sessionsDir = path.join(tempDir, ".easy-coding", "sessions");
    await mkdir(sessionsDir, { recursive: true });
    await writeFile(
      path.join(sessionsDir, "active-guard.json"),
      JSON.stringify({
        current_task: "shared-task",
        agent: "codex",
        confirm_mode: "guard",
      }),
      "utf8",
    );
    await writeFile(
      path.join(sessionsDir, "stale-lite.json"),
      JSON.stringify({
        current_task: "shared-task",
        agent: "codex",
        confirm_mode: "lite",
      }),
      "utf8",
    );

    expect(await migrateLegacyWorkflowState(tempDir)).toEqual({
      tasksUpdated: 1,
      sessionsUpdated: 2,
    });

    const task = JSON.parse(await readFile(taskPath, "utf8"));
    expect(task).toMatchObject({
      workflow_mode: "standard",
      workflow_mode_confirmed_by: "upgrade-migration",
      workflow_mode_legacy: true,
    });
    expect(task).not.toHaveProperty("workflow_mode_legacy_direct_edge");
    const guardSession = JSON.parse(
      await readFile(path.join(sessionsDir, "active-guard.json"), "utf8"),
    );
    expect(guardSession).toMatchObject({
      approval_mode: "guard",
      workflow_mode: "adaptive",
      workflow_mode_legacy_alias_override: true,
    });
    expect(guardSession).not.toHaveProperty("workflow_mode_legacy_confirm_override");
  });

  it("preserves project-level legacy lite as fast for an active task", async () => {
    const configPath = path.join(tempDir, ".easy-coding", "config.yaml");
    await mkdir(path.dirname(configPath), { recursive: true });
    await writeFile(
      configPath,
      ["version: 2", "behavior:", "  confirm_mode: lite", ""].join("\n"),
      "utf8",
    );
    const taskPath = getTaskJsonPath(tempDir, "project-lite-task");
    await mkdir(path.dirname(taskPath), { recursive: true });
    await writeFile(
      taskPath,
      JSON.stringify({
        type: "feature",
        status: "IMPLEMENT",
        created_at: "2026-07-27T00:00:00Z",
        created_by: "codex",
        last_agent: "codex",
        stage_history: [
          { stage: "IMPLEMENT", agent: "codex", entered_at: "2026-07-27T00:00:00Z" },
        ],
        pending_transition: {
          from: "IMPLEMENT",
          to: "REVIEW",
          requested_at: "2026-07-27T00:01:00Z",
          requested_by: "codex",
        },
      }),
      "utf8",
    );

    expect(await migrateLegacyWorkflowState(tempDir)).toEqual({
      tasksUpdated: 1,
      sessionsUpdated: 0,
    });

    const task = JSON.parse(await readFile(taskPath, "utf8"));
    expect(task).toMatchObject({
      workflow_mode: "fast",
      workflow_mode_confirmed_by: "upgrade-migration",
      workflow_mode_legacy: true,
    });
    expect(task).not.toHaveProperty("workflow_mode_legacy_direct_edge");
    expect(task.pending_transition).toMatchObject({ from: "IMPLEMENT", to: "QUALITY" });
  });

  it("keeps a legacy non-lite session override above a project-level lite default", async () => {
    const configPath = path.join(tempDir, ".easy-coding", "config.yaml");
    await mkdir(path.dirname(configPath), { recursive: true });
    await writeFile(
      configPath,
      ["version: 2", "behavior:", "  confirm_mode: lite", ""].join("\n"),
      "utf8",
    );
    const taskPath = getTaskJsonPath(tempDir, "session-guard-task");
    await mkdir(path.dirname(taskPath), { recursive: true });
    await writeFile(
      taskPath,
      JSON.stringify({
        type: "feature",
        status: "IMPLEMENT",
        created_at: "2026-07-27T00:00:00Z",
        created_by: "codex",
        last_agent: "codex",
        stage_history: [
          { stage: "IMPLEMENT", agent: "codex", entered_at: "2026-07-27T00:00:00Z" },
        ],
      }),
      "utf8",
    );
    const sessionPath = path.join(tempDir, ".easy-coding", "sessions", "guard.json");
    await mkdir(path.dirname(sessionPath), { recursive: true });
    await writeFile(
      sessionPath,
      JSON.stringify({
        current_task: "session-guard-task",
        agent: "codex",
        confirm_mode: "guard",
      }),
      "utf8",
    );

    expect(await migrateLegacyWorkflowState(tempDir)).toEqual({
      tasksUpdated: 1,
      sessionsUpdated: 1,
    });

    const task = JSON.parse(await readFile(taskPath, "utf8"));
    expect(task).toMatchObject({
      workflow_mode: "standard",
      workflow_mode_confirmed_by: "upgrade-migration",
      workflow_mode_legacy: true,
    });
    expect(task).not.toHaveProperty("workflow_mode_legacy_direct_edge");
    const session = JSON.parse(await readFile(sessionPath, "utf8"));
    expect(session).toMatchObject({
      approval_mode: "guard",
      workflow_mode: "adaptive",
      workflow_mode_legacy_alias_override: true,
    });
    expect(session).not.toHaveProperty("confirm_mode");
    expect(session).not.toHaveProperty("workflow_mode_legacy_confirm_override");
  });

  it("migrates an explicitly pending legacy direct edge into QUALITY", async () => {
    const taskPath = getTaskJsonPath(tempDir, "pending-direct-task");
    await mkdir(path.dirname(taskPath), { recursive: true });
    await writeFile(
      taskPath,
      JSON.stringify({
        type: "feature",
        status: "IMPLEMENT",
        created_at: "2026-07-27T00:00:00Z",
        created_by: "codex",
        last_agent: "codex",
        stage_history: [
          { stage: "IMPLEMENT", agent: "codex", entered_at: "2026-07-27T00:00:00Z" },
        ],
        pending_transition: {
          from: "IMPLEMENT",
          to: "VERIFICATION",
          requested_at: "2026-07-27T00:01:00Z",
          requested_by: "codex",
        },
      }),
      "utf8",
    );

    expect(await migrateLegacyWorkflowState(tempDir)).toEqual({
      tasksUpdated: 1,
      sessionsUpdated: 0,
    });

    const task = JSON.parse(await readFile(taskPath, "utf8"));
    expect(task).toMatchObject({
      workflow_mode: "standard",
      workflow_mode_legacy: true,
    });
    expect(task.pending_transition).toMatchObject({ from: "IMPLEMENT", to: "QUALITY" });
    expect(task).not.toHaveProperty("workflow_mode_legacy_direct_edge");
  });

  it("does not downgrade a user-frozen task mode from a legacy lite session", async () => {
    const taskPath = getTaskJsonPath(tempDir, "strict-task");
    await mkdir(path.dirname(taskPath), { recursive: true });
    await writeFile(
      taskPath,
      JSON.stringify({
        type: "feature",
        status: "REVIEW",
        created_at: "2026-07-27T00:00:00Z",
        created_by: "codex",
        last_agent: "codex",
        stage_history: [
          { stage: "REVIEW", agent: "codex", entered_at: "2026-07-27T00:00:00Z" },
        ],
        workflow_mode: "strict",
        workflow_mode_confirmed_at: "2026-07-27T00:00:00Z",
        workflow_mode_confirmed_by: "codex",
        tdd_baselines: { project: "stale-custom-value" },
      }),
      "utf8",
    );
    const sessionPath = path.join(tempDir, ".easy-coding", "sessions", "legacy-lite.json");
    await mkdir(path.dirname(sessionPath), { recursive: true });
    await writeFile(
      sessionPath,
      JSON.stringify({
        current_task: "strict-task",
        created_at: "2026-07-27T00:00:00Z",
        confirm_mode: "lite",
      }),
      "utf8",
    );

    expect(await migrateLegacyWorkflowState(tempDir)).toEqual({
      tasksUpdated: 1,
      sessionsUpdated: 1,
    });

    const task = JSON.parse(await readFile(taskPath, "utf8"));
    expect(task.workflow_mode).toBe("strict");
    expect(task.workflow_mode_confirmed_by).toBe("codex");
    expect(task).not.toHaveProperty("workflow_mode_legacy");
    expect(task).not.toHaveProperty("tdd_baselines");
    expect(task).toMatchObject({
      tdd_enabled: false,
      tdd_coverage_threshold: 90,
      tdd_confirmed_by: "upgrade-migration",
    });

    const session = JSON.parse(await readFile(sessionPath, "utf8"));
    expect(session).toMatchObject({
      approval_mode: "guard",
      workflow_mode: "fast",
      workflow_mode_legacy_confirm_override: true,
    });
    expect(session).not.toHaveProperty("confirm_mode");
  });

  it("retires active read-only tasks while preserving their history and clearing sessions", async () => {
    const taskPath = getTaskJsonPath(tempDir, "legacy-report");
    await mkdir(path.dirname(taskPath), { recursive: true });
    await writeFile(
      taskPath,
      JSON.stringify({
        type: "report",
        title: "Legacy report",
        status: "VERIFICATION",
        created_at: "2026-07-27T00:00:00Z",
        created_by: "codex",
        last_agent: "codex",
        stage_history: [
          { stage: "ANALYSIS", agent: "codex", entered_at: "2026-07-27T00:00:00Z" },
          { stage: "VERIFICATION", agent: "codex", entered_at: "2026-07-27T00:01:00Z" },
        ],
        verification_checkpoint: {
          implementation_fingerprint: "fixture",
          recorded_at: "2026-07-27T00:02:00Z",
          recorded_by: "codex",
        },
      }),
      "utf8",
    );
    const sessionPath = path.join(tempDir, ".easy-coding", "sessions", "legacy-report.json");
    await mkdir(path.dirname(sessionPath), { recursive: true });
    await writeFile(
      sessionPath,
      JSON.stringify({
        current_task: "legacy-report",
        last_seen_task: "legacy-report",
        last_seen_stage: "VERIFICATION",
      }),
      "utf8",
    );

    expect(await migrateLegacyWorkflowState(tempDir)).toEqual({
      tasksUpdated: 1,
      sessionsUpdated: 1,
    });

    const task = JSON.parse(await readFile(taskPath, "utf8"));
    expect(task).toMatchObject({
      status: "CLOSED",
      closed_reason: "legacy-read-only-task-retired",
      quality_checkpoint: {
        implementation_fingerprint: "fixture",
        recorded_by: "codex",
      },
    });
    expect(task.stage_history.map((entry: { stage: string }) => entry.stage)).toEqual([
      "ANALYSIS",
      "QUALITY",
      "CLOSED",
    ]);
    expect(task).not.toHaveProperty("verification_checkpoint");
    expect(task).not.toHaveProperty("workflow_mode");
    expect(task).not.toHaveProperty("tdd_enabled");

    const session = JSON.parse(await readFile(sessionPath, "utf8"));
    expect(session).toMatchObject({
      current_task: null,
      last_seen_task: null,
      last_seen_stage: "idle",
    });
  });
});
