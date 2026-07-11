#!/usr/bin/env python3
import argparse
import hashlib
import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
import sys


TERMINAL_STATUSES = {"COMPLETE", "CLOSED"}
HELP_SUFFIX = (
    "Use `ec-workflow` to start or resume a task, "
    "`ec-brainstorming` to brainstorm, or `ec-task-management` to manage tasks or session settings"
)
READY_LINE = (
    "> **Easy Coding** · Ready · Use `ec-workflow` to start or resume a task, "
    "`ec-brainstorming` to brainstorm, or `ec-task-management` to manage tasks or session settings"
)
WAITING_INIT_LINE = "> **Easy Coding** · Waiting init · Use `ec-init` to initialize"

MANDATORY_DEV_SPEC_HEADERS: list[str] = [
    "## 技术方案",
    "### 项目模式",
    "### 任务类型",
    "### 需求解析",
    "### 现状",
    "### 冲突摘要",
    "### 影响面分析",
    "### 改动范围",
    "### 修改方案",
    "### 实施拆解",
    "### 测试策略",
    "### 风险与注意事项",
]

VALID_TRANSITIONS: dict[str, set[str]] = {
    "idle": {"INIT"},
    "INIT": {"ANALYSIS", "CLOSED"},
    "ANALYSIS": {"IMPLEMENT", "CLOSED"},
    "IMPLEMENT": {"REVIEW", "VERIFICATION", "ANALYSIS", "COMPLETE", "CLOSED"},
    "REVIEW": {"VERIFICATION", "IMPLEMENT", "ANALYSIS", "CLOSED"},
    "VERIFICATION": {"MEMORY", "IMPLEMENT", "CLOSED"},
    "MEMORY": {"COMPLETE", "CLOSED"},
    "COMPLETE": set(),
    "CLOSED": set(),
}

ALWAYS_AUTO_TRANSITIONS = {
    ("INIT", "ANALYSIS"),
    ("MEMORY", "COMPLETE"),
}
READ_ONLY_COMPLETION_TRANSITION = ("IMPLEMENT", "COMPLETE")
NO_CODE_TASK_TYPES = {"analysis", "doc", "report"}
CONFIRM_MODES = {"approve", "guard", "auto"}
DEFAULT_CONFIRM_MODE = "guard"
GUARD_CONFIRM_TRANSITIONS = {
    ("ANALYSIS", "IMPLEMENT"),
    ("VERIFICATION", "MEMORY"),
}

LEGACY_STAGE_MAP = {
    "WAITING_CONFIRM": "ANALYSIS",
    "MEMORY_SHORT": "MEMORY",
    "MEMORY_LONG": "MEMORY",
}

DEFAULT_SHORT_TERM_MAX = 10
DEFAULT_SHORT_TERM_KEEP = 5
DEV_SPEC_PLACEHOLDER_PATTERN = re.compile(r"\[\[EC_TODO:[^\]\n]+\]\]")
MARKDOWN_HEADING_PATTERN = re.compile(r"^(#{1,6})\s+(.+?)\s*$")
TABLE_HEADER_CELLS = {
    "改动文件",
    "改动类型",
    "文件编码",
    "改动核心内容",
    "单元",
    "说明",
    "类型",
    "涉及文件",
    "依赖",
    "测试点",
    "级别",
    "归属单元",
    "方式",
    "验证命令",
}


class StateError(Exception):
    pass


