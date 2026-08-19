import { execFileSync, execSync, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { configureCodex } from "../../src/configurators/codex.js";
import { configureQoder } from "../../src/configurators/qoder.js";
import { renderHookCommand, shellDoubleQuoteArg } from "../../src/configurators/shared.js";
import { PLATFORM_META, type TemplateContext } from "../../src/types/platform.js";
import { pathExists } from "../../src/utils/file-writer.js";
import { writeInstallManifest } from "../../src/utils/install-manifest.js";

let tempDir: string;
const pythonCmd = process.platform === "win32" ? "python" : "python3";

function cleanAgentEnvironment(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const environment = { ...process.env };
  delete environment.CODEX_THREAD_ID;
  delete environment.QODER_PROJECT_DIR;
  delete environment.CLAUDE_PROJECT_DIR;
  return { ...environment, ...overrides };
}

function hookCommand(root: string, baseDir: string, scriptName: string): string {
  return renderHookCommand(root, platformContext(baseDir), scriptName);
}

function platformContext(baseDir: string): TemplateContext {
  if (baseDir === ".codex") {
    return PLATFORM_META.codex.templateContext;
  }
  return {
    ...PLATFORM_META.qoder.templateContext,
    platform_config_dir: baseDir,
  };
}

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "ec-platforms-"));
});

afterEach(async () => {
  delete process.env.EC_QODER_VARIANT;
  await rm(tempDir, { recursive: true, force: true });
});

describe("shellDoubleQuoteArg", () => {
  it("uses POSIX escaping outside Windows", () => {
    expect(shellDoubleQuoteArg('/tmp/repo $HOME `echo bad` "quote"/hooks', "darwin")).toBe(
      '"/tmp/repo \\$HOME \\`echo bad\\` \\"quote\\"/hooks"',
    );
  });

  it("does not apply POSIX expansion escapes on Windows", () => {
    expect(shellDoubleQuoteArg("C:/repo $HOME `echo bad`/hooks", "win32")).toBe(
      '"C:/repo $HOME `echo bad`/hooks"',
    );
  });

  it("rejects invalid Windows hook paths with double quotes", () => {
    expect(() => shellDoubleQuoteArg('C:/repo "bad"/hooks', "win32")).toThrow(
      "Windows hook paths cannot contain double quotes.",
    );
  });
});

