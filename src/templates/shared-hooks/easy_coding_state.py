#!/usr/bin/env python3
import argparse
import hashlib
import json
import os
import re
import secrets
import subprocess
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
import sys

from easy_dev_spec import (
    EasyDevSpecError,
    inspect_spec,
    inspection_summary,
    select_consumption_scopes,
    select_tasks,
)


TERMINAL_STATUSES = {"COMPLETE", "CLOSED"}
HELP_SUFFIX = (
    "Use `ec-workflow` to start or resume a task, "
    "`ec-brainstorming` to brainstorm, or `ec-task-management` to manage tasks or session settings"
)
READY_LINE = f"Ready · {HELP_SUFFIX}"
WAITING_INIT_LINE = "Waiting init · Use `ec-init` to initialize"

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
    "### Workflow Mode",
    "### 风险与注意事项",
]

VALID_TRANSITIONS: dict[str, set[str]] = {
    "idle": {"INIT"},
    "INIT": {"ANALYSIS", "CLOSED"},
    "ANALYSIS": {"IMPLEMENT", "CLOSED"},
    # IMPLEMENT -> VERIFICATION remains parseable only for pre-0.9 in-flight tasks.
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
APPROVAL_MODES = {"approve", "guard", "confirm", "auto"}
CONFIGURED_WORKFLOW_MODES = {"adaptive", "fast", "standard", "strict"}
WORKFLOW_MODES = {"fast", "standard", "strict"}
WORKFLOW_MODE_RANK = {"fast": 0, "standard": 1, "strict": 2}
STRICT_VERIFICATION_CHECK_TYPES = {"lint", "typecheck", "test", "build"}
REVIEW_FINDING_SEVERITIES = {"error", "warning", "info"}
STRICT_WORKFLOW_RISK_PATTERN = re.compile(
    r"(migration|migrate|schema|state[-_ ]?machine|security|payment|data[-_ ]?loss|"
    r"concurren|cross[-_ ]?repo|public[-_ ]?(api|contract)|迁移|状态机|安全|支付|"
    r"数据丢失|并发|跨仓|公共接口|公共契约)",
    re.IGNORECASE,
)
DEFAULT_APPROVAL_MODE = "guard"
DEFAULT_WORKFLOW_MODE = "adaptive"
CRITICAL_CONFIRM_TRANSITIONS = {
    ("ANALYSIS", "IMPLEMENT"),
    ("VERIFICATION", "MEMORY"),
}
ANALYSIS_CONFIRM_TRANSITION = ("ANALYSIS", "IMPLEMENT")

LEGACY_STAGE_MAP = {
    "WAITING_CONFIRM": "ANALYSIS",
    "MEMORY_SHORT": "MEMORY",
    "MEMORY_LONG": "MEMORY",
}

DEFAULT_SHORT_TERM_MAX = 10
DEFAULT_SHORT_TERM_KEEP = 5
SESSION_STALE_THRESHOLD_HOURS = 30 * 24
SESSION_COMPONENT_PATTERN = re.compile(r"^[A-Za-z0-9._-]+$")
SESSION_AGENT_NAMESPACES = {"claude-code", "codex", "qoder", "unknown"}
CODEX_AGENT_PATH_PATTERN = re.compile(r"^/?root(?:/[a-z0-9._-]+)*$")
LEGACY_STATE_LOCK_TIMEOUT_SECONDS = 5.0
LEGACY_STATE_LOCK_STALE_SECONDS = 60.0
LEGACY_STATE_LOCK_POLL_SECONDS = 0.02
SHORT_MEMORY_UUID_V7_PATTERN = re.compile(
    r"^SM-[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"
)
LEGACY_SHORT_MEMORY_ID_PATTERN = re.compile(r"^SM-\d{8}-\d+$")
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
    "验收条件",
    "跨单元契约",
}


class StateError(Exception):
    pass


