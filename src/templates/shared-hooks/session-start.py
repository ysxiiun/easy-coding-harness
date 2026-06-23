#!/usr/bin/env python3
import json
import os
from datetime import datetime, timezone
from pathlib import Path
import sys

from easy_coding_state import load_session, write_session
from easy_coding_status import build_status_context


def configure_stdio() -> None:
    for stream in (sys.stdin, sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")


def read_payload() -> dict:
    try:
        return json.loads(sys.stdin.read() or "{}")
    except (json.JSONDecodeError, ValueError):
        return {}


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


def write_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def detect_agent() -> str:
    if os.environ.get("CLAUDE_PROJECT_DIR"):
        return "claude-code"
    if os.environ.get("QODER_PROJECT_DIR"):
        return "qoder"
    hook_path = Path(sys.argv[0]).as_posix()
    if ".claude/" in hook_path:
        return "claude-code"
    if ".codex/" in hook_path:
        return "codex"
    if ".qoder/" in hook_path or ".qodercn/" in hook_path:
        return "qoder"
    return "unknown"


def is_process_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
        return True
    except (OSError, ProcessLookupError):
        return False


def clean_stale_sessions(root: Path) -> None:
    sessions_dir = root / ".easy-coding" / "sessions"
    if not sessions_dir.is_dir():
        return

    now = datetime.now(timezone.utc)
    threshold_hours = 24

    for entry in sessions_dir.iterdir():
        if not entry.suffix == ".json":
            continue
        try:
            data = json.loads(entry.read_text(encoding="utf-8"))
            created = datetime.fromisoformat(data.get("created_at", ""))
            if created.tzinfo is None:
                created = created.replace(tzinfo=timezone.utc)
            age_hours = (now - created).total_seconds() / 3600
            if age_hours <= threshold_hours:
                continue
            pid = int(entry.stem)
            if is_process_alive(pid):
                continue
            entry.unlink()
        except (OSError, json.JSONDecodeError, ValueError, KeyError):
            continue


def migrate_legacy_state(root: Path, agent: str) -> dict | None:
    """Migrate old-format state.json into session file + task.json. Returns session dict."""
    state_path = root / ".easy-coding" / "state.json"
    old_state = load_json(state_path)
    if old_state is None:
        return None

    task_id = old_state.get("current_task")
    if task_id:
        task_path = root / ".easy-coding" / "tasks" / str(task_id) / "task.json"
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
            write_json(task_path, task)

    # Remove legacy state.json
    try:
        state_path.unlink()
    except OSError:
        pass

    return {"current_task": task_id, "created_at": datetime.now(timezone.utc).isoformat()}


def emit(event_name: str, context: str) -> None:
    print(
        json.dumps(
            {
                "hookSpecificOutput": {
                    "hookEventName": event_name,
                    "additionalContext": context,
                }
            },
            ensure_ascii=False,
        )
    )


def main() -> int:
    configure_stdio()
    if os.environ.get("EC_HOOKS") == "0":
        return 0

    payload = read_payload()
    root = find_ec_root(Path(payload.get("cwd") or os.getcwd()))
    if root is None:
        return 0

    agent = detect_agent()
    event_name = payload.get("hook_event_name") or payload.get("hookEventName") or "SessionStart"

    # Migrate legacy state.json if present
    state_path = root / ".easy-coding" / "state.json"
    migrated_session = None
    if state_path.exists():
        migrated_session = migrate_legacy_state(root, agent)

    # Clean stale session files
    clean_stale_sessions(root)

    # Create/overwrite session file for this session
    session = load_session(root)
    if session is None:
        if migrated_session:
            session = migrated_session
        else:
            session = {"current_task": None, "created_at": datetime.now(timezone.utc).isoformat()}
    else:
        # Refresh created_at on session start (marks session as active)
        session["created_at"] = datetime.now(timezone.utc).isoformat()

    write_session(root, session)
    emit(event_name, build_status_context(root, session, agent))
    return 0


if __name__ == "__main__":
    sys.exit(main())
