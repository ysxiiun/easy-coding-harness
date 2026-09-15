import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { EASY_CODING_DIR, TDD_DIR, TDD_READINESS_FILE } from "../constants/paths.js";
import { pathExists } from "./file-writer.js";

export const TDD_READINESS_SCHEMA = "easy-coding/tdd-readiness-v1";
export const TDD_READINESS_SCOPE = "changed-production-lines";
const TDD_BASE_VARIABLE = "EASY_CODING_TDD_BASE_SHA";
const TDD_THRESHOLD_VARIABLE = "EASY_CODING_TDD_THRESHOLD";
const COVERAGE_TOOL_PATH = ".easy-coding/tools/easy_coding_java_coverage.py";
const JAVA_BUILD_FILE_NAMES = new Set(["pom.xml", "build.gradle", "build.gradle.kts"]);

interface ReadinessFileRecord {
  path: string;
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
  status: "ready" | "needs_init" | "needs_repair";
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
    if (typeof record.path !== "string" || !record.path.trim() || path.isAbsolute(record.path)) {
      reasons.push(`${field} contains an invalid path`);
      continue;
    }
    records.push({ path: record.path });
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

async function validateFiles(
  root: string,
  records: ReadinessFileRecord[],
  reasons: string[],
): Promise<void> {
  const resolvedRoot = await realpath(root);
  for (const record of records) {
    const absolute = path.resolve(root, record.path);
    try {
      const resolved = await realpath(absolute);
      if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
        reasons.push(`readiness file escapes project root: ${record.path}`);
        continue;
      }
      // 快照只记录初始化历史；当前构建与工具的有效性由本轮验证判定。
      await readFile(resolved);
    } catch {
      reasons.push(`readiness file is missing or unreadable: ${record.path}`);
    }
  }
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
    return { status: "needs_repair", reasons: ["TDD readiness receipt is invalid"], manifestPath };
  }

  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    return {
      status: "needs_repair",
      reasons: ["TDD readiness receipt must be a JSON object"],
      manifestPath,
    };
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
  const toolFiles = parseFileRecords(manifest.tool_files, "tool_files", reasons);
  if (!buildFiles.some((record) => JAVA_BUILD_FILE_NAMES.has(path.basename(record.path)))) {
    reasons.push("build_files must include a Maven or Gradle Java build file");
  }
  if (!toolFiles.some((record) => record.path.replaceAll("\\", "/") === COVERAGE_TOOL_PATH)) {
    reasons.push(`tool_files must include ${COVERAGE_TOOL_PATH}`);
  }
  await validateFiles(root, buildFiles, reasons);
  await validateFiles(root, toolFiles, reasons);

  return {
    status: reasons.length === 0 ? "ready" : "needs_repair",
    reasons: [...new Set(reasons)],
    manifestPath,
  };
}
