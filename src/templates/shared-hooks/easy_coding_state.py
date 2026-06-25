#!/usr/bin/env python3
import argparse
import json
import os
from datetime import datetime, timezone
from pathlib import Path
import sys


TERMINAL_STATUSES = {"COMPLETE", "CLOSED"}
HELP_SUFFIX = (
    "Use `ec-workflow` to start or resume a task, "
    "`ec-brainstorming` to brainstorm, or `ec-task-management` to view tasks"
)
READY_LINE = (
    "> **Easy Coding** · Ready · Use `ec-workflow` to start or resume a task, "
    "`ec-brainstorming` to brainstorm, or `ec-task-management` to view tasks"
)
WAITING_INIT_LINE = "> **Easy Coding** · Waiting init · Use `ec-init` to initialize"

MANDATORY_DEV_SPEC_HEADERS: list[str] = [
    "## 技术方案",
    "### 项目模式",
    "### 任务类型",
    "### 需求解析",
    "### 现状",
    "### 冲突摘要",
    "### 待用户决策",
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
    "ANALYSIS": {"WAITING_CONFIRM", "CLOSED"},
    "WAITING_CONFIRM": {"IMPLEMENT", "ANALYSIS", "CLOSED"},
    "IMPLEMENT": {"REVIEW", "ANALYSIS", "CLOSED"},
    "REVIEW": {"VERIFICATION", "IMPLEMENT", "ANALYSIS", "CLOSED"},
    "VERIFICATION": {"MEMORY_SHORT", "IMPLEMENT", "CLOSED"},
    "MEMORY_SHORT": {"MEMORY_LONG", "CLOSED"},
    "MEMORY_LONG": {"COMPLETE", "CLOSED"},
    "COMPLETE": set(),
    "CLOSED": set(),
}

DEFAULT_SHORT_TERM_MAX = 10
DEFAULT_SHORT_TERM_KEEP = 5


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
    return config


def count_short_memories(root: Path) -> int:
    short_dir = root / ".easy-coding" / "memory" / "short"
    if not short_dir.is_dir():
        return 0
    count = 0
    for entry in short_dir.glob("*.md"):
        try:
            if is_schema_v2_short_memory(entry.read_text(encoding="utf-8")):
                count += 1
        except OSError:
            continue
    return count


def is_schema_v2_short_memory(content: str) -> bool:
    lines = content.splitlines()
    if not lines or lines[0].strip() != "---":
        return False
    for line in lines[1:]:
        stripped = line.strip()
        if stripped == "---":
            return False
        if not stripped.startswith("memory_schema:"):
            continue
        _, value = stripped.split(":", 1)
        return parse_positive_int(value) == 2
    return False


def build_memory_long_instruction(root: Path) -> dict:
    config = read_memory_config(root)
    short_count = count_short_memories(root)
    action = "distill" if short_count > config["short_term_max"] else "no-op"
    trim_count = max(0, short_count - config["short_term_keep"]) if action == "distill" else 0
    return {
        "short_count": short_count,
        "short_term_max": config["short_term_max"],
        "short_term_keep": config["short_term_keep"],
        "action": action,
        "trim_count": trim_count,
    }


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


def validate_transition(previous: str, current: str) -> str | None:
    if previous == current:
        return None
    allowed = VALID_TRANSITIONS.get(previous, set())
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

    return {
        "session_file": display_path(root, session_path),
        "current_task": str(task_id) if task_id else None,
        "task": task,
        "task_missing": missing,
        "status": status,
        "is_terminal": status in TERMINAL_STATUSES,
        "last_agent": task.get("last_agent") if task else None,
        "project_init_required": is_project_init_required(root),
        "pending_init_version": get_pending_init_version(root),
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
    lines = [f"[workflow-state:{stage}]", f"[easy-coding:session-file:{resolved_session_file}]"]

    if task_id:
        lines.append(f"[current-task:{task_id}]")
        if state["task_missing"]:
            lines.append(f"[easy-coding:current-task-missing:{task_id}]")
        last_agent = state.get("last_agent")
        if agent and last_agent and last_agent != agent:
            lines.append(f"[easy-coding:handoff-from:{last_agent}]")

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
    first_line = context.splitlines()[0] if context else ""
    enriched = dict(data)
    enriched["status_line"] = first_line
    enriched["status_context"] = context
    return enriched


def list_tasks(root: Path) -> list[dict]:
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
        items.append(
            {
                "id": entry.name,
                "title": task.get("title"),
                "type": task.get("type"),
                "status": status,
                "active": status not in TERMINAL_STATUSES,
                "created_at": task.get("created_at"),
                "last_agent": task.get("last_agent"),
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


def transition_task(
    root: Path,
    stage: str,
    agent: str,
    task_id: str | None = None,
    session_file: str | Path | None = None,
) -> dict:
    if stage not in VALID_TRANSITIONS:
        raise StateError(f"Unknown stage: {stage}")
    session = ensure_session(root, session_file)
    resolved_task_id = task_id or session.get("current_task")
    if not resolved_task_id:
        raise StateError("No current task is set.")
    task = load_task(root, str(resolved_task_id))
    if task is None:
        raise StateError(f"Task not found: {resolved_task_id}")

    previous = str(task.get("status") or "idle")
    violation = validate_transition(previous, stage)
    if violation:
        raise StateError(violation)
    if previous != stage:
        task["status"] = stage
        append_stage_history(task, stage, agent)
    task["last_agent"] = agent
    write_task(root, str(resolved_task_id), task)

    if session.get("current_task") == resolved_task_id:
        if stage in TERMINAL_STATUSES:
            clear_session_pointer(session, agent)
        else:
            session["last_seen_task"] = str(resolved_task_id)
            session["last_seen_stage"] = stage
            session["last_agent"] = agent
        write_session(root, session, session_file)
    snapshot = snapshot_state(root, session_file, session)
    if stage == "MEMORY_LONG":
        snapshot["memory_long"] = build_memory_long_instruction(root)
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
        violation = validate_transition(str(last_seen_stage), stage)

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
    subcommands.add_parser("list-tasks", parents=[common])

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

    transition = subcommands.add_parser("transition", parents=[common])
    transition.add_argument("--stage", required=True)
    transition.add_argument("--agent", required=True)
    transition.add_argument("--task-id")

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
            emit({"tasks": list_tasks(root)})
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
        elif command == "transition":
            emit(
                attach_status_context(
                    root,
                    transition_task(root, args.stage, args.agent, args.task_id, session_file),
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
