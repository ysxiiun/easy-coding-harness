import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
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
    "easy_coding_java_coverage.py",
  );
}

function git(...args: string[]): string {
  return execFileSync("git", args, { cwd: tempDir, encoding: "utf8" }).trim();
}

async function writeJacoco(
  coveredInstructions: number,
  extraSources: string[] = [],
  report = path.join(tempDir, "target", "site", "jacoco", "jacoco.xml"),
): Promise<string> {
  await mkdir(path.dirname(report), { recursive: true });
  await writeFile(
    report,
    [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<report name="fixture">',
      '  <package name="com/example">',
      '    <sourcefile name="Foo.java">',
      `      <line nr="3" mi="${coveredInstructions > 0 ? 0 : 1}" ci="${coveredInstructions}" mb="0" cb="0"/>`,
      "    </sourcefile>",
      ...extraSources,
      "  </package>",
      "</report>",
      "",
    ].join("\n"),
    "utf8",
  );
  return report;
}

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "ec-java-coverage-"));
  git("init", "-q");
  git("config", "user.email", "fixture@example.com");
  git("config", "user.name", "Fixture");
  const source = path.join(tempDir, "src", "main", "java", "com", "example", "Foo.java");
  await mkdir(path.dirname(source), { recursive: true });
  await writeFile(source, "package com.example;\npublic class Foo {\n}\n", "utf8");
  git("add", ".");
  git("commit", "-qm", "baseline");
  await writeFile(
    source,
    "package com.example;\npublic class Foo {\n  public int answer() { return 42; }\n}\n",
    "utf8",
  );
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("Java changed-line coverage gate", () => {
  it("passes covered modified production executable lines and emits reproducible evidence", async () => {
    const report = await writeJacoco(1);
    const output = JSON.parse(
      execFileSync(
        "python3",
        [toolPath(), "check", "--base", "HEAD", "--repo", tempDir, "--report", report],
        { encoding: "utf8" },
      ),
    ) as Record<string, unknown>;

    expect(output).toMatchObject({
      covered_lines: 1,
      total_lines: 1,
      percentage: 100,
      threshold: 90,
      applicable: true,
      passed: true,
    });
    expect(output.baseline_sha).toBe(git("rev-parse", "HEAD"));
    expect(output.report_sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("reads the schema-4 project threshold from the Git root when repo points to a subdirectory", async () => {
    await mkdir(path.join(tempDir, ".easy-coding"), { recursive: true });
    await writeFile(
      path.join(tempDir, ".easy-coding", "config.yaml"),
      "version: 4\nbehavior:\n  tdd_coverage_threshold: 95\n",
      "utf8",
    );
    const report = await writeJacoco(1);
    const output = JSON.parse(
      execFileSync(
        "python3",
        [
          toolPath(),
          "check",
          "--base",
          "HEAD",
          "--repo",
          path.join(tempDir, "src", "main"),
          "--report",
          report,
        ],
        { encoding: "utf8" },
      ),
    ) as Record<string, unknown>;

    expect(output.threshold).toBe(95);
  });

  it("exits nonzero when changed-line coverage is below the configured threshold", async () => {
    const report = await writeJacoco(0);
    const result = spawnSync(
      "python3",
      [
        toolPath(),
        "check",
        "--base",
        "HEAD",
        "--repo",
        tempDir,
        "--report",
        report,
        "--threshold",
        "95",
      ],
      { encoding: "utf8" },
    );

    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      percentage: 0,
      threshold: 95,
      passed: false,
    });
  });

  it("fails closed when the JaCoCo XML predates the modified Java source", async () => {
    const report = await writeJacoco(1);
    await utimes(report, new Date(0), new Date(0));

    const result = spawnSync(
      "python3",
      [toolPath(), "check", "--base", "HEAD", "--repo", tempDir, "--report", report],
      { encoding: "utf8" },
    );

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("report is older than modified Java source");
  });

  it("includes untracked production Java files in the local gate", async () => {
    const source = path.join(tempDir, "src", "main", "java", "com", "example", "Bar.java");
    await writeFile(
      source,
      "package com.example;\npublic class Bar {\n  public int value() { return 7; }\n}\n",
      "utf8",
    );
    const report = await writeJacoco(1, [
      '    <sourcefile name="Bar.java">',
      '      <line nr="3" mi="0" ci="1" mb="0" cb="0"/>',
      "    </sourcefile>",
    ]);

    const output = JSON.parse(
      execFileSync(
        "python3",
        [toolPath(), "check", "--base", "HEAD", "--repo", tempDir, "--report", report],
        { encoding: "utf8" },
      ),
    ) as Record<string, unknown>;

    expect(output).toMatchObject({ covered_lines: 2, total_lines: 2, percentage: 100 });
  });

  it("covers production sources that use a legacy src layout without a main segment", async () => {
    const source = path.join(tempDir, "src", "com", "example", "Legacy.java");
    await mkdir(path.dirname(source), { recursive: true });
    await writeFile(source, "package com.example;\npublic class Legacy {\n}\n", "utf8");
    git("add", ".");
    git("commit", "-qm", "add legacy source");
    await writeFile(
      source,
      "package com.example;\npublic class Legacy {\n  public int value() { return 8; }\n}\n",
      "utf8",
    );
    const report = await writeJacoco(1, [
      '    <sourcefile name="Legacy.java">',
      '      <line nr="3" mi="0" ci="1" mb="0" cb="0"/>',
      "    </sourcefile>",
    ]);

    const output = JSON.parse(
      execFileSync(
        "python3",
        [toolPath(), "check", "--base", "HEAD", "--repo", tempDir, "--report", report],
        { encoding: "utf8" },
      ),
    ) as Record<string, unknown>;

    expect(output).toMatchObject({ covered_lines: 1, total_lines: 1, percentage: 100 });
  });

  it("prefers module reports over aggregate reports during discovery", async () => {
    await writeJacoco(1);
    await writeJacoco(
      1,
      [
        '    <sourcefile name="Foo.java">',
        '      <line nr="3" mi="0" ci="1" mb="0" cb="0"/>',
        "    </sourcefile>",
      ],
      path.join(tempDir, "target", "site", "jacoco-aggregate", "jacoco.xml"),
    );

    const output = JSON.parse(
      execFileSync(
        "python3",
        [toolPath(), "check", "--base", "HEAD", "--repo", tempDir],
        { encoding: "utf8" },
      ),
    ) as Record<string, unknown>;

    expect(output).toMatchObject({ covered_lines: 1, total_lines: 1, percentage: 100 });
    expect(output.report_paths).toEqual(["target/site/jacoco/jacoco.xml"]);
  });

  it("treats a dedicated Maven aggregate module report as repository-wide", async () => {
    const report = await writeJacoco(
      1,
      [],
      path.join(
        tempDir,
        "coverage-report",
        "target",
        "site",
        "jacoco-aggregate",
        "jacoco.xml",
      ),
    );

    const output = JSON.parse(
      execFileSync(
        "python3",
        [toolPath(), "check", "--base", "HEAD", "--repo", tempDir, "--report", report],
        { encoding: "utf8" },
      ),
    ) as Record<string, unknown>;

    expect(output).toMatchObject({ covered_lines: 1, total_lines: 1, percentage: 100 });
  });

  it("keeps same-named sources isolated by module report paths", async () => {
    const rootSource = path.join(tempDir, "src", "main", "java", "com", "example", "Foo.java");
    await writeFile(rootSource, "package com.example;\npublic class Foo {\n}\n", "utf8");
    for (const moduleName of ["module-a", "module-b"]) {
      const source = path.join(
        tempDir,
        moduleName,
        "src",
        "main",
        "java",
        "com",
        "example",
        "Foo.java",
      );
      await mkdir(path.dirname(source), { recursive: true });
      await writeFile(source, "package com.example;\npublic class Foo {\n}\n", "utf8");
    }
    git("add", ".");
    git("commit", "-qm", "add modules");
    for (const moduleName of ["module-a", "module-b"]) {
      await writeFile(
        path.join(
          tempDir,
          moduleName,
          "src",
          "main",
          "java",
          "com",
          "example",
          "Foo.java",
        ),
        "package com.example;\npublic class Foo {\n  public int value() { return 1; }\n}\n",
        "utf8",
      );
    }
    const reports = [];
    for (const moduleName of ["module-a", "module-b"]) {
      reports.push(
        await writeJacoco(
          1,
          [],
          path.join(tempDir, moduleName, "target", "site", "jacoco", "jacoco.xml"),
        ),
      );
    }

    const output = JSON.parse(
      execFileSync(
        "python3",
        [
          toolPath(),
          "check",
          "--base",
          "HEAD",
          "--repo",
          tempDir,
          "--report",
          reports[0],
          "--report",
          reports[1],
        ],
        { encoding: "utf8" },
      ),
    ) as Record<string, unknown>;

    expect(output).toMatchObject({ covered_lines: 2, total_lines: 2, percentage: 100 });
  });

  it("fails closed when an aggregate report contains ambiguous same-named sources", async () => {
    const report = await writeJacoco(1, [
      '    <sourcefile name="Foo.java">',
      '      <line nr="3" mi="0" ci="1" mb="0" cb="0"/>',
      "    </sourcefile>",
    ]);
    const result = spawnSync(
      "python3",
      [toolPath(), "check", "--base", "HEAD", "--repo", tempDir, "--report", report],
      { encoding: "utf8" },
    );

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("missing or ambiguous");
  });
});
