#!/usr/bin/env python3
"""Record and verify Easy Coding Java TDD infrastructure readiness.

This tool validates infrastructure only. It never measures repository-wide coverage and never
creates business tests. Coverage acceptance remains scoped to production lines changed after a
task's frozen baseline.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shlex
import sys
from datetime import datetime, timezone
from pathlib import Path

SCHEMA = "easy-coding/tdd-readiness-v1"
COVERAGE_SCOPE = "changed-production-lines"
RECEIPT = Path(".easy-coding/tdd/readiness.json")
TDD_BASE_VARIABLE = "EASY_CODING_TDD_BASE_SHA"
TDD_THRESHOLD_VARIABLE = "EASY_CODING_TDD_THRESHOLD"
COVERAGE_TOOL_PATH = ".easy-coding/tools/easy_coding_java_coverage.py"
JAVA_BUILD_FILE_NAMES = {"pom.xml", "build.gradle", "build.gradle.kts"}
GITLAB_CI_ENTRY_FILES = {".gitlab-ci.yml", ".gitlab-ci.yaml"}


class ReadinessError(RuntimeError):
    pass


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(65536), b""):
            digest.update(chunk)
    return digest.hexdigest()


def project_file(root: Path, value: str) -> tuple[str, Path]:
    candidate = Path(value)
    if candidate.is_absolute():
        resolved = candidate.resolve()
    else:
        resolved = (root / candidate).resolve()
    try:
        relative = resolved.relative_to(root.resolve()).as_posix()
    except ValueError as error:
        raise ReadinessError(f"Path escapes project root: {value}") from error
    if not resolved.is_file():
        raise ReadinessError(f"Required file is missing: {relative}")
    return relative, resolved


def file_record(root: Path, value: str) -> dict[str, str]:
    relative, resolved = project_file(root, value)
    return {"path": relative, "sha256": sha256(resolved)}


def safe_report_pattern(value: str) -> bool:
    candidate = Path(value)
    return bool(value.strip()) and not candidate.is_absolute() and ".." not in candidate.parts


def required_gate_variables(command: str) -> bool:
    try:
        tokens = shlex.split(command)
    except ValueError:
        return False
    options: dict[str, str] = {}
    for index, token in enumerate(tokens[:-1]):
        if token in {"--base", "--threshold"}:
            options[token] = tokens[index + 1]
    return options.get("--base") in {
        f"${TDD_BASE_VARIABLE}",
        "$" + "{" + TDD_BASE_VARIABLE + "}",
    } and options.get("--threshold") in {
        f"${TDD_THRESHOLD_VARIABLE}",
        "$" + "{" + TDD_THRESHOLD_VARIABLE + "}",
    }


def ci_contract_reasons(contents: list[str]) -> list[str]:
    combined = "\n".join(
        re.sub(r"\s+#.*$", "", re.sub(r"^\s*#.*$", "", line))
        for line in "\n".join(contents).splitlines()
    )
    lowered = combined.lower()
    reasons: list[str] = []
    for marker in (
        "jacoco",
        "artifacts",
        COVERAGE_TOOL_PATH,
        TDD_BASE_VARIABLE,
        TDD_THRESHOLD_VARIABLE,
    ):
        if marker.lower() not in lowered:
            reasons.append(f"CI files do not contain required marker: {marker}")
    if not required_gate_variables(combined):
        reasons.append(
            "CI changed-line gate must use the task baseline and threshold variables"
        )
    if re.search(r"(?:^|\n)\s*stage\s*:\s*['\"]?test['\"]?\s*(?:#.*)?(?:\n|$)", combined, re.I) is None:
        reasons.append("CI files do not declare a TEST-stage job")
    return reasons


def parse_records(root: Path, value: object, field: str, reasons: list[str]) -> list[str]:
    if not isinstance(value, list) or not value:
        reasons.append(f"{field} must contain at least one file")
        return []
    contents: list[str] = []
    for item in value:
        if not isinstance(item, dict):
            reasons.append(f"{field} contains an invalid record")
            continue
        file_name = item.get("path")
        expected = item.get("sha256")
        if not isinstance(file_name, str) or not isinstance(expected, str):
            reasons.append(f"{field} contains an invalid path or SHA-256")
            continue
        try:
            _, resolved = project_file(root, file_name)
            if sha256(resolved) != expected:
                reasons.append(f"readiness file changed: {file_name}")
            contents.append(resolved.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, ReadinessError) as error:
            reasons.append(str(error))
    return contents


def inspect(root: Path) -> dict[str, object]:
    receipt = root / RECEIPT
    if not receipt.is_file():
        return {
            "status": "needs_init",
            "coverage_scope": COVERAGE_SCOPE,
            "reasons": ["TDD readiness receipt is missing"],
            "receipt": RECEIPT.as_posix(),
        }
    try:
        manifest = json.loads(receipt.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError):
        return {
            "status": "needs_init",
            "coverage_scope": COVERAGE_SCOPE,
            "reasons": ["TDD readiness receipt is invalid"],
            "receipt": RECEIPT.as_posix(),
        }

    reasons: list[str] = []
    if not isinstance(manifest, dict):
        reasons.append("TDD readiness receipt must be a JSON object")
        manifest = {}
    if manifest.get("schema") != SCHEMA:
        reasons.append("unsupported readiness schema")
    if manifest.get("provider") != "gitlab":
        reasons.append("readiness provider must be gitlab")
    if manifest.get("coverage_scope") != COVERAGE_SCOPE:
        reasons.append("coverage scope must be changed-production-lines")
    if manifest.get("historical_coverage_required") is not False:
        reasons.append("historical coverage must remain disabled")
    patterns = manifest.get("coverage_report_patterns")
    if not isinstance(patterns, list) or not patterns or not all(
        isinstance(item, str) and safe_report_pattern(item) for item in patterns
    ):
        reasons.append(
            "coverage_report_patterns must contain safe project-relative report patterns"
        )
    gate = manifest.get("changed_line_gate_command")
    if not isinstance(gate, str) or COVERAGE_TOOL_PATH not in gate:
        reasons.append("changed-line coverage gate command is missing")
    elif not required_gate_variables(gate):
        reasons.append(
            "changed-line coverage gate must use the task baseline and threshold variables"
        )

    manifest_build_files = manifest.get("build_files")
    manifest_ci_files = manifest.get("ci_files")
    manifest_tool_files = manifest.get("tool_files")
    build_contents = parse_records(root, manifest_build_files, "build_files", reasons)
    ci_contents = parse_records(root, manifest_ci_files, "ci_files", reasons)
    parse_records(root, manifest_tool_files, "tool_files", reasons)
    build_paths = {
        Path(item.get("path", "")).name
        for item in manifest_build_files
        if isinstance(item, dict) and isinstance(item.get("path"), str)
    } if isinstance(manifest_build_files, list) else set()
    ci_paths = {
        item.get("path", "").replace("\\", "/")
        for item in manifest_ci_files
        if isinstance(item, dict) and isinstance(item.get("path"), str)
    } if isinstance(manifest_ci_files, list) else set()
    if not build_paths.intersection(JAVA_BUILD_FILE_NAMES):
        reasons.append("build_files must include a Maven or Gradle Java build file")
    if not ci_paths.intersection(GITLAB_CI_ENTRY_FILES):
        reasons.append("ci_files must include the project-root GitLab CI entry file")
    tool_paths = {
        item.get("path", "").replace("\\", "/")
        for item in manifest_tool_files
        if isinstance(item, dict) and isinstance(item.get("path"), str)
    } if isinstance(manifest_tool_files, list) else set()
    if COVERAGE_TOOL_PATH not in tool_paths:
        reasons.append(f"tool_files must include {COVERAGE_TOOL_PATH}")
    if not any("jacoco" in content.lower() for content in build_contents):
        reasons.append("build files do not configure JaCoCo")
    reasons.extend(ci_contract_reasons(ci_contents))

    return {
        "status": "ready" if not reasons else "needs_init",
        "coverage_scope": COVERAGE_SCOPE,
        "reasons": list(dict.fromkeys(reasons)),
        "receipt": RECEIPT.as_posix(),
    }


def record(args: argparse.Namespace, root: Path) -> dict[str, object]:
    if not args.build_file:
        raise ReadinessError("At least one --build-file is required.")
    if not args.ci_file:
        raise ReadinessError("At least one --ci-file is required.")
    if not args.coverage_report:
        raise ReadinessError("At least one --coverage-report is required.")
    if not all(safe_report_pattern(value) for value in args.coverage_report):
        raise ReadinessError("--coverage-report values must be safe project-relative patterns.")
    if COVERAGE_TOOL_PATH not in args.gate_command:
        raise ReadinessError(f"--gate-command must invoke {COVERAGE_TOOL_PATH}.")
    if not required_gate_variables(args.gate_command):
        raise ReadinessError(
            "--gate-command must use $EASY_CODING_TDD_BASE_SHA and "
            "$EASY_CODING_TDD_THRESHOLD."
        )

    build_records = [file_record(root, value) for value in args.build_file]
    ci_records = [file_record(root, value) for value in args.ci_file]
    tool_records = [file_record(root, COVERAGE_TOOL_PATH)]
    if not any(Path(item["path"]).name in JAVA_BUILD_FILE_NAMES for item in build_records):
        raise ReadinessError("--build-file must include pom.xml, build.gradle, or build.gradle.kts.")
    if not any(item["path"] in GITLAB_CI_ENTRY_FILES for item in ci_records):
        raise ReadinessError(
            "--ci-file must include the project-root .gitlab-ci.yml or .gitlab-ci.yaml."
        )
    build_contents = [
        (root / record_item["path"]).read_text(encoding="utf-8")
        for record_item in build_records
    ]
    ci_contents = [
        (root / record_item["path"]).read_text(encoding="utf-8") for record_item in ci_records
    ]
    if not any("jacoco" in content.lower() for content in build_contents):
        raise ReadinessError("Build files must configure JaCoCo before readiness can be recorded.")
    ci_reasons = ci_contract_reasons(ci_contents)
    if ci_reasons:
        raise ReadinessError("; ".join(ci_reasons))

    manifest = {
        "schema": SCHEMA,
        "provider": "gitlab",
        "coverage_scope": COVERAGE_SCOPE,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "generated_by": args.agent,
        "build_files": build_records,
        "ci_files": ci_records,
        "tool_files": tool_records,
        "coverage_report_patterns": args.coverage_report,
        "changed_line_gate_command": args.gate_command,
        "historical_coverage_required": False,
    }
    receipt = root / RECEIPT
    receipt.parent.mkdir(parents=True, exist_ok=True)
    temporary = receipt.with_suffix(f".tmp-{os.getpid()}")
    temporary.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    temporary.replace(receipt)
    result = inspect(root)
    if result["status"] != "ready":
        raise ReadinessError("Recorded readiness receipt did not pass validation.")
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description="Easy Coding Java TDD readiness tool")
    parser.add_argument("--cwd", default=".")
    subcommands = parser.add_subparsers(dest="command", required=True)
    subcommands.add_parser("check")
    record_parser = subcommands.add_parser("record")
    record_parser.add_argument("--build-file", action="append", default=[])
    record_parser.add_argument("--ci-file", action="append", default=[])
    record_parser.add_argument("--coverage-report", action="append", default=[])
    record_parser.add_argument("--gate-command", required=True)
    record_parser.add_argument("--agent", required=True)
    args = parser.parse_args()
    root = Path(args.cwd).resolve()
    try:
        result = inspect(root) if args.command == "check" else record(args, root)
    except (OSError, UnicodeError, ReadinessError) as error:
        print(json.dumps({"status": "needs_init", "reasons": [str(error)]}, ensure_ascii=False))
        return 2
    print(json.dumps(result, ensure_ascii=False))
    return 0 if result["status"] == "ready" else 1


if __name__ == "__main__":
    raise SystemExit(main())
