"""Lightweight workflow display shared by the CLI and prompt hooks."""

from pathlib import Path
from easy_coding_store import (
    HELP_SUFFIX,
    MANDATORY_DEV_SPEC_HEADERS,
    READY_LINE,
    TDD_INIT_TASK_TYPE,
    TERMINAL_STATUSES,
    WAITING_INIT_LINE,
    agents_equivalent,
    behavior_layers,
    clear_session_pointer,
    default_session,
    display_path,
    ensure_session,
    execution_records,
    is_automatic_transition,
    load_json,
    load_session,
    load_task,
    read_behavior_file,
    resolve_behavior,
    resolve_session_path,
    tdd_readiness,
    validate_transition,
    write_session,
)


def pending_handoff_record(root: Path, task_id: str) -> dict | None:
    latest = next((r for r in reversed(execution_records(root, task_id))
                   if r.get("type") in {"handoff", "claim"}), None)
    return latest if latest and latest["type"] == "handoff" else None


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
        "writeback": task.get("spec_writeback_progress"),
        "context": task.get("spec_context"),
        "pending_change": task.get("spec_change"),
    }


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
        project_unit_test_mode,
        session_unit_test_mode,
        effective_unit_test_mode,
        project_ut_coverage_threshold,
        session_ut_coverage_threshold,
        effective_ut_coverage_threshold,
    ) = resolve_behavior(root, resolved_session)
    concrete_workflow_mode = None
    if task:
        concrete_workflow_mode = task.get("workflow_mode")
        proposal = task.get("workflow_mode_proposal")
        if concrete_workflow_mode is None and isinstance(proposal, dict):
            concrete_workflow_mode = proposal.get("selected_mode")
    task_unit_test_mode = task.get("unit_test_mode") if task else None
    task_ut_coverage_threshold = task.get("ut_coverage_threshold") if task else None
    frozen_unit_test = bool(
        task
        and status not in {"ANALYSIS", "INIT"}
        and task_unit_test_mode in {"none", "ut", "tdd"}
    )
    is_tdd_init = bool(
        task and str(task.get("type") or "").strip().lower() == TDD_INIT_TASK_TYPE
    )
    displayed_unit_test_mode = (
        "none" if is_tdd_init else task_unit_test_mode if frozen_unit_test else effective_unit_test_mode
    )
    displayed_ut_threshold = (
        task_ut_coverage_threshold
        if frozen_unit_test and isinstance(task_ut_coverage_threshold, int)
        else effective_ut_coverage_threshold
    )
    should_check_readiness = bool(
        effective_unit_test_mode in {"ut", "tdd"} or task_unit_test_mode in {"ut", "tdd"} or is_tdd_init
    )
    readiness = (
        tdd_readiness(root)
        if should_check_readiness
        else {"status": "not_checked", "reasons": []}
    )

    layers = behavior_layers(root, resolved_session)
    local, _ = read_behavior_file(Path.home() / ".easy-coding" / "config.yaml")
    return {
        "session_file": display_path(root, session_path),
        "behavior_sources": {key: item["source"] for key, item in layers.items()},
        "local_behavior": local,
        "effective_cooperate_mode": layers["cooperate_mode"]["value"],
        "cooperation": task.get("cooperation") if task else None,
        "quality_repair": task.get("quality_repair") if task else None,
        "continuation": task.get("continuation") if task else None,
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
        "project_unit_test_mode": project_unit_test_mode,
        "session_unit_test_mode": session_unit_test_mode,
        "effective_unit_test_mode": effective_unit_test_mode,
        "project_ut_coverage_threshold": project_ut_coverage_threshold,
        "session_ut_coverage_threshold": session_ut_coverage_threshold,
        "effective_ut_coverage_threshold": effective_ut_coverage_threshold,
        "task_unit_test_mode": task_unit_test_mode,
        "task_ut_coverage_threshold": task_ut_coverage_threshold,
        "task_tdd_baselines": task.get("tdd_baselines") if task else None,
        "displayed_unit_test_mode": displayed_unit_test_mode,
        "displayed_ut_coverage_threshold": displayed_ut_threshold,
        "unit_test_readiness_status": readiness["status"],
        "unit_test_readiness_reasons": readiness["reasons"],
        "spec_summary": spec_task_summary(task),
        # Compatibility output aliases for pre-0.9 clients.
        "project_confirm_mode": project_approval_mode,
        "session_confirm_mode": session_approval_mode,
        "effective_confirm_mode": effective_approval_mode,
        "harness_disabled": resolved_session.get("harness_disabled") is True,
        "lite_mode": resolved_session.get("lite_mode") is True,
        "lite_proposal": resolved_session.get("lite_proposal"),
    }


