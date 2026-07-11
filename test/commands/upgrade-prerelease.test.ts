import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/constants/version.js", () => ({ VERSION: "9.9.9-beta.1" }));

import { init } from "../../src/commands/init.js";
import { upgrade } from "../../src/commands/upgrade.js";

let tempDir: string;
let originalCwd: string;

beforeEach(async () => {
  originalCwd = process.cwd();
  tempDir = await mkdtemp(path.join(os.tmpdir(), "ec-upgrade-prerelease-"));
  process.chdir(tempDir);
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(async () => {
  vi.restoreAllMocks();
  process.chdir(originalCwd);
  await rm(tempDir, { recursive: true, force: true });
});

describe("upgrade prerelease ordering", () => {
  it("refuses to downgrade a stable project with a matching-core beta CLI", async () => {
    await init({ agent: "codex" });
    const configPath = path.join(tempDir, ".easy-coding", "config.yaml");
    const stableConfig = (await readFile(configPath, "utf8")).replace(
      "harness_version: 9.9.9-beta.1",
      "harness_version: 9.9.9",
    );
    await writeFile(configPath, stableConfig, "utf8");

    await expect(upgrade({ yes: true })).rejects.toThrow(
      "harness version 9.9.9 is newer than CLI 9.9.9-beta.1",
    );
    expect(await readFile(configPath, "utf8")).toBe(stableConfig);
  });
});
