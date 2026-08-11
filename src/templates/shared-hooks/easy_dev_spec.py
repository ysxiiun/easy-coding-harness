"""Easy Dev Spec Canonical v1 parser and repository binding helpers."""

from __future__ import annotations

import hashlib
import re
import subprocess
from pathlib import Path
from typing import Any, Iterable

from easy_dev_spec_protocol import SCHEMA, select_scope, validate_spec


UPSTREAM_PROTOCOL_COMMIT = "8239a5befae08b41da43b7cfbf41acf07e487d04"
UPSTREAM_PROTOCOL_SHA256 = "a6016f04b4ce18794038ebcdbcab6e400a8a08aa2929a3e777c2b35ee3f7e7a1"
UPSTREAM_EXECUTION_WRITER_SHA256 = "17f03314adce341269e2689aa41bb7bb29c236979be530a373fef58fe88a2524"


class EasyDevSpecError(ValueError):
    """Canonical Spec 无法安全消费时抛出。"""


def _read_spec(
    path: Path,
    require_ready: bool = False,
    require_execution: bool = False,
) -> tuple[str, dict[str, Any], dict[str, str], Any]:
    if not path.is_file():
        raise EasyDevSpecError(f"Spec file does not exist: {path}")
    try:
        text = path.read_text(encoding="utf-8")
        report = validate_spec(
            text,
            require_ready=require_ready,
            require_execution=require_execution,
        )
    except (OSError, UnicodeError) as exc:
        raise EasyDevSpecError(f"Cannot read Spec as UTF-8: {path}: {exc}") from exc
    if report.protocol == "legacy":
        raise EasyDevSpecError("Dev Spec does not contain a Canonical v1 manifest")
    if report.protocol != "canonical-v1" or report.manifest is None or not report.ok:
        details = "; ".join(
            f"{issue.code}: {issue.message}" for issue in report.issues
        ) or "unknown validation failure"
        raise EasyDevSpecError(f"Canonical Spec validation failed: {details}")
    sections = {
        section_id: section.content
        for section_id, section in report.sections.items()
    }
    return text, report.manifest, sections, report


def normalize_remote(remote: str) -> str:
    value = remote.strip().removesuffix("/").removesuffix(".git")
    if value.startswith("git@") and ":" in value:
        host, path = value[4:].split(":", 1)
        return f"{host.lower()}/{path.removesuffix('.git').strip('/')}"
    match = re.match(r"^(?:https?|ssh|git)://(?:[^@/]+@)?([^/]+)/(.+)$", value)
    if match:
        return f"{match.group(1).lower()}/{match.group(2).removesuffix('.git').strip('/')}"
    if value.startswith("file://"):
        return str(Path(value[7:]).resolve())
    return value


def _git(repository: Path, *args: str) -> subprocess.CompletedProcess[str] | None:
    try:
        return subprocess.run(
            ["git", "-C", str(repository), *args],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            check=False,
        )
    except OSError:
        return None


def repository_remotes(repository: Path) -> list[str]:
    result = _git(repository, "remote", "-v")
    if result is None or result.returncode != 0:
        return []
    remotes: list[str] = []
    for line in result.stdout.splitlines():
        parts = line.split()
        if len(parts) >= 2:
            normalized = normalize_remote(parts[1])
            if normalized and normalized not in remotes:
                remotes.append(normalized)
    return remotes


def classify_baseline(repository: Path, commit: str, paths: Iterable[str]) -> str:
    unique_paths = sorted(set(paths))
    if unique_paths:
        worktree = _git(repository, "status", "--porcelain", "--", *unique_paths)
        if worktree is None or worktree.returncode != 0:
            return "baseline-unavailable"
        if worktree.stdout.strip():
            return "scope-drifted"
    head = _git(repository, "rev-parse", "HEAD")
    if head is None or head.returncode != 0:
        return "baseline-unavailable"
    if head.stdout.strip().lower() == commit.lower():
        return "exact"
    available = _git(repository, "cat-file", "-e", commit + "^{commit}")
    if available is None or available.returncode != 0:
        return "baseline-unavailable"
    if not unique_paths:
        return "scope-unchanged"
    changed = _git(repository, "diff", "--quiet", commit, "HEAD", "--", *unique_paths)
    if changed is None or changed.returncode not in {0, 1}:
        return "baseline-unavailable"
    return "scope-unchanged" if changed.returncode == 0 else "scope-drifted"


