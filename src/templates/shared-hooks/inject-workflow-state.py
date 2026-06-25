#!/usr/bin/env python3
import json
import os
from pathlib import Path
import sys

from easy_coding_state import StateError, load_session, snapshot_state, transition_task
from easy_coding_status import build_status_context

PROMPT_KEYS = ("prompt", "user_prompt", "userPrompt", "message", "text", "input")

NEGATIVE_OR_REVISION_PATTERNS = (
    "修改",
    "调整",
    "重写",
    "重新",
    "补充",
    "换个",
    "换一",
    "不要",
    "别",
    "取消",
    "暂停",
    "等一下",
    "先别",
    "有问题",
    "还有问题",
    "不对",
    "不是",
    "不行",
    "继续修复",
    "需要修复",
    "再修复",
    "修一下",
    "修正",
    "？",
    "?",
    "revise",
    "change",
    "cancel",
    "pause",
    "wait",
    "stop",
    "don't",
    "do not",
    "hold",
    "problem",
    "issue",
    "keep fixing",
    "continue fixing",
    "needs fixing",
)

WAITING_CONFIRM_PATTERNS = (
    "确认",
    "开始",
    "执行",
    "实施",
    "按方案",
    "按计划",
    "没问题",
    "可以",
    "同意",
    "继续",
    "go ahead",
    "proceed",
    "start",
    "implement",
    "approve",
    "approved",
    "yes",
    "ok",
    "okay",
    "confirm",
    "looks good",
    "ship it",
)

VERIFICATION_ACCEPT_PATTERNS = (
    "验收通过",
    "接受",
    "通过",
    "可以结束",
    "归档",
    "完成",
    "确认完成",
    "没问题",
    "可以",
    "同意",
    "accept",
    "accepted",
    "approve",
    "approved",
    "looks good",
    "complete",
    "finish",
    "archive",
    "done",
    "ship it",
)

WAITING_CONFIRM_EXACT = {"1", "1.", "开始实施", "确认执行"}


def configure_stdio() -> None:
    for stream in (sys.stdin, sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")


def read_payload() -> dict:
    try:
        return json.loads(sys.stdin.read() or "{}")
    except (json.JSONDecodeError, ValueError):
        return {}


def coerce_prompt_text(value: object) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        return "\n".join(part for item in value if (part := coerce_prompt_text(item)))
    if isinstance(value, dict):
        parts: list[str] = []
        for key in PROMPT_KEYS:
            if key in value:
                text = coerce_prompt_text(value[key])
                if text:
                    parts.append(text)
        if "content" in value:
            text = coerce_prompt_text(value["content"])
            if text:
                parts.append(text)
        return "\n".join(parts)
    return ""


def extract_user_prompt(payload: dict) -> str:
    for key in PROMPT_KEYS:
        if key not in payload:
            continue
        text = coerce_prompt_text(payload[key])
        if text:
            return text
    return ""


def normalize_prompt(text: str) -> str:
    return " ".join(text.casefold().strip().split())


def has_any(text: str, patterns: tuple[str, ...]) -> bool:
    return any(pattern in text for pattern in patterns)


def infer_confirmed_transition(current_stage: str, prompt: str) -> str | None:
    normalized = normalize_prompt(prompt)
    if not normalized or has_any(normalized, NEGATIVE_OR_REVISION_PATTERNS):
        return None
    if current_stage == "WAITING_CONFIRM":
        if normalized in WAITING_CONFIRM_EXACT or has_any(normalized, WAITING_CONFIRM_PATTERNS):
            return "IMPLEMENT"
    if current_stage == "VERIFICATION" and has_any(normalized, VERIFICATION_ACCEPT_PATTERNS):
        return "MEMORY_SHORT"
    return None


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


def preflight_confirmed_transition(root: Path, session: dict, payload: dict, agent: str) -> dict:
    prompt = extract_user_prompt(payload)
    if not prompt:
        return session

    state = snapshot_state(root, session=session)
    task_id = state.get("current_task")
    if not task_id or state.get("task_missing") or state.get("is_terminal"):
        return session

    target_stage = infer_confirmed_transition(str(state.get("status") or ""), prompt)
    if not target_stage:
        return session

    try:
        transition_task(
            root,
            target_stage,
            agent,
            task_id=str(task_id),
            session_file=str(state["session_file"]),
        )
    except StateError:
        return load_session(root) or session

    # Read after write so the status line renders the authoritative latest stage.
    return load_session(root) or session


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
    if event_name == "UserPromptSubmit":
        session = preflight_confirmed_transition(root, session, payload, agent)
    emit(event_name, build_status_context(root, session, agent))
    return 0


if __name__ == "__main__":
    sys.exit(main())
