import { execFileSync, execSync } from "node:child_process";
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
    expect(skill).toContain("MUST actually invoke it in the same turn");
    expect(skill).toContain("The code-task IMPLEMENT completion fallback must preserve");
    expect(skill).toContain("Skip REVIEW and enter VERIFICATION");
    expect(skill).toContain("An empty, dismissed, timed-out, or unparseable choice result");
    expect(skill).toContain("at most once per assistant turn");
    expect(skill).not.toContain("{{");
    const analysisSkill = await readFile(
      path.join(tempDir, ".agents", "skills", "ec-analysis", "SKILL.md"),
      "utf8",
    );
    expect(analysisSkill).toContain("Confirm entering IMPLEMENT (recommended)");
    expect(analysisSkill).toContain("Hand off to another agent");
    expect(analysisSkill).toContain("Other — use the native free-form Other input");
    expect(analysisSkill).toContain("at most once per assistant turn");
    expect(analysisSkill).toContain("stop the\ncurrent turn");
    const noHarnessSkill = await readFile(
      path.join(tempDir, ".agents", "skills", "ec-no-harness", "SKILL.md"),
      "utf8",
    );
    expect(noHarnessSkill).toContain("disable-harness --session-file");
    expect(noHarnessSkill).not.toContain("{{");
    const taskManagementSkill = await readFile(
      path.join(tempDir, ".agents", "skills", "ec-task-management", "SKILL.md"),
      "utf8",
    );
    expect(taskManagementSkill).toContain("show the full task and session\npanel");
    expect(taskManagementSkill).toContain("snapshot --session-file <P>");
    expect(taskManagementSkill).toContain(
      "Never omit the confirm-mode section, even when the unfinished task list is empty",
    );
    expect(taskManagementSkill).not.toContain("{{");

    expect(await pathExists(path.join(tempDir, ".codex", "hooks", "session-start.py"))).toBe(true);
    expect(await pathExists(path.join(tempDir, ".codex", "hooks", "easy_coding_status.py"))).toBe(
      true,
    );
    expect(await pathExists(path.join(tempDir, ".codex", "hooks", "easy_coding_state.py"))).toBe(
      true,
    );
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

    const main = await readFile(path.join(tempDir, "AGENTS.md"), "utf8");
    expect(main).toContain("Codex: `$ec-*`");
    expect(main).toContain("Qoder: `/ec-*`");
    expect(main).toContain("single Markdown blockquote status line");
    expect(main).toContain(
      "- Ready: > **Easy Coding** · **{confirm-mode}** · Ready · Use `ec-workflow` to start or resume a task, `ec-brainstorming` to brainstorm, or `ec-task-management` to manage tasks or session settings",
    );
    expect(main).toContain("lite chooses IMPLEMENT -> VERIFICATION");
    expect(main).toContain("A confirmation-required boundary is not fully presented");
    expect(main).toContain("approve-mode code IMPLEMENT gate must instead preserve");
    expect(main).toContain("at most once per assistant turn");
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

  it("uses the same Codex ppid fallback for agent and agentless state API commands", async () => {
    await configureCodex(tempDir);
    await mkdir(path.join(tempDir, ".easy-coding"), { recursive: true });
    const stateApi = path.join(tempDir, ".codex", "hooks", "easy_coding_state.py");

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
      { cwd: tempDir, encoding: "utf8" },
    );
    const snapshot = JSON.parse(
      execFileSync(pythonCmd, [stateApi, "snapshot"], {
        cwd: tempDir,
        encoding: "utf8",
      }),
    );

    expect(snapshot.current_task).toBe("fallback-task");
    expect(snapshot.session_file).toMatch(/codex-ppid-\d+\.json$/);
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

describe("configureQoder", () => {
  it("writes standard Qoder files under .qoder", async () => {
    await configureQoder(tempDir);

    const skill = await readFile(
      path.join(tempDir, ".qoder", "skills", "ec-workflow", "SKILL.md"),
      "utf8",
    );
    expect(skill).toContain("`/ec-init`");
    expect(skill).toContain("MUST actually invoke it in the same turn");
    expect(skill).toContain("The code-task IMPLEMENT completion fallback must preserve");
    expect(skill).toContain("Skip REVIEW and enter VERIFICATION");
    expect(skill).toContain("An empty, dismissed, timed-out, or unparseable choice result");
    expect(skill).toContain("at most once per assistant turn");
    expect(skill).not.toContain("{{");
    const analysisSkill = await readFile(
      path.join(tempDir, ".qoder", "skills", "ec-analysis", "SKILL.md"),
      "utf8",
    );
    expect(analysisSkill).toContain("Confirm entering IMPLEMENT (recommended)");
    expect(analysisSkill).toContain("Hand off to another agent");
    expect(analysisSkill).toContain("Other — use the native free-form Other input");
    expect(analysisSkill).toContain("at most once per assistant turn");
    expect(analysisSkill).toContain("stop the\ncurrent turn");
    const taskManagementSkill = await readFile(
      path.join(tempDir, ".qoder", "skills", "ec-task-management", "SKILL.md"),
      "utf8",
    );
    expect(taskManagementSkill).toContain("show the full task and session\npanel");
    expect(taskManagementSkill).toContain("snapshot --session-file <P>");
    expect(taskManagementSkill).toContain(
      "Never omit the confirm-mode section, even when the unfinished task list is empty",
    );
    expect(taskManagementSkill).not.toContain("{{");

    const main = await readFile(path.join(tempDir, "AGENTS.md"), "utf8");
    expect(main).toContain("A confirmation-required boundary is not fully presented");
    expect(main).toContain("approve-mode code IMPLEMENT gate must instead preserve");
    expect(main).toContain("at most once per assistant turn");

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
    expect(await pathExists(path.join(tempDir, ".qoder", "hooks", "inject-subagent-context.py"))).toBe(
      true,
    );
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
    expect(await pathExists(path.join(tempDir, ".qodercn", "skills", "ec-meta", "SKILL.md"))).toBe(
      true,
    );
  });
});
