import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveUpgradeTargets } from "../../src/commands/supermodule-targets.js";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "ec-super-targets-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("supermodule command targets", () => {
  it("returns parent and initialized checked-out child targets", async () => {
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
    await mkdir(path.join(tempDir, ".easy-coding"), { recursive: true });
    await writeFile(path.join(tempDir, ".easy-coding", "config.yaml"), "version: 1\n", "utf8");
    await mkdir(path.join(tempDir, "packages", "a", ".easy-coding"), { recursive: true });
    await writeFile(path.join(tempDir, "packages", "a", ".git"), "gitdir: ../../.git/modules/a\n", "utf8");
    await writeFile(
      path.join(tempDir, "packages", "a", ".easy-coding", "config.yaml"),
      "version: 1\n",
      "utf8",
    );
    await mkdir(path.join(tempDir, "packages", "b"), { recursive: true });
    await writeFile(path.join(tempDir, "packages", "b", ".git"), "gitdir: ../../.git/modules/b\n", "utf8");

    const targets = await resolveUpgradeTargets(tempDir);

    expect(targets.map((target) => target.label)).toEqual([".", "packages/a"]);
    expect(targets[0].supermodule).toEqual({
      role: "super-parent",
      submodules: ["packages/a"],
    });
    expect(targets[0].boundary).toEqual({ submodulePaths: ["packages/a"] });
    expect(targets[1].supermodule).toEqual({
      role: "submodule-child",
      parent: "../..",
    });
  });
});
