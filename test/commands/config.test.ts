import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VERSION } from "../../src/constants/version.js";

const promptMocks = vi.hoisted(() => ({
  select: vi.fn(),
  text: vi.fn(),
  confirm: vi.fn(),
  cancel: vi.fn(),
  outro: vi.fn(),
}));

vi.mock("@clack/prompts", () => promptMocks);

import { config } from "../../src/commands/config.js";

let tempDir: string;
let originalCwd: string;
let configPath: string;

async function writeReadyTddInfrastructure(): Promise<void> {
  const build = "<plugin>jacoco-maven-plugin</plugin>\n";
  const tool = "# Easy Coding changed Java production-line JaCoCo coverage gate\n";
  const ci = [
    "changed-line-coverage:",
    "  stage: test",
    "  artifacts: { reports: jacoco }",
    "  script: python3 .easy-coding/tools/easy_coding_java_coverage.py check --base $EASY_CODING_TDD_BASE_SHA --threshold $EASY_CODING_TDD_THRESHOLD",
    "",
  ].join("\n");
  await writeFile(path.join(tempDir, "pom.xml"), build, "utf8");
  await writeFile(path.join(tempDir, ".gitlab-ci.yml"), ci, "utf8");
  await mkdir(path.join(tempDir, ".easy-coding", "tools"), { recursive: true });
  await writeFile(path.join(tempDir, ".easy-coding", "tools", "easy_coding_java_coverage.py"), tool);
  const readinessPath = path.join(tempDir, ".easy-coding", "tdd", "readiness.json");
  await mkdir(path.dirname(readinessPath), { recursive: true });
  await writeFile(
    readinessPath,
    JSON.stringify({
      schema: "easy-coding/tdd-readiness-v1",
      provider: "gitlab",
      coverage_scope: "changed-production-lines",
      historical_coverage_required: false,
      build_files: [{ path: "pom.xml", sha256: createHash("sha256").update(build).digest("hex") }],
      ci_files: [
        { path: ".gitlab-ci.yml", sha256: createHash("sha256").update(ci).digest("hex") },
      ],
      tool_files: [
        {
          path: ".easy-coding/tools/easy_coding_java_coverage.py",
          sha256: createHash("sha256").update(tool).digest("hex"),
        },
      ],
      coverage_report_patterns: ["target/site/jacoco/jacoco.xml"],
      changed_line_gate_command:
        "python3 .easy-coding/tools/easy_coding_java_coverage.py check --base $EASY_CODING_TDD_BASE_SHA --threshold $EASY_CODING_TDD_THRESHOLD",
    }),
    "utf8",
  );
}

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
      "version: 5",
      `harness_version: ${VERSION}`,
      "agents:",
      "  - codex",
      "project:",
      "  id: ec-test",
      "  name: demo",
      "behavior:",
      "  approval_mode: guard",
      "  workflow_mode: adaptive",
      "  tdd_enabled: false",
      "  tdd_coverage_threshold: 90",
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
  it("interactively updates project modes and the Java TDD threshold", async () => {
    await writeReadyTddInfrastructure();
    promptMocks.select
      .mockResolvedValueOnce("confirm")
      .mockResolvedValueOnce("strict")
      .mockResolvedValueOnce(true);
    promptMocks.text.mockResolvedValueOnce("95");
    promptMocks.confirm.mockResolvedValue(true);

    await config();

    const content = await readFile(configPath, "utf8");
    expect(content).toContain("approval_mode: confirm");
    expect(content).toContain("workflow_mode: strict");
    expect(content).toContain("tdd_enabled: true");
    expect(content).toContain("tdd_coverage_threshold: 95");
    expect(promptMocks.outro).toHaveBeenCalledWith(
      expect.stringContaining("Project modes updated: approval=confirm, workflow=strict, TDD=95%"),
    );
  });

  it("rejects enabling TDD before initialization without partially changing project modes", async () => {
    promptMocks.select
      .mockResolvedValueOnce("confirm")
      .mockResolvedValueOnce("strict")
      .mockResolvedValueOnce(true);

    await config();

    const content = await readFile(configPath, "utf8");
    expect(content).toContain("approval_mode: guard");
    expect(content).toContain("workflow_mode: adaptive");
    expect(content).toContain("tdd_enabled: false");
    expect(promptMocks.text).not.toHaveBeenCalled();
    expect(promptMocks.confirm).not.toHaveBeenCalled();
    expect(promptMocks.cancel).toHaveBeenCalledWith(expect.stringContaining("Run ec-tdd-init first"));
  });

  it("rechecks readiness immediately before saving project TDD", async () => {
    await writeReadyTddInfrastructure();
    promptMocks.select
      .mockResolvedValueOnce("confirm")
      .mockResolvedValueOnce("strict")
      .mockResolvedValueOnce(true);
    promptMocks.text.mockResolvedValueOnce("95");
    promptMocks.confirm.mockImplementationOnce(async () => {
      await writeFile(path.join(tempDir, ".gitlab-ci.yml"), "drifted\n", "utf8");
      return true;
    });

    await config();

    const content = await readFile(configPath, "utf8");
    expect(content).toContain("approval_mode: guard");
    expect(content).toContain("workflow_mode: adaptive");
    expect(content).toContain("tdd_enabled: false");
    expect(promptMocks.cancel).toHaveBeenCalledWith(
      expect.stringContaining("readiness changed before save"),
    );
  });

  it("leaves the config unchanged when confirmation is declined", async () => {
    promptMocks.select
      .mockResolvedValueOnce("approve")
      .mockResolvedValueOnce("fast")
      .mockResolvedValueOnce(false);
    promptMocks.confirm.mockResolvedValue(false);

    await config();

    expect(await readFile(configPath, "utf8")).toContain("approval_mode: guard");
    expect(await readFile(configPath, "utf8")).toContain("workflow_mode: adaptive");
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