def configure_stdio() -> None:
    for stream in (sys.stdin, sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def find_ec_root(start: Path) -> Path | None:
    current = start.resolve()
    while True:
        if (current / ".easy-coding").is_dir():
            return current
        if current == current.parent:
            return None
        current = current.parent


def load_json(path: Path) -> dict | None:
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def parse_positive_int(value: str) -> int | None:
    normalized = value.split("#", 1)[0].strip().strip("'\"")
    try:
        parsed = int(normalized)
    except ValueError:
        return None
    return parsed if parsed >= 0 else None


def read_memory_config(root: Path) -> dict[str, int]:
    config = {
        "short_term_max": DEFAULT_SHORT_TERM_MAX,
        "short_term_keep": DEFAULT_SHORT_TERM_KEEP,
    }
    path = root / ".easy-coding" / "config.yaml"
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return config

    in_memory = False
    memory_indent = 0
    for raw_line in lines:
        without_comment = raw_line.split("#", 1)[0].rstrip()
        stripped = without_comment.strip()
        if not stripped:
            continue
        indent = len(without_comment) - len(without_comment.lstrip(" "))
        if stripped == "memory:":
            in_memory = True
            memory_indent = indent
            continue
        if in_memory and indent <= memory_indent:
            in_memory = False
        if not in_memory or ":" not in stripped:
            continue
        key, value = stripped.split(":", 1)
        if key not in config:
            continue
        parsed = parse_positive_int(value)
        if parsed is not None:
            config[key] = parsed
    if config["short_term_keep"] > config["short_term_max"]:
        raise StateError(
            "Invalid memory config in .easy-coding/config.yaml: "
            "memory.short_term_keep must be less than or equal to memory.short_term_max."
        )
    return config


def read_project_confirm_mode(root: Path) -> str:
    path = root / ".easy-coding" / "config.yaml"
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return DEFAULT_CONFIRM_MODE

    in_behavior = False
    behavior_indent = 0
    for raw_line in lines:
        without_comment = raw_line.split("#", 1)[0].rstrip()
        stripped = without_comment.strip()
        if not stripped:
            continue
        indent = len(without_comment) - len(without_comment.lstrip(" "))
        if stripped == "behavior:":
            in_behavior = True
            behavior_indent = indent
            continue
        if in_behavior and indent <= behavior_indent:
            in_behavior = False
        if not in_behavior or ":" not in stripped:
            continue
        key, value = stripped.split(":", 1)
        if key != "confirm_mode":
            continue
        mode = value.strip().strip("'\"")
        if mode not in CONFIRM_MODES:
            raise StateError(
                "Invalid behavior.confirm_mode in .easy-coding/config.yaml: "
                "expected approve, guard, or auto."
            )
        return mode
    return DEFAULT_CONFIRM_MODE


def resolve_confirm_mode(root: Path, session: dict) -> tuple[str, str | None, str]:
    project_mode = read_project_confirm_mode(root)
    session_mode = session.get("confirm_mode")
    if session_mode is not None and session_mode not in CONFIRM_MODES:
        raise StateError("Invalid session confirm_mode: expected approve, guard, or auto.")
    effective_mode = str(session_mode or project_mode)
    return project_mode, str(session_mode) if session_mode else None, effective_mode


def short_memory_entries(root: Path) -> list[dict[str, object]]:
    short_dir = root / ".easy-coding" / "memory" / "short"
    if not short_dir.is_dir():
        return []
    entries: list[dict[str, object]] = []
    for entry in short_dir.glob("*.md"):
        try:
            content = entry.read_text(encoding="utf-8")
        except OSError:
            continue
        if not is_schema_v2_short_memory(content):
            continue
        frontmatter = parse_short_memory_frontmatter(content)
        resolved_entry = entry.resolve()
        try:
            resolved_entry.relative_to(short_dir.resolve())
            display_entry = resolved_entry.relative_to(root.resolve()).as_posix()
        except ValueError:
            continue
        prefix_text = entry.name.split("_", 1)[0]
        try:
            prefix = int(prefix_text)
        except ValueError:
            prefix = sys.maxsize
        entries.append(
            {
                "path": resolved_entry,
                "display_path": display_entry,
                "date": frontmatter.get("date", ""),
                "prefix": prefix,
                "name": entry.name,
            }
        )
    return sorted(
        entries,
        key=lambda item: (str(item["date"]), int(item["prefix"]), str(item["name"])),
    )


def count_short_memories(root: Path) -> int:
    return len(short_memory_entries(root))


def parse_short_memory_frontmatter(content: str) -> dict[str, str]:
    lines = content.splitlines()
    if not lines or lines[0].strip() != "---":
        return {}
    frontmatter: dict[str, str] = {}
    for line in lines[1:]:
        stripped = line.strip()
        if stripped == "---":
            return frontmatter
        if not stripped or stripped.startswith("#") or ":" not in stripped:
            continue
        key, value = stripped.split(":", 1)
        frontmatter[key.strip()] = value.strip().strip("'\"")
    return {}


def is_schema_v2_short_memory(content: str) -> bool:
    frontmatter = parse_short_memory_frontmatter(content)
    return parse_positive_int(frontmatter.get("memory_schema", "")) == 2


def resolve_short_memory_path(root: Path, memory_file: str) -> Path:
    short_dir = (root / ".easy-coding" / "memory" / "short").resolve()
    memory_path = Path(memory_file.strip())
    candidate = memory_path if memory_path.is_absolute() else root / memory_path
    resolved_memory_path = candidate.resolve()
    try:
        resolved_memory_path.relative_to(short_dir)
    except ValueError as error:
        raise StateError("Short-memory file must be under .easy-coding/memory/short/.") from error
    if resolved_memory_path.suffix != ".md":
        raise StateError(f"Short-memory file must be Markdown: {memory_file.strip()}")
    return resolved_memory_path


def validate_short_memory_file(
    root: Path,
    task_id: str,
    memory_file: str,
    expected_sha256: str | None = None,
) -> tuple[Path, str]:
    resolved_memory_path = resolve_short_memory_path(root, memory_file)
    if not resolved_memory_path.is_file():
        raise StateError(f"Short-memory file not found: {memory_file.strip()}")
    try:
        content = resolved_memory_path.read_text(encoding="utf-8")
    except OSError as error:
        raise StateError(f"Cannot read short-memory file: {memory_file.strip()}") from error
    frontmatter = parse_short_memory_frontmatter(content)
    if parse_positive_int(frontmatter.get("memory_schema", "")) != 2:
        raise StateError("Short-memory file must declare memory_schema: 2.")
    source_task = frontmatter.get("source_task", "")
    if source_task != task_id:
        raise StateError(
            f"Short-memory source_task {source_task or 'missing'} does not match current task {task_id}."
        )
    digest = hashlib.sha256(content.encode("utf-8")).hexdigest()
    if expected_sha256 and digest != expected_sha256:
        raise StateError("Short-memory file changed after its checkpoint was recorded.")
    return resolved_memory_path, digest


def validate_recorded_short_memory(
    root: Path,
    task_id: str,
    progress: dict,
    allow_missing_after_distill: bool = False,
) -> None:
    if progress.get("legacy_short_memory_assumed") is True:
        return
    memory_file = progress.get("short_memory_file")
    expected_sha256 = progress.get("short_memory_sha256")
    if not isinstance(memory_file, str) or not memory_file.strip():
        raise StateError("Recorded short-memory checkpoint is missing its file path.")
    if not isinstance(expected_sha256, str) or not expected_sha256:
        raise StateError("Recorded short-memory checkpoint is missing its content fingerprint.")
    resolved_memory_path = resolve_short_memory_path(root, memory_file)
    if allow_missing_after_distill and not resolved_memory_path.exists():
        return
    validate_short_memory_file(root, task_id, memory_file, expected_sha256)


def build_memory_instruction(
    root: Path,
    checkpoint_file: str | None = None,
    legacy_checkpoint: bool = False,
) -> dict:
    config = read_memory_config(root)
    entries = short_memory_entries(root)
    short_count = len(entries)
    action = "distill" if short_count > config["short_term_max"] else "no-op"
    trim_count = max(0, short_count - config["short_term_keep"]) if action == "distill" else 0
    candidate_files = [str(entry["display_path"]) for entry in entries[:trim_count]]
    kept_files = [str(entry["display_path"]) for entry in entries[trim_count:]]
    if legacy_checkpoint:
        checkpoint_disposition = "legacy"
    elif checkpoint_file in candidate_files:
        checkpoint_disposition = "candidate"
    elif checkpoint_file in kept_files:
        checkpoint_disposition = "kept"
    else:
        raise StateError("Recorded short-memory checkpoint is absent from the frozen memory set.")
    return {
        "short_count": short_count,
        "short_term_max": config["short_term_max"],
        "short_term_keep": config["short_term_keep"],
        "action": action,
        "trim_count": trim_count,
        "candidate_files": candidate_files,
        "kept_files": kept_files,
        "checkpoint_disposition": checkpoint_disposition,
    }


def validate_distillation_file_sets(root: Path, instruction: dict) -> None:
    candidate_files = instruction.get("candidate_files")
    kept_files = instruction.get("kept_files")
    if not isinstance(candidate_files, list) or not all(
        isinstance(item, str) for item in candidate_files
    ):
        raise StateError("Memory instruction is missing its frozen candidate file set.")
    if not isinstance(kept_files, list) or not all(isinstance(item, str) for item in kept_files):
        raise StateError("Memory instruction is missing its frozen kept file set.")
    for memory_file in candidate_files:
        if resolve_short_memory_path(root, memory_file).exists():
            raise StateError(f"Distillation candidate was not consumed: {memory_file}")
    for memory_file in kept_files:
        if not resolve_short_memory_path(root, memory_file).is_file():
            raise StateError(f"Short-memory file selected for retention is missing: {memory_file}")


def normalize_legacy_stage(stage: object) -> object:
    return LEGACY_STAGE_MAP.get(str(stage), stage)


def normalize_legacy_task(task: dict) -> bool:
    """Normalize pre-0.6 stage names without touching task artifacts outside task.json."""
    legacy_status = str(task.get("status") or "")
    changed = False

    if legacy_status in LEGACY_STAGE_MAP:
        task["status"] = LEGACY_STAGE_MAP[legacy_status]
        changed = True

    history = task.get("stage_history")
    if isinstance(history, list):
        normalized_history: list[dict] = []
        for raw_entry in history:
            if not isinstance(raw_entry, dict):
                continue
            entry = dict(raw_entry)
            mapped_stage = normalize_legacy_stage(entry.get("stage"))
            if mapped_stage != entry.get("stage"):
                entry["stage"] = mapped_stage
                changed = True
            if normalized_history and normalized_history[-1].get("stage") == entry.get("stage"):
                changed = True
                continue
            normalized_history.append(entry)
        if changed:
            task["stage_history"] = normalized_history

    if legacy_status == "WAITING_CONFIRM" and not task.get("pending_transition"):
        task["pending_transition"] = {
            "from": "ANALYSIS",
            "to": "IMPLEMENT",
            "requested_at": now_iso(),
            "requested_by": str(task.get("last_agent") or "legacy-migration"),
            "reason": "migrated-from-WAITING_CONFIRM",
        }
        changed = True

    if legacy_status == "MEMORY_LONG":
        progress = task.get("memory_progress")
        if not isinstance(progress, dict):
            progress = {}
        if progress.get("short_memory_written") is not True:
            progress["short_memory_written"] = True
            progress["legacy_short_memory_assumed"] = True
            progress["updated_at"] = now_iso()
            task["memory_progress"] = progress
            changed = True
        elif progress.get("legacy_short_memory_assumed") is not True:
            progress["legacy_short_memory_assumed"] = True
            progress["updated_at"] = now_iso()
            task["memory_progress"] = progress
            changed = True

    return changed


def write_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def resolve_session_path(root: Path, session_file: str | Path | None = None) -> Path:
    sessions_dir = (root / ".easy-coding" / "sessions").resolve()
    if session_file:
        path = Path(session_file)
        candidate = path if path.is_absolute() else root / path
        resolved = candidate.resolve()
        try:
            resolved.relative_to(sessions_dir)
        except ValueError as error:
            raise StateError(
                "Unsafe session file path: "
                f"{session_file}. Must be under .easy-coding/sessions/."
            ) from error
        if resolved == sessions_dir:
            raise StateError(
                "Unsafe session file path: "
                f"{session_file}. Must be a file under .easy-coding/sessions/."
            )
        return resolved
    return sessions_dir / f"{os.getppid()}.json"


def display_path(root: Path, path: Path) -> str:
    try:
        return path.resolve().relative_to(root.resolve()).as_posix()
    except ValueError:
        return path.as_posix()


def default_session() -> dict:
    return {"current_task": None, "created_at": now_iso()}


def clear_session_pointer(session: dict, agent: str | None = None) -> None:
    session["current_task"] = None
    session["last_seen_task"] = None
    session["last_seen_stage"] = "idle"
    if agent:
        session["last_agent"] = agent


def load_session(root: Path, session_file: str | Path | None = None) -> dict | None:
    return load_json(resolve_session_path(root, session_file))


def write_session(root: Path, session: dict, session_file: str | Path | None = None) -> None:
    write_json(resolve_session_path(root, session_file), session)


def task_json_path(root: Path, task_id: str) -> Path:
    assert_safe_task_id(task_id)
    return root / ".easy-coding" / "tasks" / task_id / "task.json"


def load_task(root: Path, task_id: str | None) -> dict | None:
    if not task_id:
        return None
    return load_json(task_json_path(root, str(task_id)))


def write_task(root: Path, task_id: str, task: dict) -> None:
    write_json(task_json_path(root, task_id), task)


def execution_log_path(root: Path, task_id: str) -> Path:
    assert_safe_task_id(task_id)
    return root / ".easy-coding" / "tasks" / task_id / "execution.jsonl"


def append_execution_record(root: Path, task_id: str, record: dict) -> None:
    path = execution_log_path(root, task_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(record, ensure_ascii=False) + "\n")


def is_non_empty_string(value: object) -> bool:
    return isinstance(value, str) and bool(value.strip())


def is_string_list(value: object, allow_empty: bool = True) -> bool:
    return (
        isinstance(value, list)
        and (allow_empty or len(value) > 0)
        and all(is_non_empty_string(item) for item in value)
    )


def has_acyclic_dependencies(dependencies_by_unit: dict[str, set[str]]) -> bool:
    remaining = {unit_id: set(dependencies) for unit_id, dependencies in dependencies_by_unit.items()}
    resolved: set[str] = set()
    while remaining:
        ready = {
            unit_id for unit_id, dependencies in remaining.items() if dependencies.issubset(resolved)
        }
        if not ready:
            return False
        resolved.update(ready)
        for unit_id in ready:
            remaining.pop(unit_id)
    return True


def is_valid_execution_plan(plan: object, allow_empty_files: bool = False) -> bool:
    if not isinstance(plan, dict):
        return False
    strategy = plan.get("strategy")
    units = plan.get("units")
    if strategy not in {"single", "sequential", "parallel"} or not isinstance(units, list):
        return False
    if not units or (strategy == "single" and len(units) != 1):
        return False
    if strategy == "parallel" and len(units) < 2:
        return False

    unit_ids: list[str] = []
    has_empty_file_scope = False
    for unit in units:
        if not isinstance(unit, dict):
            return False
        if not all(is_non_empty_string(unit.get(field)) for field in ("id", "title", "type")):
            return False
        if not is_string_list(unit.get("files"), allow_empty=allow_empty_files):
            return False
        if not unit["files"]:
            has_empty_file_scope = True
        if not is_string_list(unit.get("depends_on")):
            return False
        for optional_list in ("rules_sections", "abstract_modules"):
            if optional_list in unit and not is_string_list(unit.get(optional_list)):
                return False
        unit_ids.append(str(unit["id"]))

    if has_empty_file_scope and (not allow_empty_files or strategy != "single" or len(units) != 1):
        return False

    if len(set(unit_ids)) != len(unit_ids):
        return False
    known_ids = set(unit_ids)
    dependencies_by_unit: dict[str, set[str]] = {}
    for unit in units:
        unit_id = str(unit["id"])
        dependencies = set(unit["depends_on"])
        if unit_id in dependencies or not dependencies.issubset(known_ids):
            return False
        dependencies_by_unit[unit_id] = dependencies
    if not has_acyclic_dependencies(dependencies_by_unit):
        return False

    if strategy == "parallel":
        parallel_groups = plan.get("parallel_groups")
        if not isinstance(parallel_groups, list) or not parallel_groups:
            return False
        grouped_ids: list[str] = []
        group_levels: set[int] = set()
        level_by_unit: dict[str, int] = {}
        for group in parallel_groups:
            level = group.get("level") if isinstance(group, dict) else None
            if (
                not isinstance(group, dict)
                or type(level) is not int
                or level < 0
                or level in group_levels
                or not is_string_list(group.get("units"), allow_empty=False)
            ):
                return False
            group_levels.add(level)
            grouped_ids.extend(group["units"])
            for unit_id in group["units"]:
                level_by_unit[unit_id] = level
        if len(grouped_ids) != len(set(grouped_ids)) or set(grouped_ids) != known_ids:
            return False
        for unit_id, dependencies in dependencies_by_unit.items():
            if any(level_by_unit[dependency] >= level_by_unit[unit_id] for dependency in dependencies):
                return False

    return True


def is_read_only_execution_plan(plan: object) -> bool:
    return (
        is_valid_execution_plan(plan, allow_empty_files=True)
        and isinstance(plan, dict)
        and plan.get("strategy") == "single"
        and len(plan["units"]) == 1
        and plan["units"][0].get("files") == []
    )


def has_valid_execution_plan(root: Path, task_id: str) -> bool:
    path = execution_log_path(root, task_id)
    if not path.exists():
        return False
    latest_plan: dict | None = None
    try:
        for line in path.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            try:
                record = json.loads(line)
            except json.JSONDecodeError:
                return False
            if isinstance(record, dict) and record.get("type") == "plan":
                latest_plan = record
    except OSError:
        return False
    task = load_task(root, task_id)
    task_type = str(task.get("type") or "").strip().lower() if task else ""
    if task_type in NO_CODE_TASK_TYPES:
        return is_read_only_execution_plan(latest_plan)
    return is_valid_execution_plan(latest_plan)


def validate_read_only_completion(root: Path, task_id: str) -> None:
    task = load_task(root, task_id)
    task_type = str(task.get("type") or "").strip().lower() if task else ""
    reasons: list[str] = []
    if task_type not in NO_CODE_TASK_TYPES:
        reasons.append("task type is not doc, analysis, or report")

    path = execution_log_path(root, task_id)
    records: list[dict] = []
    if not path.exists():
        reasons.append("execution.jsonl is missing")
    else:
        try:
            for line in path.read_text(encoding="utf-8").splitlines():
                if not line.strip():
                    continue
                record = json.loads(line)
                if not isinstance(record, dict):
                    reasons.append("execution.jsonl contains a non-object record")
                    break
                records.append(record)
        except (OSError, json.JSONDecodeError):
            reasons.append("execution.jsonl cannot be read as valid JSONL")

    latest_plan_index: int | None = None
    for index, record in enumerate(records):
        if record.get("type") == "plan":
            latest_plan_index = index

    unit_id = ""
    if latest_plan_index is None:
        reasons.append("execution.jsonl has no plan record")
    else:
        plan = records[latest_plan_index]
        if not is_read_only_execution_plan(plan):
            reasons.append("latest plan record is invalid")
        else:
            units = plan["units"]
            unit_id = str(units[0]["id"])

    unit_records: list[dict] = []
    if latest_plan_index is not None and unit_id:
        for record in records[latest_plan_index + 1 :]:
            if record.get("unit_id") == unit_id and record.get("type") in {"dispatch", "result"}:
                unit_records.append(record)
    latest_result = (
        unit_records[-1]
        if unit_records and unit_records[-1].get("type") == "result"
        else None
    )
    if latest_result is None:
        reasons.append("latest read-only unit has no result record")
    else:
        matching_dispatch = unit_records[-2] if len(unit_records) >= 2 else None
        if matching_dispatch is None or matching_dispatch.get("type") != "dispatch":
            reasons.append("latest read-only result has no matching dispatch record")
        elif not is_non_empty_string(matching_dispatch.get("timestamp")):
            reasons.append("latest read-only dispatch record has no timestamp")
        if latest_result.get("changed_files") != []:
            reasons.append("read-only result must contain changed_files:[]")
        if not is_non_empty_string(latest_result.get("deliverable")):
            reasons.append("read-only result must contain a non-empty deliverable")
        if latest_result.get("issues") != []:
            reasons.append("read-only result must contain issues:[]")
        if latest_result.get("needs_attention") != []:
            reasons.append("read-only result must contain needs_attention:[]")

    if reasons:
        raise StateError(
            "Read-only IMPLEMENT cannot complete before its report is ready: " + "; ".join(reasons)
        )


def markdown_headings(content: str) -> list[tuple[int, int, str]]:
    headings: list[tuple[int, int, str]] = []
    fence_marker: str | None = None
    for index, line in enumerate(content.splitlines()):
        stripped = line.lstrip()
        if stripped.startswith(("```", "~~~")):
            marker = stripped[:3]
            if fence_marker is None:
                fence_marker = marker
            elif fence_marker == marker:
                fence_marker = None
            continue
        if fence_marker is not None:
            continue
        match = MARKDOWN_HEADING_PATTERN.match(line.strip())
        if match:
            headings.append((index, len(match.group(1)), match.group(2).strip()))
    return headings


def has_meaningful_markdown_body(content: str) -> bool:
    for line in content.splitlines():
        stripped = line.strip()
        if not stripped or MARKDOWN_HEADING_PATTERN.match(stripped):
            continue
        if stripped.startswith(">"):
            continue
        if re.fullmatch(r"[-|: ]+", stripped):
            continue
        if stripped == "（若 single：单一实施单元，派发 1 个子代理执行）":
            continue
        if stripped.startswith("|") and stripped.endswith("|"):
            cells = {cell.strip() for cell in stripped.strip("|").split("|") if cell.strip()}
            if cells and cells.issubset(TABLE_HEADER_CELLS):
                continue
        plain = re.sub(r"[`*_]", "", stripped)
        plain = re.sub(r"^[-+]\s*", "", plain).strip()
        if re.fullmatch(r"[^:：|]+[:：]", plain):
            continue
        return True
    return False


def validate_mandatory_dev_spec_sections(content: str) -> tuple[list[str], list[str]]:
    lines = content.splitlines()
    headings = markdown_headings(content)
    missing: list[str] = []
    empty: list[str] = []

    title_heading = next(
        (
            (line_index, level, title)
            for line_index, level, title in headings
            if level == 2 and (title == "技术方案" or title.startswith(("技术方案：", "技术方案:")))
        ),
        None,
    )
    if title_heading is None:
        missing.append("## 技术方案")
    else:
        title = title_heading[2]
        title_value = title.removeprefix("技术方案").lstrip("：:").strip()
        if not title_value:
            empty.append("## 技术方案")

    for header in MANDATORY_DEV_SPEC_HEADERS[1:]:
        expected_title = header.removeprefix("### ")
        heading_index = next(
            (
                index
                for index, (_, level, title) in enumerate(headings)
                if level == 3 and title == expected_title
            ),
            None,
        )
        if heading_index is None:
            missing.append(header)
            continue
        line_index, level, _ = headings[heading_index]
        next_line_index = len(lines)
        for candidate_line, candidate_level, _ in headings[heading_index + 1 :]:
            if candidate_level <= level:
                next_line_index = candidate_line
                break
        body = "\n".join(lines[line_index + 1 : next_line_index])
        if not has_meaningful_markdown_body(body):
            empty.append(header)

    return missing, empty


def validate_analysis_readiness(root: Path, task_id: str) -> None:
    task_dir = task_json_path(root, task_id).parent
    task = load_task(root, task_id)
    task_type = str(task.get("type") or "").strip().lower() if task else ""
    is_read_only_task = task_type in NO_CODE_TASK_TYPES
    dev_spec = task_dir / "dev-spec.md"
    skeleton = root / ".easy-coding" / "templates" / "dev-spec-skeleton.md"
    test_strategy = task_dir / "test-strategy.md"
    reasons: list[str] = []

    dev_spec_content = ""
    if not dev_spec.exists():
        reasons.append("dev-spec.md is missing")
    else:
        try:
            dev_spec_content = dev_spec.read_text(encoding="utf-8")
            if not dev_spec_content.strip():
                reasons.append("dev-spec.md is empty")
        except OSError:
            reasons.append("dev-spec.md cannot be read")

    if dev_spec_content:
        missing_headers, empty_sections = validate_mandatory_dev_spec_sections(dev_spec_content)
        if is_read_only_task:
            empty_sections = [
                header for header in empty_sections if header != "### 改动范围"
            ]
        if missing_headers:
            reasons.append(
                "dev-spec.md is missing mandatory headers: "
                + ", ".join(header.lstrip("# ") for header in missing_headers)
            )
        if empty_sections:
            reasons.append(
                "dev-spec.md has empty mandatory sections: "
                + ", ".join(header.lstrip("# ") for header in empty_sections)
            )
        if "[阶段：ANALYSIS]" in dev_spec_content or "### 待用户决策" in dev_spec_content:
            reasons.append("dev-spec.md contains forbidden analysis-only sections")

        if not skeleton.exists():
            reasons.append("dev-spec skeleton template is missing")
        else:
            try:
                skeleton_content = skeleton.read_text(encoding="utf-8")
                if not DEV_SPEC_PLACEHOLDER_PATTERN.search(skeleton_content):
                    reasons.append("dev-spec skeleton template has no EC_TODO markers")
                if DEV_SPEC_PLACEHOLDER_PATTERN.search(dev_spec_content):
                    reasons.append("dev-spec.md contains unresolved template placeholders")
            except OSError:
                reasons.append("dev-spec skeleton template cannot be read")

    if not has_valid_execution_plan(root, task_id):
        reasons.append("execution.jsonl has no valid plan record")
    if is_read_only_task:
        if test_strategy.exists():
            reasons.append("read-only task must not create test-strategy.md")
    else:
        try:
            if not test_strategy.exists() or not test_strategy.read_text(encoding="utf-8").strip():
                reasons.append("test-strategy.md is missing or empty")
        except OSError:
            reasons.append("test-strategy.md cannot be read")

    if reasons:
        raise StateError(
            "ANALYSIS cannot advance to IMPLEMENT before analysis artifacts are ready: "
            + "; ".join(reasons)
        )


def latest_handoff_record(root: Path, task_id: str) -> dict | None:
    path = execution_log_path(root, task_id)
    if not path.exists():
        return None
    latest: dict | None = None
    try:
        for line in path.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            try:
                record = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(record, dict) and record.get("type") == "handoff":
                latest = record
    except OSError:
        return None
    return latest


def assert_safe_task_id(task_id: str) -> None:
    path = Path(task_id)
    if not task_id or path.is_absolute() or "/" in task_id or "\\" in task_id or ".." in path.parts:
        raise StateError(f"Unsafe task id: {task_id}")


def is_project_init_required(root: Path) -> bool:
    project_init = load_json(root / ".easy-coding" / "tasks" / "project-init" / "task.json")
    return bool(project_init and project_init.get("status") != "COMPLETE")


def get_pending_init_version(root: Path) -> str | None:
    project_init = load_json(root / ".easy-coding" / "tasks" / "project-init" / "task.json")
    if project_init and project_init.get("pending_init_since"):
        return str(project_init["pending_init_since"])
    return None


def transition_requires_confirmation(
    previous: str,
    current: str,
    task_type: str,
    confirm_mode: str,
) -> bool:
    if (previous, current) in ALWAYS_AUTO_TRANSITIONS:
        return False
    if current == "CLOSED":
        return True
    if confirm_mode == "auto":
        return False
    if confirm_mode == "guard":
        return (previous, current) in GUARD_CONFIRM_TRANSITIONS
    if confirm_mode == "approve":
        return True
    raise StateError(f"Unknown confirm mode: {confirm_mode}")


def is_automatic_transition(
    previous: str,
    current: str,
    task_type: str,
    confirm_mode: str,
) -> bool:
    return not transition_requires_confirmation(previous, current, task_type, confirm_mode)


def validate_transition(previous: str, current: str, task_type: str = "") -> str | None:
    if previous == current:
        return None
    normalized_task_type = task_type.strip().lower()
    allowed = set(VALID_TRANSITIONS.get(previous, set()))
    if previous == "IMPLEMENT" and normalized_task_type in NO_CODE_TASK_TYPES:
        allowed = {"ANALYSIS", "COMPLETE", "CLOSED"}
    elif previous == "IMPLEMENT":
        allowed.discard("COMPLETE")
    if current in allowed:
        return None
    return (
        f"ILLEGAL TRANSITION: {previous} -> {current}. "
        f"Allowed from {previous}: {sorted(allowed) or 'NONE (terminal state)'}."
    )


def snapshot_state(
    root: Path,
    session_file: str | Path | None = None,
    session: dict | None = None,
) -> dict:
    session_path = resolve_session_path(root, session_file)
    resolved_session = session if session is not None else load_session(root, session_path)
    if resolved_session is None:
        resolved_session = default_session()

    task_id = resolved_session.get("current_task")
    task = load_task(root, str(task_id)) if task_id else None
    missing = bool(task_id and task is None)
    status = "idle"
    if missing:
        status = "MISSING"
    elif task and task.get("status"):
        status = str(task["status"])

    if task_id and task and status in TERMINAL_STATUSES:
        clear_session_pointer(resolved_session, task.get("last_agent"))
        write_session(root, resolved_session, session_path)
        task_id = None
        task = None
        missing = False
        status = "idle"

    project_confirm_mode, session_confirm_mode, effective_confirm_mode = resolve_confirm_mode(
        root, resolved_session
    )

    return {
        "session_file": display_path(root, session_path),
        "current_task": str(task_id) if task_id else None,
        "task": task,
        "pending_transition": task.get("pending_transition") if task else None,
        "memory_progress": task.get("memory_progress") if task else None,
        "task_missing": missing,
        "status": status,
        "is_terminal": status in TERMINAL_STATUSES,
        "last_agent": task.get("last_agent") if task else None,
        "project_init_required": is_project_init_required(root),
        "pending_init_version": get_pending_init_version(root),
        "project_confirm_mode": project_confirm_mode,
        "session_confirm_mode": session_confirm_mode,
        "effective_confirm_mode": effective_confirm_mode,
        "harness_disabled": resolved_session.get("harness_disabled") is True,
    }


def build_status_line(
    root: Path,
    session: dict,
    agent: str | None = None,
    session_file: str | Path | None = None,
) -> str:
    state = snapshot_state(root, session_file, session)
    task_id = state["current_task"]
    if task_id:
        status = str(state["status"])
        line = f"> **Easy Coding** · `{task_id}` · `{status}`"
        last_agent = state.get("last_agent")
        if agent and last_agent and last_agent != agent:
            line += f" · Handoff -> `{last_agent}`"
        if state["is_terminal"] or state["task_missing"]:
            line += f" · {HELP_SUFFIX}"
        return line

    if is_project_init_required(root):
        return WAITING_INIT_LINE

    pending = get_pending_init_version(root)
    if pending:
        return (
            f"> **Easy Coding** · Waiting init · "
            f"Upgrade to v{pending} — run `ec-init` to adapt"
        )

    return READY_LINE


def build_machine_breadcrumbs(
    root: Path,
    session: dict,
    agent: str | None = None,
    session_file: str | Path | None = None,
) -> list[str]:
    state = snapshot_state(root, session_file, session)
    task_id = state["current_task"]
    task = state["task"]
    stage = str(state["status"]) if task else "idle"
    resolved_session_file = str(state["session_file"])
    lines = [
        f"[workflow-state:{stage}]",
        f"[easy-coding:session-file:{resolved_session_file}]",
        f"[easy-coding:confirm-mode:{state['effective_confirm_mode']}]",
    ]

    if task_id:
        lines.append(f"[current-task:{task_id}]")
        if state["task_missing"]:
            lines.append(f"[easy-coding:current-task-missing:{task_id}]")
        last_agent = state.get("last_agent")
        if agent and last_agent and last_agent != agent:
            lines.append(f"[easy-coding:handoff-from:{last_agent}]")
        pending = state.get("pending_transition")
        if isinstance(pending, dict):
            source = str(pending.get("from") or stage)
            target = str(pending.get("to") or "")
            if target:
                lines.append(f"[easy-coding:pending-transition:{source}->{target}]")
                task_type = str(task.get("type") or "") if task else ""
                if is_automatic_transition(
                    source,
                    target,
                    task_type,
                    str(state["effective_confirm_mode"]),
                ):
                    lines.append(f"[easy-coding:auto-transition-ready:{source}->{target}]")
                else:
                    lines.append("[easy-coding:transition-confirmation-required]")

    if is_project_init_required(root):
        lines.append("[easy-coding:init-required]")
    else:
        pending = get_pending_init_version(root)
        if pending:
            lines.append(f"[easy-coding:upgrade-init-pending:{pending}]")

    # Stage-specific reminders
    if stage == "ANALYSIS" and task_id:
        dev_spec = root / ".easy-coding" / "tasks" / str(task_id) / "dev-spec.md"
        if dev_spec.exists():
            try:
                content = dev_spec.read_text(encoding="utf-8")
                missing = [h for h in MANDATORY_DEV_SPEC_HEADERS if h not in content]
                if missing:
                    names = ",".join(h.lstrip("#").strip() for h in missing)
                    lines.append(f"[easy-coding:analysis-template-drift:missing:{names}]")
                else:
                    lines.append("[easy-coding:analysis-template-ok]")
            except OSError:
                lines.append("[easy-coding:analysis-gate:skeleton-first-then-fill]")
        else:
            lines.append("[easy-coding:analysis-gate:skeleton-first-then-fill]")

    # State machine validation
    if task_id and task and task.get("status"):
        current_stage = str(task["status"])
        last_seen = session.get("last_seen_stage")
        violation = record_seen_stage(root, str(task_id), current_stage, resolved_session_file)
        if violation:
            lines.append(f"[ILLEGAL-TRANSITION:{last_seen}->{current_stage}]")
            lines.append(f"[easy-coding:transition-error:{violation}]")

    return lines


def build_status_context(
    root: Path,
    session: dict,
    agent: str | None = None,
    session_file: str | Path | None = None,
) -> str:
    if session.get("harness_disabled") is True:
        session_path = resolve_session_path(root, session_file)
        return "\n".join(
            [
                "[easy-coding:no-harness]",
                f"[easy-coding:session-file:{display_path(root, session_path)}]",
            ]
        )
    return "\n".join(
        [
            build_status_line(root, session, agent, session_file),
            *build_machine_breadcrumbs(root, session, agent, session_file),
        ]
    )


def attach_status_context(
    root: Path,
    data: dict,
    agent: str | None = None,
    session_file: str | Path | None = None,
) -> dict:
    resolved_session_file = session_file or data.get("session_file")
    session = load_session(root, resolved_session_file)
    if session is None:
        session = default_session()
    context = build_status_context(root, session, agent, resolved_session_file)
    first_line = context.splitlines()[0] if context.startswith("> ") else ""
    enriched = dict(data)
    enriched["status_line"] = first_line
    enriched["status_context"] = context
    return enriched


def task_claim_action(task: dict, agent: str | None) -> str | None:
    status = str(task.get("status") or "PENDING")
    if status in TERMINAL_STATUSES or not agent:
        return None
    last_agent = task.get("last_agent")
    return "continue" if not last_agent or last_agent == agent else "takeover"


def list_tasks(root: Path, agent: str | None = None) -> list[dict]:
    tasks_dir = root / ".easy-coding" / "tasks"
    if not tasks_dir.is_dir():
        return []
    items: list[dict] = []
    for entry in sorted(tasks_dir.iterdir(), key=lambda item: item.name):
        if not entry.is_dir():
            continue
        task = load_json(entry / "task.json")
        if not task:
            continue
        status = str(task.get("status") or "PENDING")
        action = task_claim_action(task, agent)
        last_agent = task.get("last_agent")
        items.append(
            {
                "id": entry.name,
                "title": task.get("title"),
                "type": task.get("type"),
                "status": status,
                "active": status not in TERMINAL_STATUSES,
                "created_at": task.get("created_at"),
                "last_agent": last_agent,
                "action": action,
                "previous_agent": last_agent if action == "takeover" else None,
                "latest_handoff": latest_handoff_record(root, entry.name),
            }
        )
    return items


def ensure_session(root: Path, session_file: str | Path | None = None) -> dict:
    session = load_session(root, session_file)
    if session is None:
        session = default_session()
    if not session.get("created_at"):
        session["created_at"] = now_iso()
    return session


def set_current_task(root: Path, task_id: str, agent: str, session_file: str | Path | None = None) -> dict:
    task = load_task(root, task_id)
    if task is None:
        raise StateError(f"Task not found: {task_id}")
    session = ensure_session(root, session_file)
    session["current_task"] = task_id
    session["last_seen_task"] = task_id
    session["last_seen_stage"] = str(task.get("status") or "PENDING")
    session["last_agent"] = agent
    write_session(root, session, session_file)
    return snapshot_state(root, session_file, session)


def clear_current_task(root: Path, agent: str, session_file: str | Path | None = None) -> dict:
    session = ensure_session(root, session_file)
    clear_session_pointer(session, agent)
    write_session(root, session, session_file)
    return snapshot_state(root, session_file, session)


def set_session_confirm_mode(
    root: Path,
    mode: str,
    agent: str,
    session_file: str | Path | None = None,
) -> dict:
    if mode not in CONFIRM_MODES:
        raise StateError("Invalid confirm mode: expected approve, guard, or auto.")
    session = ensure_session(root, session_file)
    session["confirm_mode"] = mode
    session["last_agent"] = agent
    write_session(root, session, session_file)
    snapshot = snapshot_state(root, session_file, session)
    snapshot["action"] = "set-confirm-mode"
    return snapshot


def clear_session_confirm_mode(
    root: Path,
    agent: str,
    session_file: str | Path | None = None,
) -> dict:
    session = ensure_session(root, session_file)
    session.pop("confirm_mode", None)
    session["last_agent"] = agent
    write_session(root, session, session_file)
    snapshot = snapshot_state(root, session_file, session)
    snapshot["action"] = "clear-confirm-mode"
    return snapshot


def set_harness_disabled(
    root: Path,
    disabled: bool,
    agent: str,
    session_file: str | Path | None = None,
) -> dict:
    session = ensure_session(root, session_file)
    if disabled:
        session["harness_disabled"] = True
    else:
        session.pop("harness_disabled", None)
    session["last_agent"] = agent
    write_session(root, session, session_file)
    snapshot = snapshot_state(root, session_file, session)
    snapshot["action"] = "disable-harness" if disabled else "enable-harness"
    return snapshot


def handoff_task(
    root: Path,
    agent: str,
    summary: str,
    task_id: str | None = None,
    session_file: str | Path | None = None,
) -> dict:
    if not summary.strip():
        raise StateError("Handoff summary is required.")
    session = ensure_session(root, session_file)
    resolved_task_id = task_id or session.get("current_task")
    if not resolved_task_id:
        raise StateError("No current task is set.")
    task = load_task(root, str(resolved_task_id))
    if task is None:
        raise StateError(f"Task not found: {resolved_task_id}")
    stage = str(task.get("status") or "PENDING")
    if stage in TERMINAL_STATUSES:
        raise StateError(f"Cannot hand off terminal task: {resolved_task_id}")

    record = {
        "type": "handoff",
        "from": agent,
        "stage": stage,
        "summary": summary.strip(),
        "timestamp": now_iso(),
    }
    append_execution_record(root, str(resolved_task_id), record)
    task["last_agent"] = agent
    write_task(root, str(resolved_task_id), task)

    if session.get("current_task") == resolved_task_id:
        clear_session_pointer(session, agent)
        write_session(root, session, session_file)

    snapshot = snapshot_state(root, session_file, session)
    snapshot["task_id"] = str(resolved_task_id)
    snapshot["handoff"] = record
    snapshot["action"] = "handoff"
    return snapshot


def claim_task(root: Path, task_id: str, agent: str, session_file: str | Path | None = None) -> dict:
    task = load_task(root, task_id)
    if task is None:
        raise StateError(f"Task not found: {task_id}")
    status = str(task.get("status") or "PENDING")
    if status in TERMINAL_STATUSES:
        raise StateError(f"Cannot claim terminal task: {task_id}")

    previous_agent = task.get("last_agent")
    action = "continue" if not previous_agent or previous_agent == agent else "takeover"
    latest_handoff = latest_handoff_record(root, task_id)
    task["last_agent"] = agent
    write_task(root, task_id, task)

    session = ensure_session(root, session_file)
    session["current_task"] = task_id
    session["last_seen_task"] = task_id
    session["last_seen_stage"] = status
    session["last_agent"] = agent
    write_session(root, session, session_file)

    snapshot = snapshot_state(root, session_file, session)
    snapshot["task_id"] = task_id
    snapshot["action"] = action
    snapshot["previous_agent"] = previous_agent
    snapshot["latest_handoff"] = latest_handoff
    return snapshot


def create_task(
    root: Path,
    task_id: str,
    task_type: str,
    title: str,
    agent: str,
    set_current: bool = True,
    session_file: str | Path | None = None,
) -> dict:
    assert_safe_task_id(task_id)
    if set_current:
        resolve_session_path(root, session_file)
    path = task_json_path(root, task_id)
    if path.exists():
        raise StateError(f"Task already exists: {task_id}")
    timestamp = now_iso()
    task = {
        "type": task_type,
        "title": title,
        "status": "INIT",
        "created_at": timestamp,
        "created_by": agent,
        "last_agent": agent,
        "stage_history": [{"stage": "INIT", "agent": agent, "entered_at": timestamp}],
        "context": {},
        "spawned_from": None,
        "spawned_tasks": [],
        "closed_reason": None,
        "repos": [],
    }
    write_task(root, task_id, task)
    if set_current:
        return set_current_task(root, task_id, agent, session_file)
    return {"task_id": task_id, "task": task}


def append_stage_history(task: dict, stage: str, agent: str) -> None:
    history = task.setdefault("stage_history", [])
    history.append({"stage": stage, "agent": agent, "entered_at": now_iso()})


def resolve_current_task(
    root: Path,
    task_id: str | None = None,
    session_file: str | Path | None = None,
) -> tuple[dict, str, dict]:
    session = ensure_session(root, session_file)
    resolved_task_id = task_id or session.get("current_task")
    if not resolved_task_id:
        raise StateError("No current task is set.")
    task = load_task(root, str(resolved_task_id))
    if task is None:
        raise StateError(f"Task not found: {resolved_task_id}")
    return session, str(resolved_task_id), task


def request_transition(
    root: Path,
    stage: str,
    agent: str,
    task_id: str | None = None,
    session_file: str | Path | None = None,
    reason: str | None = None,
) -> dict:
    if stage not in VALID_TRANSITIONS:
        raise StateError(f"Unknown stage: {stage}")
    session, resolved_task_id, task = resolve_current_task(root, task_id, session_file)
    previous = str(task.get("status") or "idle")
    task_type = str(task.get("type") or "")
    confirm_mode = resolve_confirm_mode(root, session)[2]
    if previous == stage:
        raise StateError(f"Transition target must differ from current stage: {stage}")

    violation = validate_transition(previous, stage, task_type)
    if violation:
        raise StateError(violation)
    if is_automatic_transition(previous, stage, task_type, confirm_mode):
        raise StateError(
            f"Transition {previous} -> {stage} is automatic in {confirm_mode} mode; "
            "use auto-transition instead."
        )
    if previous == "ANALYSIS" and stage == "IMPLEMENT":
        validate_analysis_readiness(root, resolved_task_id)
    existing = task.get("pending_transition")
    if isinstance(existing, dict):
        if existing.get("from") != previous or existing.get("to") != stage:
            raise StateError(
                "A different transition is already pending. Cancel it before requesting another."
            )
    else:
        task["pending_transition"] = {
            "from": previous,
            "to": stage,
            "requested_at": now_iso(),
            "requested_by": agent,
            **({"reason": reason.strip()} if reason and reason.strip() else {}),
        }
        task["last_agent"] = agent
        write_task(root, resolved_task_id, task)

    snapshot = snapshot_state(root, session_file, session)
    snapshot["action"] = "request-transition"
    return snapshot


def apply_transition(
    root: Path,
    stage: str,
    agent: str,
    task_id: str | None = None,
    session_file: str | Path | None = None,
) -> dict:
    if stage not in VALID_TRANSITIONS:
        raise StateError(f"Unknown stage: {stage}")
    session, resolved_task_id, task = resolve_current_task(root, task_id, session_file)

    previous = str(task.get("status") or "idle")
    task_type = str(task.get("type") or "")
    violation = validate_transition(previous, stage, task_type)
    if violation:
        raise StateError(violation)
    if previous == "ANALYSIS" and stage == "IMPLEMENT":
        validate_analysis_readiness(root, resolved_task_id)
    if previous == "MEMORY" and stage == "COMPLETE":
        progress = task.get("memory_progress")
        if not isinstance(progress, dict) or progress.get("completed") is not True:
            raise StateError("MEMORY cannot advance to COMPLETE before memory processing completes.")
    if (previous, stage) == READ_ONLY_COMPLETION_TRANSITION:
        validate_read_only_completion(root, resolved_task_id)
    if previous != stage:
        task["status"] = stage
        append_stage_history(task, stage, agent)
    task.pop("pending_transition", None)
    if stage == "MEMORY" and previous != stage:
        task["memory_progress"] = {}
    task["last_agent"] = agent
    write_task(root, resolved_task_id, task)

    if session.get("current_task") == resolved_task_id:
        if stage in TERMINAL_STATUSES:
            clear_session_pointer(session, agent)
        else:
            session["last_seen_task"] = resolved_task_id
            session["last_seen_stage"] = stage
            session["last_agent"] = agent
        write_session(root, session, session_file)
    return snapshot_state(root, session_file, session)


def auto_transition(
    root: Path,
    stage: str,
    agent: str,
    task_id: str | None = None,
    session_file: str | Path | None = None,
) -> dict:
    session, _, task = resolve_current_task(root, task_id, session_file)
    previous = str(task.get("status") or "idle")
    task_type = str(task.get("type") or "")
    confirm_mode = resolve_confirm_mode(root, session)[2]
    if not is_automatic_transition(previous, stage, task_type, confirm_mode):
        raise StateError(
            f"Automatic transition is not allowed in {confirm_mode} mode: {previous} -> {stage}."
        )

    pending = task.get("pending_transition")
    if isinstance(pending, dict) and (
        pending.get("from") != previous or pending.get("to") != stage
    ):
        raise StateError(
            "A different transition is already pending. Cancel it before automatic transition."
        )

    snapshot = apply_transition(root, stage, agent, task_id, session_file)
    snapshot["action"] = "auto-transition"
    snapshot["automatic_transition"] = {"from": previous, "to": stage}
    return snapshot


def confirm_transition(
    root: Path,
    agent: str,
    stage: str | None = None,
    task_id: str | None = None,
    session_file: str | Path | None = None,
) -> dict:
    session, _, task = resolve_current_task(root, task_id, session_file)
    pending = task.get("pending_transition")
    if not isinstance(pending, dict):
        raise StateError("No transition is pending user confirmation.")
    previous = str(task.get("status") or "idle")
    task_type = str(task.get("type") or "")
    confirm_mode = resolve_confirm_mode(root, session)[2]
    source = str(pending.get("from") or "")
    target = str(pending.get("to") or "")
    if source != previous:
        raise StateError(
            f"Pending transition source {source or 'missing'} does not match current stage {previous}."
        )
    if stage and stage != target:
        raise StateError(f"Pending transition targets {target}, not {stage}.")
    if is_automatic_transition(source, target, task_type, confirm_mode):
        raise StateError(
            f"Transition {source} -> {target} is automatic in {confirm_mode} mode; "
            "use auto-transition instead."
        )

    snapshot = apply_transition(root, target, agent, task_id, session_file)
    snapshot["action"] = "confirm-transition"
    snapshot["confirmed_transition"] = {"from": source, "to": target}
    return snapshot


def cancel_transition(
    root: Path,
    agent: str,
    task_id: str | None = None,
    session_file: str | Path | None = None,
) -> dict:
    session, resolved_task_id, task = resolve_current_task(root, task_id, session_file)
    pending = task.pop("pending_transition", None)
    task["last_agent"] = agent
    write_task(root, resolved_task_id, task)
    snapshot = snapshot_state(root, session_file, session)
    snapshot["action"] = "cancel-transition"
    snapshot["cancelled_transition"] = pending
    return snapshot


def memory_short_complete(
    root: Path,
    memory_file: str,
    agent: str,
    task_id: str | None = None,
    session_file: str | Path | None = None,
) -> dict:
    session, resolved_task_id, task = resolve_current_task(root, task_id, session_file)
    if task.get("status") != "MEMORY":
        raise StateError("Short-memory progress can only be recorded during MEMORY.")
    if not memory_file.strip():
        raise StateError("Short-memory file is required.")
    resolved_memory_path, digest = validate_short_memory_file(
        root, resolved_task_id, memory_file.strip()
    )
    progress = task.get("memory_progress")
    if not isinstance(progress, dict):
        progress = {}
    checkpoint_file = display_path(root, resolved_memory_path)
    if (
        progress.get("short_memory_written") is True
        and progress.get("legacy_short_memory_assumed") is not True
    ):
        if (
            progress.get("short_memory_file") == checkpoint_file
            and progress.get("short_memory_sha256") == digest
        ):
            snapshot = snapshot_state(root, session_file, session)
            snapshot["action"] = "memory-short-complete"
            snapshot["checkpoint_unchanged"] = True
            return snapshot
        raise StateError("A different short-memory checkpoint is already recorded for this task.")
    progress["short_memory_written"] = True
    progress["short_memory_file"] = checkpoint_file
    progress["short_memory_sha256"] = digest
    progress.pop("legacy_short_memory_assumed", None)
    progress["updated_at"] = now_iso()
    task["memory_progress"] = progress
    task["last_agent"] = agent
    write_task(root, resolved_task_id, task)
    snapshot = snapshot_state(root, session_file, session)
    snapshot["action"] = "memory-short-complete"
    return snapshot


def memory_instruction(
    root: Path,
    task_id: str | None = None,
    session_file: str | Path | None = None,
) -> dict:
    session, resolved_task_id, task = resolve_current_task(root, task_id, session_file)
    if task.get("status") != "MEMORY":
        raise StateError("Memory instruction is only available during MEMORY.")
    progress = task.get("memory_progress")
    if not isinstance(progress, dict) or progress.get("short_memory_written") is not True:
        raise StateError("Write and record the short memory before requesting memory instruction.")
    instruction = progress.get("instruction")
    allow_missing_checkpoint = bool(
        isinstance(instruction, dict)
        and instruction.get("action") == "distill"
        and instruction.get("checkpoint_disposition") == "candidate"
    )
    validate_recorded_short_memory(
        root,
        resolved_task_id,
        progress,
        allow_missing_after_distill=allow_missing_checkpoint,
    )
    if not isinstance(instruction, dict):
        legacy_checkpoint = progress.get("legacy_short_memory_assumed") is True
        checkpoint_file = None if legacy_checkpoint else str(progress.get("short_memory_file"))
        instruction = build_memory_instruction(root, checkpoint_file, legacy_checkpoint)
        progress["instruction"] = instruction
        progress["updated_at"] = now_iso()
        task["memory_progress"] = progress
        write_task(root, resolved_task_id, task)
    snapshot = snapshot_state(root, session_file, session)
    snapshot["memory"] = instruction
    snapshot["action"] = "memory-instruction"
    return snapshot


def memory_complete(
    root: Path,
    action: str,
    agent: str,
    task_id: str | None = None,
    session_file: str | Path | None = None,
) -> dict:
    if action not in {"no-op", "distill"}:
        raise StateError(f"Unknown memory action: {action}")
    session, resolved_task_id, task = resolve_current_task(root, task_id, session_file)
    if task.get("status") != "MEMORY":
        raise StateError("Memory completion can only be recorded during MEMORY.")
    progress = task.get("memory_progress")
    if not isinstance(progress, dict) or progress.get("short_memory_written") is not True:
        raise StateError("Short memory must be recorded before MEMORY can complete.")
    instruction = progress.get("instruction")
    if not isinstance(instruction, dict):
        raise StateError("Request the authoritative memory instruction before completing MEMORY.")
    if instruction["action"] != action:
        raise StateError(
            f"Memory action {action} does not match authoritative instruction {instruction['action']}."
        )
    validate_recorded_short_memory(
        root,
        resolved_task_id,
        progress,
        allow_missing_after_distill=(
            action == "distill" and instruction.get("checkpoint_disposition") == "candidate"
        ),
    )
    if action == "distill":
        validate_distillation_file_sets(root, instruction)
    progress["long_memory_action"] = action
    progress["completed"] = True
    progress["updated_at"] = now_iso()
    task["memory_progress"] = progress
    task["last_agent"] = agent
    write_task(root, resolved_task_id, task)
    snapshot = snapshot_state(root, session_file, session)
    snapshot["memory"] = instruction
    snapshot["action"] = "memory-complete"
    return snapshot


def close_current_task(
    root: Path,
    reason: str,
    agent: str,
    session_file: str | Path | None = None,
) -> dict:
    session = ensure_session(root, session_file)
    task_id = session.get("current_task")
    if not task_id:
        raise StateError("No current task is set.")
    task = load_task(root, str(task_id))
    if task is None:
        raise StateError(f"Task not found: {task_id}")
    if task.get("status") != "CLOSED":
        task["status"] = "CLOSED"
        append_stage_history(task, "CLOSED", agent)
    task.pop("pending_transition", None)
    task["closed_reason"] = reason
    task["last_agent"] = agent
    write_task(root, str(task_id), task)
    clear_session_pointer(session, agent)
    write_session(root, session, session_file)
    return snapshot_state(root, session_file, session)


def project_init_complete(root: Path, agent: str) -> dict:
    task_id = "project-init"
    task = load_task(root, task_id)
    if task is None:
        raise StateError("project-init task not found.")
    if task.get("status") != "COMPLETE":
        task["status"] = "COMPLETE"
        append_stage_history(task, "COMPLETE", agent)
    task["last_agent"] = agent
    task.pop("pending_init_since", None)
    write_task(root, task_id, task)
    return {"task_id": task_id, "task": task}


def set_repo_path(
    root: Path,
    repo: str,
    repo_path: str,
    task_id: str | None = None,
    session_file: str | Path | None = None,
) -> dict:
    session = ensure_session(root, session_file)
    resolved_task_id = task_id or session.get("current_task")
    if not resolved_task_id:
        raise StateError("No current task is set.")
    task = load_task(root, str(resolved_task_id))
    if task is None:
        raise StateError(f"Task not found: {resolved_task_id}")
    repo_paths = task.setdefault("repo_paths", {})
    repo_paths[repo] = repo_path
    write_task(root, str(resolved_task_id), task)
    return {"task_id": str(resolved_task_id), "repo_paths": repo_paths}


def record_seen_stage(
    root: Path,
    task_id: str | None,
    stage: str,
    session_file: str | Path | None = None,
) -> str | None:
    if not task_id or stage in {"idle", "MISSING"}:
        return None
    session = ensure_session(root, session_file)
    last_seen_task = session.get("last_seen_task")
    last_seen_stage = session.get("last_seen_stage")

    violation = None
    if last_seen_task == task_id and last_seen_stage:
        task = load_task(root, task_id)
        task_type = str(task.get("type") or "") if task else ""
        violation = validate_transition(str(last_seen_stage), stage, task_type)

    if last_seen_task != task_id or last_seen_stage != stage:
        session["last_seen_task"] = task_id
        session["last_seen_stage"] = stage
        write_session(root, session, session_file)

    return violation


def resolve_root(cwd: str | None) -> Path:
    root = find_ec_root(Path(cwd or os.getcwd()))
    if root is None:
        raise StateError("No .easy-coding directory found from cwd.")
    return root


def emit(data: dict | list) -> None:
    print(json.dumps(data, ensure_ascii=False, indent=2))


def add_common_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--cwd", help="Project directory or a path under it.")
    parser.add_argument("--session-file", help="Session file path injected by the hook.")


def main() -> int:
    configure_stdio()
    common = argparse.ArgumentParser(add_help=False)
    add_common_args(common)
    parser = argparse.ArgumentParser(description="Easy Coding runtime state API")
    subcommands = parser.add_subparsers(dest="command")

    subcommands.add_parser("snapshot", parents=[common])

    list_tasks_parser = subcommands.add_parser("list-tasks", parents=[common])
    list_tasks_parser.add_argument("--agent")

    create = subcommands.add_parser("create-task", parents=[common])
    create.add_argument("--task-id", required=True)
    create.add_argument("--type", required=True)
    create.add_argument("--title", required=True)
    create.add_argument("--agent", required=True)
    create.add_argument("--no-set-current", action="store_true")

    set_current = subcommands.add_parser("set-current", parents=[common])
    set_current.add_argument("--task-id", required=True)
    set_current.add_argument("--agent", required=True)

    clear_current = subcommands.add_parser("clear-current", parents=[common])
    clear_current.add_argument("--agent", required=True)

    set_confirm_mode_parser = subcommands.add_parser("set-confirm-mode", parents=[common])
    set_confirm_mode_parser.add_argument("--mode", required=True, choices=sorted(CONFIRM_MODES))
    set_confirm_mode_parser.add_argument("--agent", required=True)

    clear_confirm_mode_parser = subcommands.add_parser("clear-confirm-mode", parents=[common])
    clear_confirm_mode_parser.add_argument("--agent", required=True)

    disable_harness_parser = subcommands.add_parser("disable-harness", parents=[common])
    disable_harness_parser.add_argument("--agent", required=True)

    enable_harness_parser = subcommands.add_parser("enable-harness", parents=[common])
    enable_harness_parser.add_argument("--agent", required=True)

    handoff = subcommands.add_parser("handoff-task", parents=[common])
    handoff.add_argument("--agent", required=True)
    handoff.add_argument("--summary", required=True)
    handoff.add_argument("--task-id")

    claim = subcommands.add_parser("claim-task", parents=[common])
    claim.add_argument("--task-id", required=True)
    claim.add_argument("--agent", required=True)

    request = subcommands.add_parser("request-transition", parents=[common])
    request.add_argument("--stage", required=True)
    request.add_argument("--agent", required=True)
    request.add_argument("--task-id")
    request.add_argument("--reason")

    confirm_transition_parser = subcommands.add_parser("confirm-transition", parents=[common])
    confirm_transition_parser.add_argument("--stage")
    confirm_transition_parser.add_argument("--agent", required=True)
    confirm_transition_parser.add_argument("--task-id")

    auto_transition_parser = subcommands.add_parser("auto-transition", parents=[common])
    auto_transition_parser.add_argument("--stage", required=True)
    auto_transition_parser.add_argument("--agent", required=True)
    auto_transition_parser.add_argument("--task-id")

    # Compatibility alias: pre-0.6 callers still consume the pending gate instead of bypassing it.
    transition = subcommands.add_parser("transition", parents=[common])
    transition.add_argument("--stage")
    transition.add_argument("--agent", required=True)
    transition.add_argument("--task-id")

    cancel_transition_parser = subcommands.add_parser("cancel-transition", parents=[common])
    cancel_transition_parser.add_argument("--agent", required=True)
    cancel_transition_parser.add_argument("--task-id")

    memory_short = subcommands.add_parser("memory-short-complete", parents=[common])
    memory_short.add_argument("--file", required=True)
    memory_short.add_argument("--agent", required=True)
    memory_short.add_argument("--task-id")

    memory_instruction_parser = subcommands.add_parser("memory-instruction", parents=[common])
    memory_instruction_parser.add_argument("--task-id")

    memory_complete_parser = subcommands.add_parser("memory-complete", parents=[common])
    memory_complete_parser.add_argument("--action", required=True, choices=["no-op", "distill"])
    memory_complete_parser.add_argument("--agent", required=True)
    memory_complete_parser.add_argument("--task-id")

    close = subcommands.add_parser("close-current", parents=[common])
    close.add_argument("--reason", required=True)
    close.add_argument("--agent", required=True)

    project_init = subcommands.add_parser("project-init-complete", parents=[common])
    project_init.add_argument("--agent", required=True)

    repo_path = subcommands.add_parser("set-repo-path", parents=[common])
    repo_path.add_argument("--repo", required=True)
    repo_path.add_argument("--path", required=True)
    repo_path.add_argument("--task-id")

    args = parser.parse_args()
    try:
        root = resolve_root(getattr(args, "cwd", None))
        session_file = getattr(args, "session_file", None)
        command = args.command or "snapshot"
        if command == "snapshot":
            emit(snapshot_state(root, session_file))
        elif command == "list-tasks":
            emit({"tasks": list_tasks(root, getattr(args, "agent", None))})
        elif command == "create-task":
            emit(
                attach_status_context(
                    root,
                    create_task(
                        root,
                        args.task_id,
                        args.type,
                        args.title,
                        args.agent,
                        not args.no_set_current,
                        session_file,
                    ),
                    args.agent,
                    session_file,
                )
            )
        elif command == "set-current":
            emit(
                attach_status_context(
                    root,
                    set_current_task(root, args.task_id, args.agent, session_file),
                    args.agent,
                    session_file,
                )
            )
        elif command == "clear-current":
            emit(
                attach_status_context(
                    root,
                    clear_current_task(root, args.agent, session_file),
                    args.agent,
                    session_file,
                )
            )
        elif command == "set-confirm-mode":
            emit(
                attach_status_context(
                    root,
                    set_session_confirm_mode(root, args.mode, args.agent, session_file),
                    args.agent,
                    session_file,
                )
            )
        elif command == "clear-confirm-mode":
            emit(
                attach_status_context(
                    root,
                    clear_session_confirm_mode(root, args.agent, session_file),
                    args.agent,
                    session_file,
                )
            )
        elif command == "disable-harness":
            emit(
                attach_status_context(
                    root,
                    set_harness_disabled(root, True, args.agent, session_file),
                    args.agent,
                    session_file,
                )
            )
        elif command == "enable-harness":
            emit(
                attach_status_context(
                    root,
                    set_harness_disabled(root, False, args.agent, session_file),
                    args.agent,
                    session_file,
                )
            )
        elif command == "handoff-task":
            emit(
                attach_status_context(
                    root,
                    handoff_task(root, args.agent, args.summary, args.task_id, session_file),
                    args.agent,
                    session_file,
                )
            )
        elif command == "claim-task":
            emit(
                attach_status_context(
                    root,
                    claim_task(root, args.task_id, args.agent, session_file),
                    args.agent,
                    session_file,
                )
            )
        elif command == "request-transition":
            emit(
                attach_status_context(
                    root,
                    request_transition(
                        root,
                        args.stage,
                        args.agent,
                        args.task_id,
                        session_file,
                        args.reason,
                    ),
                    args.agent,
                    session_file,
                )
            )
        elif command in {"confirm-transition", "transition"}:
            emit(
                attach_status_context(
                    root,
                    confirm_transition(root, args.agent, args.stage, args.task_id, session_file),
                    args.agent,
                    session_file,
                )
            )
        elif command == "auto-transition":
            emit(
                attach_status_context(
                    root,
                    auto_transition(root, args.stage, args.agent, args.task_id, session_file),
                    args.agent,
                    session_file,
                )
            )
        elif command == "cancel-transition":
            emit(
                attach_status_context(
                    root,
                    cancel_transition(root, args.agent, args.task_id, session_file),
                    args.agent,
                    session_file,
                )
            )
        elif command == "memory-short-complete":
            emit(
                attach_status_context(
                    root,
                    memory_short_complete(
                        root,
                        args.file,
                        args.agent,
                        args.task_id,
                        session_file,
                    ),
                    args.agent,
                    session_file,
                )
            )
        elif command == "memory-instruction":
            emit(
                attach_status_context(
                    root,
                    memory_instruction(root, args.task_id, session_file),
                    None,
                    session_file,
                )
            )
        elif command == "memory-complete":
            emit(
                attach_status_context(
                    root,
                    memory_complete(
                        root,
                        args.action,
                        args.agent,
                        args.task_id,
                        session_file,
                    ),
                    args.agent,
                    session_file,
                )
            )
        elif command == "close-current":
            emit(
                attach_status_context(
                    root,
                    close_current_task(root, args.reason, args.agent, session_file),
                    args.agent,
                    session_file,
                )
            )
        elif command == "project-init-complete":
            emit(
                attach_status_context(
                    root,
                    project_init_complete(root, args.agent),
                    args.agent,
                    session_file,
                )
            )
        elif command == "set-repo-path":
            emit(
                attach_status_context(
                    root,
                    set_repo_path(root, args.repo, args.path, args.task_id, session_file),
                    None,
                    session_file,
                )
            )
        return 0
    except StateError as error:
        print(json.dumps({"error": str(error)}, ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
