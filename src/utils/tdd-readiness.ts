import { createHash } from "node:crypto";
import { readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { EASY_CODING_DIR, SESSIONS_DIR, TDD_DIR, TDD_READINESS_FILE } from "../constants/paths.js";
import { pathExists, writeTextFile } from "./file-writer.js";

export const TDD_READINESS_SCHEMA = "easy-coding/tdd-readiness-v1";
export const TDD_READINESS_SCOPE = "changed-production-lines";
const TDD_BASE_VARIABLE = "EASY_CODING_TDD_BASE_SHA";
const TDD_THRESHOLD_VARIABLE = "EASY_CODING_TDD_THRESHOLD";
const COVERAGE_TOOL_PATH = ".easy-coding/tools/easy_coding_java_coverage.py";
const JAVA_BUILD_FILE_NAMES = new Set(["pom.xml", "build.gradle", "build.gradle.kts"]);
const GITLAB_CI_ENTRY_FILES = new Set([".gitlab-ci.yml", ".gitlab-ci.yaml"]);

interface ReadinessFileRecord {
  path: string;
  sha256: string;
}

interface TddReadinessManifest {
  schema?: unknown;
  provider?: unknown;
  coverage_scope?: unknown;
  build_files?: unknown;
  ci_files?: unknown;
  tool_files?: unknown;
  coverage_report_patterns?: unknown;
  changed_line_gate_command?: unknown;
  historical_coverage_required?: unknown;
}

export interface TddReadinessResult {
  status: "ready" | "needs_init";
  reasons: string[];
  manifestPath: string;
}

function readinessPath(root: string): string {
  return path.join(root, EASY_CODING_DIR, TDD_DIR, TDD_READINESS_FILE);
}

function parseFileRecords(value: unknown, field: string, reasons: string[]): ReadinessFileRecord[] {
  if (!Array.isArray(value) || value.length === 0) {
    reasons.push(`${field} must contain at least one file`);
    return [];
  }
  const records: ReadinessFileRecord[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      reasons.push(`${field} contains an invalid record`);
      continue;
    }
    const record = item as Record<string, unknown>;
    if (
      typeof record.path !== "string" ||
      !record.path.trim() ||
      path.isAbsolute(record.path) ||
      typeof record.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(record.sha256)
    ) {
      reasons.push(`${field} contains an invalid path or SHA-256`);
      continue;
    }
    records.push({ path: record.path, sha256: record.sha256 });
  }
  return records;
}

function usesRequiredGateVariables(command: string): boolean {
  const normalized = command
    .replaceAll(`\${${TDD_BASE_VARIABLE}}`, `$${TDD_BASE_VARIABLE}`)
    .replaceAll(`\${${TDD_THRESHOLD_VARIABLE}}`, `$${TDD_THRESHOLD_VARIABLE}`);
  return (
    new RegExp(`--base\\s+['\"]?\\$${TDD_BASE_VARIABLE}(?:['\"]|\\s|$)`).test(normalized) &&
    new RegExp(`--threshold\\s+['\"]?\\$${TDD_THRESHOLD_VARIABLE}(?:['\"]|\\s|$)`).test(normalized)
  );
}

function isSafeReportPattern(value: string): boolean {
  const normalized = value.replaceAll("\\", "/");
  return !path.isAbsolute(value) && !normalized.split("/").includes("..");
}

