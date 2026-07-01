import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const promptMocks = vi.hoisted(() => ({
  cancel: vi.fn(),
  confirm: vi.fn(),
  multiselect: vi.fn(),
}));

vi.mock("@clack/prompts", () => promptMocks);

import { resolveClearTargets } from "../../src/commands/supermodule-targets.js";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "ec-super-targets-interactive-"));
  promptMocks.cancel.mockReset();
  promptMocks.confirm.mockReset();
  promptMocks.multiselect.mockReset();
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("interactive supermodule command targets", () => {
  it("offers parent and initialized children for clear with parent selected by default", async () => {
    await writeFile(
      path.join(tempDir, ".gitmodules"),
      [
        '[submodule "pkg-a"]',
        "  path = packages/a",
        "  url = git@example.com:pkg-a.git",
        '[submodule "pkg-b"]',
        "  path = packages/b",
        "  url = git@example.com:pkg-b.git",
        "",
      ].join("\n"),
      "utf8",
    );
    await mkdir(path.join(tempDir, ".easy-coding"), { recursive: true });
    await writeFile(path.join(tempDir, ".easy-coding", "config.yaml"), "version: 1\n", "utf8");
    await mkdir(path.join(tempDir, "packages", "a", ".easy-coding"), { recursive: true });
    await writeFile(
      path.join(tempDir, "packages", "a", ".easy-coding", "config.yaml"),
      "version: 1\n",
      "utf8",
    );
    await writeFile(path.join(tempDir, "packages", "a", ".git"), "gitdir: ../../.git/modules/a\n", "utf8");
    await mkdir(path.join(tempDir, "packages", "b", ".easy-coding"), { recursive: true });
    await writeFile(
      path.join(tempDir, "packages", "b", ".easy-coding", "config.yaml"),
      "version: 1\n",
      "utf8",
    );
    await writeFile(path.join(tempDir, "packages", "b", ".git"), "gitdir: ../../.git/modules/b\n", "utf8");
    promptMocks.multiselect.mockResolvedValue(["packages/a"]);

    const targets = await resolveClearTargets(tempDir, {});

    expect(promptMocks.multiselect).toHaveBeenCalledWith(
      expect.objectContaining({
        initialValues: ["."],
        options: [
          { label: "parent repository", value: "." },
          { label: "submodule: packages/a", value: "packages/a" },
          { label: "submodule: packages/b", value: "packages/b" },
        ],
      }),
    );
    expect(targets.map((target) => target.label)).toEqual(["packages/a"]);
  });
});
