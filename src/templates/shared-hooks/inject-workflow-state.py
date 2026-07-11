#!/usr/bin/env python3
import json
import os
from pathlib import Path
import sys

from easy_coding_state import load_session
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

    session = load_session(root)
    if session is None:
        session = {"current_task": None, "created_at": ""}

    event_name = payload.get("hook_event_name") or payload.get("hookEventName") or "UserPromptSubmit"
    agent = detect_agent()
    emit(event_name, build_status_context(root, session, agent))
    return 0


if __name__ == "__main__":
    sys.exit(main())
