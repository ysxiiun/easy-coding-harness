from pathlib import Path

from easy_coding_state import (
    HELP_SUFFIX,
    get_pending_init_version,
    is_project_init_required,
    record_seen_stage,
    snapshot_state,
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

def build_status_line(root: Path, session: dict, agent: str | None = None) -> str:
    state = snapshot_state(root, session=session)
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


def build_machine_breadcrumbs(root: Path, session: dict, agent: str | None = None) -> list[str]:
    state = snapshot_state(root, session=session)
    task_id = state["current_task"]
    task = state["task"]
    stage = str(state["status"]) if task else "idle"
    lines = [f"[workflow-state:{stage}]", f"[easy-coding:session-file:{state['session_file']}]"]

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
        violation = record_seen_stage(root, str(task_id), current_stage)
        if violation:
            lines.append(f"[ILLEGAL-TRANSITION:{last_seen}->{current_stage}]")
            lines.append(f"[easy-coding:transition-error:{violation}]")

    return lines


def build_status_context(root: Path, session: dict, agent: str | None = None) -> str:
    return "\n".join([build_status_line(root, session, agent), *build_machine_breadcrumbs(root, session, agent)])
