#!/usr/bin/env python3
import json
import os
from pathlib import Path
import sys


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

    session = load_json(root / ".easy-coding" / "sessions" / f"{os.getppid()}.json") or {}
    task_id = session.get("current_task")
    context = [
        "[easy-coding:subagent-guard]",
        "Sub-agents must follow the task card, stay within the allowed file scope, and return structured results.",
        "They must not claim completion or verification without fresh evidence.",
    ]
    if task_id:
        context.append(f"Active Easy Coding task: {task_id}")

    event_name = payload.get("hook_event_name") or payload.get("hookEventName") or "PreToolUse"
    emit(event_name, "\n".join(context))
    return 0


if __name__ == "__main__":
    sys.exit(main())
