import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let tempDir: string;

function toolPath(): string {
  return path.join(
    process.cwd(),
    "src",
    "templates",
    "runtime",
    "tools",
    "easy_coding_tdd_readiness.py",
  );
}

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "ec-tdd-readiness-"));
  const toolsDir = path.join(tempDir, ".easy-coding", "tools");
  await mkdir(toolsDir, { recursive: true });
  await writeFile(
    path.join(toolsDir, "easy_coding_java_coverage.py"),
    await readFile(
      path.join(
        process.cwd(),
        "src",
        "templates",
        "runtime",
        "tools",
        "easy_coding_java_coverage.py",
      ),
    ),
  );
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("TDD readiness tool", () => {
  it("reports needs_init before infrastructure is recorded", () => {
    const result = spawnSync("python3", [toolPath(), "--cwd", tempDir, "check"], {
      encoding: "utf8",
    });
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      status: "needs_init",
      coverage_scope: "changed-production-lines",
    });
  });

  it("records infrastructure without adding or rewriting historical business tests", async () => {
    await mkdir(path.join(tempDir, "src", "main", "java"), { recursive: true });
    const legacySource = "class LegacyBusinessCode {}\n";
    await writeFile(path.join(tempDir, "src", "main", "java", "LegacyBusinessCode.java"), legacySource);
    await writeFile(path.join(tempDir, "pom.xml"), "<plugin>jacoco-maven-plugin</plugin>\n");
    await writeFile(
      path.join(tempDir, ".gitlab-ci.yml"),
      "changed-line-coverage:\n  stage: test\n  artifacts: { reports: jacoco }\n  script: python3 .easy-coding/tools/easy_coding_java_coverage.py check --base $EASY_CODING_TDD_BASE_SHA --threshold $EASY_CODING_TDD_THRESHOLD\n",
    );

    const output = execFileSync(
      "python3",
      [
        toolPath(),
        "--cwd",
        tempDir,
        "record",
        "--build-file",
        "pom.xml",
        "--ci-file",
        ".gitlab-ci.yml",
        "--coverage-report",
        "target/site/jacoco/jacoco.xml",
        "--gate-command",
        "python3 .easy-coding/tools/easy_coding_java_coverage.py check --base $EASY_CODING_TDD_BASE_SHA --threshold $EASY_CODING_TDD_THRESHOLD",
        "--agent",
        "codex",
      ],
      { encoding: "utf8" },
    );

    expect(JSON.parse(output)).toMatchObject({
      status: "ready",
      coverage_scope: "changed-production-lines",
    });
    expect(await readFile(path.join(tempDir, "src", "main", "java", "LegacyBusinessCode.java"), "utf8"))
      .toBe(legacySource);
    expect(
      await readFile(path.join(tempDir, ".easy-coding", "tdd", "readiness.json"), "utf8"),
    ).toContain('"tool_files"');
  });

  it("invalidates readiness when a recorded CI file drifts", async () => {
    await writeFile(path.join(tempDir, "pom.xml"), "<plugin>jacoco</plugin>\n");
    await writeFile(
      path.join(tempDir, ".gitlab-ci.yml"),
      "changed-line-coverage:\n  stage: test\n  artifacts: { reports: jacoco }\n  script: python3 .easy-coding/tools/easy_coding_java_coverage.py check --base $EASY_CODING_TDD_BASE_SHA --threshold $EASY_CODING_TDD_THRESHOLD\n",
    );
    execFileSync(
      "python3",
      [
        toolPath(),
        "--cwd",
        tempDir,
        "record",
        "--build-file",
        "pom.xml",
        "--ci-file",
        ".gitlab-ci.yml",
        "--coverage-report",
        "jacoco.xml",
        "--gate-command",
        "python3 .easy-coding/tools/easy_coding_java_coverage.py check --base $EASY_CODING_TDD_BASE_SHA --threshold $EASY_CODING_TDD_THRESHOLD",
        "--agent",
        "codex",
      ],
      { encoding: "utf8" },
    );
    await writeFile(path.join(tempDir, ".gitlab-ci.yml"), "changed\n");
    await writeFile(
      path.join(tempDir, ".easy-coding", "tools", "easy_coding_java_coverage.py"),
      "# drifted\n",
    );

    const result = spawnSync("python3", [toolPath(), "--cwd", tempDir, "check"], {
      encoding: "utf8",
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("readiness file changed: .gitlab-ci.yml");
    expect(result.stdout).toContain(
      "readiness file changed: .easy-coding/tools/easy_coding_java_coverage.py",
    );
  });

  it("rejects a gate that hardcodes baseline or threshold instead of task variables", async () => {
    await writeFile(path.join(tempDir, "pom.xml"), "<plugin>jacoco</plugin>\n");
    await writeFile(
      path.join(tempDir, ".gitlab-ci.yml"),
      "changed-line-coverage:\n  stage: test\n  artifacts: { reports: jacoco }\n  script: python3 .easy-coding/tools/easy_coding_java_coverage.py check --base HEAD --threshold 90\n  variables: { EASY_CODING_TDD_BASE_SHA: x, EASY_CODING_TDD_THRESHOLD: 90 }\n",
    );

    const result = spawnSync(
      "python3",
      [
        toolPath(),
        "--cwd",
        tempDir,
        "record",
        "--build-file",
        "pom.xml",
        "--ci-file",
        ".gitlab-ci.yml",
        "--coverage-report",
        "jacoco.xml",
        "--gate-command",
        "python3 .easy-coding/tools/easy_coding_java_coverage.py check --base HEAD --threshold 90",
        "--agent",
        "codex",
      ],
      { encoding: "utf8" },
    );

    expect(result.status).toBe(2);
    expect(result.stdout).toContain("must use $EASY_CODING_TDD_BASE_SHA");
  });

  it("rejects a GitLab job that hardcodes the gate even when it mentions both variables", async () => {
    await writeFile(path.join(tempDir, "pom.xml"), "<plugin>jacoco</plugin>\n");
    await writeFile(
      path.join(tempDir, ".gitlab-ci.yml"),
      "# python3 .easy-coding/tools/easy_coding_java_coverage.py check --base $EASY_CODING_TDD_BASE_SHA --threshold $EASY_CODING_TDD_THRESHOLD\nchanged-line-coverage:\n  stage: test\n  artifacts: { reports: jacoco }\n  script: python3 .easy-coding/tools/easy_coding_java_coverage.py check --base HEAD --threshold 90\n",
    );

    const result = spawnSync(
      "python3",
      [
        toolPath(),
        "--cwd",
        tempDir,
        "record",
        "--build-file",
        "pom.xml",
        "--ci-file",
        ".gitlab-ci.yml",
        "--coverage-report",
        "jacoco.xml",
        "--gate-command",
        "python3 .easy-coding/tools/easy_coding_java_coverage.py check --base $EASY_CODING_TDD_BASE_SHA --threshold $EASY_CODING_TDD_THRESHOLD",
        "--agent",
        "codex",
      ],
      { encoding: "utf8" },
    );

    expect(result.status).toBe(2);
    expect(result.stdout).toContain(
      "CI changed-line gate must use the task baseline and threshold variables",
    );
  });

  it("rejects ordinary files masquerading as Java build and GitLab CI entry files", async () => {
    await writeFile(path.join(tempDir, "build-notes.txt"), "jacoco\n");
    await writeFile(
      path.join(tempDir, "ci-fragment.yml"),
      "changed-line-coverage:\n  stage: test\n  artifacts: { reports: jacoco }\n  script: python3 .easy-coding/tools/easy_coding_java_coverage.py check --base $EASY_CODING_TDD_BASE_SHA --threshold $EASY_CODING_TDD_THRESHOLD\n",
    );

    const result = spawnSync(
      "python3",
      [
        toolPath(),
        "--cwd",
        tempDir,
        "record",
        "--build-file",
        "build-notes.txt",
        "--ci-file",
        "ci-fragment.yml",
        "--coverage-report",
        "jacoco.xml",
        "--gate-command",
        "python3 .easy-coding/tools/easy_coding_java_coverage.py check --base $EASY_CODING_TDD_BASE_SHA --threshold $EASY_CODING_TDD_THRESHOLD",
        "--agent",
        "codex",
      ],
      { encoding: "utf8" },
    );

    expect(result.status).toBe(2);
    expect(result.stdout).toContain("must include pom.xml, build.gradle, or build.gradle.kts");
  });

  it("invalidates a receipt that enables historical coverage", async () => {
    await writeFile(path.join(tempDir, "pom.xml"), "<plugin>jacoco</plugin>\n");
    await writeFile(
      path.join(tempDir, ".gitlab-ci.yml"),
      "changed-line-coverage:\n  stage: test\n  artifacts: { reports: jacoco }\n  script: python3 .easy-coding/tools/easy_coding_java_coverage.py check --base $EASY_CODING_TDD_BASE_SHA --threshold $EASY_CODING_TDD_THRESHOLD\n",
    );
    execFileSync(
      "python3",
      [
        toolPath(),
        "--cwd",
        tempDir,
        "record",
        "--build-file",
        "pom.xml",
        "--ci-file",
        ".gitlab-ci.yml",
        "--coverage-report",
        "jacoco.xml",
        "--gate-command",
        "python3 .easy-coding/tools/easy_coding_java_coverage.py check --base $EASY_CODING_TDD_BASE_SHA --threshold $EASY_CODING_TDD_THRESHOLD",
        "--agent",
        "codex",
      ],
      { encoding: "utf8" },
    );
    const receiptPath = path.join(tempDir, ".easy-coding", "tdd", "readiness.json");
    const receipt = JSON.parse(await readFile(receiptPath, "utf8")) as Record<string, unknown>;
    receipt.historical_coverage_required = true;
    await writeFile(receiptPath, JSON.stringify(receipt), "utf8");

    const result = spawnSync("python3", [toolPath(), "--cwd", tempDir, "check"], {
      encoding: "utf8",
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("historical coverage must remain disabled");
  });
});
