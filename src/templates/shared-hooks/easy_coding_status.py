import json
import os
from pathlib import Path


READY_LINE = (
    "> **Easy Coding** · Ready · Use `ec-workflow` to start or resume a task, "
    "`ec-brainstorming` to brainstorm, or `ec-task-management` to view tasks"
)
WAITING_INIT_LINE = "> **Easy Coding** · Waiting init · Use `ec-init` to initialize"

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


def load_json(path: Path) -> dict | None:
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def load_task(root: Path, task_id: str | None) -> dict | None:
    if not task_id:
        return None
    return load_json(root / ".easy-coding" / "tasks" / task_id / "task.json")


def load_session(root: Path) -> dict | None:
    ppid = os.getppid()
    return load_json(root / ".easy-coding" / "sessions" / f"{ppid}.json")


def write_session(root: Path, session: dict) -> None:
    ppid = os.getppid()
    session_path = root / ".easy-coding" / "sessions" / f"{ppid}.json"
    session_path.parent.mkdir(parents=True, exist_ok=True)
    session_path.write_text(json.dumps(session, indent=2, ensure_ascii=False), encoding="utf-8")


def is_project_init_required(root: Path) -> bool:
    project_init = load_json(root / ".easy-coding" / "tasks" / "project-init" / "task.json")
    return bool(project_init and project_init.get("status") != "COMPLETE")


def validate_transition(previous: str, current: str) -> str | None:
    if previous == current:
        return None
    allowed = VALID_TRANSITIONS.get(previous, set())
    if current in allowed:
        return None
    return f"ILLEGAL TRANSITION: {previous} -> {current}. Allowed from {previous}: {sorted(allowed) or 'NONE (terminal state)'}."


def build_status_line(root: Path, session: dict, agent: str | None = None) -> str:
    task_id = session.get("current_task")
    if task_id:
        task = load_task(root, str(task_id))
        status = str(task["status"]) if task and task.get("status") else "PENDING"
        line = f"> **Easy Coding** · `{task_id}` · `{status}`"
        if task:
            last_agent = task.get("last_agent")
            if agent and last_agent and last_agent != agent:
                line += f" · Handoff -> `{last_agent}`"
        return line

    if is_project_init_required(root):
        return WAITING_INIT_LINE

    return READY_LINE


def build_machine_breadcrumbs(root: Path, session: dict, agent: str | None = None) -> list[str]:
    task_id = session.get("current_task")
    task = load_task(root, str(task_id)) if task_id else None
    stage = str(task["status"]) if task and task.get("status") else "idle"
    lines = [f"[workflow-state:{stage}]"]

    if task_id:
        lines.append(f"[current-task:{task_id}]")
        if task:
            last_agent = task.get("last_agent")
            if agent and last_agent and last_agent != agent:
                lines.append(f"[easy-coding:handoff-from:{last_agent}]")

    if is_project_init_required(root):
        lines.append("[easy-coding:init-required]")

    # State machine validation
    last_seen = session.get("last_seen_stage")
    if last_seen and task and task.get("status"):
        current_stage = str(task["status"])
        violation = validate_transition(last_seen, current_stage)
        if violation:
            lines.append(f"[ILLEGAL-TRANSITION:{last_seen}->{current_stage}]")
            lines.append(f"[easy-coding:transition-error:{violation}]")
        if last_seen != current_stage:
            session["last_seen_stage"] = current_stage
            write_session(root, session)
    elif task and task.get("status"):
        session["last_seen_stage"] = str(task["status"])
        write_session(root, session)

    return lines


def build_status_context(root: Path, session: dict, agent: str | None = None) -> str:
    return "\n".join([build_status_line(root, session, agent), *build_machine_breadcrumbs(root, session, agent)])
