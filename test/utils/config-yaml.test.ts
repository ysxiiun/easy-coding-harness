import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addAgentsToConfig,
  createDefaultConfig,
  updateHarnessVersion,
  updateSupermoduleConfig,
  yamlHasAgent,
} from "../../src/utils/config-yaml.js";

let tempDir: string;
let configPath: string;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "ec-yaml-"));
  configPath = path.join(tempDir, "config.yaml");
  await writeFile(
    configPath,
    [
      "# team config",
      "version: 1",
      "harness_version: 0.9.0 # keep this comment",
      "agents:",
      "  - claude-code",
      "project:",
      "  name: demo",
      "memory:",
      "  short_term_max: 10",
      "  short_term_keep: 5",
      "  schema_version: 2",
      "tasks:",
      "  auto_archive_days: 30",
      "behavior:",
      "  strict_confirm: true",
      "  auto_mode: false",
      "",
    ].join("\n"),
    "utf8",
  );
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("config-yaml", () => {
  it("updates harness_version while preserving comments", async () => {
    await updateHarnessVersion(configPath, "0.1.1");
    const content = await readFile(configPath, "utf8");
    expect(content).toContain("# team config");
    expect(content).toContain("# keep this comment");
    expect(content).toContain("harness_version: 0.1.1");
  });

  it("adds agents without duplicating existing entries", async () => {
    await addAgentsToConfig(configPath, ["claude-code", "codex"]);
    const content = await readFile(configPath, "utf8");
    expect(yamlHasAgent(content, "claude-code")).toBe(true);
    expect(yamlHasAgent(content, "codex")).toBe(true);
    expect(content.match(/claude-code/g)).toHaveLength(1);
  });

  it("creates and updates supermodule topology", async () => {
    const config = createDefaultConfig({
      projectName: "demo",
      harnessVersion: "1.0.0",
      agents: ["claude-code"],
      supermodule: { role: "super-parent", submodules: ["packages/a"] },
    });
    expect(config.supermodule).toEqual({ role: "super-parent", submodules: ["packages/a"] });

    await updateSupermoduleConfig(configPath, { role: "submodule-child", parent: "../.." });
    const content = await readFile(configPath, "utf8");
    expect(content).toContain("role: submodule-child");
    expect(content).toContain("parent: ../..");
  });
});