def portable_path(root: Path, path: Path) -> str:
    resolved_root = root.resolve()
    resolved_path = path.resolve()
    try:
        return resolved_path.relative_to(resolved_root).as_posix()
    except ValueError:
        try:
            return Path("..", resolved_path.relative_to(resolved_root.parent)).as_posix()
        except ValueError:
            raise EasyDevSpecError(
                f"Path cannot be stored portably relative to the project root: {resolved_path}"
            )


def _candidate_repository_paths(
    root: Path,
    repository: dict[str, Any],
    explicit_paths: dict[str, str],
) -> list[Path]:
    repo_id = str(repository["repo_id"])
    candidates: list[Path] = []
    explicit = explicit_paths.get(repo_id)
    if explicit:
        path = Path(explicit)
        # An explicit binding is authoritative. Falling back to path_hint/root would make a
        # mistyped --repo-path appear valid while silently binding a different checkout.
        return [(path if path.is_absolute() else root / path).resolve()]
    hint = Path(str(repository.get("path_hint") or ""))
    if str(hint):
        candidates.append(hint if hint.is_absolute() else root / hint)
    candidates.append(root)
    unique: list[Path] = []
    for candidate in candidates:
        resolved = candidate.resolve()
        if resolved not in unique:
            unique.append(resolved)
    return unique


def inspect_spec(
    spec_path: Path,
    root: Path,
    repo_paths: dict[str, str] | None = None,
    selected_task_ids: Iterable[str] | None = None,
) -> dict[str, Any]:
    resolved_spec_path = spec_path.resolve()
    text, manifest, sections, report = _read_spec(resolved_spec_path)
    repositories = manifest["repositories"]
    tasks = manifest["tasks"]
    changes = manifest["changes"]
    tests = manifest["tests"]
    task_by_id = {task["task_id"]: task for task in tasks}
    explicit_paths = repo_paths or {}
    selected_task_set = set(selected_task_ids or [])
    matched_repo_paths: dict[str, str] = {}
    unresolved_repositories: list[str] = []
    baseline_status: dict[str, str] = {}
    repository_bindings: list[dict[str, Any]] = []

    for repository in repositories:
        repo_id = str(repository["repo_id"])
        expected_remotes = {normalize_remote(remote) for remote in repository["remote_urls"]}
        matches = [
            candidate
            for candidate in _candidate_repository_paths(root, repository, explicit_paths)
            if candidate.is_dir() and expected_remotes.intersection(repository_remotes(candidate))
        ]
        matches = list(dict.fromkeys(matches))
        if len(matches) != 1:
            unresolved_repositories.append(repo_id)
            baseline_status[repo_id] = "baseline-unavailable"
            continue
        repository_path = matches[0]
        selected_paths = [
            str(change["path"])
            for change in changes
            if change.get("repo_id") == repo_id
            and (not selected_task_set or change.get("task_id") in selected_task_set)
        ]
        selected_paths.extend(
            str(test["file"])
            for test in tests
            if task_by_id.get(str(test.get("task_id")), {}).get("repo_id") == repo_id
            and (not selected_task_set or test.get("task_id") in selected_task_set)
        )
        status = classify_baseline(
            repository_path,
            str(repository["baseline"]["commit"]),
            selected_paths,
        )
        stored_path = portable_path(root, repository_path)
        matched_repo_paths[repo_id] = stored_path
        baseline_status[repo_id] = status
        repository_bindings.append(
            {
                "repo_id": repo_id,
                "name": repository["name"],
                "path": stored_path,
                "baseline_commit": repository["baseline"]["commit"],
                "baseline_status": status,
            }
        )

    dependency_edges = [
        {
            "source_task_id": task["task_id"],
            "task_id": dependency["task_id"],
            "dependency_type": dependency["type"],
            "required_evidence": dependency["required_evidence"],
        }
        for task in tasks
        for dependency in task.get("depends_on", [])
    ]
    try:
        source_path = portable_path(root, resolved_spec_path)
    except EasyDevSpecError:
        # Explicit project-external input remains readable and is stored as an absolute locator.
        source_path = str(resolved_spec_path)
    execution = report.execution
    return {
        "protocol": "canonical-v1",
        "schema": SCHEMA,
        "spec_id": manifest["spec_id"],
        "revision": manifest["revision"],
        "status": manifest["status"],
        "title": manifest["title"],
        "source_path": source_path,
        "source_sha256": hashlib.sha256(text.encode("utf-8")).hexdigest(),
        "design_sha256": report.design_sha256,
        "document_sha256": report.document_sha256,
        "execution_revision": (
            execution.get("execution_revision") if isinstance(execution, dict) else None
        ),
        "execution": execution,
        "repositories": repositories,
        "tasks": tasks,
        "changes": changes,
        "steps": manifest["steps"],
        "tests": manifest["tests"],
        "contracts": manifest["contracts"],
        "dependency_edges": dependency_edges,
        "matched_repo_paths": matched_repo_paths,
        "unresolved_repositories": unresolved_repositories,
        "baseline_status": baseline_status,
        "repository_bindings": repository_bindings,
    }