describe("configureCodex", () => {
  it("writes Codex skills to .agents and platform files to .codex", async () => {
    await configureCodex(tempDir);

    const skill = await readFile(
      path.join(tempDir, ".agents", "skills", "ec-workflow", "SKILL.md"),
      "utf8",
    );
    expect(skill).toContain("`$ec-init`");
    expect(skill).toContain("approval_mode = approve|guard|confirm|auto");
    expect(skill).toContain("workflow_mode = adaptive|fast|standard|strict");
    expect(skill).toContain("Every repository-mutation task uses this graph");
    expect(skill).toContain("raise-workflow-mode");
    expect(skill).toContain("Missing: tell the user to run `easy-coding init`");
    expect(skill).toContain("During QUALITY, return to IMPLEMENT before");
    expect(skill).toContain("--manifest-only");
    expect(skill).toContain("never reconstruct completion from another local Harness task");
    expect(skill).not.toContain("{{");
    const analysisSkill = await readFile(
      path.join(tempDir, ".agents", "skills", "ec-analysis", "SKILL.md"),
      "utf8",
    );
    expect(analysisSkill).toContain("propose-workflow-mode");
    expect(analysisSkill).toContain("mechanical minimum");
    expect(analysisSkill).toContain("acceptance_criteria");
    expect(analysisSkill).toContain("No transition without a valid workflow proposal");
    expect(analysisSkill).toContain("--spec-task <selected-task-id>");
    expect(analysisSkill).toContain("`exact` and `scope-unchanged` use the fast projection path");
    expect(analysisSkill).toContain("at least five units");
    expect(analysisSkill).toContain("unused `repo_paths`");
    const noHarnessSkill = await readFile(
      path.join(tempDir, ".agents", "skills", "ec-no-harness", "SKILL.md"),
      "utf8",
    );
    expect(noHarnessSkill).toContain("disable-harness --session-file");
    expect(noHarnessSkill).not.toContain("{{");
    const gitSkill = await readFile(
      path.join(tempDir, ".agents", "skills", "ec-git", "SKILL.md"),
      "utf8",
    );
    expect(gitSkill).toContain("status is neither\n   `COMPLETE` nor `CLOSED`");
    expect(gitSkill).toContain("`COMPLETE` and `CLOSED` are terminal states");
    expect(gitSkill).toContain("Changes written by `easy-coding upgrade`");
    expect(gitSkill).toContain("current agent did not write them");
    const taskManagementSkill = await readFile(
      path.join(tempDir, ".agents", "skills", "ec-task-management", "SKILL.md"),
      "utf8",
    );
    expect(taskManagementSkill).toContain("Mode inspection and configuration belongs to `ec-config`");
    expect(taskManagementSkill).not.toContain("{{");
    const configSkill = await readFile(
      path.join(tempDir, ".agents", "skills", "ec-config", "SKILL.md"),
      "utf8",
    );
    expect(configSkill).toContain("set-tdd");
    expect(configSkill).not.toContain("{{");
    const tddInitSkill = await readFile(
      path.join(tempDir, ".agents", "skills", "ec-tdd-init", "SKILL.md"),
      "utf8",
    );
    expect(tddInitSkill).toContain("historical coverage required: no");
    expect(tddInitSkill).not.toContain("{{");
    expect(
      await readFile(path.join(tempDir, ".agents", "skills", "ec-quality", "SKILL.md"), "utf8"),
    ).toContain("one candidate, two read-only gates");
    expect(
      await readFile(path.join(tempDir, ".agents", "skills", "ec-lite", "SKILL.md"), "utf8"),
    ).toContain("controlled only by the user");
    expect(await pathExists(path.join(tempDir, ".codex", "hooks", "session-start.py"))).toBe(true);
    expect(await pathExists(path.join(tempDir, ".codex", "hooks", "easy_coding_status.py"))).toBe(
      true,
    );
    expect(await pathExists(path.join(tempDir, ".codex", "hooks", "easy_coding_state.py"))).toBe(
      true,
    );
    expect(await pathExists(path.join(tempDir, ".codex", "hooks", "easy_dev_spec.py"))).toBe(
      true,
    );
    expect(
      await pathExists(path.join(tempDir, ".codex", "hooks", "easy_dev_spec_protocol.py")),
    ).toBe(true);
    expect(
      await pathExists(path.join(tempDir, ".codex", "hooks", "easy_dev_spec_execution.py")),
    ).toBe(true);
    expect(
      await pathExists(path.join(tempDir, ".codex", "hooks", "inject-workflow-state.py")),
    ).toBe(true);
    expect(
      await pathExists(path.join(tempDir, ".codex", "hooks", "inject-subagent-context.py")),
    ).toBe(false);

    const hooks = await readFile(path.join(tempDir, ".codex", "hooks.json"), "utf8");
    expect(hooks).toContain(".codex/hooks");
    expect(hooks).toContain("session-start.py");
    expect(hooks).not.toContain(tempDir);
    expect(hooks).not.toContain(`${pythonCmd} .codex/hooks/`);
    const hooksJson = JSON.parse(hooks) as {
      hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>>;
    };
    const sessionStartCommands = hooksJson.hooks.SessionStart.flatMap((group) =>
      group.hooks.map((hook) => hook.command),
    );
    const userPromptCommands = hooksJson.hooks.UserPromptSubmit.flatMap((group) =>
      group.hooks.map((hook) => hook.command),
    );
    expect(sessionStartCommands).toEqual([hookCommand(tempDir, ".codex", "session-start.py")]);
    expect(userPromptCommands).toEqual([
      hookCommand(tempDir, ".codex", "inject-workflow-state.py"),
    ]);

    const agent = await readFile(path.join(tempDir, ".codex", "agents", "ec-implementer.toml"), "utf8");
    expect(agent).toContain('name = "ec-implementer"');
    expect(agent).toContain('task card\'s "Code Comments"');
    expect(agent).toContain('task card\'s "Local Baseline"');
    expect(agent).toContain("fragmented one-use");
    expect(agent).toContain("new core Java class");
    const reviewer = await readFile(
      path.join(tempDir, ".codex", "agents", "ec-reviewer.toml"),
      "utf8",
    );
    expect(reviewer).toContain("evidenced Local Baseline");
    expect(reviewer).toContain("missing multiline Javadoc");

    const main = await readFile(path.join(tempDir, "AGENTS.md"), "utf8");
    expect(main).toContain("Codex: `$ec-*`");
    expect(main).toContain("Qoder: `/ec-*`");
    expect(main).toContain("single Markdown blockquote status line");
    expect(main).toContain(
      "- Ready: > **Easy Coding** · **Approval: {approval-mode}** · **Workflow: {workflow-mode}** · Ready",
    );
    expect(main).toContain("Every mutation task runs QUALITY");
    expect(main).toContain("A confirmation-required boundary is not fully presented");
    expect(main).toContain("IMPLEMENT gate must preserve enter QUALITY");
    expect(main).toContain("explicitly guarantees an indefinite wait");
    expect(main).toContain("pre-render the matching numbered fallback");
    expect(main).toContain("consume a matching\n  numbered reply against the stored edge");
    expect(main).toContain("set `decision_status: open`");
    expect(main).toContain("progressively record");
    expect(main).toContain("never paste the full");
    expect(main).not.toContain("[ Easy Coding ] ready");
    expect(main).not.toContain("tasks``");
    expect(main).not.toContain("}```");
  });

  it("preserves relative hook paths when writing the manifest from launcher commands", async () => {
    const spacedDir = path.join(tempDir, "repo  with  spaces");
    await mkdir(spacedDir, { recursive: true });

    const artifacts = await configureCodex(spacedDir);
    await writeInstallManifest(spacedDir, {
      harnessVersion: "0.5.1",
      agents: ["codex"],
      artifacts,
    });

    const manifest = JSON.parse(
      await readFile(path.join(spacedDir, ".easy-coding", "install-manifest.json"), "utf8"),
    );
    const hookPaths = manifest.hook_registrations.map(
      (registration: { hook_path: string | null }) => registration.hook_path,
    );

    expect(hookPaths).toContain(".codex/hooks/session-start.py");
    expect(hookPaths).toContain(".codex/hooks/inject-workflow-state.py");
  });

  it("isolates Codex App threads for agent and agentless state API commands", async () => {
    await configureCodex(tempDir);
    await mkdir(path.join(tempDir, ".easy-coding"), { recursive: true });
    const stateApi = path.join(tempDir, ".codex", "hooks", "easy_coding_state.py");
    const firstThreadId = "019f893f-5029-7921-9a2c-444fc7e7ac7e";
    const secondThreadId = "019f893f-5029-7921-9a2c-444fc7e7ac7f";
    const firstEnvironment = cleanAgentEnvironment({ CODEX_THREAD_ID: firstThreadId });
    const secondEnvironment = cleanAgentEnvironment({ CODEX_THREAD_ID: secondThreadId });

    execFileSync(
      pythonCmd,
      [
        stateApi,
        "create-task",
        "--task-id",
        "fallback-task",
        "--type",
        "feature",
        "--title",
        "fallback",
        "--agent",
        "codex",
      ],
      { cwd: tempDir, encoding: "utf8", env: firstEnvironment },
    );
    execFileSync(
      pythonCmd,
      [
        stateApi,
        "create-task",
        "--task-id",
        "second-thread-task",
        "--type",
        "feature",
        "--title",
        "second thread",
        "--agent",
        "codex",
      ],
      { cwd: tempDir, encoding: "utf8", env: secondEnvironment },
    );
    const firstSnapshot = JSON.parse(
      execFileSync(pythonCmd, [stateApi, "snapshot"], {
        cwd: tempDir,
        encoding: "utf8",
        env: firstEnvironment,
      }),
    );
    const secondSnapshot = JSON.parse(
      execFileSync(pythonCmd, [stateApi, "snapshot"], {
        cwd: tempDir,
        encoding: "utf8",
        env: secondEnvironment,
      }),
    );

    expect(firstSnapshot.current_task).toBe("fallback-task");
    expect(firstSnapshot.session_file).toContain(`codex-${firstThreadId}.json`);
    expect(secondSnapshot.current_task).toBe("second-thread-task");
    expect(secondSnapshot.session_file).toContain(`codex-${secondThreadId}.json`);
    await expect(
      readFile(
        path.join(tempDir, ".easy-coding", "sessions", `codex-${firstThreadId}.json`),
        "utf8",
      ),
    ).resolves.toContain('"session_source": "codex-thread-id"');
    await expect(
      readFile(
        path.join(tempDir, ".easy-coding", "sessions", `codex-${secondThreadId}.json`),
        "utf8",
      ),
    ).resolves.toContain('"session_source": "codex-thread-id"');
  });

  it("runs portable launcher hook commands from paths with special characters", async () => {
    const specialDir = path.join(tempDir, 'repo $HOME `echo bad` "quote"');
    await mkdir(specialDir, { recursive: true });

    const artifacts = await configureCodex(specialDir);
    await mkdir(path.join(specialDir, ".easy-coding"), { recursive: true });

    const hooksJson = JSON.parse(await readFile(path.join(specialDir, ".codex", "hooks.json"), "utf8")) as {
      hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>>;
    };
    const command = hooksJson.hooks.SessionStart[0].hooks[0].command;

    expect(command).not.toContain(specialDir);
    expect(command).toContain(".codex/hooks/session-start.py");
    execSync(command, {
      cwd: specialDir,
      input: JSON.stringify({
        cwd: specialDir,
        hook_event_name: "SessionStart",
        session_id: "1200",
      }),
      encoding: "utf8",
    });
    execSync(command, {
      cwd: specialDir,
      input: JSON.stringify({
        cwd: specialDir,
        hook_event_name: "SessionStart",
        session_id: "1201",
      }),
      encoding: "utf8",
    });
    expect(
      await pathExists(path.join(specialDir, ".easy-coding", "sessions", "codex-1200.json")),
    ).toBe(true);
    expect(
      await pathExists(path.join(specialDir, ".easy-coding", "sessions", "codex-1201.json")),
    ).toBe(true);
    const firstSession = JSON.parse(
      await readFile(
        path.join(specialDir, ".easy-coding", "sessions", "codex-1200.json"),
        "utf8",
      ),
    );
    expect(firstSession).toMatchObject({
      agent: "codex",
      external_session_id: "1200",
      session_key: "codex-1200",
      session_source: "hook-session-id",
    });
    const promptCommand = hooksJson.hooks.UserPromptSubmit[0].hooks[0].command;
    const promptOutput = execSync(promptCommand, {
      cwd: specialDir,
      input: JSON.stringify({
        cwd: specialDir,
        hook_event_name: "UserPromptSubmit",
        session_id: "1200",
      }),
      encoding: "utf8",
    });
    expect(promptOutput).toContain("[easy-coding:session-file:.easy-coding/sessions/codex-1200.json]");

    await writeInstallManifest(specialDir, {
      harnessVersion: "0.5.1",
      agents: ["codex"],
      artifacts,
    });
    const manifest = JSON.parse(
      await readFile(path.join(specialDir, ".easy-coding", "install-manifest.json"), "utf8"),
    );
    const hookPaths = manifest.hook_registrations.map(
      (registration: { hook_path: string | null }) => registration.hook_path,
    );
    expect(hookPaths).toContain(".codex/hooks/session-start.py");
  }, 15_000);
});

