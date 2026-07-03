import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addAgent } from "../../src/commands/add-agent.js";
import { clear } from "../../src/commands/clear.js";
import { init } from "../../src/commands/init.js";
import { upgrade } from "../../src/commands/upgrade.js";
import { configureClaude } from "../../src/configurators/claude.js";
import { configureCodex } from "../../src/configurators/codex.js";
import { configureQoder } from "../../src/configurators/qoder.js";
import { renderHookCommand } from "../../src/configurators/shared.js";
import { PLATFORM_META } from "../../src/types/platform.js";
import { readConfigYaml } from "../../src/utils/config-yaml.js";
import { pathExists } from "../../src/utils/file-writer.js";

let tempDir: string;
let originalCwd: string;

function toPosixPath(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

function hookCommand(hooksDir: string, scriptName: string): string {
  return `python3 "${toPosixPath(hooksDir)}"/${scriptName}`;
}

beforeEach(async () => {
  originalCwd = process.cwd();
  tempDir = await mkdtemp(path.join(os.tmpdir(), "ec-clear-"));
  process.chdir(tempDir);
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(async () => {
  vi.restoreAllMocks();
  process.env.EC_QODER_VARIANT = undefined;
  process.env.QODER_VARIANT = undefined;
  process.chdir(originalCwd);
  await rm(tempDir, { recursive: true, force: true });
});

async function writeRuntimeState(configContent: string): Promise<void> {
  await mkdir(path.join(tempDir, ".easy-coding", "tasks", "task-1"), { recursive: true });
  await mkdir(path.join(tempDir, ".easy-coding", "spec"), { recursive: true });
  await mkdir(path.join(tempDir, ".easy-coding", "memory"), { recursive: true });
  await writeFile(path.join(tempDir, ".easy-coding", "tasks", "task-1", "task.json"), "{}\n");
  await writeFile(path.join(tempDir, ".easy-coding", "spec", "README.md"), "spec\n");
  await writeFile(path.join(tempDir, ".easy-coding", "memory", "README.md"), "memory\n");
  await writeFile(path.join(tempDir, ".easy-coding", "config.yaml"), configContent, "utf8");
}

describe("clear command", () => {
  it("clears managed Qoder files from the China variant directory", async () => {
    await mkdir(path.join(tempDir, ".qodercn"));
    await configureQoder(tempDir);
    await writeRuntimeState(
      ["version: 1", "harness_version: 0.2.0", "agents:", "  - qoder", ""].join("\n"),
    );

    await clear({ yes: true });

    expect(await pathExists(path.join(tempDir, ".qodercn", "skills", "ec-workflow"))).toBe(false);
    expect(await pathExists(path.join(tempDir, ".qodercn", "hooks", "session-start.py"))).toBe(
      false,
    );
    expect(await pathExists(path.join(tempDir, ".qodercn", "agents", "ec-implementer.md"))).toBe(
      false,
    );
    expect(await pathExists(path.join(tempDir, ".qodercn", "settings.json"))).toBe(false);
    expect(await pathExists(path.join(tempDir, ".easy-coding", "config.yaml"))).toBe(false);
    expect(
      await pathExists(path.join(tempDir, ".easy-coding", "tasks", "task-1", "task.json")),
    ).toBe(true);
    expect(await readFile(path.join(tempDir, ".easy-coding", "spec", "README.md"), "utf8")).toBe(
      "spec\n",
    );
    expect(await readFile(path.join(tempDir, ".easy-coding", "memory", "README.md"), "utf8")).toBe(
      "memory\n",
    );
  });

  it("falls back to on-disk Qoder CN detection when config.yaml is malformed", async () => {
    await mkdir(path.join(tempDir, ".qodercn"));
    await configureQoder(tempDir);
    await writeRuntimeState("agents: [qoder\n");

    await clear({ yes: true });

    expect(await pathExists(path.join(tempDir, ".qodercn", "hooks", "session-start.py"))).toBe(
      false,
    );
    expect(await pathExists(path.join(tempDir, ".qodercn", "settings.json"))).toBe(false);
    expect(await pathExists(path.join(tempDir, ".easy-coding", "config.yaml"))).toBe(false);
    expect(
      await pathExists(path.join(tempDir, ".easy-coding", "tasks", "task-1", "task.json")),
    ).toBe(true);
  });

  it("falls back to template cleanup when install manifest agents is missing", async () => {
    await configureCodex(tempDir);
    await writeRuntimeState(
      ["version: 1", "harness_version: 0.2.0", "agents:", "  - codex", ""].join("\n"),
    );
    await writeFile(
      path.join(tempDir, ".easy-coding", "install-manifest.json"),
      `${JSON.stringify(
        {
          schema_version: 1,
          harness_version: "0.2.0",
          generated_at: "2026-06-11T00:00:00.000Z",
          files: [],
          hook_registrations: [],
          constraint_regions: [],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    await clear({ yes: true });

    expect(await pathExists(path.join(tempDir, ".codex", "hooks", "session-start.py"))).toBe(false);
    expect(await pathExists(path.join(tempDir, ".codex", "hooks.json"))).toBe(false);
    expect(await pathExists(path.join(tempDir, ".codex", "agents", "ec-implementer.toml"))).toBe(
      false,
    );
    expect(await pathExists(path.join(tempDir, ".easy-coding", "config.yaml"))).toBe(false);
  });

  it("clears the standard Qoder install when an empty China variant directory also exists", async () => {
    await configureQoder(tempDir);
    await mkdir(path.join(tempDir, ".qodercn"));
    await writeRuntimeState(
      ["version: 1", "harness_version: 0.2.0", "agents:", "  - qoder", ""].join("\n"),
    );

    await clear({ yes: true });

    expect(await pathExists(path.join(tempDir, ".qoder", "skills", "ec-workflow"))).toBe(false);
    expect(await pathExists(path.join(tempDir, ".qoder", "hooks", "session-start.py"))).toBe(false);
    expect(await pathExists(path.join(tempDir, ".qoder", "settings.json"))).toBe(false);
    expect(await pathExists(path.join(tempDir, ".easy-coding", "config.yaml"))).toBe(false);
  });

  it("preserves user hooks that only share a managed hook basename", async () => {
    await mkdir(path.join(tempDir, ".qodercn"));
    await configureQoder(tempDir);
    await writeRuntimeState(
      ["version: 1", "harness_version: 0.2.0", "agents:", "  - qoder", ""].join("\n"),
    );
    const settingsPath = path.join(tempDir, ".qodercn", "settings.json");
    const settings = JSON.parse(await readFile(settingsPath, "utf8"));
    settings.hooks.UserPromptSubmit.push({
      hooks: [
        {
          type: "command",
          command: "python3 scripts/session-start.py",
          timeout: 5,
        },
      ],
    });
    await writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");

    await clear({ yes: true });

    const remaining = await readFile(settingsPath, "utf8");
    expect(remaining).toContain("scripts/session-start.py");
    expect(remaining).not.toContain(".qodercn/hooks/session-start.py");
  });

  it("preserves Codex subagent hook files that Codex never installed", async () => {
    await init({ agent: "codex", yes: true });

    const userHookPath = path.join(tempDir, ".codex", "hooks", "inject-subagent-context.py");
    await writeFile(userHookPath, "print('user owned')\n", "utf8");

    const hooksPath = path.join(tempDir, ".codex", "hooks.json");
    const hooks = JSON.parse(await readFile(hooksPath, "utf8"));
    hooks.hooks.UserPromptSubmit.push({
      hooks: [
        {
          type: "command",
          command: "python3 .codex/hooks/inject-subagent-context.py",
          timeout: 5,
        },
      ],
    });
    await writeFile(hooksPath, `${JSON.stringify(hooks, null, 2)}\n`, "utf8");

    const manifest = JSON.parse(
      await readFile(path.join(tempDir, ".easy-coding", "install-manifest.json"), "utf8"),
    );
    expect(JSON.stringify(manifest)).not.toContain(".codex/hooks/inject-subagent-context.py");

    await clear({ yes: true });

    expect(await readFile(userHookPath, "utf8")).toBe("print('user owned')\n");
    const remaining = await readFile(hooksPath, "utf8");
    expect(remaining).toContain(".codex/hooks/inject-subagent-context.py");
    expect(remaining).not.toContain(".codex/hooks/session-start.py");
  });

  it("preserves external hook registrations with managed hook filenames", async () => {
    await init({ agent: "codex", yes: true });

    const externalHooksDir = path.join(tempDir, "custom-hooks", ".codex", "hooks");
    const externalCommand = hookCommand(externalHooksDir, "session-start.py");
    const config = await readConfigYaml(path.join(tempDir, ".easy-coding", "config.yaml"));
    const hooksPath = path.join(tempDir, ".codex", "hooks.json");
    const hooks = JSON.parse(await readFile(hooksPath, "utf8"));
    hooks.hooks.UserPromptSubmit.push({
      hooks: [
        {
          type: "command",
          command: externalCommand,
          timeout: 5,
        },
      ],
    });
    await writeFile(hooksPath, `${JSON.stringify(hooks, null, 2)}\n`, "utf8");

    await clear({ yes: true });

    const remaining = JSON.parse(await readFile(hooksPath, "utf8"));
    const commands = remaining.hooks.UserPromptSubmit.flatMap(
      (group: { hooks: Array<{ command: string }> }) => group.hooks.map((hook) => hook.command),
    );
    expect(commands).toContain(externalCommand);
    expect(commands).not.toContain(
      renderHookCommand(
        tempDir,
        PLATFORM_META.codex.templateContext,
        "session-start.py",
        process.platform,
        config.project.id,
      ),
    );
  });

  it("keeps modified manifest files instead of deleting them", async () => {
    await init({ agent: "codex", yes: true });

    const hookPath = path.join(tempDir, ".codex", "hooks", "session-start.py");
    await writeFile(hookPath, "print('customized')\n", "utf8");

    await clear({ yes: true });

    expect(await readFile(hookPath, "utf8")).toBe("print('customized')\n");
    expect(await pathExists(path.join(tempDir, ".codex", "hooks", "inject-workflow-state.py"))).toBe(
      false,
    );
    expect(await pathExists(path.join(tempDir, ".easy-coding", "install-manifest.json"))).toBe(
      false,
    );
  });

  it("rejects explicit --submodules in a non-supermodule repository without clearing the parent", async () => {
    await init({ agent: "codex", yes: true });

    await expect(clear({ yes: true, submodules: "packages/a" })).rejects.toThrow(
      "--submodules can only be used in a repository with .gitmodules.",
    );

    expect(await pathExists(path.join(tempDir, ".easy-coding", "config.yaml"))).toBe(true);
  });

  it("clears only the parent when --no-submodules is used in a supermodule", async () => {
    await writeFile(
      path.join(tempDir, ".gitmodules"),
      ['[submodule "pkg-a"]', "  path = packages/a", "  url = git@example.com:pkg-a.git", ""].join(
        "\n",
      ),
      "utf8",
    );
    await mkdir(path.join(tempDir, "packages", "a"), { recursive: true });
    await writeFile(path.join(tempDir, "packages", "a", ".git"), "gitdir: ../../.git/modules/a\n", "utf8");
    await init({ agent: "codex", submodules: "packages/a" });

    await clear({ yes: true, submodules: false });

    expect(await pathExists(path.join(tempDir, ".easy-coding", "config.yaml"))).toBe(false);
    expect(
      await pathExists(path.join(tempDir, "packages", "a", ".easy-coding", "config.yaml")),
    ).toBe(true);
  });

  it("clears a supermodule parent runtime even when config.yaml is missing", async () => {
    await writeFile(
      path.join(tempDir, ".gitmodules"),
      ['[submodule "pkg-a"]', "  path = packages/a", "  url = git@example.com:pkg-a.git", ""].join(
        "\n",
      ),
      "utf8",
    );
    await mkdir(path.join(tempDir, ".easy-coding", "tasks", "task-1"), { recursive: true });
    await writeFile(path.join(tempDir, ".easy-coding", "tasks", "task-1", "task.json"), "{}\n");
    await configureCodex(tempDir);

    await clear({ yes: true, submodules: false });

    expect(await pathExists(path.join(tempDir, ".codex", "hooks", "session-start.py"))).toBe(
      false,
    );
    expect(await pathExists(path.join(tempDir, ".codex", "hooks.json"))).toBe(false);
    expect(
      await pathExists(path.join(tempDir, ".easy-coding", "tasks", "task-1", "task.json")),
    ).toBe(true);
  });

  it("clears the parent and selected initialized submodules", async () => {
    await writeFile(
      path.join(tempDir, ".gitmodules"),
      [
        '[submodule "pkg-a"]',
        "  path = packages/a",
        "  url = git@example.com:pkg-a.git",
        '[submodule "pkg-b"]',
        "  path = packages/b",
        "  url = git@example.com:pkg-b.git",
        "",
      ].join("\n"),
      "utf8",
    );
    await mkdir(path.join(tempDir, "packages", "a"), { recursive: true });
    await mkdir(path.join(tempDir, "packages", "b"), { recursive: true });
    await writeFile(path.join(tempDir, "packages", "a", ".git"), "gitdir: ../../.git/modules/a\n", "utf8");
    await writeFile(path.join(tempDir, "packages", "b", ".git"), "gitdir: ../../.git/modules/b\n", "utf8");
    await init({ agent: "codex", submodules: "packages/a,packages/b" });

    await clear({ yes: true, submodules: "packages/a" });

    expect(await pathExists(path.join(tempDir, ".easy-coding", "config.yaml"))).toBe(false);
    expect(
      await pathExists(path.join(tempDir, "packages", "a", ".easy-coding", "config.yaml")),
    ).toBe(false);
    expect(
      await pathExists(path.join(tempDir, "packages", "b", ".easy-coding", "config.yaml")),
    ).toBe(true);
  });

  it("rejects an empty --submodules list without clearing the parent", async () => {
    await writeFile(
      path.join(tempDir, ".gitmodules"),
      ['[submodule "pkg-a"]', "  path = packages/a", "  url = git@example.com:pkg-a.git", ""].join(
        "\n",
      ),
      "utf8",
    );
    await mkdir(path.join(tempDir, "packages", "a"), { recursive: true });
    await writeFile(path.join(tempDir, "packages", "a", ".git"), "gitdir: ../../.git/modules/a\n", "utf8");
    await init({ agent: "codex", submodules: "packages/a" });

    await expect(clear({ yes: true, submodules: "   " })).rejects.toThrow(
      "No submodule specified.",
    );

    expect(await pathExists(path.join(tempDir, ".easy-coding", "config.yaml"))).toBe(true);
    expect(
      await pathExists(path.join(tempDir, "packages", "a", ".easy-coding", "config.yaml")),
    ).toBe(true);
  });

  it("rejects manifest paths that escape the project", async () => {
    await writeRuntimeState(
      ["version: 1", "harness_version: 0.2.0", "agents:", "  - codex", ""].join("\n"),
    );
    const outsidePath = path.join(path.dirname(tempDir), `${path.basename(tempDir)}-outside.txt`);
    await writeFile(outsidePath, "outside\n", "utf8");
    await writeFile(
      path.join(tempDir, ".easy-coding", "install-manifest.json"),
      `${JSON.stringify(
        {
          schema_version: 1,
          harness_version: "0.2.0",
          generated_at: "2026-06-11T00:00:00.000Z",
          agents: ["codex"],
          files: [
            {
              path: `../${path.basename(outsidePath)}`,
              kind: "hook",
              platform: "codex",
              sha256: sha256("outside\n"),
            },
          ],
          hook_registrations: [],
          constraint_regions: [],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    try {
      await expect(clear({ yes: true })).rejects.toThrow("Unsafe install manifest path");
      expect(await readFile(outsidePath, "utf8")).toBe("outside\n");
      expect(await pathExists(path.join(tempDir, ".easy-coding", "config.yaml"))).toBe(true);
    } finally {
      await rm(outsidePath, { force: true });
    }
  });

  it("removes manifest empty dirs deepest-first after a fresh Codex clear", async () => {
    await init({ agent: "codex", yes: true });

    await clear({ yes: true });

    expect(await pathExists(path.join(tempDir, ".agents", "skills"))).toBe(false);
    expect(await pathExists(path.join(tempDir, ".codex", "hooks"))).toBe(false);
    expect(await pathExists(path.join(tempDir, ".codex", "agents"))).toBe(false);
    expect(await pathExists(path.join(tempDir, ".codex", "hooks.json"))).toBe(false);
  });

  it("prunes manifest hook registrations by hook_path when a command was wrapped", async () => {
    await init({ agent: "codex", yes: true });

    const hooksPath = path.join(tempDir, ".codex", "hooks.json");
    const hooks = JSON.parse(await readFile(hooksPath, "utf8"));
    for (const group of hooks.hooks.UserPromptSubmit) {
      for (const hook of group.hooks) {
        if (hook.command.includes(".codex/hooks/session-start.py")) {
          hook.command = `EC_TRACE=1 ${hook.command}`;
        }
      }
    }
    await writeFile(hooksPath, `${JSON.stringify(hooks, null, 2)}\n`, "utf8");

    await clear({ yes: true });

    expect(await pathExists(hooksPath)).toBe(false);
  });

  it("does not prune Codex subagent hook registrations in legacy template mode", async () => {
    await configureCodex(tempDir);
    await writeRuntimeState(
      ["version: 1", "harness_version: 0.2.0", "agents:", "  - codex", ""].join("\n"),
    );

    const userHookPath = path.join(tempDir, ".codex", "hooks", "inject-subagent-context.py");
    await writeFile(userHookPath, "print('legacy user owned')\n", "utf8");

    const hooksPath = path.join(tempDir, ".codex", "hooks.json");
    const hooks = JSON.parse(await readFile(hooksPath, "utf8"));
    hooks.hooks.UserPromptSubmit.push({
      hooks: [
        {
          type: "command",
          command: "python3 .codex/hooks/inject-subagent-context.py",
          timeout: 5,
        },
      ],
    });
    await writeFile(hooksPath, `${JSON.stringify(hooks, null, 2)}\n`, "utf8");

    await clear({ yes: true });

    expect(await readFile(userHookPath, "utf8")).toBe("print('legacy user owned')\n");
    const remaining = await readFile(hooksPath, "utf8");
    expect(remaining).toContain(".codex/hooks/inject-subagent-context.py");
    expect(remaining).not.toContain(".codex/hooks/session-start.py");
  });

  it("removes legacy Qoder skills even when Claude skills also exist", async () => {
    await configureQoder(tempDir);
    await configureClaude(tempDir);
    await writeRuntimeState(
      [
        "version: 1",
        "harness_version: 0.2.0",
        "agents:",
        "  - qoder",
        "  - claude-code",
        "",
      ].join("\n"),
    );

    expect(await pathExists(path.join(tempDir, ".qoder", "skills", "ec-workflow"))).toBe(true);
    expect(await pathExists(path.join(tempDir, ".claude", "skills", "ec-workflow"))).toBe(true);

    await clear({ yes: true });

    expect(await pathExists(path.join(tempDir, ".qoder", "skills", "ec-workflow"))).toBe(false);
    expect(await pathExists(path.join(tempDir, ".claude", "skills", "ec-workflow"))).toBe(false);
    expect(await pathExists(path.join(tempDir, ".qoder", "hooks", "session-start.py"))).toBe(false);
    expect(await pathExists(path.join(tempDir, ".qoder", "agents", "ec-implementer.md"))).toBe(
      false,
    );
    expect(await pathExists(path.join(tempDir, ".qoder", "settings.json"))).toBe(false);
  });

  it("keeps skipped old Qoder skills in a replacement manifest so clear removes them", async () => {
    await init({ agent: "qoder", yes: true });
    await addAgent({ agent: "claude-code", yes: true });

    const configPath = path.join(tempDir, ".easy-coding", "config.yaml");
    await writeFile(
      configPath,
      (await readFile(configPath, "utf8")).replace(/harness_version: .+/, "harness_version: 0.2.0"),
      "utf8",
    );

    await upgrade({ yes: true });

    const manifest = JSON.parse(
      await readFile(path.join(tempDir, ".easy-coding", "install-manifest.json"), "utf8"),
    );
    expect(JSON.stringify(manifest)).toContain(".qoder/skills/ec-workflow/SKILL.md");

    await clear({ yes: true });

    expect(await pathExists(path.join(tempDir, ".qoder", "skills", "ec-workflow"))).toBe(false);
    expect(await pathExists(path.join(tempDir, ".claude", "skills", "ec-workflow"))).toBe(false);
  });

  it("clears a Qoder variant that is installed but not covered by a replacement manifest", async () => {
    await init({ agent: "qoder", yes: true });
    expect(await pathExists(path.join(tempDir, ".qoder", "skills", "ec-workflow"))).toBe(true);

    await mkdir(path.join(tempDir, ".qodercn"));
    const configPath = path.join(tempDir, ".easy-coding", "config.yaml");
    await writeFile(
      configPath,
      (await readFile(configPath, "utf8")).replace(/harness_version: .+/, "harness_version: 0.2.0"),
      "utf8",
    );

    await upgrade({ yes: true });

    const manifest = JSON.parse(
      await readFile(path.join(tempDir, ".easy-coding", "install-manifest.json"), "utf8"),
    );
    const manifestText = JSON.stringify(manifest);
    expect(manifestText).toContain(".qodercn/hooks/session-start.py");
    expect(manifestText).not.toContain(".qoder/hooks/session-start.py");

    await clear({ yes: true });

    for (const baseDir of [".qoder", ".qodercn"]) {
      expect(await pathExists(path.join(tempDir, baseDir, "skills", "ec-workflow"))).toBe(false);
      expect(await pathExists(path.join(tempDir, baseDir, "hooks", "session-start.py"))).toBe(
        false,
      );
      expect(await pathExists(path.join(tempDir, baseDir, "agents", "ec-implementer.md"))).toBe(
        false,
      );
      expect(await pathExists(path.join(tempDir, baseDir, "settings.json"))).toBe(false);
    }
    expect(
      await pathExists(path.join(tempDir, ".easy-coding", "tasks", "project-init", "task.json")),
    ).toBe(true);
  });

  it("keeps legacy agents out of add-agent manifests so clear uses fallback cleanup", async () => {
    await configureClaude(tempDir);
    await writeRuntimeState(
      ["version: 1", "harness_version: 0.2.0", "agents:", "  - claude-code", ""].join("\n"),
    );

    await addAgent({ agent: "codex", yes: true });

    const manifest = JSON.parse(
      await readFile(path.join(tempDir, ".easy-coding", "install-manifest.json"), "utf8"),
    );
    expect(manifest.agents).toEqual(["codex"]);
    expect(await readFile(path.join(tempDir, ".gitignore"), "utf8")).toContain(
      ".easy-coding/sessions/",
    );

    await clear({ yes: true });

    expect(await pathExists(path.join(tempDir, ".claude", "hooks", "session-start.py"))).toBe(false);
    expect(await pathExists(path.join(tempDir, ".claude", "skills", "ec-workflow"))).toBe(false);
    expect(await pathExists(path.join(tempDir, ".codex", "hooks", "session-start.py"))).toBe(false);
    expect(await pathExists(path.join(tempDir, ".easy-coding", "config.yaml"))).toBe(false);
  });
});

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}
