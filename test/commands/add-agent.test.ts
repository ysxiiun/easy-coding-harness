import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addAgent } from "../../src/commands/add-agent.js";
import { init } from "../../src/commands/init.js";

let tempDir: string;
let originalCwd: string;

beforeEach(async () => {
  originalCwd = process.cwd();
  tempDir = await mkdtemp(path.join(os.tmpdir(), "ec-add-agent-"));
  process.chdir(tempDir);
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(async () => {
  vi.restoreAllMocks();
  process.chdir(originalCwd);
  await rm(tempDir, { recursive: true, force: true });
});

describe("add-agent command", () => {
  it("rejects explicit --submodules in a non-supermodule repository", async () => {
    await init({ agent: "codex", yes: true });

    await expect(addAgent({ agent: "claude-code", submodules: "packages/a" })).rejects.toThrow(
      "--submodules can only be used in a repository with .gitmodules.",
    );

    const config = await readFile(path.join(tempDir, ".easy-coding", "config.yaml"), "utf8");
    expect(config).toContain("  - codex");
    expect(config).not.toContain("claude-code");
  });

  it("limits parent topology refresh to selected and already managed submodules", async () => {
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

    await init({ agent: "codex", submodules: "packages/a" });
    process.chdir(path.join(tempDir, "packages", "b"));
    await init({ agent: "codex", yes: true });
    process.chdir(tempDir);

    await addAgent({ agent: "claude-code", submodules: false });

    const parentConfig = await readFile(path.join(tempDir, ".easy-coding", "config.yaml"), "utf8");
    expect(parentConfig).toContain("- packages/a");
    expect(parentConfig).not.toContain("- packages/b");
    const parentConstraint = await readFile(path.join(tempDir, "CLAUDE.md"), "utf8");
    expect(parentConstraint).toContain("`packages/a`");
    expect(parentConstraint).not.toContain("`packages/b`");

    const childAConfig = await readFile(
      path.join(tempDir, "packages", "a", ".easy-coding", "config.yaml"),
      "utf8",
    );
    expect(childAConfig).not.toContain("claude-code");
    const childBConfig = await readFile(
      path.join(tempDir, "packages", "b", ".easy-coding", "config.yaml"),
      "utf8",
    );
    expect(childBConfig).toContain("role: standalone");
    expect(childBConfig).not.toContain("claude-code");
  });

  it("refreshes supermodule topology even when selected agents are already installed", async () => {
    await writeFile(
      path.join(tempDir, ".gitmodules"),
      ['[submodule "pkg-a"]', "  path = packages/a", "  url = git@example.com:pkg-a.git", ""].join(
        "\n",
      ),
      "utf8",
    );
    await mkdir(path.join(tempDir, "packages", "a"), { recursive: true });
    await writeFile(path.join(tempDir, "packages", "a", ".git"), "gitdir: ../../.git/modules/a\n", "utf8");

    await init({ agent: "codex", submodules: false });
    process.chdir(path.join(tempDir, "packages", "a"));
    await init({ agent: "codex", yes: true });
    process.chdir(tempDir);

    await addAgent({ agent: "codex", submodules: "packages/a" });

    const parentConfig = await readFile(path.join(tempDir, ".easy-coding", "config.yaml"), "utf8");
    expect(parentConfig).toContain("- packages/a");
    const parentConstraint = await readFile(path.join(tempDir, "AGENTS.md"), "utf8");
    expect(parentConstraint).toContain("## Supermodule Boundary");
    expect(parentConstraint).toContain("`packages/a`");

    const childConfig = await readFile(
      path.join(tempDir, "packages", "a", ".easy-coding", "config.yaml"),
      "utf8",
    );
    expect(childConfig).toContain("role: submodule-child");
    expect(childConfig).toContain("parent: ../..");
  });
});
