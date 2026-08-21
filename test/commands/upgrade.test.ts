import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
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
  platform: "claude-code" | "codex" | "qoder" = "claude-code",
): Promise<void> {
  const config = await readConfigYaml(path.join(tempDir, ".easy-coding", "config.yaml"));
  expect(command).toBe(
    renderHookCommand(
      tempDir,
      PLATFORM_META[platform].templateContext,
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

async function addManagedFileToManifest(
  relativePath: string,
  content: string,
  kind: "skill" | "agent",
  platform: "claude-code" | "codex" | "qoder",
): Promise<void> {
  const filePath = path.join(tempDir, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");

  const manifestPath = path.join(tempDir, ".easy-coding", "install-manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.files.push({
    path: relativePath,
    kind,
    platform,
    sha256: createHash("sha256").update(content).digest("hex"),
  });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
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

async function duplicateClaudeSessionStartUnderUserPromptSubmit(): Promise<void> {
  const settingsPath = path.join(tempDir, ".claude", "settings.json");
  const settings = JSON.parse(await readFile(settingsPath, "utf8")) as {
    hooks: Record<
      string,
      Array<{ hooks: Array<{ command: string; timeout?: number; type?: string }> }>
    >;
  };
  const sessionStartHook = settings.hooks.SessionStart[0].hooks[0];
  settings.hooks.UserPromptSubmit.push({ hooks: [{ ...sessionStartHook }] });
  await writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
}

async function moveCodexSessionStartEventHookToUserPromptSubmit(): Promise<void> {
  const hooksPath = path.join(tempDir, ".codex", "hooks.json");
  const hooks = JSON.parse(await readFile(hooksPath, "utf8")) as {
    hooks: Record<string, Array<{ hooks: Array<{ command: string; timeout?: number; type?: string }> }>>;
  };
  const sessionStartHook = hooks.hooks.SessionStart[0].hooks[0];
  hooks.hooks.UserPromptSubmit.unshift({ hooks: [{ ...sessionStartHook }] });
  delete hooks.hooks.SessionStart;
  await writeFile(hooksPath, `${JSON.stringify(hooks, null, 2)}\n`, "utf8");
}

async function duplicateCodexSessionStartUnderUserPromptSubmit(): Promise<void> {
  const hooksPath = path.join(tempDir, ".codex", "hooks.json");
  const hooks = JSON.parse(await readFile(hooksPath, "utf8")) as {
    hooks: Record<
      string,
      Array<{ hooks: Array<{ command: string; timeout?: number; type?: string }> }>
    >;
  };
  const sessionStartHook = hooks.hooks.SessionStart[0].hooks[0];
  hooks.hooks.UserPromptSubmit.push({ hooks: [{ ...sessionStartHook }] });
  await writeFile(hooksPath, `${JSON.stringify(hooks, null, 2)}\n`, "utf8");
}

async function appendLegacyQoderSessionStart(): Promise<void> {
  const settingsPath = path.join(tempDir, ".qoder", "settings.json");
  const settings = JSON.parse(await readFile(settingsPath, "utf8")) as {
    hooks: Record<
      string,
      Array<{ hooks: Array<{ command: string; timeout?: number; type?: string }> }>
    >;
  };
  settings.hooks.UserPromptSubmit[0].hooks.push({
    type: "command",
    command: `${pythonCmd} .qoder/hooks/session-start.py`,
    timeout: 15,
  });
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
  it("refreshes durable ANALYSIS receipts from an older managed installation", async () => {
    await init({ agent: "codex,qoder", yes: true });
    await markProjectInitComplete();
    await setHarnessVersion("1.0.0-beta.0");

    const managedSkills = [
      ".agents/skills/ec-analysis/SKILL.md",
      ".agents/skills/ec-workflow/SKILL.md",
      ".qoder/skills/ec-analysis/SKILL.md",
      ".qoder/skills/ec-workflow/SKILL.md",
    ];
    for (const relativePath of managedSkills) {
      await writeFile(path.join(tempDir, relativePath), "stale managed skill\n", "utf8");
    }

    await upgrade({ yes: true });

    for (const relativePath of managedSkills.filter((value) => value.includes("ec-analysis"))) {
      const content = await readFile(path.join(tempDir, relativePath), "utf8");
      expect(content).toContain("The proposal receipt must survive the client boundary");
      expect(content).toContain("Repeat the compact receipt and full Dev-Spec link/path");
    }
    for (const relativePath of managedSkills.filter((value) => value.includes("ec-workflow"))) {
      const content = await readFile(path.join(tempDir, relativePath), "utf8");
      expect(content).toContain("non-durable process presentation");
      expect(content).toContain("repeat the receipt and full Dev-Spec link/path");
    }

    const main = await readFile(path.join(tempDir, "AGENTS.md"), "utf8");
    expect(main).toContain("Text shown before a later tool call is non-durable");
    expect(main).toContain("Auto adds no pause and carries the Dev-Spec link/path");
  });

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

  it("refreshes when Claude's SessionStart registration is missing", async () => {
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
    expect(sessionStartCount).toBe(1);
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
    expect(userPromptCommands.filter((command) => command.endsWith("/session-start.py"))).toHaveLength(0);
  });

  it("removes an exact Claude session-start duplicate left under UserPromptSubmit", async () => {
    await init({ agent: "claude-code", yes: true });
    await markProjectInitComplete();
    await duplicateClaudeSessionStartUnderUserPromptSubmit();

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

    expect(sessionStartCommands).toHaveLength(1);
    expect(userPromptCommands.some((command) => command.endsWith("/session-start.py"))).toBe(false);
  });

  it("moves legacy Codex session-start registration to SessionStart", async () => {
    await init({ agent: "codex", yes: true });
    await markProjectInitComplete();
    await moveCodexSessionStartEventHookToUserPromptSubmit();

    await upgrade({ yes: true });

    const hooks = JSON.parse(
      await readFile(path.join(tempDir, ".codex", "hooks.json"), "utf8"),
    ) as {
      hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>>;
    };
    const sessionStartCommands = hooks.hooks.SessionStart.flatMap((group) =>
      group.hooks.map((hook) => hook.command),
    );
    const userPromptCommands = hooks.hooks.UserPromptSubmit.flatMap((group) =>
      group.hooks.map((hook) => hook.command),
    );

    expect(sessionStartCommands).toHaveLength(1);
    await expectPortableHookCommand(
      sessionStartCommands[0],
      ".codex",
      "session-start.py",
      "codex",
    );
    expect(userPromptCommands.some((command) => command.endsWith("/session-start.py"))).toBe(false);
    expect(userPromptCommands).toHaveLength(1);
    await expectPortableHookCommand(
      userPromptCommands[0],
      ".codex",
      "inject-workflow-state.py",
      "codex",
    );
  });

  it("removes an exact Codex session-start duplicate left under UserPromptSubmit", async () => {
    await init({ agent: "codex", yes: true });
    await markProjectInitComplete();
    await duplicateCodexSessionStartUnderUserPromptSubmit();

    await upgrade({ yes: true });

    const hooks = JSON.parse(
      await readFile(path.join(tempDir, ".codex", "hooks.json"), "utf8"),
    ) as {
      hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>>;
    };
    const sessionStartCommands = hooks.hooks.SessionStart.flatMap((group) =>
      group.hooks.map((hook) => hook.command),
    );
    const userPromptCommands = hooks.hooks.UserPromptSubmit.flatMap((group) =>
      group.hooks.map((hook) => hook.command),
    );

    expect(sessionStartCommands).toHaveLength(1);
    expect(userPromptCommands.some((command) => command.endsWith("/session-start.py"))).toBe(false);
  });

  it("removes legacy Qoder session-start without relying on the install manifest", async () => {
    await init({ agent: "qoder", yes: true });
    await markProjectInitComplete();
    await appendLegacyQoderSessionStart();
    await rm(path.join(tempDir, ".easy-coding", "install-manifest.json"));

    await upgrade({ yes: true });

    const settings = JSON.parse(
      await readFile(path.join(tempDir, ".qoder", "settings.json"), "utf8"),
    ) as {
      hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>>;
    };
    const userPromptCommands = settings.hooks.UserPromptSubmit.flatMap((group) =>
      group.hooks.map((hook) => hook.command),
    );

    expect(userPromptCommands).toHaveLength(1);
    await expectPortableHookCommand(
      userPromptCommands[0],
      ".qoder",
      "inject-workflow-state.py",
      "qoder",
    );
    expect(JSON.stringify(settings)).not.toContain("session-start.py");
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
    expect(stdout).toContain(
      `> **Easy Coding** · **Approval: Guard** · **Workflow: Adaptive** · Waiting init · Upgrade to v${VERSION}`,
    );
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

  it("removes unchanged retired assets while preserving locally modified copies", async () => {
    await init({ agent: "claude-code,codex,qoder", yes: true });
    await markProjectInitComplete();
    await setHarnessVersion("0.10.0-beta.10");

    const retiredFiles = [
      [".claude/skills/ec-reviewing/SKILL.md", "old reviewing skill\n", "skill", "claude-code"],
      [
        ".claude/skills/ec-verification/SKILL.md",
        "old verification skill\n",
        "skill",
        "claude-code",
      ],
      [".claude/agents/ec-fixer.md", "old claude fixer\n", "agent", "claude-code"],
      [".codex/agents/ec-fixer.toml", "old codex fixer\n", "agent", "codex"],
      [".qoder/agents/ec-fixer.md", "old qoder fixer\n", "agent", "qoder"],
    ] as const;
    for (const [relativePath, content, kind, platform] of retiredFiles) {
      await addManagedFileToManifest(relativePath, content, kind, platform);
    }

    const modifiedPath = path.join(tempDir, ".qoder", "agents", "ec-fixer.md");
    await writeFile(modifiedPath, "user modified fixer\n", "utf8");

    await upgrade({ yes: true });

    for (const [relativePath] of retiredFiles.slice(0, -1)) {
      await expect(readFile(path.join(tempDir, relativePath), "utf8")).rejects.toThrow();
    }
    await expect(readFile(modifiedPath, "utf8")).resolves.toBe("user modified fixer\n");

    const manifest = JSON.parse(
      await readFile(path.join(tempDir, ".easy-coding", "install-manifest.json"), "utf8"),
    );
    expect(manifest.files.map((file: { path: string }) => file.path)).not.toEqual(
      expect.arrayContaining(retiredFiles.map(([relativePath]) => relativePath)),
    );
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining("removed 4 retired managed file(s) and preserved 1 locally modified file(s)"),
    );
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

  it("migrates legacy confirmation fields to schema 5 with default-off TDD", async () => {
    await init({ agent: "codex" });
    const configPath = path.join(tempDir, ".easy-coding", "config.yaml");
    const legacyConfig = (await readFile(configPath, "utf8"))
      .replace("version: 3", "version: 1")
      .replace(
        "approval_mode: guard\n  workflow_mode: adaptive",
        "strict_confirm: false\n  auto_mode: true",
      )
      .replace(/harness_version: .+/, "harness_version: 0.6.1");
    await writeFile(configPath, legacyConfig, "utf8");

    await upgrade({ yes: true });

    const migrated = await readFile(configPath, "utf8");
    expect(migrated).toContain("version: 5");
    expect(migrated).toContain("approval_mode: auto");
    expect(migrated).toContain("workflow_mode: adaptive");
    expect(migrated).toContain("tdd_enabled: false");
    expect(migrated).toContain("tdd_coverage_threshold: 90");
    expect(migrated).not.toContain("strict_confirm");
    expect(migrated).not.toContain("auto_mode");
  });

  it("disables beta.1 project and session TDD requests when readiness is missing", async () => {
    await init({ agent: "codex" });
    const configPath = path.join(tempDir, ".easy-coding", "config.yaml");
    const beta1 = (await readFile(configPath, "utf8"))
      .replace("version: 5", "version: 4")
      .replace(`harness_version: ${VERSION}`, "harness_version: 0.10.0-beta.1")
      .replace("tdd_enabled: false", "tdd_enabled: true")
      .replace("tdd_coverage_threshold: 90", "tdd_coverage_threshold: 95");
    await writeFile(configPath, beta1, "utf8");
    const sessionPath = path.join(tempDir, ".easy-coding", "sessions", "beta1.json");
    await mkdir(path.dirname(sessionPath), { recursive: true });
    await writeFile(
      sessionPath,
      JSON.stringify({ current_task: null, tdd_enabled: true, tdd_coverage_threshold: 95 }),
      "utf8",
    );

    await upgrade({ yes: true });

    const migrated = await readFile(configPath, "utf8");
    expect(migrated).toContain("version: 5");
    expect(migrated).toContain("tdd_enabled: false");
    expect(migrated).toContain("tdd_coverage_threshold: 95");
    expect(JSON.parse(await readFile(sessionPath, "utf8"))).toMatchObject({
      tdd_enabled: false,
      tdd_coverage_threshold: 95,
    });
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining("TDD remains off until ec-tdd-init succeeds"),
    );
  });

  it("migrates lite to guard approval and fast workflow", async () => {
    await init({ agent: "codex" });
    const configPath = path.join(tempDir, ".easy-coding", "config.yaml");
    const liteConfig = (await readFile(configPath, "utf8"))
      .replace(
        "approval_mode: guard\n  workflow_mode: adaptive",
        "confirm_mode: lite",
      )
      .replace(/harness_version: .+/, "harness_version: 0.7.1");
    await writeFile(configPath, liteConfig, "utf8");

    await upgrade({ yes: true });

    const upgraded = await readFile(configPath, "utf8");
    expect(upgraded).toContain(`harness_version: ${VERSION}`);
    expect(upgraded).toContain("approval_mode: guard");
    expect(upgraded).toContain("workflow_mode: fast");
    expect(upgraded).not.toContain("confirm_mode:");
  });

  it("normalizes an equal-core prerelease harness version to the exact CLI version", async () => {
    await init({ agent: "codex" });
    await markProjectInitComplete();
    await setHarnessVersion(`${VERSION.split("-", 1)[0]}-0`);

    await upgrade({ yes: true });

    const config = await readConfigYaml(path.join(tempDir, ".easy-coding", "config.yaml"));
    expect(config.harness_version).toBe(VERSION);
  });

  it("repairs beta.8 owner drift and shared Codex/Qoder constraints during upgrade", async () => {
    await init({ agent: "codex,qoder", yes: true });
    await markProjectInitComplete();
    await setHarnessVersion("0.10.0-beta.8");

    const taskDir = path.join(tempDir, ".easy-coding", "tasks", "08-13-forter-r1-t3");
    const taskPath = path.join(taskDir, "task.json");
    const executionPath = path.join(taskDir, "execution.jsonl");
    await mkdir(taskDir, { recursive: true });
    await writeFile(
      taskPath,
      `${JSON.stringify(
        {
          type: "feature",
          title: "Forter fixture",
          status: "REVIEW",
          created_at: "2026-08-14T00:00:00Z",
          created_by: "Codex with Easy Coding",
          last_agent: "Codex with Easy Coding",
          stage_history: [
            {
              stage: "REVIEW",
              agent: "Codex with Easy Coding",
              entered_at: "2026-08-14T00:01:00Z",
            },
          ],
          workflow_mode: "standard",
          workflow_mode_confirmed_by: "Codex with Easy Coding",
          tdd_enabled: false,
          tdd_confirmed_by: "Codex with Easy Coding",
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    const historicalExecution = `${JSON.stringify({
      type: "handoff",
      from: "Codex with Easy Coding",
      stage: "REVIEW",
      summary: "Historical audit attribution",
      timestamp: "2026-08-14T00:02:00Z",
    })}\n`;
    await writeFile(executionPath, historicalExecution, "utf8");

    const sessionPath = path.join(
      tempDir,
      ".easy-coding",
      "sessions",
      "codex-upgrade-fixture.json",
    );
    await writeFile(
      sessionPath,
      `${JSON.stringify(
        {
          current_task: "08-13-forter-r1-t3",
          created_at: "2026-08-14T00:00:00Z",
          agent: "codex",
          last_agent: "Codex with Easy Coding",
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const constraintPath = path.join(tempDir, "AGENTS.md");
    await writeFile(
      constraintPath,
      (await readFile(constraintPath, "utf8")).replace(
        "## Runtime contract",
        "## Runtime contract\n\n- stale platform route: `.qoder/hooks/easy_coding_state.py` only",
      ),
      "utf8",
    );

    await upgrade({ yes: true });

    const migratedTask = JSON.parse(await readFile(taskPath, "utf8"));
    expect(migratedTask).toMatchObject({
      created_by: "codex",
      last_agent: "codex",
      workflow_mode_confirmed_by: "codex",
      tdd_confirmed_by: "codex",
    });
    expect(migratedTask.stage_history[0].agent).toBe("codex");
    expect(JSON.parse(await readFile(sessionPath, "utf8"))).toMatchObject({
      agent: "codex",
      last_agent: "codex",
    });
    expect(await readFile(executionPath, "utf8")).toBe(historicalExecution);

    const refreshedConstraint = await readFile(constraintPath, "utf8");
    expect(refreshedConstraint).not.toContain("stale platform route");
    expect(refreshedConstraint).toContain("`.codex/hooks/easy_coding_state.py`");
    expect(refreshedConstraint).toContain("`.qoder/hooks/easy_coding_state.py`");
    const config = await readConfigYaml(path.join(tempDir, ".easy-coding", "config.yaml"));
    expect(config.harness_version).toBe(VERSION);
  });

  it("prunes expired session runtime data during an actual upgrade", async () => {
    await init({ agent: "codex", yes: true });
    await markProjectInitComplete();
    await setHarnessVersion("0.10.0-beta.9");

    const sessionsDir = path.join(tempDir, ".easy-coding", "sessions");
    const oldDate = "2020-01-01T00:00:00.000Z";
    await writeFile(
      path.join(sessionsDir, "codex-expired-idle.json"),
      JSON.stringify({ current_task: null, created_at: oldDate, last_active_at: oldDate }),
      "utf8",
    );
    await writeFile(
      path.join(sessionsDir, "codex-expired-attached.json"),
      JSON.stringify({ current_task: "active", created_at: oldDate, last_active_at: oldDate }),
      "utf8",
    );
    await writeFile(
      path.join(sessionsDir, "codex-recent.json"),
      JSON.stringify({ current_task: null, created_at: new Date().toISOString() }),
      "utf8",
    );

    const acceptanceDir = path.join(sessionsDir, "acceptance");
    await mkdir(acceptanceDir, { recursive: true });
    const activeSnapshot = path.join(acceptanceDir, "active.json");
    const orphanSnapshot = path.join(acceptanceDir, "missing.json");
    await writeFile(activeSnapshot, "active evidence\n", "utf8");
    await writeFile(orphanSnapshot, "orphan evidence\n", "utf8");
    const activeTaskDir = path.join(tempDir, ".easy-coding", "tasks", "active");
    await mkdir(activeTaskDir, { recursive: true });
    await writeFile(
      path.join(activeTaskDir, "task.json"),
      `${JSON.stringify(
        {
          type: "feature",
          title: "Active verification fixture",
          status: "VERIFICATION",
          created_at: "2026-08-18T00:00:00.000Z",
          created_by: "codex",
          last_agent: "codex",
          stage_history: [
            {
              stage: "VERIFICATION",
              agent: "codex",
              entered_at: "2026-08-18T00:01:00.000Z",
            },
          ],
          workflow_mode: "standard",
          tdd_enabled: false,
          tdd_coverage_threshold: 90,
          verification_checkpoint: {
            snapshot_file: ".easy-coding/sessions/acceptance/active.json",
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    const memoryPath = path.join(tempDir, ".easy-coding", "memory", "short", "keep.md");
    await writeFile(memoryPath, "memory stays intact\n", "utf8");

    await upgrade({ yes: true });

    await expect(
      readFile(path.join(sessionsDir, "codex-expired-idle.json"), "utf8"),
    ).rejects.toThrow();
    await expect(
      readFile(path.join(sessionsDir, "codex-expired-attached.json"), "utf8"),
    ).rejects.toThrow();
    await expect(readFile(path.join(sessionsDir, "codex-recent.json"), "utf8")).resolves.toContain(
      "current_task",
    );
    await expect(readFile(activeSnapshot, "utf8")).resolves.toBe("active evidence\n");
    await expect(readFile(orphanSnapshot, "utf8")).rejects.toThrow();
    await expect(readFile(memoryPath, "utf8")).resolves.toBe("memory stays intact\n");
  });

  it("keeps expired session runtime data during an upgrade dry run", async () => {
    await init({ agent: "codex", yes: true });
    await markProjectInitComplete();
    await setHarnessVersion("0.10.0-beta.9");

    const sessionPath = path.join(tempDir, ".easy-coding", "sessions", "codex-expired-idle.json");
    const oldSession = JSON.stringify({
      current_task: null,
      created_at: "2020-01-01T00:00:00.000Z",
    });
    await writeFile(sessionPath, oldSession, "utf8");

    await upgrade({ yes: true, dryRun: true });

    await expect(readFile(sessionPath, "utf8")).resolves.toBe(oldSession);
    const config = await readConfigYaml(path.join(tempDir, ".easy-coding", "config.yaml"));
    expect(config.harness_version).toBe("0.10.0-beta.9");
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
