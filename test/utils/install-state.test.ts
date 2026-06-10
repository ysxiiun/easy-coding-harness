import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { detectEasyCodingInstallState } from "../../src/utils/install-state.js";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "ec-install-state-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("install-state", () => {
  it("detects a fresh project", async () => {
    const state = await detectEasyCodingInstallState(tempDir);
    expect(state.kind).toBe("fresh");
  });

  it("detects an installed harness by config.yaml", async () => {
    await mkdir(path.join(tempDir, ".easy-coding"), { recursive: true });
    await writeFile(path.join(tempDir, ".easy-coding", "config.yaml"), "version: 1\n", "utf8");

    const state = await detectEasyCodingInstallState(tempDir);
    expect(state.kind).toBe("installed");
  });

  it("detects legacy easy-coding skill assets without config.yaml", async () => {
    await mkdir(path.join(tempDir, ".easy-coding", "memory", "short"), { recursive: true });
    await mkdir(path.join(tempDir, ".easy-coding", "spec"), { recursive: true });
    await writeFile(path.join(tempDir, ".easy-coding", "SOUL.md"), "legacy soul\n", "utf8");
    await writeFile(
      path.join(tempDir, ".easy-coding", "memory", "short", "001.md"),
      "legacy memory\n",
      "utf8",
    );
    await writeFile(path.join(tempDir, ".easy-coding", "spec", "Product-Spec.md"), "spec\n", "utf8");

    const state = await detectEasyCodingInstallState(tempDir);
    expect(state.kind).toBe("legacy");
    if (state.kind !== "legacy") {
      return;
    }
    expect(state.legacyAssets).toEqual([
      ".easy-coding/SOUL.md",
      ".easy-coding/memory/short/001.md",
      ".easy-coding/spec",
    ]);
    expect(state.missingHarnessFiles).toEqual([
      ".easy-coding/config.yaml",
      ".easy-coding/tasks/project-init/task.json",
    ]);
  });

  it("does not treat an empty .easy-coding directory as legacy", async () => {
    await mkdir(path.join(tempDir, ".easy-coding"), { recursive: true });

    const state = await detectEasyCodingInstallState(tempDir);
    expect(state.kind).toBe("unknown");
  });
});
