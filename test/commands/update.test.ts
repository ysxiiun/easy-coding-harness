import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the child process layer so the test NEVER actually runs `npm install -g`.
const { execFileSync } = vi.hoisted(() => ({ execFileSync: vi.fn() }));
vi.mock("node:child_process", () => ({ execFileSync }));

import { update } from "../../src/commands/update.js";
import { PACKAGE_NAME } from "../../src/constants/version.js";

describe("update", () => {
  beforeEach(() => {
    execFileSync.mockClear();
  });

  it("dry-run prints the plan and executes nothing", async () => {
    await update({ dryRun: true });
    expect(execFileSync).not.toHaveBeenCalled();
  });

  it("with --yes: refreshes the global CLI", async () => {
    await update({ yes: true });
    expect(execFileSync).toHaveBeenCalledTimes(1);
    expect(execFileSync).toHaveBeenCalledWith(
      "npm",
      ["install", "-g", `${PACKAGE_NAME}@latest`],
      expect.objectContaining({ stdio: "inherit" }),
    );
  });

  it("respects a custom --tag", async () => {
    await update({ yes: true, tag: "beta" });
    expect(execFileSync).toHaveBeenNthCalledWith(
      1,
      "npm",
      ["install", "-g", `${PACKAGE_NAME}@beta`],
      expect.anything(),
    );
  });
});
