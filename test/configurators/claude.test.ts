import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { configureClaude } from "../../src/configurators/claude.js";
import { pathExists } from "../../src/utils/file-writer.js";
import { writeRuntimeScaffold } from "../../src/utils/runtime-scaffold.js";
import { writeProjectInitTask } from "../../src/utils/task-json.js";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "ec-claude-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("configureClaude", () => {
  it("writes Claude Code skills, hooks, agents, and CLAUDE.md", async () => {
    await configureClaude(tempDir);

    const skill = await readFile(
      path.join(tempDir, ".claude", "skills", "ec-workflow", "SKILL.md"),
      "utf8",
    );
    expect(skill).toContain("`/ec-init`");
    expect(skill).toContain("claim-task --session-file");
    expect(skill).toContain("handoff-task --session-file");
    expect(skill).toContain("Current task pointer exists");
    expect(skill).toContain("No current task pointer");
    expect(skill).not.toContain("open the target agent");
    expect(skill).not.toContain("next_agent");
    expect(skill).not.toContain("{{");

    const taskManagementSkill = await readFile(
      path.join(tempDir, ".claude", "skills", "ec-task-management", "SKILL.md"),
      "utf8",
    );
    expect(taskManagementSkill).toContain("list-tasks --agent");
    expect(taskManagementSkill).toContain("claim-task --session-file");
    expect(taskManagementSkill).toContain("previous_agent");
    expect(taskManagementSkill).toContain("take over");
    expect(taskManagementSkill).not.toContain("{{");

    const settings = await readFile(path.join(tempDir, ".claude", "settings.json"), "utf8");
    expect(settings).toContain(".claude/hooks/session-start.py");
    const settingsJson = JSON.parse(settings) as {
      hooks: Record<string, Array<{ hooks: Array<{ command: string; timeout: number }> }>>;
    };
    const sessionStartCommands = settingsJson.hooks.SessionStart.flatMap((group) =>
      group.hooks.map((hook) => hook.command),
    );
    expect(sessionStartCommands).toEqual([
      expect.stringContaining(".claude/hooks/session-start.py"),
    ]);
    const userPromptCommands = settingsJson.hooks.UserPromptSubmit.map((group) =>
      group.hooks.map((hook) => hook.command),
    );
    expect(userPromptCommands).toEqual([
      [expect.stringContaining(".claude/hooks/session-start.py")],
      [expect.stringContaining(".claude/hooks/inject-workflow-state.py")],
    ]);
    const userPromptTimeouts = settingsJson.hooks.UserPromptSubmit.map((group) =>
      group.hooks.map((hook) => hook.timeout),
    );
    expect(userPromptTimeouts).toEqual([[15000], [15000]]);

    const hook = await readFile(
      path.join(tempDir, ".claude", "hooks", "inject-workflow-state.py"),
      "utf8",
    );
    expect(hook).toContain("build_status_context");
    expect(
      await readFile(path.join(tempDir, ".claude", "hooks", "easy_coding_status.py"), "utf8"),
    ).toContain("build_status_context");
    expect(
      await readFile(path.join(tempDir, ".claude", "hooks", "easy_coding_state.py"), "utf8"),
    ).toContain("READY_LINE");

    const main = await readFile(path.join(tempDir, "CLAUDE.md"), "utf8");
    expect(main).toContain("easy-coding-harness generated");
    expect(main).toContain("single Markdown blockquote status line");
    expect(main).toContain(
      "- Ready: > **Easy Coding** · Ready · Use `ec-workflow` to start or resume a task, `ec-brainstorming` to brainstorm, or `ec-task-management` to view tasks",
    );
    expect(main).not.toContain("[ Easy Coding ] ready");
    expect(main).not.toContain("tasks``");
    expect(main).not.toContain("}```");
    expect(main).toContain("`/ec-init`");
    expect(main).toContain("`/ec-meta`");

    const verificationSkill = await readFile(
      path.join(tempDir, ".claude", "skills", "ec-verification", "SKILL.md"),
      "utf8",
    );
    expect(verificationSkill.indexOf("--stage MEMORY_SHORT")).toBeGreaterThan(-1);
    expect(verificationSkill.indexOf("--stage MEMORY_LONG")).toBeGreaterThan(
      verificationSkill.indexOf("--stage MEMORY_SHORT"),
    );
    expect(verificationSkill.indexOf("--stage COMPLETE")).toBeGreaterThan(
      verificationSkill.indexOf("--stage MEMORY_LONG"),
    );

    const metaReference = await readFile(
      path.join(
        tempDir,
        ".claude",
        "skills",
        "ec-meta",
        "references",
        "platform-files",
        "README.md",
      ),
      "utf8",
    );
    expect(metaReference).toContain("Claude Code");

    const skillDirs = [
      "ec-analysis",
      "ec-brainstorming",
      "ec-git",
      "ec-implementing",
      "ec-init",
      "ec-memory",
      "ec-meta",
      "ec-reviewing",
      "ec-task-close",
      "ec-task-management",
      "ec-verification",
      "ec-workflow",
    ];
    for (const dir of skillDirs) {
      const content = await readFile(
        path.join(tempDir, ".claude", "skills", dir, "SKILL.md"),
        "utf8",
      );
      expect(content).toContain(`name: ${dir}`);
    }
  });

  it("generated hooks find the Easy Coding root from a subdirectory", async () => {
    await configureClaude(tempDir);
    await writeRuntimeScaffold(tempDir, ["claude-code"]);
    await writeProjectInitTask(tempDir, ["claude-code"]);

    const nested = path.join(tempDir, "src", "nested");
    await mkdir(nested, { recursive: true });
    const hook = path.join(tempDir, ".claude", "hooks", "session-start.py");
    const stdout = execFileSync("python3", [hook], {
      cwd: nested,
      input: "{}",
      encoding: "utf8",
    });
    expect(stdout).toContain("> **Easy Coding** · Waiting init · Use `ec-init` to initialize");
    expect(stdout).toContain("[workflow-state:idle]");
    expect(stdout).toContain("[easy-coding:init-required]");
    expect(stdout).not.toContain("/ec-init");
    expect(stdout).not.toContain("$ec-init");
  });

  it("generated hooks show Ready when no task is loaded", async () => {
    await configureClaude(tempDir);
    await writeRuntimeScaffold(tempDir, ["claude-code"]);

    const hook = path.join(tempDir, ".claude", "hooks", "session-start.py");
    const stdout = execFileSync("python3", [hook], {
      cwd: tempDir,
      input: "{}",
      encoding: "utf8",
    });

    expect(stdout).toContain(
      "> **Easy Coding** · Ready · Use `ec-workflow` to start or resume a task, `ec-brainstorming` to brainstorm, or `ec-task-management` to view tasks",
    );
    expect(stdout).not.toContain("tasks`");
    expect(stdout).toContain("[workflow-state:idle]");
    expect(stdout).not.toContain("/ec-workflow");
    expect(stdout).not.toContain("$ec-workflow");
  });

  it("generated hooks do not infer a current task when the session is empty", async () => {
    await configureClaude(tempDir);
    await writeRuntimeScaffold(tempDir, ["claude-code"]);
    await mkdir(path.join(tempDir, ".easy-coding", "tasks", "06-12-active"), { recursive: true });
    await writeFile(
      path.join(tempDir, ".easy-coding", "tasks", "06-12-active", "task.json"),
      JSON.stringify(
        {
          type: "feature",
          title: "Active task",
          status: "ANALYSIS",
          created_at: "2026-06-12T00:00:00Z",
          created_by: "claude-code",
          last_agent: "claude-code",
          stage_history: [],
        },
        null,
        2,
      ),
      "utf8",
    );

    const hook = path.join(tempDir, ".claude", "hooks", "session-start.py");
    const stdout = execFileSync("python3", [hook], {
      cwd: tempDir,
      input: "{}",
      encoding: "utf8",
    });

    expect(stdout).toContain("> **Easy Coding** · Ready · Use `ec-workflow`");
    expect(stdout).toContain("[workflow-state:idle]");
    expect(stdout).not.toContain("06-12-active");
  });

  it("generated hooks migrate legacy state.json and show task status with handoff", async () => {
    await configureClaude(tempDir);
    await writeRuntimeScaffold(tempDir, ["claude-code"]);
    await writeProjectInitTask(tempDir, ["claude-code"]);
    await writeFile(
      path.join(tempDir, ".easy-coding", "tasks", "project-init", "task.json"),
      JSON.stringify({ type: "project-init", status: "COMPLETE" }, null, 2),
      "utf8",
    );
    await writeFile(
      path.join(tempDir, ".easy-coding", "state.json"),
      JSON.stringify(
        {
          current_stage: "ANALYSIS",
          current_task: "06-10-demo",
          last_agent: "codex",
          stage_history: [],
        },
        null,
        2,
      ),
      "utf8",
    );
    await mkdir(path.join(tempDir, ".easy-coding", "tasks", "06-10-demo"), { recursive: true });
    await writeFile(
      path.join(tempDir, ".easy-coding", "tasks", "06-10-demo", "task.json"),
      JSON.stringify(
        {
          type: "feature",
          status: "IMPLEMENT",
          created_at: "2026-06-10T00:00:00Z",
          created_by: "codex",
        },
        null,
        2,
      ),
      "utf8",
    );

    const hook = path.join(tempDir, ".claude", "hooks", "session-start.py");
    const stdout = execFileSync("python3", [hook], {
      cwd: tempDir,
      input: "{}",
      encoding: "utf8",
    });

    expect(stdout).toContain("> **Easy Coding** · `06-10-demo` · `IMPLEMENT` · Handoff -> `codex`");
    expect(stdout).toContain("[workflow-state:IMPLEMENT]");
    expect(stdout).toContain("[current-task:06-10-demo]");
    expect(stdout).toContain("[easy-coding:handoff-from:codex]");
  });

  it("session-start can inject the active Claude status on UserPromptSubmit", async () => {
    await configureClaude(tempDir);
    await writeRuntimeScaffold(tempDir, ["claude-code"]);
    await writeProjectInitTask(tempDir, ["claude-code"]);
    await writeFile(
      path.join(tempDir, ".easy-coding", "tasks", "project-init", "task.json"),
      JSON.stringify({ type: "project-init", status: "COMPLETE" }, null, 2),
      "utf8",
    );
    await mkdir(path.join(tempDir, ".easy-coding", "sessions"), { recursive: true });
    await mkdir(path.join(tempDir, ".easy-coding", "tasks", "06-26-analysis"), {
      recursive: true,
    });
    await writeFile(
      path.join(tempDir, ".easy-coding", "sessions", `${process.pid}.json`),
      JSON.stringify(
        {
          current_task: "06-26-analysis",
          created_at: new Date().toISOString(),
          last_seen_task: "06-26-analysis",
          last_seen_stage: "ANALYSIS",
          last_agent: "claude-code",
        },
        null,
        2,
      ),
      "utf8",
    );
    await writeFile(
      path.join(tempDir, ".easy-coding", "tasks", "06-26-analysis", "task.json"),
      JSON.stringify(
        {
          type: "bugfix",
          title: "Claude status line",
          status: "ANALYSIS",
          created_at: "2026-06-26T00:00:00Z",
          created_by: "claude-code",
          last_agent: "claude-code",
          stage_history: [{ stage: "ANALYSIS", agent: "claude-code" }],
        },
        null,
        2,
      ),
      "utf8",
    );

    const hook = path.join(tempDir, ".claude", "hooks", "session-start.py");
    const stdout = execFileSync("python3", [hook], {
      cwd: tempDir,
      input: JSON.stringify({ cwd: tempDir, hook_event_name: "UserPromptSubmit" }),
      encoding: "utf8",
    });

    expect(stdout).toContain('"hookEventName": "UserPromptSubmit"');
    expect(stdout).toContain("> **Easy Coding** · `06-26-analysis` · `ANALYSIS`");
    expect(stdout).toContain("[workflow-state:ANALYSIS]");
    expect(stdout).toContain("[current-task:06-26-analysis]");
  });

  it("generated hooks show missing state when session points to missing task", async () => {
    await configureClaude(tempDir);
    await writeRuntimeScaffold(tempDir, ["claude-code"]);
    await mkdir(path.join(tempDir, ".easy-coding", "sessions"), { recursive: true });
    await writeFile(
      path.join(tempDir, ".easy-coding", "sessions", `${process.pid}.json`),
      JSON.stringify(
        {
          current_task: "missing-task",
          created_at: new Date().toISOString(),
        },
        null,
        2,
      ),
      "utf8",
    );

    const hook = path.join(tempDir, ".claude", "hooks", "inject-workflow-state.py");
    const stdout = execFileSync("python3", [hook], {
      cwd: tempDir,
      input: "{}",
      encoding: "utf8",
    });

    expect(stdout).toContain("> **Easy Coding** · `missing-task` · `MISSING`");
    expect(stdout).toContain("Use `ec-workflow` to start or resume a task");
    expect(stdout).toContain("[workflow-state:idle]");
    expect(stdout).toContain("[current-task:missing-task]");
    expect(stdout).toContain("[easy-coding:current-task-missing:missing-task]");
  });

  it("generated hooks clear a stale terminal current task instead of switching to another active task", async () => {
    await configureClaude(tempDir);
    await writeRuntimeScaffold(tempDir, ["claude-code"]);
    await mkdir(path.join(tempDir, ".easy-coding", "sessions"), { recursive: true });
    await mkdir(path.join(tempDir, ".easy-coding", "tasks", "06-12-done"), { recursive: true });
    await mkdir(path.join(tempDir, ".easy-coding", "tasks", "06-12-active"), { recursive: true });
    await writeFile(
      path.join(tempDir, ".easy-coding", "sessions", `${process.pid}.json`),
      JSON.stringify({ current_task: "06-12-done", created_at: new Date().toISOString() }, null, 2),
      "utf8",
    );
    await writeFile(
      path.join(tempDir, ".easy-coding", "tasks", "06-12-done", "task.json"),
      JSON.stringify(
        {
          type: "bugfix",
          title: "Done task",
          status: "COMPLETE",
          created_at: "2026-06-12T00:00:00Z",
          created_by: "claude-code",
          last_agent: "claude-code",
          stage_history: [],
        },
        null,
        2,
      ),
      "utf8",
    );
    await writeFile(
      path.join(tempDir, ".easy-coding", "tasks", "06-12-active", "task.json"),
      JSON.stringify(
        {
          type: "feature",
          title: "Active task",
          status: "IMPLEMENT",
          created_at: "2026-06-12T01:00:00Z",
          created_by: "claude-code",
          last_agent: "claude-code",
          stage_history: [],
        },
        null,
        2,
      ),
      "utf8",
    );

    const hook = path.join(tempDir, ".claude", "hooks", "inject-workflow-state.py");
    const stdout = execFileSync("python3", [hook], {
      cwd: tempDir,
      input: "{}",
      encoding: "utf8",
    });

    expect(stdout).toContain("> **Easy Coding** · Ready · Use `ec-workflow`");
    expect(stdout).toContain("[workflow-state:idle]");
    expect(stdout).not.toContain("[current-task:06-12-done]");
    expect(stdout).not.toContain("[current-task:06-12-active]");
    const session = JSON.parse(
      await readFile(path.join(tempDir, ".easy-coding", "sessions", `${process.pid}.json`), "utf8"),
    );
    expect(session.current_task).toBeNull();
  });

  it("generated hooks preflight WAITING_CONFIRM confirmation before rendering IMPLEMENT", async () => {
    await configureClaude(tempDir);
    await writeRuntimeScaffold(tempDir, ["claude-code"]);
    await mkdir(path.join(tempDir, ".easy-coding", "sessions"), { recursive: true });
    await mkdir(path.join(tempDir, ".easy-coding", "tasks", "06-25-confirm"), { recursive: true });
    await writeFile(
      path.join(tempDir, ".easy-coding", "sessions", `${process.pid}.json`),
      JSON.stringify(
        {
          current_task: "06-25-confirm",
          created_at: new Date().toISOString(),
          last_seen_task: "06-25-confirm",
          last_seen_stage: "WAITING_CONFIRM",
          last_agent: "claude-code",
        },
        null,
        2,
      ),
      "utf8",
    );
    await writeFile(
      path.join(tempDir, ".easy-coding", "tasks", "06-25-confirm", "task.json"),
      JSON.stringify(
        {
          type: "feature",
          title: "Confirm task",
          status: "WAITING_CONFIRM",
          created_at: "2026-06-25T00:00:00Z",
          created_by: "claude-code",
          last_agent: "claude-code",
          stage_history: [{ stage: "WAITING_CONFIRM", agent: "claude-code" }],
        },
        null,
        2,
      ),
      "utf8",
    );

    const hook = path.join(tempDir, ".claude", "hooks", "inject-workflow-state.py");
    const stdout = execFileSync("python3", [hook], {
      cwd: tempDir,
      input: JSON.stringify({ cwd: tempDir, prompt: "确认，开始执行" }),
      encoding: "utf8",
    });

    expect(stdout).toContain("> **Easy Coding** · `06-25-confirm` · `IMPLEMENT`");
    expect(stdout).toContain("[workflow-state:IMPLEMENT]");
    const task = JSON.parse(
      await readFile(
        path.join(tempDir, ".easy-coding", "tasks", "06-25-confirm", "task.json"),
        "utf8",
      ),
    );
    expect(task.status).toBe("IMPLEMENT");
    expect(task.stage_history.map((entry: { stage: string }) => entry.stage)).toEqual([
      "WAITING_CONFIRM",
      "IMPLEMENT",
    ]);
    const session = JSON.parse(
      await readFile(path.join(tempDir, ".easy-coding", "sessions", `${process.pid}.json`), "utf8"),
    );
    expect(session.last_seen_stage).toBe("IMPLEMENT");
  });

  it("generated hooks do not preflight WAITING_CONFIRM revision requests", async () => {
    await configureClaude(tempDir);
    await writeRuntimeScaffold(tempDir, ["claude-code"]);
    await mkdir(path.join(tempDir, ".easy-coding", "sessions"), { recursive: true });
    await mkdir(path.join(tempDir, ".easy-coding", "tasks", "06-25-revise"), { recursive: true });
    await writeFile(
      path.join(tempDir, ".easy-coding", "sessions", `${process.pid}.json`),
      JSON.stringify(
        {
          current_task: "06-25-revise",
          created_at: new Date().toISOString(),
          last_seen_task: "06-25-revise",
          last_seen_stage: "WAITING_CONFIRM",
          last_agent: "claude-code",
        },
        null,
        2,
      ),
      "utf8",
    );
    await writeFile(
      path.join(tempDir, ".easy-coding", "tasks", "06-25-revise", "task.json"),
      JSON.stringify(
        {
          type: "feature",
          title: "Revise task",
          status: "WAITING_CONFIRM",
          created_at: "2026-06-25T00:00:00Z",
          created_by: "claude-code",
          last_agent: "claude-code",
          stage_history: [{ stage: "WAITING_CONFIRM", agent: "claude-code" }],
        },
        null,
        2,
      ),
      "utf8",
    );

    const hook = path.join(tempDir, ".claude", "hooks", "inject-workflow-state.py");
    const stdout = execFileSync("python3", [hook], {
      cwd: tempDir,
      input: JSON.stringify({ cwd: tempDir, prompt: "先修改一下方案，不要执行" }),
      encoding: "utf8",
    });

    expect(stdout).toContain("> **Easy Coding** · `06-25-revise` · `WAITING_CONFIRM`");
    expect(stdout).toContain("[workflow-state:WAITING_CONFIRM]");
    const task = JSON.parse(
      await readFile(
        path.join(tempDir, ".easy-coding", "tasks", "06-25-revise", "task.json"),
        "utf8",
      ),
    );
    expect(task.status).toBe("WAITING_CONFIRM");
    expect(task.stage_history.map((entry: { stage: string }) => entry.stage)).toEqual([
      "WAITING_CONFIRM",
    ]);
  });

  it("generated hooks preflight accepted verification before rendering MEMORY_SHORT", async () => {
    await configureClaude(tempDir);
    await writeRuntimeScaffold(tempDir, ["claude-code"]);
    await mkdir(path.join(tempDir, ".easy-coding", "sessions"), { recursive: true });
    await mkdir(path.join(tempDir, ".easy-coding", "tasks", "06-25-verify"), { recursive: true });
    await writeFile(
      path.join(tempDir, ".easy-coding", "sessions", `${process.pid}.json`),
      JSON.stringify(
        {
          current_task: "06-25-verify",
          created_at: new Date().toISOString(),
          last_seen_task: "06-25-verify",
          last_seen_stage: "VERIFICATION",
          last_agent: "claude-code",
        },
        null,
        2,
      ),
      "utf8",
    );
    await writeFile(
      path.join(tempDir, ".easy-coding", "tasks", "06-25-verify", "task.json"),
      JSON.stringify(
        {
          type: "feature",
          title: "Verify task",
          status: "VERIFICATION",
          created_at: "2026-06-25T00:00:00Z",
          created_by: "claude-code",
          last_agent: "claude-code",
          stage_history: [{ stage: "VERIFICATION", agent: "claude-code" }],
        },
        null,
        2,
      ),
      "utf8",
    );

    const hook = path.join(tempDir, ".claude", "hooks", "inject-workflow-state.py");
    const stdout = execFileSync("python3", [hook], {
      cwd: tempDir,
      input: JSON.stringify({ cwd: tempDir, user_prompt: "验收通过，可以归档" }),
      encoding: "utf8",
    });

    expect(stdout).toContain("> **Easy Coding** · `06-25-verify` · `MEMORY_SHORT`");
    expect(stdout).toContain("[workflow-state:MEMORY_SHORT]");
    const task = JSON.parse(
      await readFile(
        path.join(tempDir, ".easy-coding", "tasks", "06-25-verify", "task.json"),
        "utf8",
      ),
    );
    expect(task.status).toBe("MEMORY_SHORT");
    expect(task.stage_history.map((entry: { stage: string }) => entry.stage)).toEqual([
      "VERIFICATION",
      "MEMORY_SHORT",
    ]);
  });

  it("generated hooks do not preflight non-confirmation stages", async () => {
    await configureClaude(tempDir);
    await writeRuntimeScaffold(tempDir, ["claude-code"]);
    await mkdir(path.join(tempDir, ".easy-coding", "sessions"), { recursive: true });
    await mkdir(path.join(tempDir, ".easy-coding", "tasks", "06-25-review"), { recursive: true });
    await writeFile(
      path.join(tempDir, ".easy-coding", "sessions", `${process.pid}.json`),
      JSON.stringify(
        {
          current_task: "06-25-review",
          created_at: new Date().toISOString(),
          last_seen_task: "06-25-review",
          last_seen_stage: "REVIEW",
          last_agent: "claude-code",
        },
        null,
        2,
      ),
      "utf8",
    );
    await writeFile(
      path.join(tempDir, ".easy-coding", "tasks", "06-25-review", "task.json"),
      JSON.stringify(
        {
          type: "feature",
          title: "Review task",
          status: "REVIEW",
          created_at: "2026-06-25T00:00:00Z",
          created_by: "claude-code",
          last_agent: "claude-code",
          stage_history: [{ stage: "REVIEW", agent: "claude-code" }],
        },
        null,
        2,
      ),
      "utf8",
    );

    const hook = path.join(tempDir, ".claude", "hooks", "inject-workflow-state.py");
    const stdout = execFileSync("python3", [hook], {
      cwd: tempDir,
      input: JSON.stringify({ cwd: tempDir, prompt: "确认，继续执行" }),
      encoding: "utf8",
    });

    expect(stdout).toContain("> **Easy Coding** · `06-25-review` · `REVIEW`");
    expect(stdout).toContain("[workflow-state:REVIEW]");
    const task = JSON.parse(
      await readFile(
        path.join(tempDir, ".easy-coding", "tasks", "06-25-review", "task.json"),
        "utf8",
      ),
    );
    expect(task.status).toBe("REVIEW");
    expect(task.stage_history.map((entry: { stage: string }) => entry.stage)).toEqual([
      "REVIEW",
    ]);
  });

  it("state API creates a task and advances it through legal transitions", async () => {
    await configureClaude(tempDir);
    await writeRuntimeScaffold(tempDir, ["claude-code"]);

    const stateApi = path.join(tempDir, ".claude", "hooks", "easy_coding_state.py");
    const sessionFile = ".easy-coding/sessions/custom-session.json";
    const createStdout = execFileSync(
      "python3",
      [
        stateApi,
        "create-task",
        "--session-file",
        sessionFile,
        "--task-id",
        "06-12-api",
        "--type",
        "feature",
        "--title",
        "API task",
        "--agent",
        "claude-code",
      ],
      { cwd: tempDir, encoding: "utf8" },
    );
    const createOutput = JSON.parse(createStdout) as {
      status: string;
      status_line: string;
      status_context: string;
    };
    expect(createOutput.status).toBe("INIT");
    expect(createOutput.status_line).toContain("> **Easy Coding** · `06-12-api` · `INIT`");
    expect(createOutput.status_context).toContain("[workflow-state:INIT]");
    expect(createOutput.status_context).toContain("[current-task:06-12-api]");

    const stages = [
      "ANALYSIS",
      "WAITING_CONFIRM",
      "IMPLEMENT",
      "REVIEW",
      "VERIFICATION",
      "MEMORY_SHORT",
      "MEMORY_LONG",
      "COMPLETE",
    ];
    for (const stage of stages) {
      const transitionStdout = execFileSync(
        "python3",
        [
          stateApi,
          "transition",
          "--session-file",
          sessionFile,
          "--stage",
          stage,
          "--agent",
          "claude-code",
        ],
        { cwd: tempDir, encoding: "utf8" },
      );
      const transitionOutput = JSON.parse(transitionStdout) as {
        status: string;
        status_line: string;
        status_context: string;
      };
      if (stage === "COMPLETE") {
        expect(transitionOutput.status).toBe("idle");
        expect(transitionOutput.status_line).toContain("> **Easy Coding** · Ready");
        expect(transitionOutput.status_context).toContain("[workflow-state:idle]");
      } else {
        expect(transitionOutput.status).toBe(stage);
        expect(transitionOutput.status_line).toContain(
          `> **Easy Coding** · \`06-12-api\` · \`${stage}\``,
        );
        expect(transitionOutput.status_context).toContain(`[workflow-state:${stage}]`);
      }
      if (stage === "ANALYSIS") {
        expect(transitionOutput.status_line).not.toContain("Ready");
        expect(transitionOutput.status_context).toContain(
          "[easy-coding:analysis-gate:skeleton-first-then-fill]",
        );
      }
    }

    const task = JSON.parse(
      await readFile(path.join(tempDir, ".easy-coding", "tasks", "06-12-api", "task.json"), "utf8"),
    );
    expect(task.status).toBe("COMPLETE");
    expect(task.stage_history.map((entry: { stage: string }) => entry.stage)).toEqual([
      "INIT",
      ...stages,
    ]);
    const session = JSON.parse(await readFile(path.join(tempDir, sessionFile), "utf8"));
    expect(session.current_task).toBeNull();
    expect(session.last_seen_stage).toBe("idle");
  });

  it("state API closes the current task and clears the session pointer", async () => {
    await configureClaude(tempDir);
    await writeRuntimeScaffold(tempDir, ["claude-code"]);

    const stateApi = path.join(tempDir, ".claude", "hooks", "easy_coding_state.py");
    execFileSync(
      "python3",
      [
        stateApi,
        "create-task",
        "--task-id",
        "06-12-close",
        "--type",
        "feature",
        "--title",
        "Close task",
        "--agent",
        "claude-code",
      ],
      { cwd: tempDir, encoding: "utf8" },
    );
    execFileSync(
      "python3",
      [
        stateApi,
        "close-current",
        "--reason",
        "no longer needed",
        "--agent",
        "claude-code",
      ],
      { cwd: tempDir, encoding: "utf8" },
    );

    const task = JSON.parse(
      await readFile(
        path.join(tempDir, ".easy-coding", "tasks", "06-12-close", "task.json"),
        "utf8",
      ),
    );
    expect(task.status).toBe("CLOSED");
    expect(task.closed_reason).toBe("no longer needed");

    const session = JSON.parse(
      await readFile(path.join(tempDir, ".easy-coding", "sessions", `${process.pid}.json`), "utf8"),
    );
    expect(session.current_task).toBeNull();

    const hook = path.join(tempDir, ".claude", "hooks", "inject-workflow-state.py");
    const stdout = execFileSync("python3", [hook], {
      cwd: tempDir,
      input: "{}",
      encoding: "utf8",
    });
    expect(stdout).toContain("> **Easy Coding** · Ready · Use `ec-workflow`");
    expect(stdout).toContain("[workflow-state:idle]");
  });

  it("state API rejects session files outside .easy-coding/sessions", async () => {
    await configureClaude(tempDir);
    await writeRuntimeScaffold(tempDir, ["claude-code"]);

    const stateApi = path.join(tempDir, ".claude", "hooks", "easy_coding_state.py");
    const outsidePath = path.join(path.dirname(tempDir), `${path.basename(tempDir)}-session.json`);
    try {
      expect(() =>
        execFileSync(
          "python3",
          [
            stateApi,
            "create-task",
            "--session-file",
            `../${path.basename(outsidePath)}`,
            "--task-id",
            "06-12-escape",
            "--type",
            "feature",
            "--title",
            "Escape session",
            "--agent",
            "claude-code",
          ],
          { cwd: tempDir, stdio: "ignore" },
        ),
      ).toThrow();

      expect(await pathExists(outsidePath)).toBe(false);
      expect(
        await pathExists(path.join(tempDir, ".easy-coding", "tasks", "06-12-escape", "task.json")),
      ).toBe(false);
    } finally {
      await rm(outsidePath, { force: true });
    }
  });
});