describe("shared Codex and Qoder constraints", () => {
  it("keeps the shared AGENTS generated region independent of installation order", async () => {
    const codexFirst = path.join(tempDir, "codex-first");
    const qoderFirst = path.join(tempDir, "qoder-first");

    await configureCodex(codexFirst);
    await configureQoder(codexFirst);
    await configureQoder(qoderFirst);
    await configureCodex(qoderFirst);

    const codexFirstConstraint = await readFile(path.join(codexFirst, "AGENTS.md"), "utf8");
    const qoderFirstConstraint = await readFile(path.join(qoderFirst, "AGENTS.md"), "utf8");
    expect(codexFirstConstraint).toBe(qoderFirstConstraint);
    expect(codexFirstConstraint).toContain("Codex uses\n  `.codex/hooks/easy_coding_state.py`");
    expect(codexFirstConstraint).toContain(
      "Qoder uses its installed `.qoder/hooks/easy_coding_state.py`",
    );
    expect(codexFirstConstraint).toContain("`.qodercn/hooks/easy_coding_state.py` variant");
    expect(codexFirstConstraint).toContain("Never substitute one platform's script");
  });

  it("rejects a canonical Codex owner when the Qoder state script is invoked", async () => {
    await configureCodex(tempDir);
    await configureQoder(tempDir);
    await mkdir(path.join(tempDir, ".easy-coding"), { recursive: true });
    const codexStateApi = path.join(tempDir, ".codex", "hooks", "easy_coding_state.py");
    const qoderStateApi = path.join(tempDir, ".qoder", "hooks", "easy_coding_state.py");
    expect(await readFile(codexStateApi, "utf8")).toContain(
      'INSTALLED_WORKFLOW_AGENT = "codex"',
    );
    expect(await readFile(qoderStateApi, "utf8")).toContain(
      'INSTALLED_WORKFLOW_AGENT = "qoder"',
    );

    const mismatch = spawnSync(
      "python3",
      [
        qoderStateApi,
        "create-task",
        "--task-id",
        "08-13-cross-platform",
        "--type",
        "feature",
        "--title",
        "Cross-platform mismatch",
        "--agent",
        "codex",
        "--no-set-current",
      ],
      { cwd: tempDir, encoding: "utf8", env: cleanAgentEnvironment() },
    );

    expect(mismatch.status).toBe(1);
    expect(mismatch.stderr).toContain(
      "Workflow agent mismatch: script belongs to qoder, but --agent resolved to codex",
    );
    expect(
      await pathExists(
        path.join(tempDir, ".easy-coding", "tasks", "08-13-cross-platform", "task.json"),
      ),
    ).toBe(false);

    const sessionMismatch = spawnSync(
      "python3",
      [
        qoderStateApi,
        "create-task",
        "--session-file",
        ".easy-coding/sessions/codex-thread.json",
        "--task-id",
        "08-13-cross-session",
        "--type",
        "feature",
        "--title",
        "Cross-session mismatch",
        "--agent",
        "qoder",
        "--no-set-current",
      ],
      { cwd: tempDir, encoding: "utf8", env: cleanAgentEnvironment() },
    );
    expect(sessionMismatch.status).toBe(1);
    expect(sessionMismatch.stderr).toContain(
      "Workflow session mismatch: session belongs to codex, but the state operation resolved to qoder",
    );
    expect(
      await pathExists(
        path.join(tempDir, ".easy-coding", "tasks", "08-13-cross-session", "task.json"),
      ),
    ).toBe(false);
    expect(
      execFileSync("python3", [qoderStateApi, "memory-new-id", "--agent", "qoder"], {
        cwd: tempDir,
        encoding: "utf8",
        env: cleanAgentEnvironment(),
      }),
    ).toContain('"memory_id": "SM-');
  });
});

