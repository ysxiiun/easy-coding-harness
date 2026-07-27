import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { status } from "../../src/commands/status.js";
import { VERSION } from "../../src/constants/version.js";
import { createSessionFile, writeSessionFile } from "../../src/utils/session.js";

let tempDir: string;
let originalCwd: string;
let logSpy: ReturnType<typeof vi.spyOn>;

async function writeConfig(
  harnessVersion: string,
  approvalMode = "guard",
  workflowMode = "adaptive",
): Promise<void> {
  await writeFile(
    path.join(tempDir, ".easy-coding", "config.yaml"),
    [
      "version: 3",
      `harness_version: ${harnessVersion}`,
      "agents:",
      "  - codex",
      "project:",
      "  id: ec-status-test",
      "  name: status-test",
      "behavior:",
      `  approval_mode: ${approvalMode}`,
      `  workflow_mode: ${workflowMode}`,
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

  it("reports project and effective workflow modes", async () => {
    await writeConfig(VERSION, "guard", "fast");

    await status();

    expect(output()).toContain("approval_mode: guard");
    expect(output()).toContain("workflow_mode: fast");
    expect(output()).toContain("configured_workflow_mode: fast");
  });

  it("reports a legacy non-lite session as an adaptive override", async () => {
    await writeConfig(VERSION, "guard", "fast");
    await writeSessionFile(
      tempDir,
      {
        ...createSessionFile(),
        agent: "codex",
        confirm_mode: "guard",
      },
      "legacy-guard",
    );

    await status();

    expect(output()).toContain("- legacy-guard");
    expect(output()).toContain("approval_mode: guard");
    expect(output()).toContain("workflow_mode: adaptive");
    expect(output()).toContain("configured_workflow_mode: adaptive");
  });

  it("lists agent-prefixed logical sessions independently", async () => {
    await writeConfig(VERSION, "guard");
    await writeSessionFile(
      tempDir,
      {
        ...createSessionFile(),
        agent: "claude-code",
        external_session_id: "1200",
        session_key: "claude-code-1200",
        session_source: "hook-session-id",
        approval_mode: "approve",
        workflow_mode: "strict",
      },
      "claude-code-1200",
    );
    await writeSessionFile(
      tempDir,
      {
        ...createSessionFile(),
        agent: "codex",
        external_session_id: "1200",
        session_key: "codex-1200",
        session_source: "hook-session-id",
        approval_mode: "confirm",
        workflow_mode: "fast",
      },
      "codex-1200",
    );

    await status();

    expect(output()).toContain("- claude-code-1200");
    expect(output()).toContain("- codex-1200");
    expect(output()).toContain("agent: claude-code");
    expect(output()).toContain("agent: codex");
    expect(output()).toContain("effective_approval_mode: approve");
    expect(output()).toContain("configured_workflow_mode: strict");
    expect(output()).toContain("effective_approval_mode: confirm");
    expect(output()).toContain("configured_workflow_mode: fast");
  });
});
