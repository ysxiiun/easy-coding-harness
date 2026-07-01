import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { init } from "../../src/commands/init.js";
import { upgrade } from "../../src/commands/upgrade.js";
import { VERSION } from "../../src/constants/version.js";

let tempDir: string;
let originalCwd: string;

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
