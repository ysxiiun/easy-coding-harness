import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureDir } from "../../src/utils/file-writer.js";
import {
  cleanStaleSessions,
  createSessionFile,
  getSessionFilePath,
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
    await writeSessionFile(tempDir, session);

    const read = await readSessionFile(tempDir);
    expect(read).not.toBeNull();
    expect(read?.current_task).toBe("06-09-demo");
    expect(read?.created_at).toBeDefined();
  });

  it("returns null for missing session file", async () => {
    const read = await readSessionFile(tempDir, 99999);
    expect(read).toBeNull();
  });

  it("overwrites existing session file", async () => {
    await writeSessionFile(tempDir, createSessionFile("task-a"));
    await writeSessionFile(tempDir, createSessionFile("task-b"));

    const read = await readSessionFile(tempDir);
    expect(read?.current_task).toBe("task-b");
  });

  it("getSessionFilePath uses ppid by default", () => {
    const filePath = getSessionFilePath(tempDir);
    expect(filePath).toContain(`${process.ppid}.json`);
  });

  it("cleanStaleSessions removes old files with dead pids", async () => {
    const deadPid = 2;
    const oldDate = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    await writeSessionFile(tempDir, { current_task: null, created_at: oldDate }, deadPid);

    const cleaned = await cleanStaleSessions(tempDir);
    expect(cleaned).toBe(1);

    const read = await readSessionFile(tempDir, deadPid);
    expect(read).toBeNull();
  });
});
