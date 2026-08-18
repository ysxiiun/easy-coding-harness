import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureDir } from "../../src/utils/file-writer.js";
import {
  cleanSessionRuntime,
  createSessionFile,
  ensureSessionFile,
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
        approval_mode: "auto",
        workflow_mode: "strict",
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
        approval_mode: "confirm",
        workflow_mode: "fast",
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
    expect(sessions.map(({ session }) => session.approval_mode)).toEqual(["auto", "confirm"]);
    expect(sessions.map(({ session }) => session.workflow_mode)).toEqual(["strict", "fast"]);
    expect(sessions.map(({ session }) => session.harness_disabled)).toEqual([true, false]);
  });

  it("removes idle sessions after 7 days and attached sessions after 30 days", async () => {
    const idleDate = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    const attachedDate = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
    await writeSessionFile(
      tempDir,
      { current_task: null, created_at: idleDate, last_active_at: idleDate },
      "codex-expired-idle",
    );
    await writeSessionFile(
      tempDir,
      { current_task: "task-active", created_at: idleDate, last_active_at: idleDate },
      "codex-recent-attached",
    );
    await writeSessionFile(
      tempDir,
      { current_task: "task-old", created_at: attachedDate, last_active_at: attachedDate },
      "codex-expired-attached",
    );

    const cleaned = await cleanSessionRuntime(tempDir);
    expect(cleaned).toEqual({ sessionsRemoved: 2, acceptanceSnapshotsRemoved: 0 });

    expect(await readSessionFile(tempDir, "codex-expired-idle")).toBeNull();
    expect(await readSessionFile(tempDir, "codex-expired-attached")).toBeNull();
    expect(await readSessionFile(tempDir, "codex-recent-attached")).not.toBeNull();
  });

  it("runs cleanup only when ensureSessionFile creates a logical session", async () => {
    const oldDate = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    await writeSessionFile(
      tempDir,
      { current_task: null, created_at: oldDate, last_active_at: oldDate },
      "codex-old-idle",
    );
    await writeSessionFile(tempDir, createSessionFile(), "codex-existing");

    await ensureSessionFile(tempDir, "codex-existing");
    expect(await readSessionFile(tempDir, "codex-old-idle")).not.toBeNull();

    await ensureSessionFile(tempDir, "codex-new");
    expect(await readSessionFile(tempDir, "codex-old-idle")).toBeNull();
    expect(await readSessionFile(tempDir, "codex-new")).not.toBeNull();
  });

  it("replaces a non-object logical session with a valid session object", async () => {
    const sessionPath = getSessionFilePath(tempDir, "codex-invalid");
    await writeFile(sessionPath, "[]", "utf8");

    const session = await ensureSessionFile(tempDir, "codex-invalid");

    expect(session.current_task).toBeNull();
    expect(JSON.parse(await readFile(sessionPath, "utf8"))).toMatchObject({
      current_task: null,
    });
  });

  it("keeps the newest sessions within the configured capacity", async () => {
    for (let index = 0; index < 5; index++) {
      const timestamp = new Date(Date.now() - index * 60_000).toISOString();
      await writeSessionFile(
        tempDir,
        { current_task: null, created_at: timestamp, last_active_at: timestamp },
        `codex-${index}`,
      );
    }

    const cleaned = await cleanSessionRuntime(tempDir, {
      idleRetentionMs: 24 * 60 * 60 * 1000,
      attachedRetentionMs: 24 * 60 * 60 * 1000,
      maxSessions: 3,
    });

    expect(cleaned.sessionsRemoved).toBe(2);
    expect(await readSessionFile(tempDir, "codex-4")).toBeNull();
    expect(await readSessionFile(tempDir, "codex-3")).toBeNull();
    expect(await readSessionFile(tempDir, "codex-0")).not.toBeNull();
  });

  it("uses file modification time for malformed legacy session files", async () => {
    const malformedPath = path.join(tempDir, ".easy-coding", "sessions", "legacy.json");
    const invalidTimestampPath = path.join(
      tempDir,
      ".easy-coding",
      "sessions",
      "invalid-timestamp.json",
    );
    await writeFile(malformedPath, "{not-json", "utf8");
    await writeFile(invalidTimestampPath, JSON.stringify({ created_at: 20200101 }), "utf8");
    const oldDate = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    await utimes(malformedPath, oldDate, oldDate);

    const cleaned = await cleanSessionRuntime(tempDir);

    expect(cleaned.sessionsRemoved).toBe(1);
    await expect(readFile(malformedPath, "utf8")).rejects.toThrow();
    await expect(readFile(invalidTimestampPath, "utf8")).resolves.toContain("20200101");
  });

  it("removes only orphan or terminal acceptance snapshots", async () => {
    const acceptanceDir = path.join(tempDir, ".easy-coding", "sessions", "acceptance");
    const tasksDir = path.join(tempDir, ".easy-coding", "tasks");
    await mkdir(acceptanceDir, { recursive: true });

    const activeSnapshot = path.join(acceptanceDir, "active.json");
    const unreferencedSnapshot = path.join(acceptanceDir, "unreferenced.json");
    const terminalSnapshot = path.join(acceptanceDir, "terminal.json");
    const missingSnapshot = path.join(acceptanceDir, "missing.json");
    const invalidTaskSnapshot = path.join(acceptanceDir, "invalid-task.json");
    for (const snapshotPath of [
      activeSnapshot,
      unreferencedSnapshot,
      terminalSnapshot,
      missingSnapshot,
      invalidTaskSnapshot,
    ]) {
      await writeFile(snapshotPath, "{}\n", "utf8");
    }

    await mkdir(path.join(tasksDir, "active"), { recursive: true });
    const activeTaskContent = `${JSON.stringify({
      status: "VERIFICATION",
      verification_checkpoint: {
        snapshot_file: ".easy-coding/sessions/acceptance/active.json",
      },
    })}\n`;
    await writeFile(path.join(tasksDir, "active", "task.json"), activeTaskContent, "utf8");
    await mkdir(path.join(tasksDir, "unreferenced"), { recursive: true });
    await writeFile(
      path.join(tasksDir, "unreferenced", "task.json"),
      JSON.stringify({ status: "VERIFICATION" }),
      "utf8",
    );
    await mkdir(path.join(tasksDir, "terminal"), { recursive: true });
    await writeFile(
      path.join(tasksDir, "terminal", "task.json"),
      JSON.stringify({
        status: "COMPLETE",
        verification_checkpoint: {
          snapshot_file: ".easy-coding/sessions/acceptance/terminal.json",
        },
      }),
      "utf8",
    );
    await mkdir(path.join(tasksDir, "invalid-task"), { recursive: true });
    await writeFile(path.join(tasksDir, "invalid-task", "task.json"), "[]", "utf8");

    const cleaned = await cleanSessionRuntime(tempDir);

    expect(cleaned.acceptanceSnapshotsRemoved).toBe(3);
    expect(await readFile(activeSnapshot, "utf8")).toBe("{}\n");
    expect(await readFile(invalidTaskSnapshot, "utf8")).toBe("{}\n");
    expect(await readFile(path.join(tasksDir, "active", "task.json"), "utf8")).toBe(
      activeTaskContent,
    );
    await expect(readFile(unreferencedSnapshot, "utf8")).rejects.toThrow();
    await expect(readFile(terminalSnapshot, "utf8")).rejects.toThrow();
    await expect(readFile(missingSnapshot, "utf8")).rejects.toThrow();
  });
});
