import { execFileSync, execSync } from "node:child_process";
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

function claudeFallbackSessionPath(root: string): string {
  return path.join(root, ".easy-coding", "sessions", `claude-code-ppid-${process.pid}.json`);
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
      "### 决策闭环",
      "decision_status: closed",
      "- **已解决问题与结论**：无",
      "- **确认依据**：无额外决策",
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
      "### Workflow Mode",
      "配置 adaptive，选择 standard。",
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
          acceptance_criteria: ["fixture works"],
          test_points: ["fixture test"],
          contracts: ["none"],
          risks: ["none"],
          local_baseline: ["src/example.ts:1 follows the local fixture style"],
        },
      ],
    })}\n`,
    "utf8",
  );
  await writeFile(path.join(taskDir, "test-strategy.md"), "# Test strategy\n", "utf8");
  const taskPath = path.join(taskDir, "task.json");
  const task = JSON.parse(await readFile(taskPath, "utf8"));
  task.workflow_mode_proposal = {
    configured_mode: "adaptive",
    selected_mode: "standard",
    minimum_mode: "fast",
    source: "adaptive",
    reasons: ["fixture"],
    proposed_at: "2026-07-27T00:00:00Z",
    proposed_by: "claude-code",
  };
  await writeFile(taskPath, JSON.stringify(task, null, 2), "utf8");
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
    expect(skill).toContain("approval_mode = approve|guard|confirm|auto");
    expect(skill).toContain("workflow_mode = adaptive|fast|standard|strict");
    expect(skill).toContain("New code tasks never skip REVIEW");
    expect(skill).toContain("Preserve `pending_transition` on cancellation");
    expect(skill).toContain("raise-workflow-mode");
    expect(skill).toContain("review fingerprint");
    expect(skill).toContain("verification fingerprint");
    expect(skill).toContain("Missing: tell the user to run `easy-coding init`");
    expect(skill).toContain("During VERIFICATION, return to IMPLEMENT before");
    expect(skill).toContain(
      "[easy-coding:lite-review-bypass-required:IMPLEMENT->REVIEW]",
    );
    expect(skill).toContain("one-time `workflow_mode_legacy_direct_edge`");
    expect(skill).not.toContain("Skip REVIEW");
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
    expect(analysisSkill).toContain("Progressive context loading");
    expect(analysisSkill).toContain("propose-workflow-mode");
    expect(analysisSkill).toContain("mechanical minimum");
    expect(analysisSkill).toContain("acceptance_criteria");
    expect(analysisSkill).toContain("No transition without a valid workflow proposal");
    expect(analysisSkill).toContain("concise session summary instead of");
    expect(analysisSkill).toContain("[View full Dev-Spec](</absolute/path/to/dev-spec.md>)");
    expect(analysisSkill).toContain("decision_status: closed");
    expect(analysisSkill).toContain("progressive cost budget");
    expect(analysisSkill).toContain("## Local implementation baseline");
    expect(analysisSkill).toContain("at most five");
    expect(analysisSkill).toContain("compound high-risk and complexity signals");
    expect(analysisSkill).toContain("unused `repo_paths`");

    const implementingSkill = await readFile(
      path.join(tempDir, ".claude", "skills", "ec-implementing", "SKILL.md"),
      "utf8",
    );
    expect(implementingSkill).toContain("A single low-risk unit may be implemented inline");
    expect(implementingSkill).toContain("acceptance_criteria");
    expect(implementingSkill).toContain("Code tasks enter REVIEW");
    expect(implementingSkill).toContain("Codex with Easy Coding");
    expect(implementingSkill).toContain("Every new model field, enum member, and constant");
    expect(implementingSkill).toContain("user-facing host Agent");
    expect(implementingSkill).toContain("## Code Comments");
    expect(implementingSkill).toContain("## Local Baseline");
    expect(implementingSkill).toContain("generic best practice");
    expect(implementingSkill).toContain("single return value of\n    a getter");
    expect(implementingSkill).toContain("existing core Java class");

    const implementerAgent = await readFile(
      path.join(tempDir, ".claude", "agents", "ec-implementer.md"),
      "utf8",
    );
    expect(implementerAgent).toContain("NONE — read-only deliverable");
    expect(implementerAgent).toContain("`deliverable`");
    expect(implementerAgent).toContain("`Code Comments`");
    expect(implementerAgent).toContain("`Local Baseline`");
    expect(implementerAgent).toContain("fragmented one-use");
    expect(implementerAgent).toContain("new core Java class");

    const reviewingSkill = await readFile(
      path.join(tempDir, ".claude", "skills", "ec-reviewing", "SKILL.md"),
      "utf8",
    );
    expect(reviewingSkill).toContain("Every new code task enters REVIEW");
    expect(reviewingSkill).toContain("implementation_fingerprint");
    expect(reviewingSkill).toContain("two consecutive rounds");
    expect(reviewingSkill).toContain("Review local fit before recommending generic cleanup");
    expect(reviewingSkill).toContain("constants created only for one getter");
    expect(reviewingSkill).not.toContain("Deliverable mode");

    const reviewerAgent = await readFile(
      path.join(tempDir, ".claude", "agents", "ec-reviewer.md"),
      "utf8",
    );
    expect(reviewerAgent).toContain("evidenced Local Baseline");
    expect(reviewerAgent).toContain("missing Javadoc on any method/field");

    const devSpecSkeleton = await readFile(
      path.join(tempDir, ".easy-coding", "templates", "dev-spec-skeleton.md"),
      "utf8",
    );
    expect(devSpecSkeleton.startsWith("## 技术方案：[[EC_TODO:任务标题]]")).toBe(true);
    expect(devSpecSkeleton).toContain("[[EC_TODO:");
    expect(devSpecSkeleton).toContain("### 决策闭环");
    expect(devSpecSkeleton).toContain("decision_status: [[EC_TODO:");
    expect(devSpecSkeleton).not.toContain("[阶段：ANALYSIS]");
    expect(devSpecSkeleton).not.toContain("### 待用户决策");

    const taskManagementSkill = await readFile(
      path.join(tempDir, ".claude", "skills", "ec-task-management", "SKILL.md"),
      "utf8",
    );
    expect(taskManagementSkill).toContain("Mode inspection and configuration belongs to `ec-config`");
    expect(taskManagementSkill).not.toContain("set-approval-mode");
    expect(taskManagementSkill).not.toContain("{{");
    const configSkill = await readFile(
      path.join(tempDir, ".claude", "skills", "ec-config", "SKILL.md"),
      "utf8",
    );
    expect(configSkill).toContain("project_tdd_enabled");
    expect(configSkill).toContain("set-tdd");
    expect(configSkill).toContain("clear-tdd");
    expect(configSkill).not.toContain("{{");
    const tddInitSkill = await readFile(
      path.join(tempDir, ".claude", "skills", "ec-tdd-init", "SKILL.md"),
      "utf8",
    );
    expect(tddInitSkill).toContain("historical coverage required: no");
    expect(tddInitSkill).toContain("TDD off -> initialize infrastructure");
    expect(tddInitSkill).toContain("not a Harness task acceptance dependency");
    expect(tddInitSkill).not.toContain("{{");
    const tddVerificationSkill = await readFile(
      path.join(tempDir, ".claude", "skills", "ec-verification", "SKILL.md"),
      "utf8",
    );
    expect(tddVerificationSkill).toContain('one coverage record with `coverage_scope:"local"`');
    expect(tddVerificationSkill).not.toContain('coverage_scope:"gitlab"');
    expect(tddVerificationSkill).not.toContain("pipeline_url");
    expect(
      await pathExists(path.join(tempDir, ".easy-coding", "tools", "easy_coding_java_coverage.py")),
    ).toBe(true);
    expect(
      await pathExists(path.join(tempDir, ".easy-coding", "tools", "easy_coding_tdd_readiness.py")),
    ).toBe(true);

    const gitSkill = await readFile(
      path.join(tempDir, ".claude", "skills", "ec-git", "SKILL.md"),
      "utf8",
    );
    expect(gitSkill).toContain("status is neither\n   `COMPLETE` nor `CLOSED`");
    expect(gitSkill).toContain("`COMPLETE` and `CLOSED` are terminal states");
    expect(gitSkill).toContain("Changes written by `easy-coding upgrade`");
    expect(gitSkill).toContain("current agent did not write them");

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
    expect(userPromptCommands).toEqual([[hookCommand(tempDir, "inject-workflow-state.py")]]);
    expect(settings).not.toContain(`${pythonCmd} .claude/hooks/`);
    const userPromptTimeouts = settingsJson.hooks.UserPromptSubmit.map((group) =>
      group.hooks.map((hook) => hook.timeout),
    );
    expect(userPromptTimeouts).toEqual([[15000]]);

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
    expect(
      await readFile(path.join(tempDir, ".claude", "hooks", "easy_dev_spec.py"), "utf8"),
    ).toContain("8239a5befae08b41da43b7cfbf41acf07e487d04");
    expect(
      await readFile(
        path.join(tempDir, ".claude", "hooks", "easy_dev_spec_protocol.py"),
        "utf8",
      ),
    ).toContain('SCHEMA = "easy-dev-spec/v1"');
    expect(
      await readFile(
        path.join(tempDir, ".claude", "hooks", "easy_dev_spec_execution.py"),
        "utf8",
      ),
    ).toContain("def record_task_status(");

    const main = await readFile(path.join(tempDir, "CLAUDE.md"), "utf8");
    expect(main).toContain("easy-coding-harness generated");
    expect(main).toContain("single Markdown blockquote status line");
    expect(main).toContain(
      "- Ready: > **Easy Coding** · **Approval: {approval-mode}** · **Workflow: {workflow-mode}** · Ready",
    );
    expect(main).not.toContain("[ Easy Coding ] ready");
    expect(main).not.toContain("tasks``");
    expect(main).not.toContain("}```");
    expect(main).toContain("`/ec-init`");
    expect(main).toContain("`/ec-meta`");
    expect(main).toContain("`/ec-no-harness`");
    expect(main).toContain("`pending_transition`");
    expect(main).toContain("project `behavior.approval_mode`");
    expect(main).toContain("project `behavior.workflow_mode`");
    expect(main).toContain("`auto-transition`");
    expect(main).toContain("Every new code task runs REVIEW");
    expect(main).toContain("A confirmation-required boundary is not fully presented");
    expect(main).toContain("code IMPLEMENT gate must preserve enter REVIEW");
    expect(main).toContain("explicitly guarantees an indefinite wait");
    expect(main).toContain("pre-render the matching numbered fallback");
    expect(main).toContain("consume a matching\n  numbered reply against the stored edge");
    expect(main).toContain("read-only task creates no test-strategy.md");
    expect(main).toContain("set `decision_status: open`");
    expect(main).toContain("progressively record");
    expect(main).toContain("never paste the full");

    const workflowSkill = await readFile(
      path.join(tempDir, ".claude", "skills", "ec-workflow", "SKILL.md"),
      "utf8",
    );
    expect(workflowSkill).toContain("inspect-dev-spec");
    expect(workflowSkill).toContain("--manifest-only");
    expect(workflowSkill).toContain("A differing `path_hint` is a one-time runtime mapping notice");
    expect(workflowSkill).toContain("never reconstruct completion from another local Harness task");
    expect(workflowSkill).toContain("select-dev-spec-scope");
    expect(workflowSkill).toContain("create-task-from-spec");

    expect(analysisSkill).toContain("--spec-task <selected-task-id>");
    expect(analysisSkill).toContain("`exact` and `scope-unchanged` use the fast projection path");
    expect(analysisSkill).toContain("second round of Spec");

    const verificationSkill = await readFile(
      path.join(tempDir, ".claude", "skills", "ec-verification", "SKILL.md"),
      "utf8",
    );
    expect(verificationSkill).toContain("evidence-fingerprints");
    expect(verificationSkill).toContain("implementation_fingerprint");
    expect(verificationSkill).toContain("config_fingerprint");
    expect(verificationSkill).not.toContain("then re-REVIEW");
    expect(verificationSkill).not.toContain("MEMORY_SHORT");
    expect(verificationSkill).not.toContain("MEMORY_LONG");

    const memorySkill = await readFile(
      path.join(tempDir, ".claude", "skills", "ec-memory", "SKILL.md"),
      "utf8",
    );
    expect(memorySkill).toContain("memory-short-complete");
    expect(memorySkill).toContain("memory-new-id");
    expect(memorySkill).toContain("memory-instruction");
    expect(memorySkill).toContain("memory-architecture-assessment");
    expect(memorySkill).toContain(
      "must not re-analyze the repository or repeat the entire conversation",
    );
    expect(memorySkill).toContain("Whenever `required:true`, record the decision");
    expect(memorySkill).toContain("Default to\n  `no-op`");
    expect(memorySkill).toContain("missing-ABSTRACT startup exception");
    expect(memorySkill).toContain("never\nsilently edit `RULES.md`");
    expect(memorySkill).toContain("auto-transition");
    expect(memorySkill).toContain("memory-complete");
    expect(memorySkill).toContain("source_task: {current task id, exact}");
    expect(memorySkill).toContain("{memory_id}_{YYYYMMDD}_{smart_name}.md");

    const initSkill = await readFile(
      path.join(tempDir, ".claude", "skills", "ec-init", "SKILL.md"),
      "utf8",
    );
    expect(initSkill).toContain("project-init-complete --session-file <P> --agent <agent-id>");
    expect(initSkill).toContain("snapshot --agent <agent-id>");
    expect(initSkill).toContain("Never execute a command with\n   the literal placeholder `<P>`");
    expect(initSkill).toContain("explicit `missing-abstract` assessment");
    const preflightIndex = initSkill.indexOf("## Project-init preflight (run first — read-only)");
    const sessionResolutionIndex = initSkill.indexOf(
      "## Session path resolution (run after preflight — before any project write)",
    );
    const entryDispatchIndex = initSkill.indexOf(
      "## Entry dispatch (idempotency — run after session resolution)",
    );
    expect(preflightIndex).toBeGreaterThanOrEqual(0);
    expect(sessionResolutionIndex).toBeGreaterThan(preflightIndex);
    expect(entryDispatchIndex).toBeGreaterThan(sessionResolutionIndex);
    expect(initSkill).toContain(
      "Do not call the state API or write any project asset until this file-existence check passes.",
    );

    const shortMemoryTemplate = await readFile(
      path.join(tempDir, ".easy-coding", "memory", "SHORT_MEMORY_TEMPLATE.md"),
      "utf8",
    );
    expect(shortMemoryTemplate).toContain("id: {memory_id}");
    expect(shortMemoryTemplate).not.toMatch(
      /^id: SM-[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/m,
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
    expect(stdout).toContain(
      "> **Easy Coding** · **Approval: Guard** · **Workflow: Adaptive** · Waiting init · Use `ec-init` to initialize",
    );
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
    const settings = JSON.parse(
      await readFile(path.join(tempDir, ".claude", "settings.json"), "utf8"),
    ) as {
      hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>>;
    };
    const command = settings.hooks.SessionStart[0].hooks[0].command;
    const stdout = execSync(command, {
      cwd: nested,
      input: "{}",
      encoding: "utf8",
    });

    expect(stdout).toContain(
      "> **Easy Coding** · **Approval: Guard** · **Workflow: Adaptive** · Ready · Use `ec-workflow` to start or resume a task, `ec-brainstorming` to brainstorm, `ec-task-management` to manage tasks, or `ec-config` to inspect or change modes",
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
      "> **Easy Coding** · **Approval: Guard** · **Workflow: Adaptive** · Ready · Use `ec-workflow` to start or resume a task, `ec-brainstorming` to brainstorm, `ec-task-management` to manage tasks, or `ec-config` to inspect or change modes",
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

    const sessionPath = claudeFallbackSessionPath(tempDir);
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

    expect(stdout).toContain(
      "> **Easy Coding** · **Approval: Guard** · **Workflow: Adaptive** · Ready · Use `ec-workflow`",
    );
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

    expect(stdout).toContain(
      "> **Easy Coding** · **Approval: Guard** · **Workflow: Adaptive** · `06-10-demo` · `IMPLEMENT` · Handoff -> `codex`",
    );
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
      claudeFallbackSessionPath(tempDir),
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
    expect(stdout).toContain(
      "> **Easy Coding** · **Approval: Guard** · **Workflow: Adaptive** · `06-26-analysis` · `ANALYSIS`",
    );
    expect(stdout).toContain("[workflow-state:ANALYSIS]");
    expect(stdout).toContain("[current-task:06-26-analysis]");
  });

  it("generated hooks show missing state when session points to missing task", async () => {
    await configureClaude(tempDir);
    await writeRuntimeScaffold(tempDir, ["claude-code"]);
    await mkdir(path.join(tempDir, ".easy-coding", "sessions"), { recursive: true });
    await writeFile(
      claudeFallbackSessionPath(tempDir),
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

    expect(stdout).toContain(
      "> **Easy Coding** · **Approval: Guard** · **Workflow: Adaptive** · `missing-task` · `MISSING`",
    );
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
      claudeFallbackSessionPath(tempDir),
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

    expect(stdout).toContain(
      "> **Easy Coding** · **Approval: Guard** · **Workflow: Adaptive** · Ready · Use `ec-workflow`",
    );
    expect(stdout).toContain("[workflow-state:idle]");
    expect(stdout).not.toContain("[current-task:06-12-done]");
    expect(stdout).not.toContain("[current-task:06-12-active]");
    const session = JSON.parse(await readFile(claudeFallbackSessionPath(tempDir), "utf8"));
    expect(session.current_task).toBeNull();
  });

  it("generated hooks keep option 1 read-only until the agent confirms explicitly", async () => {
    await configureClaude(tempDir);
    await writeRuntimeScaffold(tempDir, ["claude-code"]);
    await mkdir(path.join(tempDir, ".easy-coding", "sessions"), { recursive: true });
    await mkdir(path.join(tempDir, ".easy-coding", "tasks", "06-25-confirm"), { recursive: true });
    await writeFile(
      claudeFallbackSessionPath(tempDir),
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

    expect(stdout).toContain(
      "> **Easy Coding** · **Approval: Guard** · **Workflow: Adaptive** · `06-25-confirm` · `ANALYSIS`",
    );
    expect(stdout).toContain("[workflow-state:ANALYSIS]");
    expect(stdout).toContain("[easy-coding:pending-transition:ANALYSIS->IMPLEMENT]");
    const task = JSON.parse(
      await readFile(
        path.join(tempDir, ".easy-coding", "tasks", "06-25-confirm", "task.json"),
        "utf8",
      ),
    );
    expect(task.status).toBe("ANALYSIS");
    expect(task.stage_history.map((entry: { stage: string }) => entry.stage)).toEqual(["ANALYSIS"]);
    const session = JSON.parse(await readFile(claudeFallbackSessionPath(tempDir), "utf8"));
    expect(session.last_seen_stage).toBe("ANALYSIS");
  });

  it("generated hooks keep a pending edge when the user requests revision", async () => {
    await configureClaude(tempDir);
    await writeRuntimeScaffold(tempDir, ["claude-code"]);
    await mkdir(path.join(tempDir, ".easy-coding", "sessions"), { recursive: true });
    await mkdir(path.join(tempDir, ".easy-coding", "tasks", "06-25-revise"), { recursive: true });
    await writeFile(
      claudeFallbackSessionPath(tempDir),
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

    expect(stdout).toContain(
      "> **Easy Coding** · **Approval: Guard** · **Workflow: Adaptive** · `06-25-revise` · `ANALYSIS`",
    );
    expect(stdout).toContain("[workflow-state:ANALYSIS]");
    expect(stdout).toContain("[easy-coding:pending-transition:ANALYSIS->IMPLEMENT]");
    const task = JSON.parse(
      await readFile(
        path.join(tempDir, ".easy-coding", "tasks", "06-25-revise", "task.json"),
        "utf8",
      ),
    );
    expect(task.status).toBe("ANALYSIS");
    expect(task.stage_history.map((entry: { stage: string }) => entry.stage)).toEqual(["ANALYSIS"]);
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
      claudeFallbackSessionPath(tempDir),
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
    const taskPath = path.join(tempDir, ".easy-coding", "tasks", "06-25-discuss", "task.json");
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
      expect(stdout).toContain(
        "> **Easy Coding** · **Approval: Guard** · **Workflow: Adaptive** · `06-25-discuss` · `ANALYSIS`",
      );
      expect(stdout).toContain("[easy-coding:pending-transition:ANALYSIS->IMPLEMENT]");
    }

    const task = JSON.parse(await readFile(taskPath, "utf8"));
    expect(task.status).toBe("ANALYSIS");
    expect(task.stage_history.map((entry: { stage: string }) => entry.stage)).toEqual(["ANALYSIS"]);
    expect(task.pending_transition).toMatchObject({ from: "ANALYSIS", to: "IMPLEMENT" });
  });

  it("generated hooks keep verification fallback input read-only", async () => {
    await configureClaude(tempDir);
    await writeRuntimeScaffold(tempDir, ["claude-code"]);
    await mkdir(path.join(tempDir, ".easy-coding", "sessions"), { recursive: true });
    await mkdir(path.join(tempDir, ".easy-coding", "tasks", "06-25-verify"), { recursive: true });
    await writeFile(
      claudeFallbackSessionPath(tempDir),
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

    expect(stdout).toContain(
      "> **Easy Coding** · **Approval: Guard** · **Workflow: Adaptive** · `06-25-verify` · `VERIFICATION`",
    );
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
      claudeFallbackSessionPath(tempDir),
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

    expect(stdout).toContain(
      "> **Easy Coding** · **Approval: Guard** · **Workflow: Adaptive** · `06-25-review` · `REVIEW`",
    );
    expect(stdout).toContain("[workflow-state:REVIEW]");
    const task = JSON.parse(
      await readFile(
        path.join(tempDir, ".easy-coding", "tasks", "06-25-review", "task.json"),
        "utf8",
      ),
    );
    expect(task.status).toBe("REVIEW");
    expect(task.stage_history.map((entry: { stage: string }) => entry.stage)).toEqual(["REVIEW"]);
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
    expect(createOutput.status_line).toContain(
      "> **Easy Coding** · **Approval: Guard** · **Workflow: Adaptive** · `06-12-api` · `INIT`",
    );
    expect(createOutput.status_context).toContain("[workflow-state:INIT]");
    expect(createOutput.status_context).toContain("[current-task:06-12-api]");

    const stages = ["ANALYSIS", "IMPLEMENT", "REVIEW", "VERIFICATION", "MEMORY", "COMPLETE"];
    const automaticStages = new Set(["ANALYSIS", "REVIEW", "VERIFICATION", "COMPLETE"]);
    for (const stage of stages) {
      if (stage === "VERIFICATION" || stage === "MEMORY") {
        const fingerprints = JSON.parse(
          execFileSync(
            "python3",
            [
              stateApi,
              "evidence-fingerprints",
              "--session-file",
              sessionFile,
              "--agent",
              "claude-code",
            ],
            { cwd: tempDir, encoding: "utf8" },
          ),
        ) as {
          implementation_fingerprint: string;
          config_fingerprint: string;
        };
        const record =
          stage === "VERIFICATION"
            ? {
                type: "review",
                dimension: "integration",
                passed: true,
                reviewer: "claude-code",
                implementation_fingerprint: fingerprints.implementation_fingerprint,
                timestamp: "2026-07-27T00:00:00Z",
                findings: [],
              }
            : {
                type: "verify",
                check: "integration fixture",
                check_type: "test",
                command: "fixture",
                passed: true,
                applicable: true,
                implementation_fingerprint: fingerprints.implementation_fingerprint,
                config_fingerprint: fingerprints.config_fingerprint,
                timestamp: "2026-07-27T00:00:00Z",
              };
        await appendFile(
          path.join(
            tempDir,
            ".easy-coding",
            "tasks",
            "06-12-api",
            "execution.jsonl",
          ),
          `${JSON.stringify(record)}\n`,
          "utf8",
        );
      }
      if (stage === "COMPLETE") {
        const memoryId = "SM-019f69d3-5c86-7a10-87a1-7f1774ccb959";
        const memoryName = `${memoryId}_20260612_fixture.md`;
        await writeFile(
          path.join(tempDir, ".easy-coding", "memory", "short", memoryName),
          `---\nmemory_schema: 2\nid: ${memoryId}\nsource_task: 06-12-api\ndate: 2026-06-12\n---\n`,
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
            `.easy-coding/memory/short/${memoryName}`,
            "--agent",
            "claude-code",
          ],
          { cwd: tempDir, encoding: "utf8" },
        );
        await writeFile(
          path.join(tempDir, ".easy-coding", "ABSTRACT.md"),
          "# Architecture\n\nLifecycle fixture.\n",
          "utf8",
        );
        await writeFile(
          path.join(tempDir, ".easy-coding", "CHANGELOG.md"),
          "# Architecture changelog\n",
          "utf8",
        );
        execFileSync("python3", [stateApi, "memory-instruction", "--session-file", sessionFile], {
          cwd: tempDir,
          encoding: "utf8",
        });
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
        expect(transitionOutput.status_line).toContain(
          "> **Easy Coding** · **Approval: Guard** · **Workflow: Adaptive** · Ready",
        );
        expect(transitionOutput.status_context).toContain("[workflow-state:idle]");
      } else {
        expect(transitionOutput.status).toBe(stage);
        const expectedWorkflow = stage === "ANALYSIS" ? "Adaptive" : "Standard";
        expect(transitionOutput.status_line).toContain(
          `> **Easy Coding** · **Approval: Guard** · **Workflow: ${expectedWorkflow}** · \`06-12-api\` · \`${stage}\``,
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
      [stateApi, "close-current", "--reason", "no longer needed", "--agent", "claude-code"],
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

    const session = JSON.parse(await readFile(claudeFallbackSessionPath(tempDir), "utf8"));
    expect(session.current_task).toBeNull();

    const hook = path.join(tempDir, ".claude", "hooks", "inject-workflow-state.py");
    const stdout = execFileSync("python3", [hook], {
      cwd: tempDir,
      input: "{}",
      encoding: "utf8",
    });
    expect(stdout).toContain(
      "> **Easy Coding** · **Approval: Guard** · **Workflow: Adaptive** · Ready · Use `ec-workflow`",
    );
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
