import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VERSION } from "../../src/constants/version.js";

const promptMocks = vi.hoisted(() => ({
  select: vi.fn(),
  confirm: vi.fn(),
  cancel: vi.fn(),
  outro: vi.fn(),
}));

vi.mock("@clack/prompts", () => promptMocks);

import { config } from "../../src/commands/config.js";

let tempDir: string;
let originalCwd: string;
let configPath: string;

function adjacentCoreVersion(direction: -1 | 1): string {
  const [major, minor, patch] = VERSION.split("-", 1)[0]
    .split(".")
    .map((part) => Number.parseInt(part, 10));
  if (direction === 1) {
    return `${major}.${minor}.${patch + 1}`;
  }
  if (patch > 0) {
    return `${major}.${minor}.${patch - 1}`;
  }
  if (minor > 0) {
    return `${major}.${minor - 1}.0`;
  }
  return `${Math.max(0, major - 1)}.0.0`;
}

beforeEach(async () => {
  originalCwd = process.cwd();
  tempDir = await mkdtemp(path.join(os.tmpdir(), "ec-config-command-"));
  process.chdir(tempDir);
  configPath = path.join(tempDir, ".easy-coding", "config.yaml");
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(
    configPath,
    [
      "version: 2",
      `harness_version: ${VERSION}`,
      "agents:",
      "  - codex",
      "project:",
      "  id: ec-test",
      "  name: demo",
      "behavior:",
      "  confirm_mode: guard",
      "",
    ].join("\n"),
    "utf8",
  );
  vi.clearAllMocks();
});

afterEach(async () => {
  process.chdir(originalCwd);
  await rm(tempDir, { recursive: true, force: true });
});

describe("config command", () => {
  it("interactively updates the project confirm mode", async () => {
    promptMocks.select.mockResolvedValue("auto");
    promptMocks.confirm.mockResolvedValue(true);

    await config();

    expect(await readFile(configPath, "utf8")).toContain("confirm_mode: auto");
    expect(promptMocks.outro).toHaveBeenCalledWith(
      expect.stringContaining("Project confirm mode updated to auto"),
    );
  });

  it("leaves the config unchanged when confirmation is declined", async () => {
    promptMocks.select.mockResolvedValue("approve");
    promptMocks.confirm.mockResolvedValue(false);

    await config();

    expect(await readFile(configPath, "utf8")).toContain("confirm_mode: guard");
    expect(promptMocks.cancel).toHaveBeenCalledWith("Configuration cancelled.");
  });

  it.each([
    [adjacentCoreVersion(-1), `older than CLI ${VERSION}`, "easy-coding upgrade"],
    [
      `${VERSION.split("+", 1)[0]}+fixture`,
      `does not exactly match CLI ${VERSION}`,
      "before changing config",
    ],
    [adjacentCoreVersion(1), `newer than CLI ${VERSION}`, "Update the CLI"],
  ])(
    "refuses to mutate a project with harness version %s",
    async (harnessVersion, expectedRelation, expectedAction) => {
      const original = (await readFile(configPath, "utf8")).replace(
        `harness_version: ${VERSION}`,
        `harness_version: ${harnessVersion}`,
      );
      await writeFile(configPath, original, "utf8");

      const invocation = config();
      await expect(invocation).rejects.toThrow(expectedRelation);
      await expect(invocation).rejects.toThrow(expectedAction);

      expect(await readFile(configPath, "utf8")).toBe(original);
      expect(promptMocks.select).not.toHaveBeenCalled();
    },
  );
});