def build_status_line(
    root: Path,
    session: dict,
    agent: str | None = None,
    session_file: str | Path | None = None,
    state: dict | None = None,
) -> str:
    state = state if state is not None else snapshot_state(root, session_file, session)
    if state["lite_mode"]:
        lite_state = (
            "Awaiting Confirmation"
            if isinstance(state.get("lite_proposal"), dict)
            and not state["lite_proposal"].get("confirmed_at")
            else "Ready"
        )
        return (
            f"> **Easy Coding** · **Lite Direct** · {lite_state} · "
            "No Task / Quality / Memory · Use `ec-lite` to exit"
        )
    approval = str(state["effective_approval_mode"]).capitalize()
    workflow = str(state["concrete_workflow_mode"] or state["configured_workflow_mode"]).capitalize()
    status_brand = f"> **Easy Coding** · **Approval: {approval}** · **Workflow: {workflow}**"
    if state["effective_cooperate_mode"] == "dispatch":
        status_brand += " · **Dispatch**"
    if state["displayed_unit_test_mode"] in {"ut", "tdd"}:
        status_brand += f" · **{state['displayed_unit_test_mode'].upper()}**"
    task_id = state["current_task"]
    if task_id:
        status = str(state["status"])
        line = f"{status_brand} · `{task_id}` · `{status}`"
        handoff = pending_handoff_record(root, str(task_id))
        handoff_from = handoff.get("from") if handoff else None
        if agent and handoff_from and not agents_equivalent(handoff_from, agent):
            line += f" · Handoff -> `{handoff_from}`"
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
    state: dict | None = None,
) -> list[str]:
    state = state if state is not None else snapshot_state(root, session_file, session)
    task_id = state["current_task"]
    task = state["task"]
    stage = str(state["status"]) if task else "idle"
    resolved_session_file = str(state["session_file"])
    lines = [
        f"[workflow-state:{stage}]",
        f"[easy-coding:session-file:{resolved_session_file}]",
        f"[easy-coding:approval-mode:{state['effective_approval_mode']}]",
        f"[easy-coding:configured-workflow-mode:{state['configured_workflow_mode']}]",
        f"[easy-coding:cooperate-mode:{state['effective_cooperate_mode']}]",
    ]
    if state.get("concrete_workflow_mode"):
        lines.append(f"[easy-coding:workflow-mode:{state['concrete_workflow_mode']}]")
    if state.get("displayed_unit_test_mode") in {"ut", "tdd"}:
        lines.append(f"[easy-coding:unit-test-mode:{state['displayed_unit_test_mode']}]")
        lines.append(
            f"[easy-coding:ut-coverage-threshold:{state['displayed_ut_coverage_threshold']}]"
        )

    if task_id:
        lines.append(f"[current-task:{task_id}]")
        continuation = state.get("continuation") or {}
        if continuation.get("next_action"):
            lines.append(f"[easy-coding:next-action:{continuation['next_action']}]")
        if continuation.get("stop_after"):
            lines.append(f"[easy-coding:stop-after:{continuation['stop_after']}]")
        if task and isinstance(task.get("spec_source"), dict):
            source = task["spec_source"]
            lines.append(f"[easy-coding:spec:{source.get('spec_id')}:revision:{source.get('revision')}]")
            lines.append("[easy-coding:spec-context:reuse-current-session-or-resume-if-missing]")
            if task.get("spec_change"):
                lines.append("[easy-coding:spec-change:pending-sync-spec-design]")
            if (task.get("spec_writeback_progress") or {}).get("pending_action"):
                lines.append("[easy-coding:spec-writeback:reconcile-spec-execution-required]")
        if state["task_missing"]:
            lines.append(f"[easy-coding:current-task-missing:{task_id}]")
        handoff = pending_handoff_record(root, str(task_id))
        handoff_from = handoff.get("from") if handoff else None
        if agent and handoff_from and not agents_equivalent(handoff_from, agent):
            lines.append(f"[easy-coding:handoff-from:{handoff_from}]")
        pending = state.get("pending_transition")
        if isinstance(pending, dict):
            source = str(pending.get("from") or stage)
            target = str(pending.get("to") or "")
            if target:
                lines.append(f"[easy-coding:pending-transition:{source}->{target}]")
                task_type = str(task.get("type") or "") if task else ""
                if pending.get("confirmation_override") == "evidence-drift":
                    lines.append(
                        "[easy-coding:acceptance-drift-confirmation-required]"
                    )
                    lines.append("[easy-coding:transition-confirmation-required]")
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
    state: dict | None = None,
) -> str:
    if session.get("harness_disabled") is True:
        session_path = resolve_session_path(root, session_file)
        return "\n".join(
            [
                "[easy-coding:no-harness]",
                f"[easy-coding:session-file:{display_path(root, session_path)}]",
            ]
        )
    if session.get("lite_mode") is True:
        session_path = resolve_session_path(root, session_file)
        proposal = session.get("lite_proposal")
        lines = [
            build_status_line(root, session, agent, session_file),
            "[easy-coding:lite-direct]",
            f"[easy-coding:session-file:{display_path(root, session_path)}]",
        ]
        if isinstance(proposal, dict):
            lines.append(f"[easy-coding:lite-proposal:{proposal.get('digest', 'missing')}]")
        return "\n".join(lines)
    state = state if state is not None else snapshot_state(root, session_file, session)
    return "\n".join(
        [
            build_status_line(root, session, agent, session_file, state),
            *build_machine_breadcrumbs(root, session, agent, session_file, state),
        ]
    )


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
