import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
});
