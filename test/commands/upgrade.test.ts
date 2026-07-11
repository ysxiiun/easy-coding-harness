import { execSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { init } from "../../src/commands/init.js";
import { upgrade } from "../../src/commands/upgrade.js";
import { renderHookCommand, shellDoubleQuoteArg } from "../../src/configurators/shared.js";
import { VERSION } from "../../src/constants/version.js";
import { PLATFORM_META } from "../../src/types/platform.js";
import { readConfigYaml } from "../../src/utils/config-yaml.js";

let tempDir: string;
let originalCwd: string;
const pythonCmd = process.platform === "win32" ? "python" : "python3";

async function expectPortableHookCommand(
  command: string,
  platformDir: string,
  scriptName: string,
): Promise<void> {
  const config = await readConfigYaml(path.join(tempDir, ".easy-coding", "config.yaml"));
  expect(command).toBe(
    renderHookCommand(
      tempDir,
      PLATFORM_META["claude-code"].templateContext,
      scriptName,
      process.platform,
      config.project.id,
    ),
  );
  expect(command).toContain(`${platformDir}/hooks/${scriptName}`);
  expect(command).not.toContain(tempDir);
  expect(command).not.toBe(`${pythonCmd} ${platformDir}/hooks/${scriptName}`);
}

function absoluteHookCommand(platformDir: string, scriptName: string): string {
  return `${pythonCmd} ${shellDoubleQuoteArg(path.join(tempDir, platformDir, "hooks"))}/${scriptName}`;
}

async function setHarnessVersion(version: string): Promise<void> {
  const configPath = path.join(tempDir, ".easy-coding", "config.yaml");
  await writeFile(
    configPath,
    (await readFile(configPath, "utf8")).replace(/harness_version: .+/, `harness_version: ${version}`),
    "utf8",
  );
}

async function markProjectInitComplete(): Promise<void> {
  const taskPath = path.join(tempDir, ".easy-coding", "tasks", "project-init", "task.json");
  const task = JSON.parse(await readFile(taskPath, "utf8"));
  task.status = "COMPLETE";
  await writeFile(taskPath, `${JSON.stringify(task, null, 2)}\n`, "utf8");
}

async function rewriteClaudeHooksToLegacyRelativeCommands(): Promise<void> {
  const settingsPath = path.join(tempDir, ".claude", "settings.json");
  const settings = JSON.parse(await readFile(settingsPath, "utf8")) as {
    hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>>;
  };
  for (const groups of Object.values(settings.hooks)) {
    for (const group of groups) {
      for (const hook of group.hooks) {
        const scriptName = extractHookScriptName(hook.command);
        hook.command = `${pythonCmd} .claude/hooks/${scriptName}`;
      }
    }
  }
  await writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
}

async function rewriteClaudeHooksToPublishedAbsoluteCommands(): Promise<void> {
  const settingsPath = path.join(tempDir, ".claude", "settings.json");
  const settings = JSON.parse(await readFile(settingsPath, "utf8")) as {
    hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>>;
  };
  for (const groups of Object.values(settings.hooks)) {
    for (const group of groups) {
      for (const hook of group.hooks) {
        hook.command = absoluteHookCommand(".claude", extractHookScriptName(hook.command));
      }
    }
  }
  await writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
}

function extractHookScriptName(command: string): string {
  const match = command.match(/([^/\s]+\.py)$/);
  expect(match?.[1]).toBeTruthy();
  return match?.[1] ?? "";
}

async function appendLegacyClaudeSessionStartToUserPromptSubmit(): Promise<void> {
  const settingsPath = path.join(tempDir, ".claude", "settings.json");
  const settings = JSON.parse(await readFile(settingsPath, "utf8")) as {
    hooks: Record<string, Array<{ hooks: Array<{ command: string; timeout?: number; type?: string }> }>>;
  };
  settings.hooks.UserPromptSubmit[0].hooks.push({
    type: "command",
    command: `${pythonCmd} .claude/hooks/session-start.py`,
    timeout: 15000,
  });
  await writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
}

async function removeClaudeSessionStartEvent(): Promise<void> {
  const settingsPath = path.join(tempDir, ".claude", "settings.json");
  const settings = JSON.parse(await readFile(settingsPath, "utf8")) as {
    hooks: Record<string, unknown>;
  };
  delete settings.hooks.SessionStart;
  await writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
}

async function moveClaudeSessionStartEventHookToUserPromptSubmit(): Promise<void> {
  const settingsPath = path.join(tempDir, ".claude", "settings.json");
  const settings = JSON.parse(await readFile(settingsPath, "utf8")) as {
    hooks: Record<string, Array<{ hooks: Array<{ command: string; timeout?: number; type?: string }> }>>;
  };
  const sessionStartHook = settings.hooks.SessionStart[0].hooks[0];
  settings.hooks.UserPromptSubmit[0].hooks.push({ ...sessionStartHook });
  delete settings.hooks.SessionStart;
  await writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
}

beforeEach(async () => {
  originalCwd = process.cwd();
  tempDir = await mkdtemp(path.join(os.tmpdir(), "ec-upgrade-"));
  process.chdir(tempDir);
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(async () => {
  vi.restoreAllMocks();
  process.chdir(originalCwd);
  await rm(tempDir, { recursive: true, force: true });
});

describe("upgrade command", () => {
  it("refreshes stale hook commands even when the harness version is current", async () => {
    await init({ agent: "claude-code", yes: true });
    await markProjectInitComplete();
    await rewriteClaudeHooksToLegacyRelativeCommands();

    await upgrade({ yes: true });

    const settings = JSON.parse(
      await readFile(path.join(tempDir, ".claude", "settings.json"), "utf8"),
    ) as {
      hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>>;
    };
    const command = settings.hooks.SessionStart[0].hooks[0].command;
    await expectPortableHookCommand(command, ".claude", "session-start.py");
    expect(JSON.stringify(settings)).not.toContain(`${pythonCmd} .claude/hooks/`);
  });

  it("refreshes published 0.5.1 absolute hook commands at the current version", async () => {
    await init({ agent: "claude-code", yes: true });
    await markProjectInitComplete();
    await rewriteClaudeHooksToPublishedAbsoluteCommands();

    await upgrade({ yes: true });

    const settings = JSON.parse(
      await readFile(path.join(tempDir, ".claude", "settings.json"), "utf8"),
    ) as {
      hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>>;
    };
    const command = settings.hooks.SessionStart[0].hooks[0].command;
    await expectPortableHookCommand(command, ".claude", "session-start.py");
    expect(JSON.stringify(settings)).not.toContain(tempDir);
  });

  it("refreshes stale managed hook commands left beside expected commands", async () => {
    await init({ agent: "claude-code", yes: true });
    await markProjectInitComplete();
    await appendLegacyClaudeSessionStartToUserPromptSubmit();

    await upgrade({ yes: true });

    const settings = JSON.parse(
      await readFile(path.join(tempDir, ".claude", "settings.json"), "utf8"),
    ) as {
      hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>>;
    };
    await expectPortableHookCommand(
      settings.hooks.SessionStart[0].hooks[0].command,
      ".claude",
      "session-start.py",
    );
    expect(JSON.stringify(settings)).not.toContain(`${pythonCmd} .claude/hooks/`);
  });

  it("refreshes when one of Claude's duplicate session-start registrations is missing", async () => {
    await init({ agent: "claude-code", yes: true });
    await markProjectInitComplete();
    await removeClaudeSessionStartEvent();

    await upgrade({ yes: true });

    const settings = JSON.parse(
      await readFile(path.join(tempDir, ".claude", "settings.json"), "utf8"),
    ) as {
      hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>>;
    };
    const commands = [
      ...settings.hooks.SessionStart.flatMap((group) => group.hooks.map((hook) => hook.command)),
      ...settings.hooks.UserPromptSubmit.flatMap((group) =>
        group.hooks.map((hook) => hook.command),
      ),
    ];
    const sessionStartCount = commands.filter((command) =>
      command.endsWith("/session-start.py"),
    ).length;

    await expectPortableHookCommand(
      settings.hooks.SessionStart[0].hooks[0].command,
      ".claude",
      "session-start.py",
    );
    expect(sessionStartCount).toBe(2);
  });

  it("refreshes when Claude session-start registrations are present under the wrong event", async () => {
    await init({ agent: "claude-code", yes: true });
    await markProjectInitComplete();
    await moveClaudeSessionStartEventHookToUserPromptSubmit();

    await upgrade({ yes: true });

    const settings = JSON.parse(
      await readFile(path.join(tempDir, ".claude", "settings.json"), "utf8"),
    ) as {
      hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>>;
    };
    const sessionStartCommands = settings.hooks.SessionStart.flatMap((group) =>
      group.hooks.map((hook) => hook.command),
    );
    const userPromptCommands = settings.hooks.UserPromptSubmit.flatMap((group) =>
      group.hooks.map((hook) => hook.command),
    );

    await expectPortableHookCommand(sessionStartCommands[0], ".claude", "session-start.py");
    expect(userPromptCommands.filter((command) => command.endsWith("/session-start.py"))).toHaveLength(1);
  });

  it("refreshes 0.5.0 relative Claude hook commands and keeps ec-init adaptation pending", async () => {
    await init({ agent: "claude-code", yes: true });
    await setHarnessVersion("0.5.0");
    await markProjectInitComplete();
    await rewriteClaudeHooksToLegacyRelativeCommands();

    await upgrade({ yes: true });

    const settings = JSON.parse(
      await readFile(path.join(tempDir, ".claude", "settings.json"), "utf8"),
    ) as {
      hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>>;
    };
    const command = settings.hooks.SessionStart[0].hooks[0].command;
    await expectPortableHookCommand(command, ".claude", "session-start.py");
    expect(JSON.stringify(settings)).not.toContain(`${pythonCmd} .claude/hooks/`);

    const nested = path.join(tempDir, ".easy-coding", "memory", "short");
    const stdout = execSync(command, {
      cwd: nested,
      input: "{}",
      encoding: "utf8",
    });
    expect(stdout).toContain(`> **Easy Coding** · Waiting init · Upgrade to v${VERSION}`);
    expect(stdout).toContain(`[easy-coding:upgrade-init-pending:${VERSION}]`);

    const task = JSON.parse(
      await readFile(path.join(tempDir, ".easy-coding", "tasks", "project-init", "task.json"), "utf8"),
    );
    expect(task.pending_init_since).toBe(VERSION);
  });

  it("keeps the ec-init adaptation marker for older upgrades", async () => {
    await init({ agent: "claude-code", yes: true });
    await setHarnessVersion("0.4.0");
    await markProjectInitComplete();

    await upgrade({ yes: true });

    const task = JSON.parse(
      await readFile(path.join(tempDir, ".easy-coding", "tasks", "project-init", "task.json"), "utf8"),
    );
    expect(task.pending_init_since).toBe(VERSION);
  });

  it("migrates active 0.5.x workflow stages without touching memory content", async () => {
    await init({ agent: "claude-code", yes: true });
    await setHarnessVersion("0.5.3");
    await markProjectInitComplete();

    const taskDir = path.join(tempDir, ".easy-coding", "tasks", "07-10-upgrade");
    await mkdir(taskDir, { recursive: true });
    await writeFile(
      path.join(taskDir, "task.json"),
      JSON.stringify({
        type: "feature",
        status: "WAITING_CONFIRM",
        created_at: "2026-07-10T00:00:00Z",
        created_by: "codex",
        last_agent: "codex",
        stage_history: [
          { stage: "ANALYSIS", agent: "codex", entered_at: "2026-07-10T00:00:00Z" },
          { stage: "WAITING_CONFIRM", agent: "codex", entered_at: "2026-07-10T00:01:00Z" },
        ],
      }),
      "utf8",
    );
    const sessionPath = path.join(tempDir, ".easy-coding", "sessions", "legacy.json");
    await writeFile(
      sessionPath,
      JSON.stringify({ current_task: "07-10-upgrade", last_seen_stage: "WAITING_CONFIRM" }),
      "utf8",
    );
    const memoryPath = path.join(tempDir, ".easy-coding", "memory", "short", "keep.md");
    await writeFile(memoryPath, "memory must stay byte-identical\n", "utf8");

    await upgrade({ yes: true });

    const task = JSON.parse(await readFile(path.join(taskDir, "task.json"), "utf8"));
    expect(task.status).toBe("ANALYSIS");
    expect(task.pending_transition).toMatchObject({ from: "ANALYSIS", to: "IMPLEMENT" });
    expect(task.stage_history.map((entry: { stage: string }) => entry.stage)).toEqual([
      "ANALYSIS",
    ]);
    const session = JSON.parse(await readFile(sessionPath, "utf8"));
    expect(session.last_seen_stage).toBe("ANALYSIS");
    expect(await readFile(memoryPath, "utf8")).toBe("memory must stay byte-identical\n");
  });

  it("migrates legacy confirmation fields to schema 2 and removes the old keys", async () => {
    await init({ agent: "codex" });
    const configPath = path.join(tempDir, ".easy-coding", "config.yaml");
    const legacyConfig = (await readFile(configPath, "utf8"))
      .replace("version: 2", "version: 1")
      .replace("confirm_mode: guard", "strict_confirm: false\n  auto_mode: true")
      .replace(/harness_version: .+/, "harness_version: 0.6.1");
    await writeFile(configPath, legacyConfig, "utf8");

    await upgrade({ yes: true });

    const migrated = await readFile(configPath, "utf8");
    expect(migrated).toContain("version: 2");
    expect(migrated).toContain("confirm_mode: auto");
    expect(migrated).not.toContain("strict_confirm");
    expect(migrated).not.toContain("auto_mode");
  });

  it("normalizes an equal-core prerelease harness version to the exact CLI version", async () => {
    await init({ agent: "codex" });
    await markProjectInitComplete();
    await setHarnessVersion(`${VERSION}-beta.1`);

    await upgrade({ yes: true });

    const config = await readConfigYaml(path.join(tempDir, ".easy-coding", "config.yaml"));
    expect(config.harness_version).toBe(VERSION);
  });

  it("refreshes stale supermodule parent topology even when all targets are current", async () => {
    await writeFile(
      path.join(tempDir, ".gitmodules"),
      ['[submodule "pkg-a"]', "  path = packages/a", "  url = git@example.com:pkg-a.git", ""].join(
        "\n",
      ),
      "utf8",
    );
    await init({ agent: "codex", submodules: false });

    await mkdir(path.join(tempDir, "packages", "a", ".easy-coding"), { recursive: true });
    await writeFile(path.join(tempDir, "packages", "a", ".git"), "gitdir: ../../.git/modules/a\n", "utf8");
    await writeFile(
      path.join(tempDir, "packages", "a", ".easy-coding", "config.yaml"),
      ["version: 1", `harness_version: ${VERSION}`, "agents:", "  - codex", ""].join("\n"),
      "utf8",
    );

    const staleParentConfig = await readFile(
      path.join(tempDir, ".easy-coding", "config.yaml"),
      "utf8",
    );
    expect(staleParentConfig).toContain("submodules: []");

    await upgrade({ yes: true });

    const parentConfig = await readFile(path.join(tempDir, ".easy-coding", "config.yaml"), "utf8");
    expect(parentConfig).toContain("- packages/a");
    const childConfig = await readFile(
      path.join(tempDir, "packages", "a", ".easy-coding", "config.yaml"),
      "utf8",
    );
    expect(childConfig).toContain("role: submodule-child");
    expect(childConfig).toContain("parent: ../..");
    const parentConstraint = await readFile(path.join(tempDir, "AGENTS.md"), "utf8");
    expect(parentConstraint).toContain("## Supermodule Boundary");
    expect(parentConstraint).toContain("`packages/a`");
  });
});
