import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listInstallableSubmodules, parseGitmodules } from "../../src/utils/gitmodules.js";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "ec-gitmodules-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("gitmodules", () => {
  it("parses submodule entries sorted by path", async () => {
    await writeFile(
      path.join(tempDir, ".gitmodules"),
      [
        '[submodule "tools"]',
        "  path = packages/tools",
        "  url = git@example.com:tools.git",
        '[submodule "core"]',
        "  path = packages/core",
        "  url = git@example.com:core.git",
        "",
      ].join("\n"),
      "utf8",
    );

    await expect(parseGitmodules(tempDir)).resolves.toEqual([
      { name: "core", path: "packages/core", url: "git@example.com:core.git" },
      { name: "tools", path: "packages/tools", url: "git@example.com:tools.git" },
    ]);
  });

  it("parses git-config key casing and inline comments", async () => {
    await writeFile(
      path.join(tempDir, ".gitmodules"),
      [
        '[Submodule "mixed"]',
        "  Path = packages/mixed # checked out later",
        "  URL = git@example.com:mixed.git ; upstream",
        "",
      ].join("\n"),
      "utf8",
    );
    await mkdir(path.join(tempDir, "packages", "mixed"), { recursive: true });
    await writeFile(
      path.join(tempDir, "packages", "mixed", ".git"),
      "gitdir: ../../.git/modules/mixed\n",
      "utf8",
    );

    await expect(parseGitmodules(tempDir)).resolves.toEqual([
      { name: "mixed", path: "packages/mixed", url: "git@example.com:mixed.git" },
    ]);
    await expect(listInstallableSubmodules(tempDir)).resolves.toEqual([
      { name: "mixed", path: "packages/mixed", url: "git@example.com:mixed.git" },
    ]);
  });

  it("lists only checked-out submodule worktrees", async () => {
    await writeFile(
      path.join(tempDir, ".gitmodules"),
      [
        '[submodule "ready"]',
        "  path = ready",
        "  url = git@example.com:ready.git",
        '[submodule "stale"]',
        "  path = stale",
        "  url = git@example.com:stale.git",
        '[submodule "linked"]',
        "  path = linked",
        "  url = git@example.com:linked.git",
        "",
      ].join("\n"),
      "utf8",
    );
    await mkdir(path.join(tempDir, "ready"), { recursive: true });
    await writeFile(path.join(tempDir, "ready", ".git"), "gitdir: ../.git/modules/ready\n", "utf8");
    await mkdir(path.join(tempDir, "stale"), { recursive: true });
    await writeFile(path.join(tempDir, "stale", ".DS_Store"), "placeholder\n", "utf8");
    const outsideDir = await mkdtemp(path.join(os.tmpdir(), "ec-linked-submodule-"));
    try {
      await writeFile(path.join(outsideDir, ".git"), "gitdir: ../.git/modules/linked\n", "utf8");
      await symlink(outsideDir, path.join(tempDir, "linked"), "dir");

      await expect(listInstallableSubmodules(tempDir)).resolves.toEqual([
        { name: "ready", path: "ready", url: "git@example.com:ready.git" },
      ]);
    } finally {
      await rm(outsideDir, { recursive: true, force: true });
    }
  });

  it("rejects unsafe submodule paths", async () => {
    await writeFile(
      path.join(tempDir, ".gitmodules"),
      ['[submodule "escape"]', "  path = ../escape", "  url = git@example.com:escape.git", ""].join(
        "\n",
      ),
      "utf8",
    );

    await expect(parseGitmodules(tempDir)).rejects.toThrow("Unsafe submodule path");
  });
});
