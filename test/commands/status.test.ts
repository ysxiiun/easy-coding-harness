import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { status } from "../../src/commands/status.js";
import { VERSION } from "../../src/constants/version.js";

let tempDir: string;
let originalCwd: string;
let logSpy: ReturnType<typeof vi.spyOn>;

async function writeConfig(harnessVersion: string, confirmMode = "guard"): Promise<void> {
  await writeFile(
    path.join(tempDir, ".easy-coding", "config.yaml"),
    [
      "version: 2",
      `harness_version: ${harnessVersion}`,
      "agents:",
      "  - codex",
      "project:",
      "  id: ec-status-test",
      "  name: status-test",
      "behavior:",
      `  confirm_mode: ${confirmMode}`,
      "",
    ].join("\n"),
    "utf8",
  );
}

function output(): string {
  return logSpy.mock.calls.flat().join("\n");
}

beforeEach(async () => {
  originalCwd = process.cwd();
  tempDir = await mkdtemp(path.join(os.tmpdir(), "ec-status-command-"));
  process.chdir(tempDir);
  await mkdir(path.join(tempDir, ".easy-coding"), { recursive: true });
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(async () => {
  vi.restoreAllMocks();
  process.chdir(originalCwd);
  await rm(tempDir, { recursive: true, force: true });
});

describe("status command", () => {
  it("reports an exact-version refresh when SemVer precedence is equal", async () => {
    await writeConfig(`${VERSION.split("+", 1)[0]}+fixture`);

    await status();

    expect(output()).toContain("upgrade: available");
    expect(output()).not.toContain("upgrade: up to date");
  });

  it("reports up to date only for an exact version match", async () => {
    await writeConfig(VERSION);

    await status();

    expect(output()).toContain("upgrade: up to date");
  });

  it("reports lite as the project and effective confirm mode", async () => {
    await writeConfig(VERSION, "lite");

    await status();

    expect(output()).toContain("confirm_mode: lite");
    expect(output()).toContain("effective_confirm_mode: lite");
  });
});