def select_consumption_scopes(
    spec_path: Path,
    root: Path,
    selected_task_ids: Iterable[str],
) -> dict[str, Any]:
    """Return final-protocol consumption closures grouped by repository."""

    resolved_spec_path = spec_path.resolve()
    text, manifest, _, report = _read_spec(
        resolved_spec_path,
        require_ready=True,
        require_execution=True,
    )
    selected_ids = list(dict.fromkeys(selected_task_ids))
    if not selected_ids:
        raise EasyDevSpecError("At least one Canonical Spec task must be selected")

    task_by_id = {task["task_id"]: task for task in manifest["tasks"]}
    unknown = [task_id for task_id in selected_ids if task_id not in task_by_id]
    if unknown:
        raise EasyDevSpecError("Unknown Canonical Spec tasks: " + ", ".join(unknown))

    selected_by_repo: dict[str, list[str]] = {}
    for task_id in selected_ids:
        repo_id = str(task_by_id[task_id]["repo_id"])
        selected_by_repo.setdefault(repo_id, []).append(task_id)

    scopes: list[dict[str, Any]] = []
    for repository in manifest["repositories"]:
        repo_id = str(repository["repo_id"])
        repo_task_ids = selected_by_repo.get(repo_id)
        if not repo_task_ids:
            continue
        try:
            scope = select_scope(
                text,
                repo_id,
                repo_task_ids,
                output_format="json",
            )
        except ValueError as exc:
            raise EasyDevSpecError(f"Cannot select consumption scope for {repo_id}: {exc}") from exc
        if not isinstance(scope, dict):
            raise EasyDevSpecError(f"Canonical selector returned an invalid scope for {repo_id}")
        scopes.append(scope)

    try:
        source_path = portable_path(root, resolved_spec_path)
    except EasyDevSpecError:
        source_path = str(resolved_spec_path)
    source_sha256 = hashlib.sha256(text.encode("utf-8")).hexdigest()
    for scope in scopes:
        scope["source_path"] = source_path
        scope["source_sha256"] = source_sha256
    return {
        "protocol": "canonical-v1",
        "schema": SCHEMA,
        "spec_id": manifest["spec_id"],
        "revision": manifest["revision"],
        "status": manifest["status"],
        "source_path": source_path,
        "source_sha256": source_sha256,
        "design_sha256": report.design_sha256,
        "document_sha256": report.document_sha256,
        "execution_revision": report.execution.get("execution_revision"),
        "selected_task_ids": selected_ids,
        "scopes": scopes,
    }


