import { execSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { init } from "../../src/commands/init.js";
import { pathExists } from "../../src/utils/file-writer.js";
import { readTaskJson } from "../../src/utils/task-json.js";

let tempDir: string;
let originalCwd: string;

beforeEach(async () => {
  originalCwd = process.cwd();
  tempDir = await mkdtemp(path.join(os.tmpdir(), "ec-init-"));
  process.chdir(tempDir);
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(async () => {
  vi.restoreAllMocks();
  process.chdir(originalCwd);
  await rm(tempDir, { recursive: true, force: true });
});

describe("init command", () => {
  it("installs harness over legacy easy-coding skill assets without overwriting them", async () => {
    await mkdir(path.join(tempDir, ".easy-coding", "memory", "long"), { recursive: true });
    await mkdir(path.join(tempDir, ".easy-coding", "memory", "short"), { recursive: true });
    await mkdir(path.join(tempDir, ".easy-coding", "prototype"), { recursive: true });
    await writeFile(path.join(tempDir, ".easy-coding", "SOUL.md"), "legacy soul\n", "utf8");
    await writeFile(path.join(tempDir, ".easy-coding", "RULES.md"), "legacy rules\n", "utf8");
    await writeFile(path.join(tempDir, ".easy-coding", "ABSTRACT.md"), "legacy abstract\n", "utf8");
    await writeFile(
      path.join(tempDir, ".easy-coding", "memory", "long", "MEMORY.md"),
      "legacy memory\n",
      "utf8",
    );
    await writeFile(
      path.join(tempDir, ".easy-coding", "prototype", "index.html"),
      "<main>legacy prototype</main>\n",
      "utf8",
    );

    await init({ yes: true });

    expect(await readFile(path.join(tempDir, ".easy-coding", "SOUL.md"), "utf8")).toBe(
      "legacy soul\n",
    );
    expect(await readFile(path.join(tempDir, ".easy-coding", "RULES.md"), "utf8")).toBe(
      "legacy rules\n",
    );
    expect(await readFile(path.join(tempDir, ".easy-coding", "ABSTRACT.md"), "utf8")).toBe(
      "legacy abstract\n",
    );
    expect(
      await readFile(path.join(tempDir, ".easy-coding", "memory", "long", "MEMORY.md"), "utf8"),
    ).toBe("legacy memory\n");
    expect(await pathExists(path.join(tempDir, ".easy-coding", "config.yaml"))).toBe(true);
    expect(await pathExists(path.join(tempDir, ".easy-coding", "tasks", "project-init", "task.json"))).toBe(
      true,
    );

    const task = await readTaskJson(
      path.join(tempDir, ".easy-coding", "tasks", "project-init", "task.json"),
    );
    expect(task.context?.init_source).toBe("legacy-easy-coding");
    expect(task.context?.legacy_assets).toEqual([
      ".easy-coding/ABSTRACT.md",
      ".easy-coding/RULES.md",
      ".easy-coding/SOUL.md",
      ".easy-coding/memory/long/MEMORY.md",
      ".easy-coding/prototype",
    ]);
    expect(task.context?.legacy_missing_harness_files).toEqual([
      ".easy-coding/config.yaml",
      ".easy-coding/tasks/project-init/task.json",
    ]);
  });

  it("rejects an unrecognized .easy-coding directory", async () => {
    await mkdir(path.join(tempDir, ".easy-coding"), { recursive: true });

    await expect(init({ yes: true })).rejects.toThrow(".easy-coding exists but is not recognized");
  });

  it("does not mark a fresh install as installed when platform setup fails", async () => {
    await writeFile(path.join(tempDir, ".claude"), "blocking file\n", "utf8");

    await expect(init({ yes: true })).rejects.toThrow();
    expect(await pathExists(path.join(tempDir, ".easy-coding", "config.yaml"))).toBe(false);

    await rm(path.join(tempDir, ".claude"), { force: true });
    await init({ yes: true });

    expect(await pathExists(path.join(tempDir, ".easy-coding", "config.yaml"))).toBe(true);
    expect(await pathExists(path.join(tempDir, ".claude", "settings.json"))).toBe(true);
  });

  it("rejects explicit --submodules in a non-supermodule repository", async () => {
    await expect(init({ yes: true, submodules: "packages/a" })).rejects.toThrow(
      "--submodules can only be used in a repository with .gitmodules.",
    );

    expect(await pathExists(path.join(tempDir, ".easy-coding", "config.yaml"))).toBe(false);
  });

  it("installs parent and checked-out submodules in a supermodule", async () => {
    await writeFile(
      path.join(tempDir, ".gitmodules"),
      [
        '[submodule "pkg-a"]',
        "  Path = packages/a # checked out",
        "  URL = git@example.com:pkg-a.git",
        '[submodule "pkg-b"]',
        "  path = packages/b # stale checkout",
        "  url = git@example.com:pkg-b.git",
        '[submodule "pkg-c"]',
        "  path = packages/c",
        "  url = git@example.com:pkg-c.git",
        "",
      ].join("\n"),
      "utf8",
    );
    const outsideSubmoduleDir = await mkdtemp(path.join(os.tmpdir(), "ec-init-linked-child-"));
    await mkdir(path.join(tempDir, "packages", "a"), { recursive: true });
    await writeFile(path.join(tempDir, "packages", "a", ".git"), "gitdir: ../../.git/modules/a\n", "utf8");
    await mkdir(path.join(tempDir, "packages", "b"), { recursive: true });
    await writeFile(path.join(tempDir, "packages", "b", ".DS_Store"), "placeholder\n", "utf8");
    await writeFile(
      path.join(outsideSubmoduleDir, ".git"),
      "gitdir: ../../.git/modules/c\n",
      "utf8",
    );
    await symlink(outsideSubmoduleDir, path.join(tempDir, "packages", "c"), "dir");

    try {
      await init({ yes: true });

      const parentConfig = await readFile(
        path.join(tempDir, ".easy-coding", "config.yaml"),
        "utf8",
      );
      expect(parentConfig).toContain("role: super-parent");
      expect(parentConfig).toContain("- packages/a");
      expect(parentConfig).not.toContain("packages/b");
      expect(parentConfig).not.toContain("packages/c");

      const childConfig = await readFile(
        path.join(tempDir, "packages", "a", ".easy-coding", "config.yaml"),
        "utf8",
      );
      expect(childConfig).toContain("role: submodule-child");
      expect(childConfig).toContain("parent: ../..");
      expect(await pathExists(path.join(tempDir, "packages", "b", ".easy-coding"))).toBe(false);
      expect(await pathExists(path.join(outsideSubmoduleDir, ".easy-coding"))).toBe(false);

      const parentConstraint = await readFile(path.join(tempDir, "CLAUDE.md"), "utf8");
      expect(parentConstraint).toContain("## Supermodule Boundary");
      expect(parentConstraint).toContain("`packages/a`");
      const childConstraint = await readFile(
        path.join(tempDir, "packages", "a", "CLAUDE.md"),
        "utf8",
      );
      expect(childConstraint).not.toContain("## Supermodule Boundary");
    } finally {
      await rm(outsideSubmoduleDir, { recursive: true, force: true });
    }
  });

  it("binds parent hook commands to the parent root when fired from a child cwd", async () => {
    await writeFile(
      path.join(tempDir, ".gitmodules"),
      ['[submodule "pkg-a"]', "  path = packages/a", "  url = git@example.com:pkg-a.git", ""].join(
        "\n",
      ),
      "utf8",
    );
    const childDir = path.join(tempDir, "packages", "a");
    await mkdir(childDir, { recursive: true });
    await writeFile(path.join(childDir, ".git"), "gitdir: ../../.git/modules/a\n", "utf8");

    await init({ yes: true });

    const parentTaskPath = path.join(
      tempDir,
      ".easy-coding",
      "tasks",
      "project-init",
      "task.json",
    );
    const parentTask = JSON.parse(await readFile(parentTaskPath, "utf8"));
    parentTask.status = "COMPLETE";
    await writeFile(parentTaskPath, `${JSON.stringify(parentTask, null, 2)}\n`, "utf8");

    const parentSettings = JSON.parse(
      await readFile(path.join(tempDir, ".claude", "settings.json"), "utf8"),
    ) as {
      hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>>;
    };
    const command = parentSettings.hooks.SessionStart[0].hooks[0].command;
    const childConfig = await readFile(path.join(childDir, ".easy-coding", "config.yaml"), "utf8");
    const childProjectId = childConfig.match(/^\s+id:\s*(\S+)/m)?.[1];
    expect(command).not.toContain(String(childProjectId));

    const stdout = execSync(command, {
      cwd: childDir,
      input: JSON.stringify({ cwd: childDir }),
      encoding: "utf8",
    });
    expect(stdout).toContain(
      "> **Easy Coding** · **Guard** · Ready · Use `ec-workflow` to start or resume a task, `ec-brainstorming` to brainstorm, or `ec-task-management` to manage tasks or session settings",
    );
    expect(stdout).not.toContain("Waiting init");
  });

  it("respects --no-submodules in a supermodule", async () => {
    await writeFile(
      path.join(tempDir, ".gitmodules"),
      ['[submodule "pkg-a"]', "  path = packages/a", "  url = git@example.com:pkg-a.git", ""].join(
        "\n",
      ),
      "utf8",
    );
    await mkdir(path.join(tempDir, "packages", "a"), { recursive: true });
    await writeFile(path.join(tempDir, "packages", "a", ".git"), "gitdir: ../../.git/modules/a\n", "utf8");

    await init({ yes: true, submodules: false });

    const parentConfig = await readFile(path.join(tempDir, ".easy-coding", "config.yaml"), "utf8");
    expect(parentConfig).toContain("role: super-parent");
    expect(parentConfig).toContain("submodules: []");
    expect(await pathExists(path.join(tempDir, "packages", "a", ".easy-coding"))).toBe(false);
  });

  it("preserves existing child topology during --no-submodules re-entry", async () => {
    await writeFile(
      path.join(tempDir, ".gitmodules"),
      ['[submodule "pkg-a"]', "  path = packages/a", "  url = git@example.com:pkg-a.git", ""].join(
        "\n",
      ),
      "utf8",
    );
    await mkdir(path.join(tempDir, "packages", "a"), { recursive: true });
    await writeFile(path.join(tempDir, "packages", "a", ".git"), "gitdir: ../../.git/modules/a\n", "utf8");

    await init({ agent: "codex", yes: true });
    await init({ yes: true, submodules: false });

    const parentConfig = await readFile(path.join(tempDir, ".easy-coding", "config.yaml"), "utf8");
    expect(parentConfig).toContain("- packages/a");
    const parentConstraint = await readFile(path.join(tempDir, "AGENTS.md"), "utf8");
    expect(parentConstraint).toContain("`packages/a`");
    const childConfig = await readFile(
      path.join(tempDir, "packages", "a", ".easy-coding", "config.yaml"),
      "utf8",
    );
    expect(childConfig).toContain("role: submodule-child");
  });

  it("does not adopt a standalone child during --no-submodules init", async () => {
    await writeFile(
      path.join(tempDir, ".gitmodules"),
      ['[submodule "pkg-a"]', "  path = packages/a", "  url = git@example.com:pkg-a.git", ""].join(
        "\n",
      ),
      "utf8",
    );
    await mkdir(path.join(tempDir, "packages", "a"), { recursive: true });
    await writeFile(path.join(tempDir, "packages", "a", ".git"), "gitdir: ../../.git/modules/a\n", "utf8");

    process.chdir(path.join(tempDir, "packages", "a"));
    await init({ agent: "codex", yes: true });
    process.chdir(tempDir);

    await init({ agent: "codex", yes: true, submodules: false });

    const parentConfig = await readFile(path.join(tempDir, ".easy-coding", "config.yaml"), "utf8");
    expect(parentConfig).toContain("submodules: []");
    expect(parentConfig).not.toContain("- packages/a");
    const parentConstraint = await readFile(path.join(tempDir, "AGENTS.md"), "utf8");
    expect(parentConstraint).not.toContain("`packages/a`");
    const childConfig = await readFile(
      path.join(tempDir, "packages", "a", ".easy-coding", "config.yaml"),
      "utf8",
    );
    expect(childConfig).toContain("role: standalone");
  });

  it("refreshes an already-installed child during default supermodule init", async () => {
    await writeFile(
      path.join(tempDir, ".gitmodules"),
      ['[submodule "pkg-a"]', "  path = packages/a", "  url = git@example.com:pkg-a.git", ""].join(
        "\n",
      ),
      "utf8",
    );
    await mkdir(path.join(tempDir, "packages", "a"), { recursive: true });
    await writeFile(path.join(tempDir, "packages", "a", ".git"), "gitdir: ../../.git/modules/a\n", "utf8");

    process.chdir(path.join(tempDir, "packages", "a"));
    await init({ agent: "codex", yes: true });
    let childConfig = await readFile(
      path.join(tempDir, "packages", "a", ".easy-coding", "config.yaml"),
      "utf8",
    );
    expect(childConfig).toContain("role: standalone");

    process.chdir(tempDir);
    await init({ agent: "codex", yes: true });

    const parentConfig = await readFile(path.join(tempDir, ".easy-coding", "config.yaml"), "utf8");
    expect(parentConfig).toContain("- packages/a");
    childConfig = await readFile(
      path.join(tempDir, "packages", "a", ".easy-coding", "config.yaml"),
      "utf8",
    );
    expect(childConfig).toContain("role: submodule-child");
    expect(childConfig).toContain("parent: ../..");
  });

  it("re-enters a supermodule init to add a newly selected child", async () => {
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

    process.chdir(path.join(tempDir, "packages", "a"));
    await init({ agent: "codex", yes: true });
    let childAConfig = await readFile(
      path.join(tempDir, "packages", "a", ".easy-coding", "config.yaml"),
      "utf8",
    );
    expect(childAConfig).toContain("role: standalone");

    process.chdir(tempDir);
    await init({ agent: "codex", submodules: "packages/a" });
    childAConfig = await readFile(
      path.join(tempDir, "packages", "a", ".easy-coding", "config.yaml"),
      "utf8",
    );
    expect(childAConfig).toContain("role: submodule-child");
    expect(childAConfig).toContain("parent: ../..");
    await init({ yes: true, submodules: "packages/b" });

    const parentConfig = await readFile(path.join(tempDir, ".easy-coding", "config.yaml"), "utf8");
    expect(parentConfig).toContain("- packages/a");
    expect(parentConfig).toContain("- packages/b");
    const childBConfig = await readFile(
      path.join(tempDir, "packages", "b", ".easy-coding", "config.yaml"),
      "utf8",
    );
    expect(childBConfig).toContain("  - codex");

    const parentConstraint = await readFile(path.join(tempDir, "AGENTS.md"), "utf8");
    expect(parentConstraint).toContain("`packages/a`");
    expect(parentConstraint).toContain("`packages/b`");
  });
});
