import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkForUpgrade,
  compareVersions,
  isVersionBehind,
} from "../../src/utils/compare-versions.js";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "ec-version-"));
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(tempDir, { recursive: true, force: true });
});

describe("compareVersions", () => {
  it("compares semver-like versions", () => {
    expect(compareVersions("0.1.1", "0.1.1")).toBe(0);
    expect(compareVersions("0.1.2", "0.1.1")).toBe(1);
    expect(compareVersions("0.2.0", "0.10.0")).toBe(-1);
    expect(compareVersions("0.1", "0.1.0")).toBe(0);
  });

  it("orders prereleases below the matching stable release", () => {
    expect(compareVersions("0.7.0-beta.1", "0.7.0")).toBe(-1);
    expect(compareVersions("0.7.0", "0.7.0-beta.1")).toBe(1);
    expect(compareVersions("0.7.0-beta.2", "0.7.0-beta.10")).toBe(-1);
    expect(compareVersions("0.7.0-beta.1", "0.7.0-beta.alpha")).toBe(-1);
    expect(compareVersions("0.7.0+build.1", "0.7.0+build.2")).toBe(0);
  });

  it("detects an installed version behind the current CLI", () => {
    expect(isVersionBehind("0.1.0", "0.1.1")).toBe(true);
    expect(isVersionBehind("0.1.1", "0.1.1")).toBe(false);
  });
});

describe("checkForUpgrade", () => {
  it("ignores malformed config.yaml so recovery commands can still run", async () => {
    await mkdir(path.join(tempDir, ".easy-coding"), { recursive: true });
    await writeFile(path.join(tempDir, ".easy-coding", "config.yaml"), "agents: [qoder\n");

    await expect(checkForUpgrade(tempDir)).resolves.toBeUndefined();
  });

  it("still warns when an installed harness version is behind the CLI", async () => {
    await mkdir(path.join(tempDir, ".easy-coding"), { recursive: true });
    await writeFile(
      path.join(tempDir, ".easy-coding", "config.yaml"),
      "harness_version: 0.0.1\n",
      "utf8",
    );
    const writeSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await checkForUpgrade(tempDir);

    expect(writeSpy).toHaveBeenCalledWith(expect.stringContaining("older than CLI"));
  });
});
