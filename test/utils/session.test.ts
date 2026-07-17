import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureDir } from "../../src/utils/file-writer.js";
import {
  cleanStaleSessions,
  createSessionFile,
  getSessionFilePath,
  listSessionFiles,
  readSessionFile,
  writeSessionFile,
} from "../../src/utils/session.js";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "ec-session-"));
  await ensureDir(path.join(tempDir, ".easy-coding", "sessions"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("session", () => {
  it("creates and reads a session file", async () => {
    const session = createSessionFile("06-09-demo");
    await writeSessionFile(tempDir, session, "codex-1200");

    const read = await readSessionFile(tempDir, "codex-1200");
    expect(read).not.toBeNull();
    expect(read?.current_task).toBe("06-09-demo");
    expect(read?.created_at).toBeDefined();
  });

  it("returns null for missing session file", async () => {
    const read = await readSessionFile(tempDir, "codex-99999");
    expect(read).toBeNull();
  });

  it("overwrites existing session file", async () => {
    await writeSessionFile(tempDir, createSessionFile("task-a"), "codex-1200");
    await writeSessionFile(tempDir, createSessionFile("task-b"), "codex-1200");

    const read = await readSessionFile(tempDir, "codex-1200");
    expect(read?.current_task).toBe("task-b");
  });

  it("requires a safe logical session key", () => {
    expect(getSessionFilePath(tempDir, "claude-code-10004")).toContain(
      "claude-code-10004.json",
    );
    expect(() => getSessionFilePath(tempDir, "../escape")).toThrow("Unsafe session key");
  });

  it("lists agent-prefixed sessions without cross-agent collisions", async () => {
    await writeSessionFile(
      tempDir,
      {
        ...createSessionFile("task-codex"),
        agent: "codex",
        external_session_id: "1200",
        confirm_mode: "auto",
        harness_disabled: true,
      },
      "codex-1200",
    );
    await writeSessionFile(
      tempDir,
      {
        ...createSessionFile("task-qoder"),
        agent: "qoder",
        external_session_id: "1200",
        confirm_mode: "guard",
        harness_disabled: false,
      },
      "qoder-1200",
    );

    const sessions = await listSessionFiles(tempDir);

    expect(sessions.map(({ key }) => key)).toEqual(["codex-1200", "qoder-1200"]);
    expect(sessions.map(({ session }) => session.current_task)).toEqual([
      "task-codex",
      "task-qoder",
    ]);
    expect(sessions.map(({ session }) => session.confirm_mode)).toEqual(["auto", "guard"]);
    expect(sessions.map(({ session }) => session.harness_disabled)).toEqual([true, false]);
  });

  it("cleanStaleSessions removes only old sessions without a current task", async () => {
    const oldDate = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
    await writeSessionFile(
      tempDir,
      { current_task: null, created_at: oldDate, last_active_at: oldDate },
      "codex-old-idle",
    );
    await writeSessionFile(
      tempDir,
      { current_task: "task-active", created_at: oldDate, last_active_at: oldDate },
      "codex-old-active",
    );

    const cleaned = await cleanStaleSessions(tempDir);
    expect(cleaned).toBe(1);

    expect(await readSessionFile(tempDir, "codex-old-idle")).toBeNull();
    expect(await readSessionFile(tempDir, "codex-old-active")).not.toBeNull();
  });
});
