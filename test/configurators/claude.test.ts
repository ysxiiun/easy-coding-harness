import { execFileSync, execSync, spawn } from "node:child_process";
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
    expect(skill).toContain("Every repository-mutation task uses this graph");
    expect(skill).toContain("Preserve `pending_transition` on cancellation");
    expect(skill).toContain("raise-workflow-mode");
    expect(skill).toContain("review fingerprint");
    expect(skill).toContain("verification fingerprint");
    expect(skill).toContain("Missing: tell the user to run `easy-coding init`");
    expect(skill).toContain("During QUALITY, return to IMPLEMENT before");
    expect(skill).toContain("[easy-coding:lite-direct]");
    expect(skill).not.toContain("workflow_mode_legacy_direct_edge");
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
    expect(analysisSkill).toContain("concise proposal receipt instead of");
    expect(analysisSkill).toContain("[View full Dev-Spec](</absolute/path/to/dev-spec.md>)");
    expect(analysisSkill).toContain("The proposal receipt must survive the client boundary");
    expect(analysisSkill).toContain("Repeat the compact receipt and full Dev-Spec link/path");
    expect(analysisSkill).toContain(
      "native choice returns or a matching transition call completes",
    );
    expect(analysisSkill).toContain("For an automatic edge, do not add a pause");
    expect(analysisSkill).toContain("decision_status: closed");
    expect(analysisSkill).toContain("progressive cost budget");
    expect(analysisSkill).toContain("## Local implementation baseline");
    expect(analysisSkill).toContain("at least five units");
    expect(analysisSkill).toContain("compound high-risk and complexity signals");
    expect(analysisSkill).toContain("unused `repo_paths`");

    const implementingSkill = await readFile(
      path.join(tempDir, ".claude", "skills", "ec-implementing", "SKILL.md"),
      "utf8",
    );
    expect(implementingSkill).toContain("A single low-risk unit may be implemented inline");
    expect(implementingSkill).toContain("acceptance_criteria");
    expect(implementingSkill).toContain("Every Harness task transitions from IMPLEMENT to QUALITY");
    expect(implementingSkill).toContain("Codex with Easy Coding");
    expect(implementingSkill).toContain("Every newly added field in a data-bearing model");
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
    expect(implementerAgent).toContain("Do not run quality commands");
    expect(implementerAgent).toContain("otherwise an empty array");
    expect(implementerAgent).toContain("`Code Comments`");
    expect(implementerAgent).toContain("`Local Baseline`");
    expect(implementerAgent).toContain("fragmented one-use");
    expect(implementerAgent).toContain("new core Java class");

    const qualitySkill = await readFile(
      path.join(tempDir, ".claude", "skills", "ec-quality", "SKILL.md"),
      "utf8",
    );
    expect(qualitySkill).toContain("one candidate, two read-only gates");
    expect(qualitySkill).toContain("implementation/config fingerprints");
    expect(qualitySkill).toContain("The first review must report the complete in-scope finding set");
    expect(qualitySkill).toContain("Do not demand defensive null checks");
    expect(qualitySkill).toContain("constant extraction");
    expect(qualitySkill).toContain("One repair bundle");

    const reviewerAgent = await readFile(
      path.join(tempDir, ".claude", "agents", "ec-reviewer.md"),
      "utf8",
    );
    expect(reviewerAgent).toContain("evidenced Local Baseline");
    expect(reviewerAgent).toContain("missing multiline Javadoc");
    const verifierAgent = await readFile(
      path.join(tempDir, ".claude", "agents", "ec-verifier.md"),
      "utf8",
    );
    expect(verifierAgent).toContain("lint | typecheck | test | build | coverage");

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
    expect(taskManagementSkill).toContain("inspect-dev-spec --manifest-only");
    expect(taskManagementSkill).toContain(
      "Do not call\n`select-dev-spec-scope` during routing",
    );
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
    expect(qualitySkill).toContain('coverage result with `coverage_scope:"local"`');
    expect(qualitySkill).not.toContain('coverage_scope:"gitlab"');
    expect(qualitySkill).not.toContain("pipeline_url");
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
    const stateApi = await readFile(
      path.join(tempDir, ".claude", "hooks", "easy_coding_state.py"),
      "utf8",
    );
    expect(stateApi).toContain("READY_LINE");
    expect(stateApi).toContain('INSTALLED_WORKFLOW_AGENT = "claude-code"');
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
    expect(main).toContain("canonical owner ID `claude-code`");
    expect(main).toContain("`Claude with Easy Coding` is not a workflow identity");
    expect(main).toContain("injected session namespace must agree");
    expect(main).toContain("project `behavior.approval_mode`");
    expect(main).toContain("project `behavior.workflow_mode`");
    expect(main).toContain("`auto-transition`");
    expect(main).toContain("Every mutation task runs QUALITY");
    expect(main).toContain("A confirmation-required boundary is not fully presented");
    expect(main).toContain("IMPLEMENT gate must preserve enter QUALITY");
    expect(main).toContain("explicitly guarantees an indefinite wait");
    expect(main).toContain("pre-render the matching numbered fallback");
    expect(main).toContain("Text shown before a later tool call is non-durable");
    expect(main).toContain("Repeat the complete\n  fallback while the edge is pending");
    expect(main).toContain("Auto adds no pause and carries the Dev-Spec link/path");
    expect(main).toContain("consume a matching\n  numbered reply against the stored edge");
    expect(main).toContain("Pure read-only conversation stays Ready and creates no task");
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
    expect(workflowSkill).toContain("non-durable process presentation");
    expect(workflowSkill).toContain("repeat the receipt and full Dev-Spec link/path");
    expect(workflowSkill).toContain(
      "native choice returns or a matching transition call completes",
    );
    expect(workflowSkill).toContain("An automatic ANALYSIS -> IMPLEMENT edge must not pause");

    expect(analysisSkill).toContain("--spec-task <selected-task-id>");
    expect(analysisSkill).toContain("`exact` and `scope-unchanged` use the fast projection path");
    expect(analysisSkill).toContain("second round of Spec");

    expect(qualitySkill).toContain("evidence-fingerprints");
    expect(qualitySkill).toContain("candidate fingerprint");
    expect(qualitySkill).toContain("config fingerprints");
    expect(qualitySkill).not.toContain("then re-REVIEW");
    expect(qualitySkill).not.toContain("MEMORY_SHORT");
    expect(qualitySkill).not.toContain("MEMORY_LONG");

    const liteSkill = await readFile(
      path.join(tempDir, ".claude", "skills", "ec-lite", "SKILL.md"),
      "utf8",
    );
    expect(liteSkill).toContain("controlled only by the user");
    expect(liteSkill).toContain("Cancel Lite startup");
    expect(liteSkill).toContain("Close the task and start Lite");
    expect(liteSkill).toContain("Ignore the original task and start Lite");
    expect(liteSkill).toContain("No Task / Quality / Memory");

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
      "ec-lite",
      "ec-quality",
      "ec-task-close",
      "ec-task-management",
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

  it("generated hooks migrate legacy state without inventing a handoff event", async () => {
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
          last_agent: "Codex with Easy Coding",
          stage_history: [
            {
              stage: "ANALYSIS",
              agent: "Codex with Easy Coding",
              entered_at: "2026-06-10T00:01:00Z",
            },
          ],
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
          created_by: "Codex with Easy Coding",
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
      "> **Easy Coding** · **Approval: Guard** · **Workflow: Adaptive** · `06-10-demo` · `IMPLEMENT`",
    );
    expect(stdout).toContain("[workflow-state:IMPLEMENT]");
    expect(stdout).toContain("[current-task:06-10-demo]");
    expect(stdout).not.toContain("Handoff ->");
    expect(stdout).not.toContain("[easy-coding:handoff-from:");
    const migratedTask = JSON.parse(
      await readFile(
        path.join(tempDir, ".easy-coding", "tasks", "06-10-demo", "task.json"),
        "utf8",
      ),
    );
    expect(migratedTask.created_by).toBe("codex");
    expect(migratedTask.last_agent).toBe("codex");
    expect(migratedTask.stage_history).toEqual([
      {
        stage: "ANALYSIS",
        agent: "codex",
        entered_at: "2026-06-10T00:01:00Z",
      },
    ]);
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

    const stages = ["ANALYSIS", "IMPLEMENT", "QUALITY", "MEMORY", "COMPLETE"];
    const automaticStages = new Set(["ANALYSIS", "QUALITY", "COMPLETE"]);
    for (const stage of stages) {
      if (stage === "MEMORY") {
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
          quality_attempt: { attempt: number };
        };
        const records = [
          {
            type: "review",
            dimension: "integration",
            passed: true,
            reviewer: "claude-code",
            implementation_fingerprint: fingerprints.implementation_fingerprint,
            quality_attempt: fingerprints.quality_attempt.attempt,
            timestamp: "2026-07-27T00:00:00Z",
            findings: [],
          },
          {
            type: "verify",
            check: "integration fixture",
            check_type: "test",
            command: "fixture",
            passed: true,
            applicable: true,
            implementation_fingerprint: fingerprints.implementation_fingerprint,
            config_fingerprint: fingerprints.config_fingerprint,
            quality_attempt: fingerprints.quality_attempt.attempt,
            timestamp: "2026-07-27T00:00:00Z",
          },
        ];
        await appendFile(
          path.join(
            tempDir,
            ".easy-coding",
            "tasks",
            "06-12-api",
            "execution.jsonl",
          ),
          `${records.map((record) => JSON.stringify(record)).join("\n")}\n`,
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

  it("state API keeps Lite direct, proposal, and active-task choices separate from tasks", async () => {
    execFileSync("git", ["init"], { cwd: tempDir });
    await configureClaude(tempDir);
    await writeRuntimeScaffold(tempDir, ["claude-code"]);

    const stateApi = path.join(tempDir, ".claude", "hooks", "easy_coding_state.py");
    const sessionFile = ".easy-coding/sessions/lite-session.json";
    const runState = (args: string[]) =>
      JSON.parse(
        execFileSync(
          "python3",
          [stateApi, ...args, "--session-file", sessionFile, "--agent", "claude-code"],
          { cwd: tempDir, encoding: "utf8" },
        ),
      ) as Record<string, unknown>;

    const enabled = runState(["enable-lite"]);
    expect(enabled).toMatchObject({ action: "enable-lite", lite_mode: true, status: "idle" });
    expect(String(enabled.status_line)).toContain(
      "**Lite Direct** · Ready · No Task / Quality / Memory",
    );
    expect(String(enabled.status_context)).toContain("[easy-coding:lite-direct]");
    expect(() =>
      runState(["set-lite-proposal", "--summary", "Missing target"]),
    ).toThrow();
    expect(() =>
      runState([
        "set-lite-proposal",
        "--summary",
        "Unsafe target",
        "--target-file",
        "../outside.ts",
      ]),
    ).toThrow();
    expect(() =>
      runState([
        "set-lite-proposal",
        "--summary",
        "Runtime target",
        "--target-file",
        ".easy-coding/sessions/lite-session.json",
      ]),
    ).toThrow();

    const setProposal = () =>
      runState([
        "set-lite-proposal",
        "--summary",
        "Change one local parameter",
        "--target-file",
        "src/example.ts",
      ]);
    const proposalDigest = (proposal: Record<string, unknown>) =>
      String((proposal.lite_proposal as { digest: string }).digest);

    const proposed = setProposal();
    const digest = String((proposed.lite_proposal as { digest: string }).digest);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(String(proposed.status_line)).toContain("Awaiting Confirmation");

    const liteSessionPath = path.join(tempDir, sessionFile);
    const tamperedBeforeConfirm = JSON.parse(await readFile(liteSessionPath, "utf8"));
    tamperedBeforeConfirm.lite_proposal.summary = "Different unconfirmed change";
    await writeFile(liteSessionPath, JSON.stringify(tamperedBeforeConfirm), "utf8");
    expect(() => runState(["confirm-lite-proposal", "--digest", digest])).toThrow();

    const driftedProposal = setProposal();
    const driftedDigest = proposalDigest(driftedProposal);
    await mkdir(path.join(tempDir, "src"), { recursive: true });
    await writeFile(path.join(tempDir, "src", "example.ts"), "external change\n", "utf8");
    expect(() => runState(["confirm-lite-proposal", "--digest", driftedDigest])).toThrow();
    await rm(path.join(tempDir, "src", "example.ts"));

    const reproposed = setProposal();
    const reproposedDigest = proposalDigest(reproposed);
    expect(reproposedDigest).not.toBe(digest);
    expect(runState(["confirm-lite-proposal", "--digest", reproposedDigest])).toMatchObject({
      action: "confirm-lite-proposal",
      lite_mode: true,
    });
    expect(() =>
      runState(["confirm-lite-proposal", "--digest", reproposedDigest]),
    ).toThrow();

    const tamperedBeforeComplete = JSON.parse(await readFile(liteSessionPath, "utf8"));
    tamperedBeforeComplete.lite_proposal.target_files = ["src/other.ts"];
    await writeFile(liteSessionPath, JSON.stringify(tamperedBeforeComplete), "utf8");
    expect(() =>
      runState(["complete-lite-proposal", "--digest", reproposedDigest]),
    ).toThrow();

    const baselineProposal = setProposal();
    const baselineDigest = proposalDigest(baselineProposal);
    runState(["confirm-lite-proposal", "--digest", baselineDigest]);
    const tamperedBaseline = JSON.parse(await readFile(liteSessionPath, "utf8"));
    tamperedBaseline.lite_proposal.baseline.dirty_paths = ["src/outside.ts"];
    await writeFile(liteSessionPath, JSON.stringify(tamperedBaseline), "utf8");
    expect(() =>
      runState(["complete-lite-proposal", "--digest", baselineDigest]),
    ).toThrow();

    const finalProposal = setProposal();
    const finalDigest = proposalDigest(finalProposal);
    expect(finalDigest).not.toBe(reproposedDigest);
    runState(["confirm-lite-proposal", "--digest", finalDigest]);
    expect(() => runState(["complete-lite-proposal", "--digest", finalDigest])).toThrow();
    await mkdir(path.join(tempDir, "src"), { recursive: true });
    await writeFile(path.join(tempDir, "src", "example.ts"), "export const value = 1;\n", "utf8");
    await writeFile(path.join(tempDir, "src", "outside.ts"), "export const outside = 1;\n", "utf8");
    expect(() => runState(["confirm-lite-proposal", "--digest", finalDigest])).toThrow();
    expect(() => runState(["complete-lite-proposal", "--digest", finalDigest])).toThrow();
    await rm(path.join(tempDir, "src", "outside.ts"));
    expect(runState(["complete-lite-proposal", "--digest", finalDigest])).toMatchObject({
      action: "complete-lite-proposal",
      lite_mode: true,
      lite_proposal: null,
      changed_files: ["src/example.ts"],
    });
    expect(() =>
      runState([
        "create-task",
        "--task-id",
        "lite-forbidden",
        "--type",
        "feature",
        "--title",
        "Must not be created",
      ]),
    ).toThrow();

    runState(["disable-lite"]);
    expect(() =>
      runState([
        "create-task",
        "--task-id",
        "read-only-forbidden",
        "--type",
        "analysis",
        "--title",
        "Conversation only",
      ]),
    ).toThrow();
    runState([
      "create-task",
      "--task-id",
      "active-lite-choice",
      "--type",
      "feature",
      "--title",
      "Active task",
    ]);

    const decision = runState(["enable-lite"]);
    expect(decision).toMatchObject({
      action: "lite-active-task-decision-required",
      choices: ["cancel", "close", "ignore"],
      lite_mode: false,
    });
    runState([
      "create-task",
      "--task-id",
      "switched-lite-choice",
      "--type",
      "feature",
      "--title",
      "Switched task",
    ]);
    expect(() =>
      runState([
        "enable-lite",
        "--active-task-policy",
        "close",
        "--expected-task-id",
        "active-lite-choice",
      ]),
    ).toThrow();
    expect(
      JSON.parse(
        await readFile(
          path.join(tempDir, ".easy-coding", "tasks", "switched-lite-choice", "task.json"),
          "utf8",
        ),
      ),
    ).toMatchObject({ status: "INIT" });
    runState(["claim-task", "--task-id", "active-lite-choice"]);
    expect(runState(["enable-lite", "--active-task-policy", "cancel"])).toMatchObject({
      action: "lite-enable-cancelled",
      current_task: "active-lite-choice",
      lite_mode: false,
    });
    expect(
      runState([
        "enable-lite",
        "--active-task-policy",
        "ignore",
        "--expected-task-id",
        "active-lite-choice",
      ]),
    ).toMatchObject({
      action: "enable-lite",
      current_task: null,
      lite_mode: true,
    });
    expect(
      JSON.parse(
        await readFile(
          path.join(tempDir, ".easy-coding", "tasks", "active-lite-choice", "task.json"),
          "utf8",
        ),
      ),
    ).toMatchObject({ status: "INIT" });

    runState(["disable-lite"]);
    runState(["claim-task", "--task-id", "active-lite-choice"]);
    expect(
      runState([
        "enable-lite",
        "--active-task-policy",
        "close",
        "--expected-task-id",
        "active-lite-choice",
      ]),
    ).toMatchObject({
      action: "enable-lite",
      current_task: null,
      lite_mode: true,
    });
    expect(
      JSON.parse(
        await readFile(
          path.join(tempDir, ".easy-coding", "tasks", "active-lite-choice", "task.json"),
          "utf8",
        ),
      ),
    ).toMatchObject({ status: "CLOSED", closed_reason: "user-switched-to-lite" });
  }, 10_000);

  it("serializes Lite task decisions against concurrent task selection", async () => {
    await configureClaude(tempDir);
    await writeRuntimeScaffold(tempDir, ["claude-code"]);

    const stateApi = path.join(tempDir, ".claude", "hooks", "easy_coding_state.py");
    const sessionFile = ".easy-coding/sessions/lite-race.json";
    const commonArgs = ["--session-file", sessionFile, "--agent", "claude-code"];
    const runState = (args: string[]) =>
      execFileSync(pythonCmd, [stateApi, ...args, ...commonArgs], {
        cwd: tempDir,
        encoding: "utf8",
      });
    const runStateAsync = (args: string[]) =>
      new Promise<{ code: number | null; stderr: string }>((resolve) => {
        const child = spawn(pythonCmd, [stateApi, ...args, ...commonArgs], {
          cwd: tempDir,
        });
        let stderr = "";
        child.stderr.setEncoding("utf8");
        child.stderr.on("data", (chunk) => {
          stderr += chunk;
        });
        child.on("close", (code) => resolve({ code, stderr }));
      });

    for (const taskId of ["lite-race-a", "lite-race-b"]) {
      runState([
        "create-task",
        "--task-id",
        taskId,
        "--type",
        "feature",
        "--title",
        taskId,
      ]);
    }
    runState(["claim-task", "--task-id", "lite-race-a"]);

    const [liteResult, claimResult] = await Promise.all([
      runStateAsync([
        "enable-lite",
        "--active-task-policy",
        "close",
        "--expected-task-id",
        "lite-race-a",
      ]),
      runStateAsync(["claim-task", "--task-id", "lite-race-b"]),
    ]);
    const session = JSON.parse(
      await readFile(path.join(tempDir, sessionFile), "utf8"),
    ) as { current_task: string | null; lite_mode?: boolean };
    const taskA = JSON.parse(
      await readFile(
        path.join(tempDir, ".easy-coding", "tasks", "lite-race-a", "task.json"),
        "utf8",
      ),
    ) as { status: string };
    const taskB = JSON.parse(
      await readFile(
        path.join(tempDir, ".easy-coding", "tasks", "lite-race-b", "task.json"),
        "utf8",
      ),
    ) as { status: string };

    expect(taskB.status).toBe("INIT");
    if (session.lite_mode) {
      expect(liteResult.code).toBe(0);
      expect(claimResult.code).toBe(1);
      expect(session.current_task).toBeNull();
      expect(taskA.status).toBe("CLOSED");
    } else {
      expect(liteResult.code).toBe(1);
      expect(liteResult.stderr).toContain("Active task changed");
      expect(claimResult.code).toBe(0);
      expect(session.current_task).toBe("lite-race-b");
      expect(taskA.status).toBe("INIT");
    }
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