function activeCiContent(contents: string[]): string {
  return contents
    .join("\n")
    .split("\n")
    .map((line) => line.replace(/^\s*#.*$/, "").replace(/\s+#.*$/, ""))
    .join("\n");
}

async function validateFiles(
  root: string,
  records: ReadinessFileRecord[],
  reasons: string[],
): Promise<string[]> {
  const contents: string[] = [];
  const resolvedRoot = await realpath(root);
  for (const record of records) {
    const absolute = path.resolve(root, record.path);
    try {
      const resolved = await realpath(absolute);
      if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
        reasons.push(`readiness file escapes project root: ${record.path}`);
        continue;
      }
      const content = await readFile(resolved);
      const digest = createHash("sha256").update(content).digest("hex");
      if (digest !== record.sha256) reasons.push(`readiness file changed: ${record.path}`);
      contents.push(content.toString("utf8"));
    } catch {
      reasons.push(`readiness file is missing or unreadable: ${record.path}`);
    }
  }
  return contents;
}

export async function inspectTddReadiness(root: string): Promise<TddReadinessResult> {
  const manifestPath = readinessPath(root);
  if (!(await pathExists(manifestPath))) {
    return { status: "needs_init", reasons: ["TDD readiness receipt is missing"], manifestPath };
  }

  let manifest: TddReadinessManifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8")) as TddReadinessManifest;
  } catch {
    return { status: "needs_init", reasons: ["TDD readiness receipt is invalid"], manifestPath };
  }

  const reasons: string[] = [];
  if (manifest.schema !== TDD_READINESS_SCHEMA) reasons.push("unsupported readiness schema");
  if (manifest.provider !== "gitlab") reasons.push("readiness provider must be gitlab");
  if (manifest.coverage_scope !== TDD_READINESS_SCOPE) {
    reasons.push("coverage scope must be changed-production-lines");
  }
  if (manifest.historical_coverage_required !== false) {
    reasons.push("historical coverage must remain disabled");
  }
  if (
    !Array.isArray(manifest.coverage_report_patterns) ||
    manifest.coverage_report_patterns.length === 0 ||
    manifest.coverage_report_patterns.some(
      (item) => typeof item !== "string" || !item.trim() || !isSafeReportPattern(item),
    )
  ) {
    reasons.push("coverage_report_patterns must contain safe project-relative report patterns");
  }
  if (
    typeof manifest.changed_line_gate_command !== "string" ||
    !manifest.changed_line_gate_command.includes(COVERAGE_TOOL_PATH)
  ) {
    reasons.push("changed-line coverage gate command is missing");
  } else if (!usesRequiredGateVariables(manifest.changed_line_gate_command)) {
    reasons.push("changed-line coverage gate must use the task baseline and threshold variables");
  }

  const buildFiles = parseFileRecords(manifest.build_files, "build_files", reasons);
  const ciFiles = parseFileRecords(manifest.ci_files, "ci_files", reasons);
  const toolFiles = parseFileRecords(manifest.tool_files, "tool_files", reasons);
  if (!buildFiles.some((record) => JAVA_BUILD_FILE_NAMES.has(path.basename(record.path)))) {
    reasons.push("build_files must include a Maven or Gradle Java build file");
  }
  if (!ciFiles.some((record) => GITLAB_CI_ENTRY_FILES.has(record.path.replaceAll("\\", "/")))) {
    reasons.push("ci_files must include the project-root GitLab CI entry file");
  }
  if (!toolFiles.some((record) => record.path.replaceAll("\\", "/") === COVERAGE_TOOL_PATH)) {
    reasons.push(`tool_files must include ${COVERAGE_TOOL_PATH}`);
  }
  const buildContents = await validateFiles(root, buildFiles, reasons);
  const ciContents = await validateFiles(root, ciFiles, reasons);
  await validateFiles(root, toolFiles, reasons);
  if (!buildContents.some((content) => /jacoco/i.test(content))) {
    reasons.push("build files do not configure JaCoCo");
  }
  const combinedCi = activeCiContent(ciContents);
  for (const marker of [
    "jacoco",
    "artifacts",
    COVERAGE_TOOL_PATH,
    TDD_BASE_VARIABLE,
    TDD_THRESHOLD_VARIABLE,
  ]) {
    if (!combinedCi.toLowerCase().includes(marker.toLowerCase())) {
      reasons.push(`CI files do not contain required marker: ${marker}`);
    }
  }
  if (!usesRequiredGateVariables(combinedCi)) {
    reasons.push("CI changed-line gate must use the task baseline and threshold variables");
  }
  if (!/(?:^|\n)\s*stage\s*:\s*['"]?test['"]?\s*(?:#.*)?(?:\n|$)/i.test(combinedCi)) {
    reasons.push("CI files do not declare a TEST-stage job");
  }

  return {
    status: reasons.length === 0 ? "ready" : "needs_init",
    reasons: [...new Set(reasons)],
    manifestPath,
  };
}

export async function disableUnreadySessionTddOverrides(root: string): Promise<number> {
  if ((await inspectTddReadiness(root)).status === "ready") return 0;
  const sessionsDir = path.join(root, EASY_CODING_DIR, SESSIONS_DIR);
  if (!(await pathExists(sessionsDir))) return 0;
  let updated = 0;
  for (const entry of await readdir(sessionsDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const filePath = path.join(sessionsDir, entry.name);
    try {
      const session = JSON.parse(await readFile(filePath, "utf8")) as Record<string, unknown>;
      if (session.tdd_enabled !== true) continue;
      session.tdd_enabled = false;
      await writeTextFile(filePath, `${JSON.stringify(session, null, 2)}\n`);
      updated += 1;
    } catch {
      // Malformed legacy sessions are handled by the runtime state API; do not overwrite them.
    }
  }
  return updated;
}