describe("configureQoder", () => {
  it("writes standard Qoder files under .qoder", async () => {
    await configureQoder(tempDir);

    const skill = await readFile(
      path.join(tempDir, ".qoder", "skills", "ec-workflow", "SKILL.md"),
      "utf8",
    );
    expect(skill).toContain("`/ec-init`");
    expect(skill).toContain("approval_mode = approve|guard|confirm|auto");
    expect(skill).toContain("workflow_mode = adaptive|fast|standard|strict");
    expect(skill).toContain("Every repository-mutation task uses this graph");
    expect(skill).toContain("raise-workflow-mode");
    expect(skill).toContain("--manifest-only");
    expect(skill).toContain("never reconstruct completion from another local Harness task");
    expect(skill).not.toContain("{{");
    const analysisSkill = await readFile(
      path.join(tempDir, ".qoder", "skills", "ec-analysis", "SKILL.md"),
      "utf8",
    );
    expect(analysisSkill).toContain("propose-workflow-mode");
    expect(analysisSkill).toContain("mechanical minimum");
    expect(analysisSkill).toContain("acceptance_criteria");
    expect(analysisSkill).toContain("No transition without a valid workflow proposal");
    expect(analysisSkill).toContain("--spec-task <selected-task-id>");
    expect(analysisSkill).toContain("`exact` and `scope-unchanged` use the fast projection path");
    expect(analysisSkill).toContain("at least five units");
    expect(analysisSkill).toContain("unused `repo_paths`");
    const taskManagementSkill = await readFile(
      path.join(tempDir, ".qoder", "skills", "ec-task-management", "SKILL.md"),
      "utf8",
    );
    expect(taskManagementSkill).toContain("Mode inspection and configuration belongs to `ec-config`");
    expect(taskManagementSkill).not.toContain("{{");
    const configSkill = await readFile(
      path.join(tempDir, ".qoder", "skills", "ec-config", "SKILL.md"),
      "utf8",
    );
    expect(configSkill).toContain("set-tdd");
    expect(configSkill).not.toContain("{{");
    const tddInitSkill = await readFile(
      path.join(tempDir, ".qoder", "skills", "ec-tdd-init", "SKILL.md"),
      "utf8",
    );
    expect(tddInitSkill).toContain("historical coverage required: no");
    expect(tddInitSkill).not.toContain("{{");
    expect(
      await readFile(path.join(tempDir, ".qoder", "skills", "ec-quality", "SKILL.md"), "utf8"),
    ).toContain("one candidate, two read-only gates");
    expect(
      await readFile(path.join(tempDir, ".qoder", "skills", "ec-lite", "SKILL.md"), "utf8"),
    ).toContain("controlled only by the user");
    const gitSkill = await readFile(
      path.join(tempDir, ".qoder", "skills", "ec-git", "SKILL.md"),
      "utf8",
    );
    expect(gitSkill).toContain("status is neither\n   `COMPLETE` nor `CLOSED`");
    expect(gitSkill).toContain("`COMPLETE` and `CLOSED` are terminal states");
    expect(gitSkill).toContain("Changes written by `easy-coding upgrade`");
    expect(gitSkill).toContain("current agent did not write them");

    const main = await readFile(path.join(tempDir, "AGENTS.md"), "utf8");
    expect(main).toContain("A confirmation-required boundary is not fully presented");
    expect(main).toContain("IMPLEMENT gate must preserve enter QUALITY");
    expect(main).toContain("explicitly guarantees an indefinite wait");
    expect(main).toContain("pre-render the matching numbered fallback");
    expect(main).toContain("consume a matching\n  numbered reply against the stored edge");

    const settings = await readFile(path.join(tempDir, ".qoder", "settings.json"), "utf8");
    expect(settings).toContain(".qoder/hooks");
    expect(settings).not.toContain("session-start.py");
    expect(settings).not.toContain(tempDir);
    expect(settings).not.toContain(`${pythonCmd} .qoder/hooks/`);
    expect(settings).not.toContain("{{");
    const settingsJson = JSON.parse(settings) as {
      hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>>;
    };
    const commands = [
      ...settingsJson.hooks.UserPromptSubmit.flatMap((group) =>
        group.hooks.map((hook) => hook.command),
      ),
      ...settingsJson.hooks.PreToolUse.flatMap((group) => group.hooks.map((hook) => hook.command)),
    ];
    expect(commands).toEqual([
      hookCommand(tempDir, ".qoder", "inject-workflow-state.py"),
      hookCommand(tempDir, ".qoder", "inject-subagent-context.py"),
    ]);
    expect(await pathExists(path.join(tempDir, ".qoder", "hooks", "easy_coding_status.py"))).toBe(
      true,
    );
    expect(await pathExists(path.join(tempDir, ".qoder", "hooks", "easy_coding_state.py"))).toBe(
      true,
    );
    expect(await pathExists(path.join(tempDir, ".qoder", "hooks", "easy_dev_spec.py"))).toBe(
      true,
    );
    expect(
      await pathExists(path.join(tempDir, ".qoder", "hooks", "easy_dev_spec_protocol.py")),
    ).toBe(true);
    expect(
      await pathExists(path.join(tempDir, ".qoder", "hooks", "easy_dev_spec_execution.py")),
    ).toBe(true);
    expect(await pathExists(path.join(tempDir, ".qoder", "hooks", "inject-subagent-context.py"))).toBe(
      true,
    );
    const implementer = await readFile(
      path.join(tempDir, ".qoder", "agents", "ec-implementer.md"),
      "utf8",
    );
    expect(implementer).toContain("`Local Baseline`");
    expect(implementer).toContain("fragmented one-use");
    expect(implementer).toContain("new core Java class");
    const reviewer = await readFile(
      path.join(tempDir, ".qoder", "agents", "ec-reviewer.md"),
      "utf8",
    );
    expect(reviewer).toContain("evidenced Local Baseline");
    expect(reviewer).toContain("missing multiline Javadoc");
  });

  it("keeps Qoder in its own namespace when Claude compatibility variables are also present", async () => {
    await configureQoder(tempDir);
    await mkdir(path.join(tempDir, ".easy-coding"), { recursive: true });
    const settings = JSON.parse(
      await readFile(path.join(tempDir, ".qoder", "settings.json"), "utf8"),
    ) as { hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>> };
    const command = settings.hooks.UserPromptSubmit[0].hooks[0].command;
    const output = execSync(command, {
      cwd: tempDir,
      input: JSON.stringify({
        cwd: tempDir,
        hook_event_name: "UserPromptSubmit",
        session_id: "qoder-cli-session",
      }),
      encoding: "utf8",
      env: cleanAgentEnvironment({
        QODER_PROJECT_DIR: tempDir,
        CLAUDE_PROJECT_DIR: tempDir,
      }),
    });

    expect(output).toContain(
      "[easy-coding:session-file:.easy-coding/sessions/qoder-qoder-cli-session.json]",
    );
    expect(
      await pathExists(
        path.join(tempDir, ".easy-coding", "sessions", "qoder-qoder-cli-session.json"),
      ),
    ).toBe(true);
    expect(
      await pathExists(
        path.join(tempDir, ".easy-coding", "sessions", "claude-code-qoder-cli-session.json"),
      ),
    ).toBe(false);
  });

  it("uses .qodercn when the project already has the China variant directory", async () => {
    await mkdir(path.join(tempDir, ".qodercn"));
    await configureQoder(tempDir);

    const settings = await readFile(path.join(tempDir, ".qodercn", "settings.json"), "utf8");
    expect(settings).toContain(".qodercn/hooks");
    expect(settings).not.toContain("session-start.py");
    expect(settings).not.toContain(tempDir);
    expect(settings).not.toContain(`${pythonCmd} .qodercn/hooks/`);
    const settingsJson = JSON.parse(settings) as {
      hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>>;
    };
    const commands = [
      ...settingsJson.hooks.UserPromptSubmit.flatMap((group) =>
        group.hooks.map((hook) => hook.command),
      ),
      ...settingsJson.hooks.PreToolUse.flatMap((group) => group.hooks.map((hook) => hook.command)),
    ];
    expect(commands).toEqual([
      hookCommand(tempDir, ".qodercn", "inject-workflow-state.py"),
      hookCommand(tempDir, ".qodercn", "inject-subagent-context.py"),
    ]);
    expect(await pathExists(path.join(tempDir, ".qodercn", "hooks", "easy_coding_status.py"))).toBe(
      true,
    );
    expect(await pathExists(path.join(tempDir, ".qodercn", "hooks", "easy_coding_state.py"))).toBe(
      true,
    );
    expect(await pathExists(path.join(tempDir, ".qodercn", "hooks", "easy_dev_spec.py"))).toBe(
      true,
    );
    expect(
      await pathExists(path.join(tempDir, ".qodercn", "hooks", "easy_dev_spec_protocol.py")),
    ).toBe(true);
    expect(
      await pathExists(path.join(tempDir, ".qodercn", "hooks", "easy_dev_spec_execution.py")),
    ).toBe(true);
    expect(await pathExists(path.join(tempDir, ".qodercn", "skills", "ec-meta", "SKILL.md"))).toBe(
      true,
    );
  });
});