def select_tasks(
    inspection: dict[str, Any],
    selected_task_ids: Iterable[str],
    dependency_evidence: dict[str, str] | None = None,
) -> dict[str, Any]:
    selected_ids = list(dict.fromkeys(selected_task_ids))
    if not selected_ids:
        raise EasyDevSpecError("At least one Canonical Spec task must be selected")
    task_by_id = {task["task_id"]: task for task in inspection["tasks"]}
    unknown = [task_id for task_id in selected_ids if task_id not in task_by_id]
    if unknown:
        raise EasyDevSpecError("Unknown Canonical Spec tasks: " + ", ".join(unknown))
    not_ready = [task_id for task_id in selected_ids if task_by_id[task_id].get("status") != "READY"]
    if inspection.get("status") != "READY" or not_ready:
        raise EasyDevSpecError(
            "Canonical Spec and all selected tasks must be READY: " + ", ".join(not_ready)
        )

    selected_set = set(selected_ids)
    evidence_by_dependency = dependency_evidence or {}
    execution = inspection.get("execution")
    execution_by_task = {
        str(snapshot.get("task_id")): snapshot
        for snapshot in execution.get("tasks", [])
        if isinstance(execution, dict)
        and isinstance(snapshot, dict)
        and isinstance(snapshot.get("task_id"), str)
    } if isinstance(execution, dict) else {}
    dependency_target_counts: dict[str, int] = {}
    for source_task_id in selected_ids:
        for dependency in task_by_id[source_task_id].get("depends_on", []):
            dependency_id = str(dependency["task_id"])
            dependency_target_counts[dependency_id] = dependency_target_counts.get(dependency_id, 0) + 1
    dependency_records: list[dict[str, Any]] = []
    missing_hard: list[str] = []
    for source_task_id in selected_ids:
        for dependency in task_by_id[source_task_id].get("depends_on", []):
            dependency_id = str(dependency["task_id"])
            dependency_type = str(dependency["type"])
            edge_key = f"{source_task_id}->{dependency_id}"
            evidence = evidence_by_dependency.get(edge_key)
            if evidence is None and dependency_target_counts[dependency_id] == 1:
                evidence = evidence_by_dependency.get(dependency_id)
            source_snapshot = execution_by_task.get(source_task_id, {})
            shared_dependency = next(
                (
                    item
                    for item in source_snapshot.get("dependencies", [])
                    if isinstance(item, dict) and item.get("task_id") == dependency_id
                ),
                None,
            )
            dependency_snapshot = execution_by_task.get(dependency_id, {})
            shared_satisfied = bool(
                isinstance(shared_dependency, dict)
                and shared_dependency.get("status") == "satisfied"
            )
            dependency_completed = dependency_snapshot.get("status") == "completed"
            if dependency_type == "hard":
                satisfied = shared_satisfied or dependency_completed or bool(evidence)
                if dependency_id not in selected_set and not satisfied:
                    missing_hard.append(f"{source_task_id}->{dependency_id}")
            elif dependency_type == "contract":
                satisfied = shared_satisfied or inspection.get("status") == "READY"
                evidence = evidence or "canonical-spec-ready-contract"
            else:
                satisfied = shared_satisfied or bool(evidence)
            dependency_records.append(
                {
                    "source_task_id": source_task_id,
                    "task_id": dependency_id,
                    "dependency_type": dependency_type,
                    "required_evidence": dependency["required_evidence"],
                    "status": "satisfied" if satisfied else "pending",
                    "shared_status": (
                        shared_dependency.get("status")
                        if isinstance(shared_dependency, dict)
                        else "pending"
                    ),
                    **({"evidence": evidence} if evidence else {}),
                }
            )
    if missing_hard:
        raise EasyDevSpecError(
            "Selected tasks omit hard dependencies without evidence: " + ", ".join(missing_hard)
        )

    selected_tasks = [task_by_id[task_id] for task_id in selected_ids]
    selected_repo_ids = list(dict.fromkeys(task["repo_id"] for task in selected_tasks))
    unresolved = [
        repo_id for repo_id in selected_repo_ids if repo_id not in inspection["matched_repo_paths"]
    ]
    if unresolved:
        raise EasyDevSpecError("Selected tasks have unresolved repository paths: " + ", ".join(unresolved))
    return {
        "selected_task_ids": selected_ids,
        "selected_tasks": selected_tasks,
        "selected_repo_ids": selected_repo_ids,
        "selected_changes": [
            change for change in inspection["changes"] if change.get("task_id") in selected_set
        ],
        "selected_steps": [
            step for step in inspection["steps"] if step.get("task_id") in selected_set
        ],
        "selected_tests": [
            test for test in inspection["tests"] if test.get("task_id") in selected_set
        ],
        "dependency_records": dependency_records,
        "execution_revision": inspection.get("execution_revision"),
        "execution_tasks": [
            execution_by_task[task_id]
            for task_id in selected_ids
            if task_id in execution_by_task
        ],
    }


def inspection_summary(inspection: dict[str, Any]) -> dict[str, Any]:
    """Return the discovery surface without unrelated implementation routing objects."""

    keys = (
        "protocol",
        "schema",
        "spec_id",
        "revision",
        "status",
        "title",
        "source_path",
        "source_sha256",
        "design_sha256",
        "document_sha256",
        "execution_revision",
        "repositories",
        "tasks",
        "dependency_edges",
        "matched_repo_paths",
        "unresolved_repositories",
        "baseline_status",
        "repository_bindings",
    )
    summary = {key: inspection[key] for key in keys}
    execution = inspection.get("execution")
    if isinstance(execution, dict):
        summary["execution"] = {
            key: execution.get(key)
            for key in (
                "schema",
                "spec_id",
                "design_revision",
                "design_sha256",
                "execution_revision",
                "updated_at",
                "tasks",
            )
        }
    else:
        summary["execution"] = None
    return summary
