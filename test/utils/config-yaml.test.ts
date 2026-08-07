import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addAgentsToConfig,
  createDefaultConfig,
  ensureProjectId,
  migrateBehaviorConfig,
  readConfigYaml,
  resolveLegacyBehavior,
  setBehaviorModes,
  setConfirmMode,
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
      "  tdd_enabled: true # pre-schema-4 custom key must not opt in",
      "  tdd_coverage_threshold: 99",
      "",
    ].join("\n"),
    "utf8",
  );
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("config-yaml", () => {
  it("creates schema 5 configs with default-off TDD and a 90 percent threshold", () => {
    const config = createDefaultConfig({
      projectName: "demo",
      harnessVersion: "1.0.0",
      agents: ["claude-code"],
    });
    expect(config.version).toBe(5);
    expect(config.behavior).toEqual({
      approval_mode: "guard",
      workflow_mode: "adaptive",
      tdd_enabled: false,
      tdd_coverage_threshold: 90,
    });
  });

  it("migrates legacy confirmation booleans and removes them", async () => {
    await migrateBehaviorConfig(configPath);
    const content = await readFile(configPath, "utf8");
    expect(content).toContain("version: 5");
    expect(content).toContain("approval_mode: approve");
    expect(content).toContain("workflow_mode: adaptive");
    expect(content).toContain("tdd_enabled: false");
    expect(content).toContain("tdd_coverage_threshold: 90");
    expect(content).not.toContain("strict_confirm");
    expect(content).not.toContain("auto_mode");
  });

  it("treats schema 4 TDD as unready while preserving its configured threshold", async () => {
    const beta1 = (await readFile(configPath, "utf8"))
      .replace("version: 1", "version: 4")
      .replace("  strict_confirm: true", "  approval_mode: guard")
      .replace("  auto_mode: false\n", "")
      .replace("tdd_enabled: true # pre-schema-4 custom key must not opt in", "tdd_enabled: true")
      .replace("tdd_coverage_threshold: 99", "tdd_coverage_threshold: 95");
    await writeFile(configPath, beta1, "utf8");

    expect(resolveLegacyBehavior(await readConfigYaml(configPath))).toMatchObject({
      tddEnabled: false,
      tddCoverageThreshold: 95,
    });
  });

  it("writes explicit behavior modes without restoring legacy keys", async () => {
    await setBehaviorModes(configPath, "confirm", "fast", true, 95);
    const content = await readFile(configPath, "utf8");
    expect(content).toContain("approval_mode: confirm");
    expect(content).toContain("workflow_mode: fast");
    expect(content).toContain("tdd_enabled: true");
    expect(content).toContain("tdd_coverage_threshold: 95");
    expect(content).not.toContain("strict_confirm");
    expect(content).not.toContain("auto_mode");
  });

  it.each([0, 101, 90.5])("rejects invalid TDD coverage threshold %s", async (threshold) => {
    await expect(setBehaviorModes(configPath, "guard", "adaptive", true, threshold)).rejects.toThrow(
      "integer from 1 to 100",
    );
  });

  it("keeps an existing workflow mode when the deprecated approval setter is used", async () => {
    await setBehaviorModes(configPath, "guard", "strict");
    await setConfirmMode(configPath, "auto");
    const content = await readFile(configPath, "utf8");
    expect(content).toContain("approval_mode: auto");
    expect(content).toContain("workflow_mode: strict");
  });

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
    expect(config.project.id).toMatch(/^ec-[0-9a-f-]+$/);
    expect(config.supermodule).toEqual({ role: "super-parent", submodules: ["packages/a"] });

    await updateSupermoduleConfig(configPath, { role: "submodule-child", parent: "../.." });
    const content = await readFile(configPath, "utf8");
    expect(content).toContain("role: submodule-child");
    expect(content).toContain("parent: ../..");
  });

  it("adds a stable project id to existing configs", async () => {
    const projectId = await ensureProjectId(configPath);
    const secondProjectId = await ensureProjectId(configPath);
    const content = await readFile(configPath, "utf8");

    expect(projectId).toMatch(/^ec-[0-9a-f-]+$/);
    expect(secondProjectId).toBe(projectId);
    expect(content).toContain(`id: ${projectId}`);
    expect(content).toContain("name: demo");
  });
});
