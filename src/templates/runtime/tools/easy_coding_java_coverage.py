#!/usr/bin/env python3
"""Gate changed Java production lines with one or more JaCoCo XML reports."""

import argparse
import ast
import hashlib
import json
import re
import subprocess
import sys
import xml.etree.ElementTree as ET
from pathlib import Path


DEFAULT_THRESHOLD = 90
HUNK_PATTERN = re.compile(r"^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@")
TEST_PATH_PARTS = {"test", "tests", "testfixtures", "integrationtest"}


class CoverageError(Exception):
    pass


def run_git(repo: Path, *args: str) -> str:
    result = subprocess.run(
        ["git", "-C", str(repo), *args],
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise CoverageError(result.stderr.strip() or "git command failed")
    return result.stdout


def changed_java_lines(repo: Path, base: str) -> dict[str, set[int]]:
    diff = run_git(
        repo,
        "-c",
        "core.quotePath=false",
        "diff",
        "--unified=0",
        "--no-ext-diff",
        base,
        "--",
        "*.java",
    )
    changed: dict[str, set[int]] = {}
    current: str | None = None
    new_line = 0
    for line in diff.splitlines():
        if line.startswith("+++ "):
            target = line[4:].strip()
            if target.startswith('"'):
                try:
                    target = ast.literal_eval(target)
                except (SyntaxError, ValueError) as error:
                    raise CoverageError(f"Cannot decode Git diff path: {target}") from error
            current = None if target == "/dev/null" else target.removeprefix("b/")
            if current and not is_production_java(current):
                current = None
            continue
        match = HUNK_PATTERN.match(line)
        if match:
            new_line = int(match.group(1))
            continue
        if current is None or line.startswith(("--- ", "diff ", "index ")):
            continue
        if line.startswith("+") and not line.startswith("+++"):
            changed.setdefault(current, set()).add(new_line)
            new_line += 1
        elif not line.startswith("-"):
            new_line += 1
    untracked = run_git(
        repo,
        "ls-files",
        "--others",
        "--exclude-standard",
        "-z",
        "--",
        "*.java",
    )
    for file_path in filter(None, untracked.split("\0")):
        if not is_production_java(file_path):
            continue
        candidate = repo / file_path
        try:
            line_count = len(candidate.read_text(encoding="utf-8").splitlines())
        except (OSError, UnicodeError) as error:
            raise CoverageError(f"Cannot read untracked Java source {file_path}: {error}") from error
        changed.setdefault(file_path, set()).update(range(1, line_count + 1))
    return changed


def is_production_java(file_path: str) -> bool:
    path = Path(file_path)
    if path.suffix != ".java":
        return False
    parts = {part.lower() for part in path.parts}
    if TEST_PATH_PARTS & parts:
        return False
    return True


def report_module_prefix(report: Path, repo: Path) -> str:
    relative = report.resolve().relative_to(repo.resolve()).as_posix()
    if "/target/site/jacoco-aggregate/" in f"/{relative}":
        return ""
    markers = ("/target/", "/build/reports/")
    for marker in markers:
        if marker in f"/{relative}":
            prefix = f"/{relative}".split(marker, 1)[0].lstrip("/")
            return f"{prefix}/" if prefix else ""
    return ""


def parse_reports(
    repo: Path, reports: list[Path]
) -> tuple[list[tuple[str, str, dict[int, bool], Path]], str]:
    sources: list[tuple[str, str, dict[int, bool], Path]] = []
    digest = hashlib.sha256()
    for report in reports:
        try:
            payload = report.read_bytes()
            root = ET.fromstring(payload)
        except (OSError, ET.ParseError) as error:
            raise CoverageError(f"Cannot read JaCoCo XML report {report}: {error}") from error
        try:
            report_name = report.resolve().relative_to(repo.resolve()).as_posix()
        except ValueError as error:
            raise CoverageError(f"JaCoCo XML report must be inside the Git repository: {report}") from error
        digest.update(report_name.encode())
        digest.update(b"\0")
        digest.update(payload)
        digest.update(b"\0")
        prefix = report_module_prefix(report, repo)
        for package in root.findall(".//package"):
            package_name = package.get("name", "").strip("/")
            for source in package.findall("sourcefile"):
                source_name = source.get("name", "")
                suffix = "/".join(part for part in (package_name, source_name) if part)
                executable: dict[int, bool] = {}
                try:
                    for line in source.findall("line"):
                        number = int(line.get("nr", "0"))
                        covered = int(line.get("ci", "0")) > 0 or int(line.get("cb", "0")) > 0
                        executable[number] = executable.get(number, False) or covered
                except ValueError as error:
                    raise CoverageError(f"Invalid JaCoCo line counters in {report}") from error
                sources.append((prefix, suffix, executable, report))
    return sources, digest.hexdigest()


def discover_reports(repo: Path) -> list[Path]:
    regular = [
        *repo.glob("**/target/site/jacoco/jacoco.xml"),
        *repo.glob("**/build/reports/jacoco/**/jacocoTestReport.xml"),
    ]
    reports = sorted({candidate.resolve() for candidate in regular if candidate.is_file()})
    if reports:
        return reports
    aggregate = repo.glob("**/target/site/jacoco-aggregate/jacoco.xml")
    return sorted({candidate.resolve() for candidate in aggregate if candidate.is_file()})


def read_project_threshold(repo: Path) -> int:
    path = repo / ".easy-coding" / "config.yaml"
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return DEFAULT_THRESHOLD
    in_behavior = False
    behavior_indent = 0
    schema_version = 0
    for raw in lines:
        clean = raw.split("#", 1)[0].rstrip()
        stripped = clean.strip()
        if not stripped:
            continue
        indent = len(clean) - len(clean.lstrip(" "))
        if stripped == "behavior:":
            in_behavior = True
            behavior_indent = indent
            continue
        if in_behavior and indent <= behavior_indent:
            in_behavior = False
        if not in_behavior and indent == 0 and stripped.startswith("version:"):
            try:
                schema_version = int(stripped.split(":", 1)[1].strip().strip("'\""))
            except ValueError:
                schema_version = 0
            continue
        if (
            schema_version >= 4
            and in_behavior
            and stripped.startswith("tdd_coverage_threshold:")
        ):
            try:
                value = int(stripped.split(":", 1)[1].strip().strip("'\""))
            except ValueError as error:
                raise CoverageError("Invalid behavior.tdd_coverage_threshold") from error
            if not 1 <= value <= 100:
                raise CoverageError("TDD coverage threshold must be from 1 to 100")
            return value
    return DEFAULT_THRESHOLD


def calculate(
    repo: Path, base: str, reports: list[Path], threshold: int
) -> dict[str, object]:
    baseline_sha = run_git(repo, "rev-parse", "--verify", f"{base}^{{commit}}").strip()
    if re.fullmatch(r"[0-9a-f]{40}|[0-9a-f]{64}", baseline_sha) is None:
        raise CoverageError(f"Invalid Git baseline commit: {base}")
    try:
        run_git(repo, "merge-base", "--is-ancestor", baseline_sha, "HEAD")
    except CoverageError as error:
        raise CoverageError(
            f"Git baseline {baseline_sha} is not an ancestor of HEAD"
        ) from error
    changed = changed_java_lines(repo, base)
    sources, report_sha = parse_reports(repo, reports)
    covered = 0
    total = 0
    files: list[dict[str, object]] = []
    missing: list[str] = []
    for file_path, added_lines in sorted(changed.items()):
        matches: list[tuple[dict[int, bool], Path]] = []
        for prefix, suffix, lines, report in sources:
            if (not prefix or file_path.startswith(prefix)) and file_path.endswith(suffix):
                matches.append((lines, report))
        if len(matches) != 1:
            missing.append(file_path)
            continue
        executable, matched_report = matches[0]
        source_path = repo / file_path
        try:
            if matched_report.stat().st_mtime_ns < source_path.stat().st_mtime_ns:
                raise CoverageError(
                    f"JaCoCo XML report is older than modified Java source {file_path}; regenerate unit-test coverage"
                )
        except OSError as error:
            raise CoverageError(
                f"Cannot compare JaCoCo report freshness for {file_path}: {error}"
            ) from error
        relevant = sorted(added_lines & executable.keys())
        file_covered = sum(1 for number in relevant if executable[number])
        covered += file_covered
        total += len(relevant)
        files.append(
            {
                "path": file_path,
                "covered_lines": file_covered,
                "total_lines": len(relevant),
            }
        )
    if missing:
        raise CoverageError(
            "Modified production Java files are missing or ambiguous in JaCoCo XML: "
            + ", ".join(missing)
        )
    percentage = 100.0 if total == 0 else round(covered * 100.0 / total, 2)
    applicable = total > 0
    return {
        "baseline_sha": baseline_sha,
        "covered_lines": covered,
        "total_lines": total,
        "percentage": percentage,
        "threshold": threshold,
        "applicable": applicable,
        "not_applicable_reason": None if applicable else "no modified executable production Java lines",
        "passed": percentage >= threshold,
        "report_paths": [str(report.resolve().relative_to(repo.resolve())) for report in reports],
        "report_sha256": report_sha,
        "files": files,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    subcommands = parser.add_subparsers(dest="command", required=True)
    check = subcommands.add_parser("check")
    check.add_argument("--base", required=True)
    check.add_argument("--repo", default=".")
    check.add_argument("--report", action="append", default=[])
    check.add_argument("--threshold", type=int)
    check.add_argument("--output")
    args = parser.parse_args()
    try:
        requested_repo = Path(args.repo).resolve()
        repo = Path(run_git(requested_repo, "rev-parse", "--show-toplevel").strip()).resolve()
        threshold = (
            args.threshold
            if args.threshold is not None
            else read_project_threshold(repo)
        )
        if not 1 <= threshold <= 100:
            raise CoverageError("TDD coverage threshold must be from 1 to 100")
        reports = (
            sorted({Path(item).resolve() for item in args.report})
            if args.report
            else discover_reports(repo)
        )
        if not reports:
            raise CoverageError("No JaCoCo XML report found; pass --report or generate one first")
        result = calculate(repo, args.base, reports, threshold)
        payload = json.dumps(result, ensure_ascii=False, indent=2)
        if args.output:
            Path(args.output).write_text(payload + "\n", encoding="utf-8")
        print(payload)
        return 0 if result["passed"] else 1
    except CoverageError as error:
        print(json.dumps({"passed": False, "error": str(error)}, ensure_ascii=False), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
