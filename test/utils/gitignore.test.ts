import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureEasyCodingSessionsIgnored } from "../../src/utils/gitignore.js";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "ec-gitignore-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("ensureEasyCodingSessionsIgnored", () => {
  it("appends the sessions entry idempotently", async () => {
    expect(await ensureEasyCodingSessionsIgnored(tempDir)).toBe(true);
    expect(await ensureEasyCodingSessionsIgnored(tempDir)).toBe(false);

    const content = await readFile(path.join(tempDir, ".gitignore"), "utf8");
    expect(content.match(/\.easy-coding\/sessions\//g)).toHaveLength(1);
  });
});
