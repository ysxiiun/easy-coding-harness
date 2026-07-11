import { execFileSync, execSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { configureClaude } from "../../src/configurators/claude.js";
import { renderHookCommand } from "../../src/configurators/shared.js";
import { PLATFORM_META } from "../../src/types/platform.js";
import { pathExists } from "../../src/utils/file-writer.js";
import { writeRuntimeScaffold } from "../../src/utils/runtime-scaffold.js";
import { writeProjectInitTask } from "../../src/utils/task-json.js";

let tempDir: string;
const pythonCmd = process.platform === "win32" ? "python" : "python3";

function hookCommand(root: string, scriptName: string): string {
  return renderHookCommand(root, PLATFORM_META["claude-code"].templateContext, scriptName);
}

async function writeReadyAnalysisArtifacts(root: string, taskId: string): Promise<void> {
  const taskDir = path.join(root, ".easy-coding", "tasks", taskId);
  await writeFile(
    path.join(taskDir, "dev-spec.md"),
    [
      "## 技术方案：Fixture",
      "### 项目模式",
      "迭代项目",
      "### 任务类型",
      "新功能",
      "### 需求解析",
      "目标和边界已确认。",
      "### 现状",
      "证据：src/example.ts:1。",
      "### 冲突摘要",
      "无冲突。",
      "### 影响面分析",
      "仅影响 fixture。",
      "### 改动范围",
      "src/example.ts，保持 UTF-8。",
      "### 修改方案",
      "实现 fixture。",
      "### 实施拆解",
      "U1：实现 fixture。",
      "### 测试策略",
      "执行 fixture 测试。",
      "### 风险与注意事项",
      "无额外风险。",
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
          title: "实现 fixture",
          type: "backend",
          files: ["src/example.ts"],
          depends_on: [],
        },
      ],
    })}\n`,
    "utf8",
  );
  await writeFile(path.join(taskDir, "test-strategy.md"), "# Test strategy\n", "utf8");
}

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "ec-claude-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("configureClaude", () => {
  it("writes Claude Code skills, hooks, agents, and CLAUDE.md", async () => {
    await configureClaude(tempDir);
    await writeRuntimeScaffold(tempDir, ["claude-code"]);

    const skill = await readFile(
      path.join(tempDir, ".claude", "skills", "ec-workflow", "SKILL.md"),
      "utf8",
    );
    expect(skill).toContain("`/ec-init`");
    expect(skill).toContain("claim-task --session-file");
    expect(skill).toContain("handoff-task --session-file");
    expect(skill).toContain("request-transition --session-file");
    expect(skill).toContain("confirm-transition --session-file");
    expect(skill).toContain("native user-choice tool whenever one is available");
    expect(skill).toContain("Plain-text numbered choices are fallback only");
    expect(skill).toContain("Current task pointer exists");
    expect(skill).toContain("No current task pointer");
    expect(skill).toContain("edge with `effective_confirm_mode`");
    expect(skill).toContain("automatic code path chooses REVIEW");
    expect(skill).toContain("missing user-visible delivery keeps");
    expect(skill).not.toContain("before re-walking\n  REVIEW -> VERIFICATION");
    expect(skill).not.toContain("open the target agent");
    expect(skill).not.toContain("next_agent");
    expect(skill).not.toContain("{{");

    const noHarnessSkill = await readFile(
      path.join(tempDir, ".claude", "skills", "ec-no-harness", "SKILL.md"),
      "utf8",
    );
    expect(noHarnessSkill).toContain("disable-harness --session-file");
    expect(noHarnessSkill).toContain("does not disable the");
    expect(noHarnessSkill).not.toContain("{{");

    const analysisSkill = await readFile(
      path.join(tempDir, ".claude", "skills", "ec-analysis", "SKILL.md"),
      "utf8",
    );
    expect(analysisSkill).toContain("Resolve the decision gate");
    expect(analysisSkill).toContain("Do not fill dev-spec.md");
    expect(analysisSkill).toContain("all 12 must be present");
    expect(analysisSkill).toContain("explicitly no-code");
    expect(analysisSkill).toContain("MUST NOT create\n   `test-strategy.md`");
    const planExampleMatch = analysisSkill.match(/```json\n([^\n]+)\n```/);
    expect(planExampleMatch).not.toBeNull();
    const planExample = JSON.parse(planExampleMatch?.[1] ?? "{}") as {
      units: Array<{ id: string; type?: string }>;
      parallel_groups: Array<{ units: string[] }>;
    };
    const exampleUnitIds = planExample.units.map((unit) => unit.id).sort();
    const groupedUnitIds = planExample.parallel_groups.flatMap((group) => group.units).sort();
    expect(groupedUnitIds).toEqual(exampleUnitIds);
    expect(planExample.units.every((unit) => Boolean(unit.type))).toBe(true);

    const implementingSkill = await readFile(
      path.join(tempDir, ".claude", "skills", "ec-implementing", "SKILL.md"),
      "utf8",
    );
    expect(implementingSkill).toContain("output the complete `deliverable` to the user");
    expect(implementingSkill).toContain("Never replace,\n   truncate, or hide it");
    expect(implementingSkill).toContain("request COMPLETE in approve mode or auto-transition");
    expect(implementingSkill).toContain("followed the effective confirm mode");

    const implementerAgent = await readFile(
      path.join(tempDir, ".claude", "agents", "ec-implementer.md"),
      "utf8",
    );
    expect(implementerAgent).toContain("NONE — read-only deliverable");
    expect(implementerAgent).toContain("`deliverable`");

    const reviewingSkill = await readFile(
      path.join(tempDir, ".claude", "skills", "ec-reviewing", "SKILL.md"),
      "utf8",
    );
    expect(reviewingSkill).toContain("auto-complete from IMPLEMENT and never enter REVIEW");
    expect(reviewingSkill).not.toContain("Deliverable mode");

    const devSpecSkeleton = await readFile(
      path.join(tempDir, ".easy-coding", "templates", "dev-spec-skeleton.md"),
      "utf8",
    );
    expect(devSpecSkeleton.startsWith("## 技术方案：[[EC_TODO:任务标题]]")).toBe(true);
    expect(devSpecSkeleton).toContain("[[EC_TODO:");
    expect(devSpecSkeleton).not.toContain("[阶段：ANALYSIS]");
    expect(devSpecSkeleton).not.toContain("### 待用户决策");

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
    expect(settings).toContain(".claude/hooks");
    expect(settings).toContain("session-start.py");
    expect(settings).not.toContain(tempDir);
    const settingsJson = JSON.parse(settings) as {
      hooks: Record<string, Array<{ hooks: Array<{ command: string; timeout: number }> }>>;
    };
    const sessionStartCommands = settingsJson.hooks.SessionStart.flatMap((group) =>
      group.hooks.map((hook) => hook.command),
    );
    expect(sessionStartCommands).toEqual([hookCommand(tempDir, "session-start.py")]);
    const userPromptCommands = settingsJson.hooks.UserPromptSubmit.map((group) =>
      group.hooks.map((hook) => hook.command),
    );
    expect(userPromptCommands).toEqual([
      [hookCommand(tempDir, "session-start.py")],
      [hookCommand(tempDir, "inject-workflow-state.py")],
    ]);
    expect(settings).not.toContain(`${pythonCmd} .claude/hooks/`);
    const userPromptTimeouts = settingsJson.hooks.UserPromptSubmit.map((group) =>
      group.hooks.map((hook) => hook.timeout),
    );
    expect(userPromptTimeouts).toEqual([[15000], [15000]]);

    const hook = await readFile(
      path.join(tempDir, ".claude", "hooks", "inject-workflow-state.py"),
      "utf8",
    );
    expect(hook).toContain("build_status_context");
    expect(hook).not.toContain("CONFIRM_PATTERNS");
    expect(hook).not.toContain("confirm_transition");
    expect(hook).not.toContain("preflight_confirmed_transition");
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
    expect(main).toContain("`/ec-no-harness`");
    expect(main).toContain("`pending_transition`");
    expect(main).toContain("project `behavior.confirm_mode`");
    expect(main).toContain("`auto-transition`");
    expect(main).toContain("Automatic code flow chooses IMPLEMENT -> REVIEW");
    expect(main).toContain("read-only task creates no test-strategy.md");
    expect(main).toContain("ask every unresolved decision during analysis");

    const verificationSkill = await readFile(
      path.join(tempDir, ".claude", "skills", "ec-verification", "SKILL.md"),
      "utf8",
    );
    expect(verificationSkill).toContain("request-transition --stage MEMORY");
    expect(verificationSkill).toContain("guard/auto default to REVIEW");
    expect(verificationSkill).not.toContain("then re-REVIEW");
    expect(verificationSkill).not.toContain("MEMORY_SHORT");
    expect(verificationSkill).not.toContain("MEMORY_LONG");

    const memorySkill = await readFile(
      path.join(tempDir, ".claude", "skills", "ec-memory", "SKILL.md"),
      "utf8",
    );
    expect(memorySkill).toContain("memory-short-complete");
    expect(memorySkill).toContain("memory-instruction");
    expect(memorySkill).toContain("auto-transition");
    expect(memorySkill).toContain("memory-complete");
    expect(memorySkill).toContain("source_task: {current task id, exact}");

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
      "ec-no-harness",
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

  it("configured hook commands run from Easy Coding memory subdirectories", async () => {
    await configureClaude(tempDir);
    await writeRuntimeScaffold(tempDir, ["claude-code"]);

    const nested = path.join(tempDir, ".easy-coding", "memory", "short");
    await mkdir(nested, { recursive: true });
    const settings = JSON.parse(await readFile(path.join(tempDir, ".claude", "settings.json"), "utf8")) as {
      hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>>;
    };
    const command = settings.hooks.SessionStart[0].hooks[0].command;
    const stdout = execSync(command, {
      cwd: nested,
      input: "{}",
      encoding: "utf8",
    });

    expect(stdout).toContain(
      "> **Easy Coding** · Ready · Use `ec-workflow` to start or resume a task, `ec-brainstorming` to brainstorm, or `ec-task-management` to view tasks",
    );
    expect(stdout).toContain("[workflow-state:idle]");
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

  it("does not inject the Easy Coding sub-agent guard while this session bypasses the harness", async () => {
    await configureClaude(tempDir);
    await writeRuntimeScaffold(tempDir, ["claude-code"]);
    await mkdir(path.join(tempDir, ".easy-coding", "sessions"), { recursive: true });

    const sessionPath = path.join(
      tempDir,
      ".easy-coding",
      "sessions",
      `${process.pid}.json`,
    );
    const hook = path.join(tempDir, ".claude", "hooks", "inject-subagent-context.py");
    const payload = JSON.stringify({ cwd: tempDir, hook_event_name: "PreToolUse" });

    await writeFile(
      sessionPath,
      JSON.stringify({
        current_task: null,
        created_at: "2026-07-11T00:00:00Z",
        harness_disabled: true,
      }),
      "utf8",
    );
    const bypassed = execFileSync("python3", [hook], {
      cwd: tempDir,
      input: payload,
      encoding: "utf8",
    });
    expect(bypassed).toBe("");

    await writeFile(
      sessionPath,
      JSON.stringify({ current_task: null, created_at: "2026-07-11T00:00:00Z" }),
      "utf8",
    );
    const enabled = execFileSync("python3", [hook], {
      cwd: tempDir,
      input: payload,
      encoding: "utf8",
    });
    expect(enabled).toContain("[easy-coding:subagent-guard]");
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

  it("generated hooks keep option 1 read-only until the agent confirms explicitly", async () => {
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
          last_seen_stage: "ANALYSIS",
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
          status: "ANALYSIS",
          created_at: "2026-06-25T00:00:00Z",
          created_by: "claude-code",
          last_agent: "claude-code",
          stage_history: [{ stage: "ANALYSIS", agent: "claude-code" }],
          pending_transition: {
            from: "ANALYSIS",
            to: "IMPLEMENT",
            requested_at: "2026-06-25T00:01:00Z",
            requested_by: "claude-code",
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    const hook = path.join(tempDir, ".claude", "hooks", "inject-workflow-state.py");
    const stdout = execFileSync("python3", [hook], {
      cwd: tempDir,
      input: JSON.stringify({ cwd: tempDir, prompt: "1" }),
      encoding: "utf8",
    });

    expect(stdout).toContain("> **Easy Coding** · `06-25-confirm` · `ANALYSIS`");
    expect(stdout).toContain("[workflow-state:ANALYSIS]");
    expect(stdout).toContain("[easy-coding:pending-transition:ANALYSIS->IMPLEMENT]");
    const task = JSON.parse(
      await readFile(
        path.join(tempDir, ".easy-coding", "tasks", "06-25-confirm", "task.json"),
        "utf8",
      ),
    );
    expect(task.status).toBe("ANALYSIS");
    expect(task.stage_history.map((entry: { stage: string }) => entry.stage)).toEqual([
      "ANALYSIS",
    ]);
    const session = JSON.parse(
      await readFile(path.join(tempDir, ".easy-coding", "sessions", `${process.pid}.json`), "utf8"),
    );
    expect(session.last_seen_stage).toBe("ANALYSIS");
  });

  it("generated hooks keep a pending edge when the user requests revision", async () => {
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
          last_seen_stage: "ANALYSIS",
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
          status: "ANALYSIS",
          created_at: "2026-06-25T00:00:00Z",
          created_by: "claude-code",
          last_agent: "claude-code",
          stage_history: [{ stage: "ANALYSIS", agent: "claude-code" }],
          pending_transition: {
            from: "ANALYSIS",
            to: "IMPLEMENT",
            requested_at: "2026-06-25T00:01:00Z",
            requested_by: "claude-code",
          },
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

    expect(stdout).toContain("> **Easy Coding** · `06-25-revise` · `ANALYSIS`");
    expect(stdout).toContain("[workflow-state:ANALYSIS]");
    expect(stdout).toContain("[easy-coding:pending-transition:ANALYSIS->IMPLEMENT]");
    const task = JSON.parse(
      await readFile(
        path.join(tempDir, ".easy-coding", "tasks", "06-25-revise", "task.json"),
        "utf8",
      ),
    );
    expect(task.status).toBe("ANALYSIS");
    expect(task.stage_history.map((entry: { stage: string }) => entry.stage)).toEqual([
      "ANALYSIS",
    ]);
    expect(task.pending_transition).toMatchObject({ from: "ANALYSIS", to: "IMPLEMENT" });
  });

  it("generated hooks do not treat free-form or directional language as confirmation", async () => {
    await configureClaude(tempDir);
    await writeRuntimeScaffold(tempDir, ["claude-code"]);
    await mkdir(path.join(tempDir, ".easy-coding", "sessions"), { recursive: true });
    await mkdir(path.join(tempDir, ".easy-coding", "tasks", "06-25-discuss"), {
      recursive: true,
    });
    await writeFile(
      path.join(tempDir, ".easy-coding", "sessions", `${process.pid}.json`),
      JSON.stringify(
        {
          current_task: "06-25-discuss",
          created_at: new Date().toISOString(),
          last_seen_task: "06-25-discuss",
          last_seen_stage: "ANALYSIS",
          last_agent: "claude-code",
        },
        null,
        2,
      ),
      "utf8",
    );
    const taskPath = path.join(
      tempDir,
      ".easy-coding",
      "tasks",
      "06-25-discuss",
      "task.json",
    );
    await writeFile(
      taskPath,
      JSON.stringify(
        {
          type: "feature",
          title: "Discuss task",
          status: "ANALYSIS",
          created_at: "2026-06-25T00:00:00Z",
          created_by: "claude-code",
          last_agent: "claude-code",
          stage_history: [{ stage: "ANALYSIS", agent: "claude-code" }],
          pending_transition: {
            from: "ANALYSIS",
            to: "IMPLEMENT",
            requested_at: "2026-06-25T00:01:00Z",
            requested_by: "claude-code",
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    const hook = path.join(tempDir, ".claude", "hooks", "inject-workflow-state.py");
    const prompts = [
      "继续分析这个方案",
      "我想继续讨论方案",
      "我还没确认",
      "帮我确认现在处于什么阶段",
      "确认进入下一阶段",
      "确认返回上一阶段",
    ];
    for (const prompt of prompts) {
      const stdout = execFileSync("python3", [hook], {
        cwd: tempDir,
        input: JSON.stringify({ cwd: tempDir, prompt }),
        encoding: "utf8",
      });
      expect(stdout).toContain("> **Easy Coding** · `06-25-discuss` · `ANALYSIS`");
      expect(stdout).toContain("[easy-coding:pending-transition:ANALYSIS->IMPLEMENT]");
    }

    const task = JSON.parse(await readFile(taskPath, "utf8"));
    expect(task.status).toBe("ANALYSIS");
    expect(task.stage_history.map((entry: { stage: string }) => entry.stage)).toEqual([
      "ANALYSIS",
    ]);
    expect(task.pending_transition).toMatchObject({ from: "ANALYSIS", to: "IMPLEMENT" });
  });

  it("generated hooks keep verification fallback input read-only", async () => {
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
          pending_transition: {
            from: "VERIFICATION",
            to: "MEMORY",
            requested_at: "2026-06-25T00:01:00Z",
            requested_by: "claude-code",
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    const hook = path.join(tempDir, ".claude", "hooks", "inject-workflow-state.py");
    const stdout = execFileSync("python3", [hook], {
      cwd: tempDir,
      input: JSON.stringify({ cwd: tempDir, user_prompt: "1." }),
      encoding: "utf8",
    });

    expect(stdout).toContain("> **Easy Coding** · `06-25-verify` · `VERIFICATION`");
    expect(stdout).toContain("[workflow-state:VERIFICATION]");
    expect(stdout).toContain("[easy-coding:pending-transition:VERIFICATION->MEMORY]");
    const task = JSON.parse(
      await readFile(
        path.join(tempDir, ".easy-coding", "tasks", "06-25-verify", "task.json"),
        "utf8",
      ),
    );
    expect(task.status).toBe("VERIFICATION");
    expect(task.stage_history.map((entry: { stage: string }) => entry.stage)).toEqual([
      "VERIFICATION",
    ]);
  });

  it("generated hooks do not advance stages without a pending edge", async () => {
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
      "IMPLEMENT",
      "REVIEW",
      "VERIFICATION",
      "MEMORY",
      "COMPLETE",
    ];
    const automaticStages = new Set(["ANALYSIS", "REVIEW", "VERIFICATION", "COMPLETE"]);
    for (const stage of stages) {
      if (stage === "COMPLETE") {
        await writeFile(
          path.join(tempDir, ".easy-coding", "memory", "short", "001_fixture.md"),
          "---\nmemory_schema: 2\nsource_task: 06-12-api\n---\n",
          "utf8",
        );
        execFileSync(
          "python3",
          [
            stateApi,
            "memory-short-complete",
            "--session-file",
            sessionFile,
            "--file",
            ".easy-coding/memory/short/001_fixture.md",
            "--agent",
            "claude-code",
          ],
          { cwd: tempDir, encoding: "utf8" },
        );
        execFileSync(
          "python3",
          [stateApi, "memory-instruction", "--session-file", sessionFile],
          { cwd: tempDir, encoding: "utf8" },
        );
        execFileSync(
          "python3",
          [
            stateApi,
            "memory-complete",
            "--session-file",
            sessionFile,
            "--action",
            "no-op",
            "--agent",
            "claude-code",
          ],
          { cwd: tempDir, encoding: "utf8" },
        );
      }
      let transitionStdout: string;
      if (automaticStages.has(stage)) {
        transitionStdout = execFileSync(
          "python3",
          [
            stateApi,
            "auto-transition",
            "--session-file",
            sessionFile,
            "--stage",
            stage,
            "--agent",
            "claude-code",
          ],
          { cwd: tempDir, encoding: "utf8" },
        );
      } else {
        const requestStdout = execFileSync(
          "python3",
          [
            stateApi,
            "request-transition",
            "--session-file",
            sessionFile,
            "--stage",
            stage,
            "--agent",
            "claude-code",
          ],
          { cwd: tempDir, encoding: "utf8" },
        );
        const requestOutput = JSON.parse(requestStdout) as {
          status: string;
          pending_transition: { to: string };
        };
        expect(requestOutput.pending_transition.to).toBe(stage);
        expect(requestOutput.status).not.toBe(stage);

        transitionStdout = execFileSync(
          "python3",
          [
            stateApi,
            "confirm-transition",
            "--session-file",
            sessionFile,
            "--stage",
            stage,
            "--agent",
            "claude-code",
          ],
          { cwd: tempDir, encoding: "utf8" },
        );
      }
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
        await writeReadyAnalysisArtifacts(tempDir, "06-12-api");
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