def configure_stdio() -> None:
    for stream in (sys.stdin, sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def generate_short_memory_id() -> str:
    timestamp_ms = time.time_ns() // 1_000_000
    random_bits = secrets.randbits(74)
    random_a = random_bits >> 62
    random_b = random_bits & ((1 << 62) - 1)
    # UUIDv7 用毫秒时间保证可排序，再用 74 位随机数避免多 Agent 并发碰撞。
    value = (timestamp_ms & ((1 << 48) - 1)) << 80
    value |= 0x7 << 76
    value |= random_a << 64
    value |= 0b10 << 62
    value |= random_b
    return f"SM-{uuid.UUID(int=value)}"


def short_memory_id_sort_key(memory_id: str) -> tuple[int, str]:
    # 升级当天可能同时存在旧序号 ID 和新 UUIDv7；旧记录先排，避免新记录被误判为窗口外旧记忆。
    if LEGACY_SHORT_MEMORY_ID_PATTERN.fullmatch(memory_id):
        return (0, memory_id)
    if SHORT_MEMORY_UUID_V7_PATTERN.fullmatch(memory_id):
        return (1, memory_id)
    return (2, memory_id)


def normalize_agent_identity(agent: str | None) -> str:
    raw_agent = str(agent or "unknown").strip()
    normalized = raw_agent.lower()
    # Codex 可能把根执行者写成 root 或 /root；两者及其协作子路径都属于同一平台身份。
    if CODEX_AGENT_PATH_PATTERN.fullmatch(normalized):
        return "codex"
    if normalized in SESSION_AGENT_NAMESPACES:
        return normalized
    return raw_agent


def normalize_session_agent(agent: str | None) -> str:
    normalized = normalize_agent_identity(agent)
    return normalized if normalized in SESSION_AGENT_NAMESPACES else "unknown"


def agents_equivalent(first: str | None, second: str | None) -> bool:
    return normalize_agent_identity(first) == normalize_agent_identity(second)


def detect_runtime_agent() -> str:
    script_path = Path(sys.argv[0]).as_posix()
    if ".qoder/" in script_path or ".qodercn/" in script_path:
        return "qoder"
    if ".codex/" in script_path:
        return "codex"
    if ".claude/" in script_path:
        return "claude-code"
    # Qoder CLI 会暴露 Claude 兼容环境变量，专属信号必须优先于兼容信号。
    if os.environ.get("QODER_PROJECT_DIR"):
        return "qoder"
    if os.environ.get("CLAUDE_PROJECT_DIR"):
        return "claude-code"
    return "unknown"


def normalize_session_component(value: str) -> str:
    if (
        value not in {".", ".."}
        and len(value) <= 120
        and SESSION_COMPONENT_PATTERN.fullmatch(value)
    ):
        return value
    digest = hashlib.sha256(value.encode("utf-8")).hexdigest()[:32]
    return f"sha256-{digest}"


# 逻辑会话由 Agent 命名空间与平台会话 ID 共同标识；PPID 只用于缺少逻辑 ID 的兼容回退。
def hook_session_identity(
    payload: dict,
    agent: str | None,
    ppid: int | None = None,
) -> dict:
    namespace = normalize_session_agent(agent)
    raw_session_id = payload.get("session_id") or payload.get("sessionId")
    external_session_id = str(raw_session_id).strip() if raw_session_id is not None else ""
    source = "hook-session-id"
    if not external_session_id and namespace == "codex":
        # Codex App 当前会把 thread ID 暴露在进程环境中；标准 hook session_id 仍保持最高优先级。
        raw_thread_id = (
            payload.get("thread_id")
            or payload.get("threadId")
            or os.environ.get("CODEX_THREAD_ID")
        )
        external_session_id = str(raw_thread_id).strip() if raw_thread_id is not None else ""
        source = "codex-thread-id"
    if external_session_id:
        component = normalize_session_component(external_session_id)
    else:
        component = f"ppid-{ppid if ppid is not None else os.getppid()}"
        source = "legacy-ppid"
    return {
        "agent": namespace,
        "external_session_id": external_session_id or None,
        "session_key": f"{namespace}-{component}",
        "session_source": source,
    }


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


def read_project_behavior(root: Path) -> tuple[str, str]:
    path = root / ".easy-coding" / "config.yaml"
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return DEFAULT_APPROVAL_MODE, DEFAULT_WORKFLOW_MODE

    in_behavior = False
    behavior_indent = 0
    behavior: dict[str, str] = {}
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
        behavior[key] = value.strip().strip("'\"")

    legacy = behavior.get("confirm_mode")
    approval_mode = behavior.get("approval_mode")
    workflow_mode = behavior.get("workflow_mode")
    if approval_mode is None:
        if legacy == "lite":
            approval_mode = "guard"
        elif legacy in APPROVAL_MODES:
            approval_mode = legacy
        else:
            approval_mode = DEFAULT_APPROVAL_MODE
    if workflow_mode is None:
        workflow_mode = "fast" if legacy == "lite" else DEFAULT_WORKFLOW_MODE
    if approval_mode not in APPROVAL_MODES:
        raise StateError(
            "Invalid behavior.approval_mode in .easy-coding/config.yaml: "
            "expected approve, guard, confirm, or auto."
        )
    if workflow_mode not in CONFIGURED_WORKFLOW_MODES:
        raise StateError(
            "Invalid behavior.workflow_mode in .easy-coding/config.yaml: "
            "expected adaptive, fast, standard, or strict."
        )
    return approval_mode, workflow_mode


def resolve_behavior(
    root: Path, session: dict
) -> tuple[str, str | None, str, str, str | None, str]:
    project_approval, project_workflow = read_project_behavior(root)
    legacy = session.get("confirm_mode")
    session_approval = session.get("approval_mode")
    session_workflow = session.get("workflow_mode")
    if session_approval is None:
        if legacy == "lite":
            session_approval = "guard"
        elif legacy in APPROVAL_MODES:
            session_approval = legacy
    if session_workflow is None:
        if legacy == "lite":
            session_workflow = "fast"
        elif legacy in APPROVAL_MODES:
            session_workflow = "adaptive"
    if session_approval is not None and session_approval not in APPROVAL_MODES:
        raise StateError(
            "Invalid session approval_mode: expected approve, guard, confirm, or auto."
        )
    if session_workflow is not None and session_workflow not in CONFIGURED_WORKFLOW_MODES:
        raise StateError(
            "Invalid session workflow_mode: expected adaptive, fast, standard, or strict."
        )
    return (
        project_approval,
        str(session_approval) if session_approval else None,
        str(session_approval or project_approval),
        project_workflow,
        str(session_workflow) if session_workflow else None,
        str(session_workflow or project_workflow),
    )


def resolve_approval_mode(root: Path, session: dict) -> tuple[str, str | None, str]:
    behavior = resolve_behavior(root, session)
    return behavior[0], behavior[1], behavior[2]


def materialize_legacy_session_behavior(session: dict) -> None:
    legacy = session.get("confirm_mode")
    if legacy == "lite":
        session.setdefault("approval_mode", "guard")
        if "workflow_mode" not in session:
            session["workflow_mode"] = "fast"
            session["workflow_mode_legacy_confirm_override"] = True
        session.pop("workflow_mode_legacy_alias_override", None)
    elif legacy in APPROVAL_MODES:
        session.setdefault("approval_mode", legacy)
        if "workflow_mode" not in session:
            session["workflow_mode"] = "adaptive"
            session["workflow_mode_legacy_alias_override"] = True
        session.pop("workflow_mode_legacy_confirm_override", None)
    session.pop("confirm_mode", None)


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
        memory_id = frontmatter.get("id", "")
        id_rank, id_value = short_memory_id_sort_key(memory_id)
        entries.append(
            {
                "path": resolved_entry,
                "display_path": display_entry,
                "date": frontmatter.get("date", ""),
                "id_rank": id_rank,
                "memory_id": id_value,
                "name": entry.name,
            }
        )
    return sorted(
        entries,
        key=lambda item: (
            str(item["date"]),
            int(item["id_rank"]),
            str(item["memory_id"]),
            str(item["name"]),
        ),
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
    require_current_id: bool = False,
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
    if require_current_id:
        memory_id = frontmatter.get("id", "")
        if not SHORT_MEMORY_UUID_V7_PATTERN.fullmatch(memory_id):
            raise StateError("Short-memory id must use the SM-<UUIDv7> format.")
        if not resolved_memory_path.name.startswith(f"{memory_id}_"):
            raise StateError("Short-memory filename prefix must exactly match its frontmatter id.")
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


def acquire_legacy_state_lock(root: Path) -> Path | None:
    state_path = root / ".easy-coding" / "state.json"
    lock_path = root / ".easy-coding" / "sessions" / ".legacy-state-migration.lock"
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    deadline = time.monotonic() + LEGACY_STATE_LOCK_TIMEOUT_SECONDS

    while state_path.exists() or lock_path.exists():
        try:
            lock_path.mkdir()
            return lock_path
        except FileExistsError:
            try:
                lock_age = time.time() - lock_path.stat().st_mtime
                if lock_age > LEGACY_STATE_LOCK_STALE_SECONDS:
                    lock_path.rmdir()
                    continue
            except FileNotFoundError:
                continue
            except OSError:
                pass
            if time.monotonic() >= deadline:
                raise StateError("Timed out waiting for legacy state migration lock.")
            time.sleep(LEGACY_STATE_LOCK_POLL_SECONDS)
        except OSError as error:
            raise StateError("Cannot acquire legacy state migration lock.") from error
    return None


def release_legacy_state_lock(lock_path: Path | None) -> None:
    if lock_path is None:
        return
    try:
        lock_path.rmdir()
    except OSError:
        pass


def migrate_legacy_state(root: Path, agent: str) -> dict | None:
    """Prepare old state.json data for the canonical session; the caller commits it first."""
    state_path = root / ".easy-coding" / "state.json"
    old_state = load_json(state_path)
    if old_state is None:
        return None

    task_id = old_state.get("current_task")
    if task_id:
        task_path = task_json_path(root, str(task_id))
        task = load_json(task_path)
        if task:
            if "stage_history" not in task or not task["stage_history"]:
                task["stage_history"] = old_state.get("stage_history", [])
            if "last_agent" not in task or not task["last_agent"]:
                task["last_agent"] = old_state.get("last_agent", agent)
            if old_state.get("confirmed_by_user"):
                task["confirmed_by_user"] = True
            if old_state.get("test_strategy_confirmed"):
                task["test_strategy_confirmed"] = True
            if old_state.get("repo_paths"):
                task["repo_paths"] = old_state["repo_paths"]
            normalize_legacy_task(task)
            write_json(task_path, task)

    return {"current_task": task_id, "created_at": now_iso()}


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
    identity = hook_session_identity({}, detect_runtime_agent())
    return sessions_dir / f"{identity['session_key']}.json"


def resolve_hook_session_path(
    root: Path,
    payload: dict,
    agent: str | None,
    ppid: int | None = None,
) -> Path:
    identity = hook_session_identity(payload, agent, ppid)
    return resolve_session_path(root, f".easy-coding/sessions/{identity['session_key']}.json")


def display_path(root: Path, path: Path) -> str:
    try:
        return path.resolve().relative_to(root.resolve()).as_posix()
    except ValueError:
        return path.as_posix()


def default_session() -> dict:
    timestamp = now_iso()
    return {"current_task": None, "created_at": timestamp, "last_active_at": timestamp}


def apply_hook_session_identity(session: dict, identity: dict) -> None:
    timestamp = now_iso()
    if not session.get("created_at"):
        session["created_at"] = timestamp
    session["last_active_at"] = timestamp
    for key in ("agent", "external_session_id", "session_key", "session_source"):
        session[key] = identity.get(key)


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


def migrate_legacy_pid_session(
    root: Path,
    session_path: Path,
    identity: dict,
    ppid: int,
) -> dict | None:
    sessions_dir = root / ".easy-coding" / "sessions"
    fallback_path = sessions_dir / f"{identity['agent']}-ppid-{ppid}.json"
    legacy_paths = [fallback_path, sessions_dir / f"{ppid}.json"]
    session_path.parent.mkdir(parents=True, exist_ok=True)

    for legacy_path in legacy_paths:
        if legacy_path == session_path or not legacy_path.is_file():
            continue
        try:
            legacy_path.replace(session_path)
        except FileNotFoundError:
            continue
        except OSError:
            if session_path.is_file():
                break
            continue
        migrated = load_session(root, session_path)
        if migrated is not None:
            return migrated
    return load_session(root, session_path)


def merge_legacy_session(session: dict, legacy_session: dict) -> dict:
    merged = dict(session)
    if not merged.get("current_task") and legacy_session.get("current_task"):
        merged["current_task"] = legacy_session["current_task"]
    if not merged.get("created_at") and legacy_session.get("created_at"):
        merged["created_at"] = legacy_session["created_at"]
    return merged


def ensure_hook_session(
    root: Path,
    payload: dict,
    agent: str | None,
    ppid: int | None = None,
) -> tuple[dict, Path]:
    identity = hook_session_identity(payload, agent, ppid)
    session_path = resolve_hook_session_path(root, payload, agent, ppid)
    resolved_ppid = ppid if ppid is not None else os.getppid()
    legacy_state_lock = acquire_legacy_state_lock(root)
    try:
        session = load_session(root, session_path)
        legacy_state = (
            migrate_legacy_state(root, str(identity["agent"]))
            if legacy_state_lock is not None
            else None
        )

        if session is None:
            clean_stale_sessions(root)
            session = migrate_legacy_pid_session(root, session_path, identity, resolved_ppid)
        if session is None:
            session = load_session(root, session_path)
        if session is None:
            session = default_session()
        if legacy_state is not None:
            session = merge_legacy_session(session, legacy_state)

        apply_hook_session_identity(session, identity)
        write_session(root, session, session_path)
        if legacy_state is not None:
            try:
                (root / ".easy-coding" / "state.json").unlink()
            except OSError:
                pass
        return session, session_path
    finally:
        release_legacy_state_lock(legacy_state_lock)


def clean_stale_sessions(
    root: Path,
    threshold_hours: int = SESSION_STALE_THRESHOLD_HOURS,
) -> int:
    sessions_dir = root / ".easy-coding" / "sessions"
    if not sessions_dir.is_dir():
        return 0

    now = datetime.now(timezone.utc)
    cleaned = 0
    # 逻辑会话不对应独立进程，仅清理长期空闲且没有当前任务的 session。
    for entry in sessions_dir.iterdir():
        if entry.suffix != ".json":
            continue
        try:
            session = json.loads(entry.read_text(encoding="utf-8"))
            if session.get("current_task"):
                continue
            activity_value = session.get("last_active_at") or session.get("created_at") or ""
            last_active = datetime.fromisoformat(str(activity_value))
            if last_active.tzinfo is None:
                last_active = last_active.replace(tzinfo=timezone.utc)
            age_hours = (now - last_active).total_seconds() / 3600
            if age_hours <= threshold_hours:
                continue
            entry.unlink()
            cleaned += 1
        except (OSError, json.JSONDecodeError, ValueError, TypeError):
            continue
    return cleaned


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


def is_valid_review_finding(value: object) -> bool:
    if not isinstance(value, dict):
        return False
    line = value.get("line")
    return (
        is_non_empty_string(value.get("file"))
        and isinstance(line, int)
        and not isinstance(line, bool)
        and line >= 1
        and is_non_empty_string(value.get("issue"))
        and value.get("severity") in REVIEW_FINDING_SEVERITIES
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


def is_valid_execution_plan(
    plan: object,
    allow_empty_files: bool = False,
    require_unit_contracts: bool = False,
) -> bool:
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
        if require_unit_contracts:
            for contract_field in (
                "acceptance_criteria",
                "test_points",
                "contracts",
                "risks",
            ):
                if not is_string_list(unit.get(contract_field), allow_empty=False):
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


def stored_spec_path(root: Path, task: dict) -> Path:
    source = task.get("spec_source")
    if not isinstance(source, dict) or not is_non_empty_string(source.get("path")):
        raise StateError("Spec-backed task is missing spec_source.path.")
    raw_path = Path(str(source["path"]))
    path = raw_path if raw_path.is_absolute() else root / raw_path
    resolved = path.resolve()
    try:
        resolved.relative_to(root.resolve())
    except ValueError as exc:
        raise StateError("Spec-backed task source path must remain inside the project root.") from exc
    return resolved


def inspect_task_spec(root: Path, task: dict) -> tuple[dict, dict]:
    source = task.get("spec_source")
    selected = task.get("selected_spec_tasks")
    repo_paths = task.get("repo_paths")
    if not isinstance(source, dict) or not is_string_list(selected, allow_empty=False):
        raise StateError("Spec-backed task source and selected task metadata are incomplete.")
    try:
        inspection = inspect_spec(
            stored_spec_path(root, task),
            root,
            repo_paths if isinstance(repo_paths, dict) else {},
            selected,
        )
        satisfied = {
            f"{record.get('source_task_id')}->{record.get('task_id')}": str(record.get("evidence"))
            for record in task.get("spec_dependency_evidence", [])
            if isinstance(record, dict)
            and record.get("status") == "satisfied"
            and is_non_empty_string(record.get("task_id"))
            and is_non_empty_string(record.get("evidence"))
        }
        selection = select_tasks(inspection, selected, satisfied)
    except EasyDevSpecError as exc:
        raise StateError(f"Canonical Spec validation failed: {exc}") from exc
    stored_dependencies = task.get("spec_dependency_evidence")
    if not isinstance(stored_dependencies, list):
        raise StateError("Spec-backed task dependency metadata is incomplete.")
    expected_by_edge = {
        (record.get("source_task_id"), record.get("task_id")): record
        for record in selection["dependency_records"]
    }
    stored_by_edge = {
        (record.get("source_task_id"), record.get("task_id")): record
        for record in stored_dependencies
        if isinstance(record, dict)
    }
    if (
        len(stored_by_edge) != len(stored_dependencies)
        or set(stored_by_edge) != set(expected_by_edge)
    ):
        raise StateError("Canonical Spec dependency metadata no longer matches source selection.")
    for edge, expected in expected_by_edge.items():
        stored = stored_by_edge[edge]
        for field in ("dependency_type", "required_evidence", "status"):
            if stored.get(field) != expected.get(field):
                raise StateError(
                    "Canonical Spec dependency metadata no longer matches source selection."
                )
        if stored.get("evidence") != expected.get("evidence"):
            raise StateError(
                "Canonical Spec dependency evidence no longer matches its recorded status."
            )
    if source.get("schema") != inspection.get("schema"):
        raise StateError("Canonical Spec schema no longer matches task.json.")
    if source.get("spec_id") != inspection.get("spec_id"):
        raise StateError("Canonical Spec ID no longer matches task.json.")
    if source.get("revision") != inspection.get("revision"):
        raise StateError("Canonical Spec revision no longer matches task.json.")
    if source.get("sha256") != inspection.get("source_sha256"):
        raise StateError("Canonical Spec SHA-256 changed after task creation.")
    selected_repo_ids = set(selection["selected_repo_ids"])
    stored_bindings = task.get("spec_repositories")
    if not isinstance(stored_bindings, list):
        raise StateError("Spec-backed task repository metadata is incomplete.")
    stored_by_repo = {
        str(binding.get("repo_id")): binding
        for binding in stored_bindings
        if isinstance(binding, dict) and is_non_empty_string(binding.get("repo_id"))
    }
    current_by_repo = {
        str(binding.get("repo_id")): binding
        for binding in inspection.get("repository_bindings", [])
        if isinstance(binding, dict)
        and str(binding.get("repo_id")) in selected_repo_ids
    }
    if (
        len(stored_by_repo) != len(stored_bindings)
        or set(stored_by_repo) != selected_repo_ids
        or set(current_by_repo) != selected_repo_ids
    ):
        raise StateError("Canonical Spec repository bindings no longer match task.json.")
    for repo_id in selected_repo_ids:
        stored = stored_by_repo[repo_id]
        current = current_by_repo[repo_id]
        for field in ("repo_id", "name", "path", "baseline_commit"):
            if stored.get(field) != current.get(field):
                raise StateError("Canonical Spec repository bindings no longer match task.json.")
    return inspection, selection


def is_valid_spec_execution_plan(root: Path, task: dict, plan: object) -> bool:
    if not isinstance(plan, dict):
        return False
    try:
        inspection, selection = inspect_task_spec(root, task)
    except StateError:
        return False
    selected_ids = set(selection["selected_task_ids"])
    task_by_id = {item["task_id"]: item for item in selection["selected_tasks"]}
    change_by_id = {
        str(change["change_id"]): change for change in selection["selected_changes"]
    }
    step_by_id = {
        str(step["step_id"]): step for step in selection["selected_steps"]
    }
    test_by_id = {
        str(test["test_id"]): test for test in selection["selected_tests"]
    }
    changes_by_task: dict[str, list[dict]] = {task_id: [] for task_id in selected_ids}
    tests_by_task: dict[str, list[dict]] = {task_id: [] for task_id in selected_ids}
    for change in selection["selected_changes"]:
        changes_by_task[str(change["task_id"])].append(change)
    for test in selection["selected_tests"]:
        tests_by_task[str(test["task_id"])].append(test)

    units = [unit for unit in plan.get("units", []) if isinstance(unit, dict)]
    units_by_task: dict[str, list[dict]] = {task_id: [] for task_id in selected_ids}
    covered_steps: dict[str, list[str]] = {task_id: [] for task_id in selected_ids}
    covered_files: dict[str, set[str]] = {task_id: set() for task_id in selected_ids}
    covered_symbols: dict[str, set[str]] = {task_id: set() for task_id in selected_ids}
    covered_commands: dict[str, set[str]] = {task_id: set() for task_id in selected_ids}
    unit_by_id = {str(unit["id"]): unit for unit in units}
    unit_id_by_step: dict[str, str] = {}
    for unit in units:
        source_task_id = unit.get("source_task_id")
        if source_task_id not in selected_ids:
            return False
        source_task_id = str(source_task_id)
        source_task = task_by_id[source_task_id]
        if unit.get("repo_id") != source_task.get("repo_id"):
            return False
        for field in ("source_step_ids", "symbols", "test_commands"):
            if not is_string_list(unit.get(field), allow_empty=False):
                return False
        allowed_steps = set(source_task.get("step_ids", []))
        if not set(unit["source_step_ids"]).issubset(allowed_steps):
            return False
        source_steps = [step_by_id.get(str(step_id)) for step_id in unit["source_step_ids"]]
        if any(
            step is None or step.get("task_id") != source_task_id
            for step in source_steps
        ):
            return False
        step_change_ids = {
            str(change_id)
            for step in source_steps
            if isinstance(step, dict)
            for change_id in step.get("change_ids", [])
        }
        step_test_ids = {
            str(test_id)
            for step in source_steps
            if isinstance(step, dict)
            for test_id in step.get("test_ids", [])
        }
        step_files = {
            str(change_by_id[change_id]["path"])
            for change_id in step_change_ids
            if change_id in change_by_id
        }
        step_symbols = {
            str(symbol)
            for change_id in step_change_ids
            if change_id in change_by_id
            for symbol in change_by_id[change_id].get("symbols", [])
        }
        step_commands = {
            str(test_by_id[test_id]["command"])
            for test_id in step_test_ids
            if test_id in test_by_id
        }
        # Unit 必须保存它声明的 source steps 的完整文件、符号和源测试映射；附加本地命令可保留。
        if (
            not step_change_ids.issubset(change_by_id)
            or not step_test_ids.issubset(test_by_id)
            or set(unit.get("files", [])) != step_files
            or set(unit["symbols"]) != step_symbols
            or not set(unit["test_commands"]).issuperset(step_commands)
        ):
            return False
        for step_id in unit["source_step_ids"]:
            normalized_step_id = str(step_id)
            if normalized_step_id in unit_id_by_step:
                return False
            unit_id_by_step[normalized_step_id] = str(unit["id"])
        units_by_task[source_task_id].append(unit)
        covered_steps[source_task_id].extend(unit["source_step_ids"])
        covered_files[source_task_id].update(unit.get("files", []))
        covered_symbols[source_task_id].update(unit["symbols"])
        covered_commands[source_task_id].update(unit["test_commands"])

    for source_task_id, source_task in task_by_id.items():
        if not units_by_task[source_task_id]:
            return False
        steps = covered_steps[source_task_id]
        if len(steps) != len(set(steps)) or set(steps) != set(source_task.get("step_ids", [])):
            return False
        if covered_files[source_task_id] != {
            str(change["path"]) for change in changes_by_task[source_task_id]
        }:
            return False
        if covered_symbols[source_task_id] != {
            str(symbol)
            for change in changes_by_task[source_task_id]
            for symbol in change.get("symbols", [])
        }:
            return False
        if not covered_commands[source_task_id].issuperset({
            str(test["command"]) for test in tests_by_task[source_task_id]
        }):
            return False

    # 同一 source task 内的 Step DAG 也必须投影到 Unit DAG；合并在同一 Unit 的步骤无需自依赖。
    for step_id, step in step_by_id.items():
        owner_unit_id = unit_id_by_step.get(step_id)
        if owner_unit_id is None:
            return False
        owner_unit = unit_by_id[owner_unit_id]
        for dependency_step_id in step.get("depends_on_step_ids", []):
            dependency_unit_id = unit_id_by_step.get(str(dependency_step_id))
            if dependency_unit_id is None:
                return False
            if (
                dependency_unit_id != owner_unit_id
                and dependency_unit_id not in owner_unit.get("depends_on", [])
            ):
                return False

    # hard 依赖必须投影为 Unit DAG，不能只保存在说明文字中。
    unit_ids_by_task = {
        source_task_id: {str(unit["id"]) for unit in source_units}
        for source_task_id, source_units in units_by_task.items()
    }
    for edge in inspection.get("dependency_edges", []):
        source_task_id = str(edge.get("source_task_id") or "")
        dependency_task_id = str(edge.get("task_id") or "")
        if (
            edge.get("dependency_type") != "hard"
            or source_task_id not in selected_ids
            or dependency_task_id not in selected_ids
        ):
            continue
        dependency_ids = unit_ids_by_task[dependency_task_id]
        depended_on_within_dependency = {
            dependency
            for unit in units_by_task[dependency_task_id]
            for dependency in unit.get("depends_on", [])
            if dependency in dependency_ids
        }
        dependency_terminals = dependency_ids - depended_on_within_dependency
        source_units = units_by_task[source_task_id]
        source_ids = unit_ids_by_task[source_task_id]
        source_roots = [
            unit
            for unit in source_units
            if not set(unit.get("depends_on", [])).intersection(source_ids)
        ]
        if not dependency_terminals or any(
            not dependency_terminals.issubset(set(unit.get("depends_on", [])))
            for unit in source_roots
        ):
            return False
    return True


def contains_spec_marker(content: str, marker: str) -> bool:
    boundary_characters = (
        r"A-Za-z0-9_/" + ("." if "/" in marker or "." in marker else "") + "-"
    )
    return (
        re.search(
            rf"(?<![{boundary_characters}]){re.escape(marker)}(?![{boundary_characters}])",
            content,
        )
        is not None
    )


def missing_spec_test_strategy_markers(
    selection: dict, plan: dict, content: str
) -> list[str]:
    unit_ids_by_step = {
        str(step_id): str(unit["id"])
        for unit in plan.get("units", [])
        if isinstance(unit, dict)
        for step_id in unit.get("source_step_ids", [])
    }
    owner_units_by_test: dict[str, set[str]] = {}
    for step in selection.get("selected_steps", []):
        if not isinstance(step, dict):
            continue
        owner_unit_id = unit_ids_by_step.get(str(step.get("step_id") or ""))
        if not owner_unit_id:
            continue
        for test_id in step.get("test_ids", []):
            owner_units_by_test.setdefault(str(test_id), set()).add(owner_unit_id)

    missing: list[str] = []
    for test in selection.get("selected_tests", []):
        if not isinstance(test, dict):
            continue
        test_id = str(test.get("test_id") or "")
        markers = {
            test_id,
            str(test.get("task_id") or ""),
            str(test.get("file") or ""),
            str(test.get("command") or ""),
            *owner_units_by_test.get(test_id, set()),
        }
        missing.extend(
            marker
            for marker in sorted(markers)
            if marker and not contains_spec_marker(content, marker)
        )
    return list(dict.fromkeys(missing))


def read_project_schema_version(root: Path) -> int:
    path = root / ".easy-coding" / "config.yaml"
    try:
        for raw_line in path.read_text(encoding="utf-8").splitlines():
            line = raw_line.split("#", 1)[0].strip()
            if not line.startswith("version:"):
                continue
            return int(line.split(":", 1)[1].strip())
    except (OSError, ValueError):
        return 0
    return 0


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
    valid = is_valid_execution_plan(
        latest_plan,
        require_unit_contracts=read_project_schema_version(root) >= 3,
    )
    if not valid:
        return False
    if task and isinstance(task.get("spec_source"), dict):
        return is_valid_spec_execution_plan(root, task, latest_plan)
    return True


def execution_records(root: Path, task_id: str) -> list[dict]:
    path = execution_log_path(root, task_id)
    if not path.exists():
        return []
    records: list[dict] = []
    try:
        for line in path.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            record = json.loads(line)
            if isinstance(record, dict):
                records.append(record)
    except (OSError, json.JSONDecodeError):
        return []
    return records


def latest_execution_plan(root: Path, task_id: str) -> dict | None:
    latest: dict | None = None
    for record in execution_records(root, task_id):
        if record.get("type") == "plan":
            latest = record
    if latest is None or not is_valid_execution_plan(latest, allow_empty_files=True):
        return None
    return latest


def existing_parent(path: Path) -> Path:
    candidate = path
    while not candidate.exists() and candidate != candidate.parent:
        candidate = candidate.parent
    return candidate.parent if candidate.is_file() else candidate


def run_git(repository: Path, *args: str) -> subprocess.CompletedProcess[bytes] | None:
    try:
        return subprocess.run(
            ["git", "-C", str(repository), *args],
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            check=False,
        )
    except OSError:
        return None


def git_repository_root(path: Path) -> Path | None:
    candidate = existing_parent(path).resolve()
    for directory in (candidate, *candidate.parents):
        if (directory / ".git").exists():
            return directory
    return None


def is_path_within(path: Path, parent: Path) -> bool:
    try:
        path.relative_to(parent)
        return True
    except ValueError:
        return False


def minimize_repository_scopes(repository: Path, scopes: set[Path]) -> list[Path]:
    minimized: list[Path] = []
    for scope in sorted(scopes, key=lambda path: (len(path.parts), path.as_posix())):
        normalized = scope.resolve()
        if not is_path_within(normalized, repository):
            continue
        if any(is_path_within(normalized, existing) for existing in minimized):
            continue
        minimized.append(normalized)
    return minimized


def task_repository_scopes(
    root: Path, task: dict | None, plan: dict
) -> list[tuple[Path, list[Path]]]:
    if task and isinstance(task.get("spec_source"), dict):
        repo_paths = task.get("repo_paths")
        if not isinstance(repo_paths, dict):
            raise StateError("Spec-backed task is missing repo_paths.")
        repositories: dict[Path, set[Path]] = {}
        for unit in plan.get("units", []):
            if not isinstance(unit, dict) or not is_non_empty_string(unit.get("repo_id")):
                raise StateError("Spec-backed execution unit is missing repo_id.")
            repo_id = str(unit["repo_id"])
            raw_repo_path = repo_paths.get(repo_id)
            if not is_non_empty_string(raw_repo_path):
                raise StateError(f"Spec repository path is missing: {repo_id}")
            candidate = Path(str(raw_repo_path))
            repository_path = (candidate if candidate.is_absolute() else root / candidate).resolve()
            repository = git_repository_root(repository_path)
            if repository is None or repository.resolve() != repository_path:
                raise StateError(f"Spec repository binding is not a Git root: {repo_id}")
            scopes = repositories.setdefault(repository, set())
            scopes.add(repository)
            for file_name in unit.get("files", []):
                if not is_non_empty_string(file_name):
                    raise StateError(f"Spec execution unit has an invalid file path: {repo_id}")
                relative_path = Path(str(file_name))
                if relative_path.is_absolute() or ".." in relative_path.parts:
                    raise StateError(f"Spec execution unit path escapes repository {repo_id}: {file_name}")
                resolved_file = (repository / relative_path).resolve()
                if not is_path_within(resolved_file, repository):
                    raise StateError(f"Spec execution unit path escapes repository {repo_id}: {file_name}")
                file_repository = git_repository_root(resolved_file)
                if file_repository is None or file_repository.resolve() != repository:
                    raise StateError(
                        f"Spec execution unit path belongs to another Git repository: {repo_id}:{file_name}"
                    )
        return [
            (repository, [repository])
            for repository in sorted(repositories, key=lambda item: item.as_posix())
        ]

    scope_candidates = [root]
    if task:
        repo_paths = task.get("repo_paths")
        if isinstance(repo_paths, dict):
            for repo_path in repo_paths.values():
                if is_non_empty_string(repo_path):
                    candidate = Path(str(repo_path))
                    scope_candidates.append(
                        candidate if candidate.is_absolute() else root / candidate
                    )

    repositories: dict[Path, set[Path]] = {}
    for candidate in scope_candidates:
        normalized = candidate.resolve()
        if candidate.exists() and candidate.is_file():
            normalized = normalized.parent
        repository = git_repository_root(normalized)
        if repository is not None:
            repositories.setdefault(repository, set()).add(normalized)

    for unit in plan.get("units", []):
        if not isinstance(unit, dict):
            continue
        for file_name in unit.get("files", []):
            if not is_non_empty_string(file_name):
                continue
            candidate = Path(str(file_name))
            normalized = (
                candidate if candidate.is_absolute() else root / candidate
            ).resolve()
            repository = git_repository_root(normalized)
            if repository is None:
                continue
            scopes = repositories.setdefault(repository, set())
            if not any(is_path_within(normalized, scope) for scope in scopes):
                # Without project metadata for an external file, conservatively cover
                # the full repository so unplanned sibling changes remain visible.
                scopes.add(repository)

    return [
        (repository, minimize_repository_scopes(repository, scopes))
        for repository, scopes in sorted(
            repositories.items(), key=lambda item: item[0].as_posix()
        )
    ]


def task_repository_roots(root: Path, task: dict | None, plan: dict) -> list[Path]:
    return [
        repository
        for repository, _scopes in task_repository_scopes(root, task, plan)
    ]


def repository_scope_pathspecs(repository: Path, scopes: list[Path]) -> list[str]:
    return [
        f":(literal){scope.relative_to(repository).as_posix()}"
        for scope in scopes
    ]


def is_easy_coding_state_path(
    repository: Path, relative_name: str, scopes: list[Path]
) -> bool:
    candidate = repository / relative_name
    for scope in scopes:
        if not is_path_within(candidate, scope):
            continue
        scoped_name = candidate.relative_to(scope).as_posix()
        if scoped_name == ".easy-coding" or scoped_name.startswith(".easy-coding/"):
            return True
    return False


def git_index_entries(
    repository: Path, pathspecs: list[str]
) -> dict[bytes, tuple[bytes, bytes]]:
    result = run_git(
        repository,
        "ls-files",
        "--stage",
        "-z",
        "--",
        *pathspecs,
    )
    if result is None or result.returncode != 0:
        return {}
    entries: dict[bytes, tuple[bytes, bytes]] = {}
    for raw_entry in filter(None, result.stdout.split(b"\0")):
        try:
            metadata, raw_path = raw_entry.split(b"\t", 1)
            mode, object_id, stage = metadata.split()
        except ValueError:
            continue
        if stage == b"0":
            entries[raw_path] = (mode, object_id)
    return entries


def git_worktree_blob_oid(repository: Path, relative_name: str) -> bytes | None:
    result = run_git(
        repository,
        "hash-object",
        f"--path={relative_name}",
        "--",
        relative_name,
    )
    if result is None or result.returncode != 0:
        return None
    object_id = result.stdout.strip()
    return object_id or None


def worktree_git_mode(path: Path) -> bytes:
    if path.is_symlink():
        return b"120000"
    try:
        return b"100755" if path.stat().st_mode & 0o111 else b"100644"
    except OSError:
        return b"<missing-mode>"


def update_git_repository_content_fingerprint(
    digest,
    root: Path,
    repository: Path,
    scopes: list[Path],
    visited: set[tuple[Path, tuple[Path, ...]]],
) -> None:
    normalized_repository = repository.resolve()
    normalized_scopes = tuple(scope.resolve() for scope in scopes)
    visit_key = (normalized_repository, normalized_scopes)
    if visit_key in visited:
        digest.update(b"<git-scope-cycle>\0")
        return
    visited.add(visit_key)
    try:
        digest.update(b"git-repository\0")
        digest.update(os.fsencode(display_path(root, normalized_repository)))
        digest.update(b"\0")
        pathspecs = repository_scope_pathspecs(
            normalized_repository, list(normalized_scopes)
        )
        for scope in normalized_scopes:
            relative_scope = scope.relative_to(normalized_repository).as_posix()
            digest.update(b"git-scope\0")
            digest.update(os.fsencode(relative_scope))
            digest.update(b"\0")

        index_entries = git_index_entries(normalized_repository, pathspecs)
        listed = run_git(
            normalized_repository,
            "ls-files",
            "--cached",
            "--others",
            "--exclude-standard",
            "-z",
            "--",
            *pathspecs,
        )
        modified = run_git(
            normalized_repository,
            "diff-files",
            "--name-only",
            "-z",
            "--ignore-submodules=none",
            "--",
            *pathspecs,
        )
        if listed is None or listed.returncode != 0:
            digest.update(b"<git-files-error>\0")
            return
        if modified is None or modified.returncode != 0:
            digest.update(b"<git-diff-files-error>\0")
            return
        modified_paths = set(filter(None, modified.stdout.split(b"\0")))

        for raw_path in sorted(set(filter(None, listed.stdout.split(b"\0")))):
            relative_name = os.fsdecode(raw_path)
            if is_easy_coding_state_path(
                normalized_repository, relative_name, list(normalized_scopes)
            ):
                continue
            candidate = normalized_repository / relative_name
            index_entry = index_entries.get(raw_path)
            if index_entry is not None and index_entry[0] == b"160000":
                digest.update(b"git-entry\0")
                digest.update(raw_path)
                digest.update(b"\0gitlink\0")
                submodule_root = git_repository_root(candidate)
                if (
                    submodule_root is not None
                    and submodule_root.resolve() == candidate.resolve()
                ):
                    update_git_repository_content_fingerprint(
                        digest,
                        root,
                        submodule_root,
                        [submodule_root],
                        visited,
                    )
                else:
                    digest.update(index_entry[1])
                    digest.update(b"\0")
                continue

            exists = candidate.exists() or candidate.is_symlink()
            if not exists:
                if raw_path in modified_paths or index_entry is None:
                    # A worktree deletion is canonically absent before and after staging.
                    continue
                # Sparse or otherwise intentionally absent tracked files retain index content.
                mode, object_id = index_entry
            elif index_entry is not None and raw_path not in modified_paths:
                mode, object_id = index_entry
            else:
                mode = worktree_git_mode(candidate)
                object_id = git_worktree_blob_oid(
                    normalized_repository, relative_name
                )
                if object_id is None:
                    try:
                        content = (
                            os.fsencode(os.readlink(candidate))
                            if candidate.is_symlink()
                            else candidate.read_bytes()
                        )
                    except OSError:
                        content = b"<missing>"
                    object_id = hashlib.sha256(content).hexdigest().encode("ascii")

            digest.update(b"git-entry\0")
            digest.update(raw_path)
            digest.update(b"\0")
            digest.update(mode)
            digest.update(b"\0")
            digest.update(object_id)
            digest.update(b"\0")
    finally:
        visited.remove(visit_key)


def update_git_worktree_fingerprint(
    digest,
    root: Path,
    task: dict | None,
    plan: dict,
) -> None:
    visited: set[tuple[Path, tuple[Path, ...]]] = set()
    for repository, scopes in task_repository_scopes(root, task, plan):
        if not scopes:
            continue
        update_git_repository_content_fingerprint(
            digest, root, repository, scopes, visited
        )


def implementation_fingerprint(root: Path, task_id: str) -> str:
    plan = latest_execution_plan(root, task_id)
    if not plan:
        raise StateError("Cannot calculate implementation fingerprint without a valid plan.")
    task = load_task(root, task_id)
    workflow_mode = str(task.get("workflow_mode") or "") if task else ""
    digest = hashlib.sha256()
    digest.update(b"workflow-mode\0")
    digest.update(workflow_mode.encode("utf-8"))
    digest.update(b"\0")
    digest.update(b"execution-plan\0")
    digest.update(
        json.dumps(
            plan,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
    )
    digest.update(b"\0")
    if task and isinstance(task.get("spec_source"), dict):
        digest.update(b"canonical-spec\0")
        digest.update(
            json.dumps(
                {
                    "source": task.get("spec_source"),
                    "selected_tasks": task.get("selected_spec_tasks"),
                },
                ensure_ascii=False,
                sort_keys=True,
                separators=(",", ":"),
            ).encode("utf-8")
        )
        digest.update(b"\0")
    update_git_worktree_fingerprint(digest, root, task, plan)
    repo_paths = task.get("repo_paths") if task else None
    file_entries: set[tuple[str, str | None]] = {
        (str(file_name), str(unit.get("repo_id")) if unit.get("repo_id") else None)
        for unit in plan.get("units", [])
        if isinstance(unit, dict)
        for file_name in unit.get("files", [])
        if is_non_empty_string(file_name)
    }
    for file_name, repo_id in sorted(file_entries, key=lambda item: (item[0], item[1] or "")):
        candidate = Path(file_name)
        was_absolute = candidate.is_absolute()
        base = root
        if (
            task
            and isinstance(task.get("spec_source"), dict)
            and isinstance(repo_paths, dict)
            and repo_id
            and is_non_empty_string(repo_paths.get(repo_id))
        ):
            raw_base = Path(str(repo_paths[repo_id]))
            base = raw_base if raw_base.is_absolute() else root / raw_base
        if not was_absolute:
            candidate = base / candidate
        resolved = candidate.resolve()
        if not was_absolute:
            try:
                resolved.relative_to(base.resolve())
            except ValueError as error:
                raise StateError(f"Execution plan file escapes repository: {file_name}") from error
        digest.update(f"{repo_id or ''}:{file_name}".encode("utf-8"))
        digest.update(b"\0")
        try:
            digest.update(resolved.read_bytes())
        except OSError:
            digest.update(b"<missing>")
        digest.update(b"\0")
    return digest.hexdigest()


def behavior_config_fingerprint(root: Path) -> str:
    path = root / ".easy-coding" / "config.yaml"
    digest = hashlib.sha256()
    try:
        digest.update(path.read_bytes())
    except OSError:
        digest.update(b"<missing-config>")
    return digest.hexdigest()


def evidence_fingerprints(root: Path, task_id: str) -> dict[str, str]:
    return {
        "implementation_fingerprint": implementation_fingerprint(root, task_id),
        "config_fingerprint": behavior_config_fingerprint(root),
    }


def validate_spec_implementation_results(root: Path, task_id: str, task: dict) -> None:
    if not isinstance(task.get("spec_source"), dict):
        return
    plan = latest_execution_plan(root, task_id)
    if plan is None or not is_valid_spec_execution_plan(root, task, plan):
        raise StateError("Canonical Spec implementation has no valid source-traceable plan.")
    unit_by_id = {
        str(unit["id"]): unit for unit in plan.get("units", []) if isinstance(unit, dict)
    }
    records = execution_records(root, task_id)
    latest_plan_index = max(
        (index for index, record in enumerate(records) if record.get("type") == "plan"),
        default=-1,
    )
    lifecycle_by_unit: dict[str, list[dict]] = {unit_id: [] for unit_id in unit_by_id}
    for record in records[latest_plan_index + 1 :]:
        unit_id = str(record.get("unit_id") or "")
        if record.get("type") in {"dispatch", "result"} and unit_id in unit_by_id:
            lifecycle_by_unit[unit_id].append(record)
    missing_dispatches = sorted(
        unit_id
        for unit_id, lifecycle in lifecycle_by_unit.items()
        if not any(record.get("type") == "dispatch" for record in lifecycle)
    )
    if missing_dispatches:
        raise StateError(
            "Canonical Spec implementation is missing dispatch records for units: "
            + ", ".join(missing_dispatches)
        )
    missing_results = sorted(
        unit_id
        for unit_id, lifecycle in lifecycle_by_unit.items()
        if not lifecycle or lifecycle[-1].get("type") != "result"
    )
    if missing_results:
        raise StateError(
            "Canonical Spec implementation is missing result records for units: "
            + ", ".join(missing_results)
        )
    for unit_id, unit in unit_by_id.items():
        lifecycle = lifecycle_by_unit[unit_id]
        if len(lifecycle) < 2 or lifecycle[-2].get("type") != "dispatch":
            raise StateError(
                f"Canonical Spec result {unit_id} has no matching preceding dispatch record."
            )
        dispatch = lifecycle[-2]
        if (
            dispatch.get("repo_id") != unit.get("repo_id")
            or dispatch.get("source_task_id") != unit.get("source_task_id")
        ):
            raise StateError(
                f"Canonical Spec dispatch {unit_id} must preserve repository/source-task ownership."
            )
        result = lifecycle[-1]
        if (
            result.get("repo_id") != unit.get("repo_id")
            or result.get("source_task_id") != unit.get("source_task_id")
            or result.get("status") != "completed"
            or not isinstance(result.get("changed_files"), list)
            or not set(result.get("changed_files", [])).issubset(set(unit.get("files", [])))
            or not is_non_empty_string(result.get("summary"))
            or result.get("issues") != []
            or result.get("needs_attention") != []
        ):
            raise StateError(
                f"Canonical Spec result {unit_id} must be completed without unresolved issues, "
                "preserve repository/source-task ownership, and remain within the Unit file scope."
            )


def validate_review_readiness(root: Path, task_id: str, task: dict) -> None:
    validate_spec_implementation_results(root, task_id, task)
    is_spec_task = isinstance(task.get("spec_source"), dict)
    if task.get("workflow_mode_legacy") is True and not is_spec_task:
        return
    expected = implementation_fingerprint(root, task_id)
    latest_by_dimension: dict[str, dict] = {}
    for record in execution_records(root, task_id):
        if (
            record.get("type") == "review"
            and record.get("implementation_fingerprint") == expected
            and is_non_empty_string(record.get("dimension"))
        ):
            dimension = str(record["dimension"])
            source_task_id = str(record.get("source_task_id") or "")
            record_key = f"{dimension}\0{source_task_id}" if is_spec_task else dimension
            latest_by_dimension[record_key] = record
    if not latest_by_dimension:
        raise StateError(
            "REVIEW cannot advance to VERIFICATION without a review record for the current implementation fingerprint."
        )
    for record in latest_by_dimension.values():
        if (
            not is_non_empty_string(record.get("reviewer"))
            or not is_non_empty_string(record.get("timestamp"))
            or not isinstance(record.get("findings"), list)
        ):
            raise StateError(
                "Review evidence for new tasks must include reviewer, timestamp, and a findings array."
            )
        if not all(is_valid_review_finding(finding) for finding in record["findings"]):
            raise StateError(
                "Each review finding must include a non-empty file and issue, a positive integer "
                "line, and severity error, warning, or info."
            )
    if is_spec_task:
        plan = latest_execution_plan(root, task_id) or {}
        task_repositories = {
            str(unit.get("source_task_id")): str(unit.get("repo_id"))
            for unit in plan.get("units", [])
            if isinstance(unit, dict)
            and is_non_empty_string(unit.get("source_task_id"))
            and is_non_empty_string(unit.get("repo_id"))
        }
        reviewed_dimensions: dict[str, set[str]] = {
            source_task_id: set() for source_task_id in task_repositories
        }
        for record in latest_by_dimension.values():
            source_task_id = str(record.get("source_task_id") or "")
            repo_id = str(record.get("repo_id") or "")
            if source_task_id not in task_repositories or repo_id != task_repositories[source_task_id]:
                raise StateError(
                    "Canonical Spec review evidence must preserve repository/source-task ownership."
                )
            for finding in record["findings"]:
                finding_path = Path(str(finding["file"]))
                if finding_path.is_absolute() or ".." in finding_path.parts:
                    raise StateError(
                        "Canonical Spec review findings must use safe repository-relative paths."
                    )
            reviewed_dimensions[source_task_id].add(str(record["dimension"]))
        missing_review_tasks = sorted(
            source_task_id
            for source_task_id, dimensions in reviewed_dimensions.items()
            if not dimensions
        )
        if missing_review_tasks:
            raise StateError(
                "Canonical Spec review evidence does not cover selected source tasks: "
                + ", ".join(missing_review_tasks)
            )
    has_failed_dimension = False
    for record in latest_by_dimension.values():
        findings = record.get("findings")
        has_blocker = isinstance(findings, list) and any(
            isinstance(finding, dict)
            and str(finding.get("severity") or "").lower() == "error"
            for finding in findings
        )
        if record.get("passed") is not True or has_blocker:
            has_failed_dimension = True
            break
    if has_failed_dimension:
        raise StateError(
            "REVIEW cannot advance to VERIFICATION while a current review dimension is not passed or has error findings."
        )
    if task.get("workflow_mode") == "strict":
        if is_spec_task:
            missing_strict_dimensions = sorted(
                source_task_id
                for source_task_id, dimensions in reviewed_dimensions.items()
                if len(dimensions) < 2
            )
            if missing_strict_dimensions:
                raise StateError(
                    "Strict Canonical Spec review requires at least two passed dimensions for "
                    "every selected source task: " + ", ".join(missing_strict_dimensions)
                )
        elif len(latest_by_dimension) < 2:
            raise StateError(
                "Strict workflow requires at least two passed review dimensions for the current implementation fingerprint."
            )


def validate_verification_readiness(root: Path, task_id: str, task: dict) -> None:
    fingerprints = evidence_fingerprints(root, task_id)
    is_spec_task = isinstance(task.get("spec_source"), dict)
    if (
        (task.get("workflow_mode_legacy") is not True or is_spec_task)
        and task.get("workflow_mode_legacy_review_bypass_fingerprint")
        != fingerprints["implementation_fingerprint"]
    ):
        validate_review_readiness(root, task_id, task)
    latest_by_check: dict[str, dict] = {}
    for record in execution_records(root, task_id):
        if (
            record.get("type") == "verify"
            and record.get("implementation_fingerprint")
            == fingerprints["implementation_fingerprint"]
            and record.get("config_fingerprint") == fingerprints["config_fingerprint"]
            and is_non_empty_string(record.get("check"))
        ):
            check = str(record["check"])
            if is_spec_task:
                check = f"{check}\0{record.get('source_task_id') or ''}"
            previous = latest_by_check.get(check)
            if (
                record.get("applicable") is False
                and previous is not None
                and previous.get("applicable") is not False
            ):
                continue
            latest_by_check[check] = record
    if not latest_by_check:
        raise StateError(
            "VERIFICATION cannot advance to MEMORY without verification evidence for the current implementation and config fingerprints."
        )
    if task.get("workflow_mode_legacy") is not True or is_spec_task:
        for record in latest_by_check.values():
            check_type = str(record.get("check_type") or "")
            if (
                check_type not in STRICT_VERIFICATION_CHECK_TYPES
                or not is_non_empty_string(record.get("timestamp"))
                or (
                    record.get("applicable") is not False
                    and not is_non_empty_string(record.get("command"))
                )
            ):
                raise StateError(
                    "Verification evidence for new tasks must include check_type, timestamp, and command for applicable checks."
                )
            if record.get("applicable") is False and not is_non_empty_string(
                record.get("not_applicable_reason")
            ):
                raise StateError(
                    "Verification evidence marked not applicable must include a non-empty not_applicable_reason."
                )
    if is_spec_task:
        plan = latest_execution_plan(root, task_id) or {}
        task_repositories = {
            str(unit.get("source_task_id")): str(unit.get("repo_id"))
            for unit in plan.get("units", [])
            if isinstance(unit, dict)
            and is_non_empty_string(unit.get("source_task_id"))
            and is_non_empty_string(unit.get("repo_id"))
        }
        for record in latest_by_check.values():
            source_task_id = str(record.get("source_task_id") or "")
            if (
                source_task_id not in task_repositories
                or record.get("repo_id") != task_repositories[source_task_id]
            ):
                raise StateError(
                    "Canonical Spec verification evidence must preserve "
                    "repository/source-task ownership."
                )
    applicable_records = [
        record for record in latest_by_check.values() if record.get("applicable") is not False
    ]
    if not applicable_records:
        raise StateError(
            "VERIFICATION cannot advance to MEMORY without at least one applicable executed check."
        )
    if any(record.get("passed") is not True for record in applicable_records):
        raise StateError(
            "VERIFICATION cannot advance to MEMORY while current verification evidence contains failures."
        )
    if task.get("workflow_mode") == "strict":
        if is_spec_task:
            check_types_by_repository: dict[str, set[str]] = {
                repo_id: set() for repo_id in set(task_repositories.values())
            }
            for record in latest_by_check.values():
                repo_id = str(record.get("repo_id") or "")
                check_type = str(record.get("check_type") or "")
                if repo_id in check_types_by_repository and check_type in STRICT_VERIFICATION_CHECK_TYPES:
                    check_types_by_repository[repo_id].add(check_type)
            missing_by_repository = {
                repo_id: sorted(STRICT_VERIFICATION_CHECK_TYPES - check_types)
                for repo_id, check_types in check_types_by_repository.items()
                if check_types != STRICT_VERIFICATION_CHECK_TYPES
            }
            if missing_by_repository:
                raise StateError(
                    "Strict Canonical Spec verification requires every repository to cover "
                    "lint, typecheck, test, and build: "
                    + "; ".join(
                        f"{repo_id} missing {', '.join(check_types)}"
                        for repo_id, check_types in sorted(missing_by_repository.items())
                    )
                )
        else:
            latest_by_type: dict[str, dict] = {}
            for record in latest_by_check.values():
                check_type = str(record.get("check_type") or "")
                if check_type in STRICT_VERIFICATION_CHECK_TYPES:
                    latest_by_type[check_type] = record
            missing_types = sorted(STRICT_VERIFICATION_CHECK_TYPES - latest_by_type.keys())
            if missing_types:
                raise StateError(
                    "Strict workflow requires current verification evidence for every check type: "
                    + ", ".join(missing_types)
                    + "."
                )
            for check_type, record in latest_by_type.items():
                if record.get("applicable") is False and not is_non_empty_string(
                    record.get("not_applicable_reason")
                ):
                    raise StateError(
                        "Strict workflow requires a non-empty not_applicable_reason when "
                        f"{check_type} is marked not applicable."
                    )
    if is_spec_task:
        inspect_task_spec(root, task)
        plan = latest_execution_plan(root, task_id)
        required_test_commands = {
            (
                str(unit.get("source_task_id")),
                str(unit.get("repo_id")),
                str(command),
            )
            for unit in (plan or {}).get("units", [])
            if isinstance(unit, dict)
            for command in unit.get("test_commands", [])
            if is_non_empty_string(command)
        }
        executed_commands = {
            (
                str(record.get("source_task_id")),
                str(record.get("repo_id")),
                str(record.get("command")),
            )
            for record in applicable_records
            if is_non_empty_string(record.get("command"))
        }
        missing_commands = sorted(required_test_commands - executed_commands)
        if missing_commands:
            raise StateError(
                "Canonical Spec verification is missing source test commands: "
                + ", ".join(
                    f"{source_task_id}@{repo_id}: {command}"
                    for source_task_id, repo_id, command in missing_commands
                )
            )
        covered_verification_tasks = {
            str(record.get("source_task_id")) for record in applicable_records
        }
        missing_verification_tasks = sorted(
            set(task_repositories) - covered_verification_tasks
        )
        if missing_verification_tasks:
            raise StateError(
                "Canonical Spec verification evidence does not cover selected source tasks: "
                + ", ".join(missing_verification_tasks)
            )
        pending_integration = [
            record
            for record in task.get("spec_dependency_evidence", [])
            if isinstance(record, dict)
            and record.get("dependency_type") == "integration"
            and record.get("status") != "satisfied"
        ]
        if pending_integration:
            edges = ", ".join(
                f"{record.get('source_task_id')}->{record.get('task_id')}"
                for record in pending_integration
            )
            raise StateError(
                "VERIFICATION cannot advance to MEMORY while Canonical Spec integration "
                f"dependencies are pending: {edges}."
            )


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

    plan_is_valid = has_valid_execution_plan(root, task_id)
    if not plan_is_valid:
        reasons.append("execution.jsonl has no valid plan record")
    if task and isinstance(task.get("spec_source"), dict):
        try:
            inspection, selection = inspect_task_spec(root, task)
            required_markers = [
                str(task["spec_source"].get("path") or ""),
                str(task["spec_source"].get("spec_id") or ""),
                str(task["spec_source"].get("sha256") or ""),
                *[str(task_id) for task_id in selection["selected_task_ids"]],
                *[str(repo_id) for repo_id in selection["selected_repo_ids"]],
                *[
                    f"{repo_id}={inspection['baseline_status'].get(repo_id)}"
                    for repo_id in selection["selected_repo_ids"]
                ],
            ]
            missing_markers = [
                marker
                for marker in required_markers
                if marker and not contains_spec_marker(dev_spec_content, marker)
            ]
            revision = task["spec_source"].get("revision")
            if (
                type(revision) is not int
                or re.search(
                    rf"\brevision\s*[:：=]\s*{revision}(?!\d)",
                    dev_spec_content,
                    re.IGNORECASE,
                )
                is None
            ):
                missing_markers.append(f"revision={revision}")
            if missing_markers:
                reasons.append(
                    "dev-spec.md is missing Canonical Spec traceability markers: "
                    + ", ".join(missing_markers)
                )
            selected_repo_ids = set(selection["selected_repo_ids"])
            bindings = task.get("spec_repositories")
            bound_repo_ids = {
                str(binding.get("repo_id"))
                for binding in bindings or []
                if isinstance(binding, dict)
            }
            if bound_repo_ids != selected_repo_ids:
                reasons.append("spec_repositories do not cover selected Canonical Spec tasks")
            if inspection.get("unresolved_repositories"):
                reasons.append(
                    "Canonical Spec repository bindings are unresolved: "
                    + ", ".join(inspection["unresolved_repositories"])
                )
            unavailable_repositories = [
                repo_id
                for repo_id in selection["selected_repo_ids"]
                if inspection["baseline_status"].get(repo_id) == "baseline-unavailable"
            ]
            if unavailable_repositories:
                reasons.append(
                    "Canonical Spec baselines are unavailable: "
                    + ", ".join(unavailable_repositories)
                )
            if plan_is_valid:
                plan = latest_execution_plan(root, task_id)
                if plan is None:
                    reasons.append("Canonical Spec execution plan cannot be loaded")
                else:
                    task_repository_scopes(root, task, plan)
                    derived_markers = [
                        *[
                            str(unit.get("id") or "")
                            for unit in plan.get("units", [])
                            if isinstance(unit, dict)
                        ],
                        *[
                            str(step_id)
                            for unit in plan.get("units", [])
                            if isinstance(unit, dict)
                            for step_id in unit.get("source_step_ids", [])
                        ],
                        *[
                            f"{record.get('source_task_id')}->{record.get('task_id')}"
                            for record in task.get("spec_dependency_evidence", [])
                            if isinstance(record, dict)
                            and record.get("dependency_type") == "integration"
                            and record.get("status") == "pending"
                        ],
                        *[
                            str(record.get("required_evidence") or "")
                            for record in task.get("spec_dependency_evidence", [])
                            if isinstance(record, dict)
                            and record.get("dependency_type") == "integration"
                            and record.get("status") == "pending"
                        ],
                    ]
                    missing_derived_markers = [
                        marker
                        for marker in derived_markers
                        if marker and not contains_spec_marker(dev_spec_content, marker)
                    ]
                    if missing_derived_markers:
                        reasons.append(
                            "dev-spec.md is missing Canonical Spec Unit/dependency markers: "
                            + ", ".join(dict.fromkeys(missing_derived_markers))
                        )
                    if test_strategy.is_file():
                        test_strategy_content = test_strategy.read_text(encoding="utf-8")
                        if test_strategy_content.strip():
                            missing_test_markers = missing_spec_test_strategy_markers(
                                selection, plan, test_strategy_content
                            )
                            if missing_test_markers:
                                reasons.append(
                                    "test-strategy.md is missing Canonical Spec markers: "
                                    + ", ".join(missing_test_markers)
                                )
        except StateError as exc:
            reasons.append(str(exc))
        except OSError:
            reasons.append("test-strategy.md cannot be read")
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


def spec_task_summary(task: dict | None) -> dict | None:
    if not task or not isinstance(task.get("spec_source"), dict):
        return None
    dependencies = task.get("spec_dependency_evidence")
    pending_dependencies = [
        {
            "source_task_id": record.get("source_task_id"),
            "task_id": record.get("task_id"),
            "dependency_type": record.get("dependency_type"),
            "required_evidence": record.get("required_evidence"),
        }
        for record in dependencies or []
        if isinstance(record, dict) and record.get("status") == "pending"
    ]
    return {
        "source": task["spec_source"],
        "selected_spec_tasks": task.get("selected_spec_tasks", []),
        "repositories": task.get("spec_repositories", []),
        "pending_dependencies": pending_dependencies,
    }


def transition_requires_confirmation(
    previous: str,
    current: str,
    task_type: str,
    approval_mode: str,
) -> bool:
    if (previous, current) in ALWAYS_AUTO_TRANSITIONS:
        return False
    if current == "CLOSED":
        return True
    if approval_mode == "auto":
        return False
    if approval_mode == "guard":
        return (previous, current) in CRITICAL_CONFIRM_TRANSITIONS
    if approval_mode == "confirm":
        return (previous, current) == ANALYSIS_CONFIRM_TRANSITION
    if approval_mode == "approve":
        return True
    raise StateError(f"Unknown approval mode: {approval_mode}")


def is_automatic_transition(
    previous: str,
    current: str,
    task_type: str,
    approval_mode: str,
) -> bool:
    return not transition_requires_confirmation(previous, current, task_type, approval_mode)


def validate_transition(
    previous: str,
    current: str,
    task_type: str = "",
    task: dict | None = None,
) -> str | None:
    if previous == current:
        return None
    normalized_task_type = task_type.strip().lower()
    allowed = set(VALID_TRANSITIONS.get(previous, set()))
    if previous == "IMPLEMENT" and normalized_task_type in NO_CODE_TASK_TYPES:
        allowed = {"ANALYSIS", "COMPLETE", "CLOSED"}
    elif previous == "IMPLEMENT":
        allowed.discard("COMPLETE")
        if not (
            isinstance(task, dict)
            and task.get("workflow_mode_legacy_direct_edge") is True
        ):
            allowed.discard("VERIFICATION")
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

    (
        project_approval_mode,
        session_approval_mode,
        effective_approval_mode,
        project_workflow_mode,
        session_workflow_mode,
        configured_workflow_mode,
    ) = resolve_behavior(root, resolved_session)
    concrete_workflow_mode = None
    if task:
        concrete_workflow_mode = task.get("workflow_mode")
        proposal = task.get("workflow_mode_proposal")
        if concrete_workflow_mode is None and isinstance(proposal, dict):
            concrete_workflow_mode = proposal.get("selected_mode")

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
        "project_approval_mode": project_approval_mode,
        "session_approval_mode": session_approval_mode,
        "effective_approval_mode": effective_approval_mode,
        "project_workflow_mode": project_workflow_mode,
        "session_workflow_mode": session_workflow_mode,
        "configured_workflow_mode": configured_workflow_mode,
        "concrete_workflow_mode": concrete_workflow_mode,
        "spec_summary": spec_task_summary(task),
        # Compatibility output aliases for pre-0.9 clients.
        "project_confirm_mode": project_approval_mode,
        "session_confirm_mode": session_approval_mode,
        "effective_confirm_mode": effective_approval_mode,
        "harness_disabled": resolved_session.get("harness_disabled") is True,
    }


def build_status_line(
    root: Path,
    session: dict,
    agent: str | None = None,
    session_file: str | Path | None = None,
) -> str:
    state = snapshot_state(root, session_file, session)
    approval = str(state["effective_approval_mode"]).capitalize()
    workflow = str(state["concrete_workflow_mode"] or state["configured_workflow_mode"]).capitalize()
    status_brand = f"> **Easy Coding** · **Approval: {approval}** · **Workflow: {workflow}**"
    task_id = state["current_task"]
    if task_id:
        status = str(state["status"])
        line = f"{status_brand} · `{task_id}` · `{status}`"
        last_agent = state.get("last_agent")
        if agent and last_agent and not agents_equivalent(last_agent, agent):
            line += f" · Handoff -> `{last_agent}`"
        if state["is_terminal"] or state["task_missing"]:
            line += f" · {HELP_SUFFIX}"
        return line

    if is_project_init_required(root):
        return f"{status_brand} · {WAITING_INIT_LINE}"

    pending = get_pending_init_version(root)
    if pending:
        return (
            f"{status_brand} · Waiting init · "
            f"Upgrade to v{pending} — run `ec-init` to adapt"
        )

    return f"{status_brand} · {READY_LINE}"


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
        f"[easy-coding:approval-mode:{state['effective_approval_mode']}]",
        f"[easy-coding:configured-workflow-mode:{state['configured_workflow_mode']}]",
    ]
    if state.get("concrete_workflow_mode"):
        lines.append(f"[easy-coding:workflow-mode:{state['concrete_workflow_mode']}]")

    if task_id:
        lines.append(f"[current-task:{task_id}]")
        if state["task_missing"]:
            lines.append(f"[easy-coding:current-task-missing:{task_id}]")
        last_agent = state.get("last_agent")
        if agent and last_agent and not agents_equivalent(last_agent, agent):
            lines.append(f"[easy-coding:handoff-from:{last_agent}]")
        pending = state.get("pending_transition")
        if isinstance(pending, dict):
            source = str(pending.get("from") or stage)
            target = str(pending.get("to") or "")
            if target:
                lines.append(f"[easy-coding:pending-transition:{source}->{target}]")
                task_type = str(task.get("type") or "") if task else ""
                legacy_review_bypass = (
                    source == "IMPLEMENT"
                    and target == "REVIEW"
                    and isinstance(task, dict)
                    and task.get("workflow_mode_legacy_direct_edge") is True
                )
                if legacy_review_bypass:
                    lines.append(
                        "[easy-coding:lite-review-bypass-required:IMPLEMENT->REVIEW]"
                    )
                elif is_automatic_transition(
                    source,
                    target,
                    task_type,
                    str(state["effective_approval_mode"]),
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
    return "continue" if not last_agent or agents_equivalent(last_agent, agent) else "takeover"


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
                "spec_summary": spec_task_summary(task),
            }
        )
    return items


def ensure_session(root: Path, session_file: str | Path | None = None) -> dict:
    session = load_session(root, session_file)
    if session is None:
        session = default_session()
    if not session.get("created_at"):
        session["created_at"] = now_iso()
    session["last_active_at"] = now_iso()
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


def set_session_approval_mode(
    root: Path,
    mode: str,
    agent: str,
    session_file: str | Path | None = None,
) -> dict:
    if mode not in APPROVAL_MODES:
        raise StateError("Invalid approval mode: expected approve, guard, confirm, or auto.")
    session = ensure_session(root, session_file)
    materialize_legacy_session_behavior(session)
    session["approval_mode"] = mode
    session["last_agent"] = agent
    write_session(root, session, session_file)
    snapshot = snapshot_state(root, session_file, session)
    snapshot["action"] = "set-approval-mode"
    return snapshot


def set_session_legacy_confirm_mode(
    root: Path,
    mode: str,
    agent: str,
    session_file: str | Path | None = None,
) -> dict:
    session = ensure_session(root, session_file)
    materialize_legacy_session_behavior(session)
    if mode == "lite":
        session["approval_mode"] = "guard"
        session["workflow_mode"] = "fast"
        session["workflow_mode_legacy_confirm_override"] = True
        session.pop("workflow_mode_legacy_alias_override", None)
    else:
        session["approval_mode"] = mode
        legacy_lite_owned = (
            session.pop("workflow_mode_legacy_confirm_override", None) is True
        )
        legacy_alias_owned = (
            session.get("workflow_mode_legacy_alias_override") is True
        )
        if (
            "workflow_mode" not in session
            or legacy_lite_owned
            or legacy_alias_owned
        ):
            session["workflow_mode"] = "adaptive"
            session["workflow_mode_legacy_alias_override"] = True
    session["last_agent"] = agent
    write_session(root, session, session_file)
    snapshot = snapshot_state(root, session_file, session)
    snapshot["action"] = "set-confirm-mode"
    return snapshot


def clear_session_approval_mode(
    root: Path,
    agent: str,
    session_file: str | Path | None = None,
) -> dict:
    session = ensure_session(root, session_file)
    materialize_legacy_session_behavior(session)
    session.pop("approval_mode", None)
    session["last_agent"] = agent
    write_session(root, session, session_file)
    snapshot = snapshot_state(root, session_file, session)
    snapshot["action"] = "clear-approval-mode"
    return snapshot


def clear_session_legacy_confirm_mode(
    root: Path,
    agent: str,
    session_file: str | Path | None = None,
) -> dict:
    session = ensure_session(root, session_file)
    materialize_legacy_session_behavior(session)
    session.pop("approval_mode", None)
    legacy_lite_owned = session.pop("workflow_mode_legacy_confirm_override", False)
    legacy_alias_owned = session.pop("workflow_mode_legacy_alias_override", False)
    if legacy_lite_owned or legacy_alias_owned:
        session.pop("workflow_mode", None)
    session["last_agent"] = agent
    write_session(root, session, session_file)
    snapshot = snapshot_state(root, session_file, session)
    snapshot["action"] = "clear-confirm-mode"
    return snapshot


def set_session_workflow_mode(
    root: Path,
    mode: str,
    agent: str,
    session_file: str | Path | None = None,
) -> dict:
    if mode not in CONFIGURED_WORKFLOW_MODES:
        raise StateError(
            "Invalid workflow mode: expected adaptive, fast, standard, or strict."
        )
    session = ensure_session(root, session_file)
    materialize_legacy_session_behavior(session)
    session["workflow_mode"] = mode
    session.pop("workflow_mode_legacy_confirm_override", None)
    session.pop("workflow_mode_legacy_alias_override", None)
    session["last_agent"] = agent
    write_session(root, session, session_file)
    snapshot = snapshot_state(root, session_file, session)
    snapshot["action"] = "set-workflow-mode"
    return snapshot


def clear_session_workflow_mode(
    root: Path,
    agent: str,
    session_file: str | Path | None = None,
) -> dict:
    session = ensure_session(root, session_file)
    materialize_legacy_session_behavior(session)
    session.pop("workflow_mode", None)
    session.pop("workflow_mode_legacy_confirm_override", None)
    session.pop("workflow_mode_legacy_alias_override", None)
    session["last_agent"] = agent
    write_session(root, session, session_file)
    snapshot = snapshot_state(root, session_file, session)
    snapshot["action"] = "clear-workflow-mode"
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
    action = (
        "continue"
        if not previous_agent or agents_equivalent(previous_agent, agent)
        else "takeover"
    )
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
    task_fields: dict | None = None,
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
    if task_fields:
        task.update(task_fields)
    write_task(root, task_id, task)
    if set_current:
        return set_current_task(root, task_id, agent, session_file)
    return {"task_id": task_id, "task": task}


def ensure_path_inside_root(root: Path, path: Path, label: str) -> Path:
    resolved = path.resolve()
    try:
        resolved.relative_to(root.resolve())
    except ValueError as exc:
        raise StateError(f"{label} must be inside the Easy Coding project root.") from exc
    return resolved


def create_task_from_spec(
    root: Path,
    spec_path: str,
    spec_task_ids: list[str],
    task_id: str,
    task_type: str,
    title: str,
    repo_paths: dict[str, str],
    dependency_evidence: dict[str, str],
    agent: str,
    set_current: bool = True,
    session_file: str | Path | None = None,
) -> dict:
    raw_spec_path = Path(spec_path)
    resolved_spec_path = ensure_path_inside_root(
        root,
        raw_spec_path if raw_spec_path.is_absolute() else root / raw_spec_path,
        "Canonical Spec path",
    )
    try:
        inspection = inspect_spec(
            resolved_spec_path,
            root,
            repo_paths,
            spec_task_ids,
        )
        selection = select_tasks(inspection, spec_task_ids, dependency_evidence)
    except EasyDevSpecError as exc:
        raise StateError(f"Cannot create task from Canonical Spec: {exc}") from exc

    selected_repo_ids = set(selection["selected_repo_ids"])
    bindings = [
        binding
        for binding in inspection["repository_bindings"]
        if binding.get("repo_id") in selected_repo_ids
    ]
    if len(bindings) != len(selected_repo_ids):
        raise StateError("Canonical Spec repository bindings do not cover every selected task.")
    stored_repo_paths = {
        str(binding["repo_id"]): str(binding["path"])
        for binding in bindings
    }
    source_path = resolved_spec_path.relative_to(root.resolve()).as_posix()
    fields = {
        "repos": list(selection["selected_repo_ids"]),
        "repo_paths": stored_repo_paths,
        "spec_source": {
            "schema": inspection["schema"],
            "spec_id": inspection["spec_id"],
            "revision": inspection["revision"],
            "path": source_path,
            "sha256": inspection["source_sha256"],
        },
        "selected_spec_tasks": selection["selected_task_ids"],
        "spec_repositories": bindings,
        "spec_dependency_evidence": selection["dependency_records"],
    }
    return create_task(
        root,
        task_id,
        task_type,
        title,
        agent,
        set_current,
        session_file,
        fields,
    )


def satisfy_spec_dependency(
    root: Path,
    dependency_task_id: str,
    evidence: str,
    agent: str,
    source_task_id: str | None = None,
    task_id: str | None = None,
    session_file: str | Path | None = None,
) -> dict:
    session, resolved_task_id, task = resolve_current_task(root, task_id, session_file)
    if task.get("status") in TERMINAL_STATUSES or task.get("status") == "MEMORY":
        raise StateError("Spec dependency evidence cannot change after MEMORY begins.")
    if not is_non_empty_string(evidence):
        raise StateError("Spec dependency evidence must be non-empty.")
    inspect_task_spec(root, task)
    records = task.get("spec_dependency_evidence")
    if not isinstance(records, list):
        raise StateError("Current task is not backed by Canonical Spec dependency metadata.")
    matches = [
        record
        for record in records
        if isinstance(record, dict)
        and record.get("task_id") == dependency_task_id
        and (source_task_id is None or record.get("source_task_id") == source_task_id)
    ]
    if not matches:
        raise StateError("Canonical Spec dependency edge was not found.")
    if source_task_id is None and len(matches) > 1:
        raise StateError(
            "Canonical Spec dependency is ambiguous; pass --source-task to identify the edge."
        )
    record = matches[0]
    if record.get("dependency_type") == "contract":
        raise StateError("Contract dependencies are satisfied by the frozen READY Spec.")
    record["status"] = "satisfied"
    record["evidence"] = evidence.strip()
    record["satisfied_at"] = now_iso()
    record["satisfied_by"] = agent
    task["last_agent"] = agent
    write_task(root, resolved_task_id, task)
    snapshot = snapshot_state(root, session_file, session)
    snapshot["action"] = "satisfy-spec-dependency"
    return snapshot


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


def validate_workflow_mode_proposal(
    root: Path,
    session: dict,
    proposal: object,
    task_id: str | None = None,
) -> dict:
    if not isinstance(proposal, dict):
        raise StateError("workflow_mode_proposal is missing.")
    configured = str(proposal.get("configured_mode") or "")
    selected = str(proposal.get("selected_mode") or "")
    minimum = str(proposal.get("minimum_mode") or "")
    source = str(proposal.get("source") or "")
    reasons = proposal.get("reasons")
    effective_configured = resolve_behavior(root, session)[5]
    if configured != effective_configured:
        raise StateError(
            "Workflow proposal configured_mode no longer matches the effective project/session setting."
        )
    if configured not in CONFIGURED_WORKFLOW_MODES:
        raise StateError("Invalid configured workflow mode.")
    if selected not in WORKFLOW_MODES or minimum not in WORKFLOW_MODES:
        raise StateError("selected_mode and minimum_mode must be fast, standard, or strict.")
    if source not in {"project", "session", "adaptive", "user", "migration"}:
        raise StateError("Invalid workflow proposal source.")
    if not is_string_list(reasons, allow_empty=False):
        raise StateError("Workflow proposal reasons must contain at least one non-empty reason.")
    required_rank = WORKFLOW_MODE_RANK[minimum]
    if configured in WORKFLOW_MODES and WORKFLOW_MODE_RANK[minimum] < WORKFLOW_MODE_RANK[configured]:
        raise StateError(
            f"Workflow minimum {minimum} is below configured floor {configured}."
        )
    if task_id:
        calculated_minimum, calculated_reasons = calculate_workflow_floor(root, task_id)
        calculated_rank = WORKFLOW_MODE_RANK[calculated_minimum]
        if WORKFLOW_MODE_RANK[minimum] < calculated_rank:
            raise StateError(
                f"Workflow minimum {minimum} is below calculated floor {calculated_minimum}: "
                + ", ".join(calculated_reasons)
            )
        required_rank = max(required_rank, calculated_rank)
    if configured in WORKFLOW_MODES:
        required_rank = max(required_rank, WORKFLOW_MODE_RANK[configured])
    if WORKFLOW_MODE_RANK[selected] < required_rank:
        raise StateError(
            f"Workflow mode {selected} is below the allowed minimum for this task."
        )
    return proposal


def calculate_workflow_floor(root: Path, task_id: str) -> tuple[str, list[str]]:
    task = load_task(root, task_id)
    if task is None:
        raise StateError(f"Task not found: {task_id}")
    task_type = str(task.get("type") or "").strip().lower()
    if task_type in NO_CODE_TASK_TYPES:
        return "fast", ["read-only-task"]

    plan = latest_execution_plan(root, task_id)
    if not plan:
        raise StateError("Cannot calculate workflow floor without a valid execution plan.")
    units = [unit for unit in plan.get("units", []) if isinstance(unit, dict)]
    files = {
        str(file_name)
        for unit in units
        for file_name in unit.get("files", [])
        if is_non_empty_string(file_name)
    }
    repositories = task_repository_roots(root, task, plan)
    repos = task.get("repos")
    repo_paths = task.get("repo_paths")
    metadata_repo_count = max(
        len(repos) if isinstance(repos, list) else 0,
        len(repo_paths) if isinstance(repo_paths, dict) else 0,
    )
    repo_count = max(len(repositories), metadata_repo_count)
    risk_text = " ".join(
        [
            str(task.get("title") or ""),
            task_type,
            *files,
            *[
                str(item)
                for unit in units
                for field in ("risks", "contracts")
                for item in unit.get(field, [])
                if is_non_empty_string(item)
                and str(item).strip().lower() not in {"none", "no", "n/a", "无", "无风险"}
            ],
        ]
    )
    strict_reasons: list[str] = []
    if repo_count > 1:
        strict_reasons.append("cross-repository-scope")
    if len(units) >= 4 or len(files) >= 8:
        strict_reasons.append("broad-change-scope")
    if STRICT_WORKFLOW_RISK_PATTERN.search(risk_text):
        strict_reasons.append("high-risk-contract-or-domain")
    if strict_reasons:
        return "strict", strict_reasons

    standard_reasons: list[str] = []
    if len(units) > 1:
        standard_reasons.append("multiple-units")
    if len(files) >= 3:
        standard_reasons.append("multi-file-impact")
    if plan.get("strategy") == "parallel":
        standard_reasons.append("parallel-execution")
    if standard_reasons:
        return "standard", standard_reasons
    return "fast", ["single-bounded-unit"]


def propose_workflow_mode(
    root: Path,
    configured_mode: str,
    selected_mode: str,
    minimum_mode: str,
    source: str,
    reasons: list[str],
    agent: str,
    task_id: str | None = None,
    session_file: str | Path | None = None,
) -> dict:
    session, resolved_task_id, task = resolve_current_task(root, task_id, session_file)
    if str(task.get("status") or "") != "ANALYSIS":
        raise StateError("Workflow mode can only be proposed during ANALYSIS.")
    proposal = {
        "configured_mode": configured_mode,
        "selected_mode": selected_mode,
        "minimum_mode": minimum_mode,
        "source": source,
        "reasons": [reason.strip() for reason in reasons if reason.strip()],
        "proposed_at": now_iso(),
        "proposed_by": agent,
    }
    validate_workflow_mode_proposal(root, session, proposal, resolved_task_id)
    task["workflow_mode_proposal"] = proposal
    task["last_agent"] = agent
    write_task(root, resolved_task_id, task)
    snapshot = snapshot_state(root, session_file, session)
    snapshot["action"] = "propose-workflow-mode"
    return snapshot


def freeze_workflow_mode(
    root: Path, session: dict, task_id: str, task: dict, agent: str
) -> None:
    proposal = validate_workflow_mode_proposal(
        root, session, task.get("workflow_mode_proposal"), task_id
    )
    task["workflow_mode"] = proposal["selected_mode"]
    task["workflow_mode_confirmed_at"] = now_iso()
    task["workflow_mode_confirmed_by"] = agent


def raise_workflow_mode(
    root: Path,
    mode: str,
    reason: str,
    agent: str,
    task_id: str | None = None,
    session_file: str | Path | None = None,
) -> dict:
    session, resolved_task_id, task = resolve_current_task(root, task_id, session_file)
    stage = str(task.get("status") or "")
    if stage == "VERIFICATION":
        raise StateError(
            "Return to IMPLEMENT before raising workflow mode from VERIFICATION so the "
            "task can re-enter REVIEW with fresh evidence."
        )
    if stage not in {"IMPLEMENT", "REVIEW"}:
        raise StateError("A frozen workflow mode can only be raised during active execution.")
    current = str(task.get("workflow_mode") or "")
    if current not in WORKFLOW_MODES or mode not in WORKFLOW_MODES:
        raise StateError("Workflow mode must be frozen before it can be raised.")
    if WORKFLOW_MODE_RANK[mode] <= WORKFLOW_MODE_RANK[current]:
        raise StateError(f"Workflow mode can only be raised above {current}.")
    task["workflow_mode"] = mode
    task.setdefault("workflow_mode_escalations", []).append(
        {
            "from": current,
            "to": mode,
            "reason": reason.strip(),
            "raised_at": now_iso(),
            "raised_by": agent,
        }
    )
    task["last_agent"] = agent
    write_task(root, resolved_task_id, task)
    snapshot = snapshot_state(root, session_file, session)
    snapshot["action"] = "raise-workflow-mode"
    return snapshot


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
    approval_mode = resolve_approval_mode(root, session)[2]
    if previous == stage:
        raise StateError(f"Transition target must differ from current stage: {stage}")

    violation = validate_transition(previous, stage, task_type, task)
    if violation:
        raise StateError(violation)
    if is_automatic_transition(previous, stage, task_type, approval_mode):
        raise StateError(
            f"Transition {previous} -> {stage} is automatic in {approval_mode} mode; "
            "use auto-transition instead."
        )
    if previous == "ANALYSIS" and stage == "IMPLEMENT":
        validate_analysis_readiness(root, resolved_task_id)
        if task.get("workflow_mode_legacy") is not True:
            validate_workflow_mode_proposal(
                root,
                session,
                task.get("workflow_mode_proposal"),
                resolved_task_id,
            )
    if previous == "REVIEW" and stage == "VERIFICATION":
        validate_review_readiness(root, resolved_task_id, task)
    if previous == "VERIFICATION" and stage == "MEMORY":
        validate_verification_readiness(root, resolved_task_id, task)
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
    approval_mode = resolve_approval_mode(root, session)[2]
    legacy_edge = task.get("workflow_mode_legacy") is True
    violation = validate_transition(previous, stage, task_type, task)
    if violation:
        raise StateError(violation)
    if previous == "ANALYSIS" and stage == "IMPLEMENT":
        validate_analysis_readiness(root, resolved_task_id)
        if task.get("workflow_mode_legacy") is not True:
            freeze_workflow_mode(root, session, resolved_task_id, task, agent)
    if previous == "REVIEW" and stage == "VERIFICATION":
        validate_review_readiness(root, resolved_task_id, task)
    if previous == "VERIFICATION" and stage == "MEMORY":
        validate_verification_readiness(root, resolved_task_id, task)
    if previous == "MEMORY" and stage == "COMPLETE":
        progress = task.get("memory_progress")
        if not isinstance(progress, dict) or progress.get("completed") is not True:
            raise StateError("MEMORY cannot advance to COMPLETE before memory processing completes.")
    if (previous, stage) == READ_ONLY_COMPLETION_TRANSITION:
        validate_read_only_completion(root, resolved_task_id)
    if previous != stage:
        task["status"] = stage
        append_stage_history(task, stage, agent)
        if legacy_edge:
            task.pop("workflow_mode_legacy", None)
            if previous in {"IMPLEMENT", "REVIEW"} and stage == "VERIFICATION":
                task["workflow_mode_legacy_review_bypass_fingerprint"] = (
                    implementation_fingerprint(root, resolved_task_id)
                )
        task.pop("workflow_mode_legacy_direct_edge", None)
        if stage in {"ANALYSIS", "IMPLEMENT", "MEMORY", "COMPLETE", "CLOSED"}:
            task.pop("workflow_mode_legacy_review_bypass_fingerprint", None)
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
    approval_mode = resolve_approval_mode(root, session)[2]
    if not is_automatic_transition(previous, stage, task_type, approval_mode):
        raise StateError(
            f"Automatic transition is not allowed in {approval_mode} mode: {previous} -> {stage}."
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
    approval_mode = resolve_approval_mode(root, session)[2]
    source = str(pending.get("from") or "")
    target = str(pending.get("to") or "")
    if source != previous:
        raise StateError(
            f"Pending transition source {source or 'missing'} does not match current stage {previous}."
        )
    if stage and stage != target:
        raise StateError(f"Pending transition targets {target}, not {stage}.")
    if is_automatic_transition(source, target, task_type, approval_mode):
        raise StateError(
            f"Transition {source} -> {target} is automatic in {approval_mode} mode; "
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
        root,
        resolved_task_id,
        memory_file.strip(),
        require_current_id=True,
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
        violation = validate_transition(str(last_seen_stage), stage, task_type, task)

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


def parse_mapping_args(values: list[str], label: str) -> dict[str, str]:
    mappings: dict[str, str] = {}
    for value in values:
        key, separator, mapped_value = value.partition("=")
        if not separator or not key.strip() or not mapped_value.strip():
            raise StateError(f"{label} must use KEY=VALUE syntax: {value!r}")
        key = key.strip()
        if key in mappings:
            raise StateError(f"{label} contains a duplicate key: {key}")
        mappings[key] = mapped_value.strip()
    return mappings


def main() -> int:
    configure_stdio()
    common = argparse.ArgumentParser(add_help=False)
    add_common_args(common)
    parser = argparse.ArgumentParser(description="Easy Coding runtime state API")
    subcommands = parser.add_subparsers(dest="command")

    snapshot_parser = subcommands.add_parser("snapshot", parents=[common])
    snapshot_parser.add_argument("--agent")

    list_tasks_parser = subcommands.add_parser("list-tasks", parents=[common])
    list_tasks_parser.add_argument("--agent")

    inspect_spec_parser = subcommands.add_parser("inspect-dev-spec", parents=[common])
    inspect_spec_parser.add_argument("--spec", required=True)
    inspect_spec_parser.add_argument("--repo-path", action="append", default=[])

    select_spec_scope = subcommands.add_parser("select-dev-spec-scope", parents=[common])
    select_spec_scope.add_argument("--spec", required=True)
    select_spec_scope.add_argument("--spec-task", required=True, action="append")

    create = subcommands.add_parser("create-task", parents=[common])
    create.add_argument("--task-id", required=True)
    create.add_argument("--type", required=True)
    create.add_argument("--title", required=True)
    create.add_argument("--agent", required=True)
    create.add_argument("--no-set-current", action="store_true")

    create_from_spec = subcommands.add_parser("create-task-from-spec", parents=[common])
    create_from_spec.add_argument("--spec", required=True)
    create_from_spec.add_argument("--spec-task", required=True, action="append")
    create_from_spec.add_argument("--task-id", required=True)
    create_from_spec.add_argument("--type", required=True)
    create_from_spec.add_argument("--title", required=True)
    create_from_spec.add_argument("--repo-path", required=True, action="append")
    create_from_spec.add_argument("--dependency-evidence", action="append", default=[])
    create_from_spec.add_argument("--agent", required=True)
    create_from_spec.add_argument("--no-set-current", action="store_true")

    set_current = subcommands.add_parser("set-current", parents=[common])
    set_current.add_argument("--task-id", required=True)
    set_current.add_argument("--agent", required=True)

    clear_current = subcommands.add_parser("clear-current", parents=[common])
    clear_current.add_argument("--agent", required=True)

    set_approval_mode_parser = subcommands.add_parser("set-approval-mode", parents=[common])
    set_approval_mode_parser.add_argument("--mode", required=True, choices=sorted(APPROVAL_MODES))
    set_approval_mode_parser.add_argument("--agent", required=True)

    clear_approval_mode_parser = subcommands.add_parser("clear-approval-mode", parents=[common])
    clear_approval_mode_parser.add_argument("--agent", required=True)

    set_workflow_mode_parser = subcommands.add_parser("set-workflow-mode", parents=[common])
    set_workflow_mode_parser.add_argument(
        "--mode", required=True, choices=sorted(CONFIGURED_WORKFLOW_MODES)
    )
    set_workflow_mode_parser.add_argument("--agent", required=True)

    clear_workflow_mode_parser = subcommands.add_parser("clear-workflow-mode", parents=[common])
    clear_workflow_mode_parser.add_argument("--agent", required=True)

    # Compatibility aliases for pre-0.9 callers.
    set_confirm_mode_parser = subcommands.add_parser("set-confirm-mode", parents=[common])
    set_confirm_mode_parser.add_argument(
        "--mode", required=True, choices=sorted(APPROVAL_MODES | {"lite"})
    )
    set_confirm_mode_parser.add_argument("--agent", required=True)

    clear_confirm_mode_parser = subcommands.add_parser("clear-confirm-mode", parents=[common])
    clear_confirm_mode_parser.add_argument("--agent", required=True)

    propose_workflow_parser = subcommands.add_parser(
        "propose-workflow-mode", parents=[common]
    )
    propose_workflow_parser.add_argument(
        "--configured", required=True, choices=sorted(CONFIGURED_WORKFLOW_MODES)
    )
    propose_workflow_parser.add_argument(
        "--selected", required=True, choices=sorted(WORKFLOW_MODES)
    )
    propose_workflow_parser.add_argument(
        "--minimum", required=True, choices=sorted(WORKFLOW_MODES)
    )
    propose_workflow_parser.add_argument(
        "--source",
        required=True,
        choices=["project", "session", "adaptive", "user", "migration"],
    )
    propose_workflow_parser.add_argument("--reason", required=True, action="append")
    propose_workflow_parser.add_argument("--agent", required=True)
    propose_workflow_parser.add_argument("--task-id")

    workflow_floor_parser = subcommands.add_parser("workflow-floor", parents=[common])
    workflow_floor_parser.add_argument("--agent", required=True)
    workflow_floor_parser.add_argument("--task-id")

    raise_workflow_parser = subcommands.add_parser("raise-workflow-mode", parents=[common])
    raise_workflow_parser.add_argument("--mode", required=True, choices=sorted(WORKFLOW_MODES))
    raise_workflow_parser.add_argument("--reason", required=True)
    raise_workflow_parser.add_argument("--agent", required=True)
    raise_workflow_parser.add_argument("--task-id")

    fingerprints_parser = subcommands.add_parser("evidence-fingerprints", parents=[common])
    fingerprints_parser.add_argument("--agent", required=True)
    fingerprints_parser.add_argument("--task-id")

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

    memory_new_id = subcommands.add_parser("memory-new-id", parents=[common])
    memory_new_id.add_argument("--agent")

    memory_instruction_parser = subcommands.add_parser("memory-instruction", parents=[common])
    memory_instruction_parser.add_argument("--agent")
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
    repo_path.add_argument("--agent")
    repo_path.add_argument("--task-id")

    satisfy_dependency = subcommands.add_parser("satisfy-spec-dependency", parents=[common])
    satisfy_dependency.add_argument("--spec-task", required=True)
    satisfy_dependency.add_argument("--source-task")
    satisfy_dependency.add_argument("--evidence", required=True)
    satisfy_dependency.add_argument("--agent", required=True)
    satisfy_dependency.add_argument("--task-id")

    args = parser.parse_args()
    try:
        root = resolve_root(getattr(args, "cwd", None))
        session_file = getattr(args, "session_file", None)
        command = args.command or "snapshot"
        agent = normalize_agent_identity(
            getattr(args, "agent", None) or detect_runtime_agent()
        )
        session_agent = normalize_session_agent(agent)
        visible_agent = None if agent == "unknown" else agent
        if session_file is None and command == "project-init-complete":
            raise StateError(
                "project-init-complete requires --session-file from the current hook context."
            )
        if session_file is None and command not in {
            "inspect-dev-spec",
            "select-dev-spec-scope",
            "list-tasks",
            "memory-new-id",
        }:
            if session_agent == "unknown":
                raise StateError(
                    "Cannot resolve the logical session. Pass --session-file or --agent."
                )
            _, session_file = ensure_hook_session(root, {}, session_agent)
        if command == "snapshot":
            emit(snapshot_state(root, session_file))
        elif command == "inspect-dev-spec":
            spec_path = Path(args.spec)
            emit(
                inspection_summary(
                    inspect_spec(
                        spec_path if spec_path.is_absolute() else root / spec_path,
                        root,
                        parse_mapping_args(args.repo_path, "--repo-path"),
                    )
                )
            )
        elif command == "select-dev-spec-scope":
            spec_path = Path(args.spec)
            emit(
                select_consumption_scopes(
                    spec_path if spec_path.is_absolute() else root / spec_path,
                    root,
                    args.spec_task,
                )
            )
        elif command == "list-tasks":
            emit({"tasks": list_tasks(root, visible_agent)})
        elif command == "create-task":
            emit(
                attach_status_context(
                    root,
                    create_task(
                        root,
                        args.task_id,
                        args.type,
                        args.title,
                        agent,
                        not args.no_set_current,
                        session_file,
                    ),
                    agent,
                    session_file,
                )
            )
        elif command == "create-task-from-spec":
            emit(
                attach_status_context(
                    root,
                    create_task_from_spec(
                        root,
                        args.spec,
                        args.spec_task,
                        args.task_id,
                        args.type,
                        args.title,
                        parse_mapping_args(args.repo_path, "--repo-path"),
                        parse_mapping_args(
                            args.dependency_evidence,
                            "--dependency-evidence",
                        ),
                        agent,
                        not args.no_set_current,
                        session_file,
                    ),
                    agent,
                    session_file,
                )
            )
        elif command == "set-current":
            emit(
                attach_status_context(
                    root,
                    set_current_task(root, args.task_id, agent, session_file),
                    agent,
                    session_file,
                )
            )
        elif command == "clear-current":
            emit(
                attach_status_context(
                    root,
                    clear_current_task(root, agent, session_file),
                    agent,
                    session_file,
                )
            )
        elif command == "set-approval-mode":
            emit(
                attach_status_context(
                    root,
                    set_session_approval_mode(root, args.mode, agent, session_file),
                    agent,
                    session_file,
                )
            )
        elif command == "set-confirm-mode":
            emit(
                attach_status_context(
                    root,
                    set_session_legacy_confirm_mode(root, args.mode, agent, session_file),
                    agent,
                    session_file,
                )
            )
        elif command == "clear-approval-mode":
            emit(
                attach_status_context(
                    root,
                    clear_session_approval_mode(root, agent, session_file),
                    agent,
                    session_file,
                )
            )
        elif command == "clear-confirm-mode":
            emit(
                attach_status_context(
                    root,
                    clear_session_legacy_confirm_mode(root, agent, session_file),
                    agent,
                    session_file,
                )
            )
        elif command == "set-workflow-mode":
            emit(
                attach_status_context(
                    root,
                    set_session_workflow_mode(root, args.mode, agent, session_file),
                    agent,
                    session_file,
                )
            )
        elif command == "clear-workflow-mode":
            emit(
                attach_status_context(
                    root,
                    clear_session_workflow_mode(root, agent, session_file),
                    agent,
                    session_file,
                )
            )
        elif command == "propose-workflow-mode":
            emit(
                attach_status_context(
                    root,
                    propose_workflow_mode(
                        root,
                        args.configured,
                        args.selected,
                        args.minimum,
                        args.source,
                        args.reason,
                        agent,
                        args.task_id,
                        session_file,
                    ),
                    agent,
                    session_file,
                )
            )
        elif command == "workflow-floor":
            _, resolved_task_id, _ = resolve_current_task(root, args.task_id, session_file)
            minimum_mode, reasons = calculate_workflow_floor(root, resolved_task_id)
            emit(
                attach_status_context(
                    root,
                    {
                        "task_id": resolved_task_id,
                        "minimum_mode": minimum_mode,
                        "reasons": reasons,
                    },
                    visible_agent,
                    session_file,
                )
            )
        elif command == "raise-workflow-mode":
            emit(
                attach_status_context(
                    root,
                    raise_workflow_mode(
                        root,
                        args.mode,
                        args.reason,
                        agent,
                        args.task_id,
                        session_file,
                    ),
                    agent,
                    session_file,
                )
            )
        elif command == "evidence-fingerprints":
            session, resolved_task_id, _ = resolve_current_task(
                root, args.task_id, session_file
            )
            emit(
                attach_status_context(
                    root,
                    {
                        "task_id": resolved_task_id,
                        **evidence_fingerprints(root, resolved_task_id),
                    },
                    visible_agent,
                    session_file,
                )
            )
        elif command == "disable-harness":
            emit(
                attach_status_context(
                    root,
                    set_harness_disabled(root, True, agent, session_file),
                    agent,
                    session_file,
                )
            )
        elif command == "enable-harness":
            emit(
                attach_status_context(
                    root,
                    set_harness_disabled(root, False, agent, session_file),
                    agent,
                    session_file,
                )
            )
        elif command == "handoff-task":
            emit(
                attach_status_context(
                    root,
                    handoff_task(root, agent, args.summary, args.task_id, session_file),
                    agent,
                    session_file,
                )
            )
        elif command == "claim-task":
            emit(
                attach_status_context(
                    root,
                    claim_task(root, args.task_id, agent, session_file),
                    agent,
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
                        agent,
                        args.task_id,
                        session_file,
                        args.reason,
                    ),
                    agent,
                    session_file,
                )
            )
        elif command in {"confirm-transition", "transition"}:
            emit(
                attach_status_context(
                    root,
                    confirm_transition(root, agent, args.stage, args.task_id, session_file),
                    agent,
                    session_file,
                )
            )
        elif command == "auto-transition":
            emit(
                attach_status_context(
                    root,
                    auto_transition(root, args.stage, agent, args.task_id, session_file),
                    agent,
                    session_file,
                )
            )
        elif command == "cancel-transition":
            emit(
                attach_status_context(
                    root,
                    cancel_transition(root, agent, args.task_id, session_file),
                    agent,
                    session_file,
                )
            )
        elif command == "memory-new-id":
            emit({"memory_id": generate_short_memory_id()})
        elif command == "memory-short-complete":
            emit(
                attach_status_context(
                    root,
                    memory_short_complete(
                        root,
                        args.file,
                        agent,
                        args.task_id,
                        session_file,
                    ),
                    agent,
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
                        agent,
                        args.task_id,
                        session_file,
                    ),
                    agent,
                    session_file,
                )
            )
        elif command == "close-current":
            emit(
                attach_status_context(
                    root,
                    close_current_task(root, args.reason, agent, session_file),
                    agent,
                    session_file,
                )
            )
        elif command == "project-init-complete":
            emit(
                attach_status_context(
                    root,
                    project_init_complete(root, agent),
                    agent,
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
        elif command == "satisfy-spec-dependency":
            emit(
                attach_status_context(
                    root,
                    satisfy_spec_dependency(
                        root,
                        args.spec_task,
                        args.evidence,
                        agent,
                        args.source_task,
                        args.task_id,
                        session_file,
                    ),
                    agent,
                    session_file,
                )
            )
        return 0
    except (StateError, EasyDevSpecError) as error:
        print(json.dumps({"error": str(error)}, ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
