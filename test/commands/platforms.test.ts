import { describe, expect, it, vi, beforeEach } from "vitest";

const promptMocks = vi.hoisted(() => ({
  cancel: vi.fn(),
  confirm: vi.fn(),
  multiselect: vi.fn(),
}));

vi.mock("@clack/prompts", () => promptMocks);

import {
  parseSubmoduleList,
  resolvePlatforms,
  resolveSubmodules,
} from "../../src/commands/platforms.js";

beforeEach(() => {
  promptMocks.cancel.mockReset();
  promptMocks.confirm.mockReset();
  promptMocks.multiselect.mockReset();
});

describe("resolvePlatforms", () => {
  it("confirms interactive platform selections before returning", async () => {
    promptMocks.multiselect.mockResolvedValue(["claude-code", "codex"]);
    promptMocks.confirm.mockResolvedValue(true);

    const platforms = await resolvePlatforms({});

    expect(platforms).toEqual(["claude-code", "codex"]);
    expect(promptMocks.multiselect).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Select agent platforms (Space to toggle, Enter to review)",
      }),
    );
    expect(promptMocks.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Install Easy Coding for: Claude Code, Codex?",
      }),
    );
  });

  it("reopens platform selection when confirmation is declined", async () => {
    promptMocks.multiselect
      .mockResolvedValueOnce(["claude-code"])
      .mockResolvedValueOnce(["qoder"]);
    promptMocks.confirm.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    const platforms = await resolvePlatforms({});

    expect(platforms).toEqual(["qoder"]);
    expect(promptMocks.multiselect).toHaveBeenCalledTimes(2);
    expect(promptMocks.confirm).toHaveBeenCalledTimes(2);
  });

  it("does not confirm explicit --agent selections", async () => {
    const platforms = await resolvePlatforms({ agent: "codex,qoder" });

    expect(platforms).toEqual(["codex", "qoder"]);
    expect(promptMocks.multiselect).not.toHaveBeenCalled();
    expect(promptMocks.confirm).not.toHaveBeenCalled();
  });

  it("does not confirm --yes defaults", async () => {
    const platforms = await resolvePlatforms({ yes: true });

    expect(platforms).toEqual(["claude-code"]);
    expect(promptMocks.multiselect).not.toHaveBeenCalled();
    expect(promptMocks.confirm).not.toHaveBeenCalled();
  });
});

describe("parseSubmoduleList", () => {
  const available = [
    { name: "core", path: "packages/core", url: "git@example.com:core.git" },
    { name: "tools", path: "packages/tools", url: "git@example.com:tools.git" },
  ];

  it("selects submodules by path or name", () => {
    expect(parseSubmoduleList("packages/core,tools", available)).toEqual(available);
  });

  it("rejects unknown submodules", () => {
    expect(() => parseSubmoduleList("missing", available)).toThrow("Unknown or unavailable");
  });

  it("rejects explicit submodule selections when none are available", async () => {
    await expect(resolveSubmodules({ submodules: "missing" }, [])).rejects.toThrow(
      "Unknown or unavailable",
    );
  });
});
