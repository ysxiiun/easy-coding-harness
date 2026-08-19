---
name: ec-config
description: Inspect and configure Easy Coding project/session Approval, Workflow, and Java TDD modes.
---

# ec-config — mode configuration

Communicate in the user's language. A bare invocation is read-only: show the configuration panel
and available actions. Never mutate project or session settings without an explicit user choice.

## Configuration panel

Call `snapshot` and show project, session, effective, and frozen task values for:

- `approval_mode`;
- `workflow_mode`;
- `tdd_enabled` and `tdd_coverage_threshold`.

Use the returned fields directly, including `project_tdd_enabled`, `session_tdd_enabled`,
`effective_tdd_enabled`, their threshold counterparts, `task_tdd_enabled`, and the task's
per-repository `task_tdd_baselines` frozen state. When `tdd_readiness_status=not_checked` because
TDD is off, explicitly run the read-only readiness command below before showing readiness:

```bash
python3 .easy-coding/tools/easy_coding_tdd_readiness.py --cwd . check
```

This explicit configuration-panel check is the only disabled-mode readiness scan; ordinary hooks
must not inspect build or CI files while TDD is off.

Explain precedence as `session override > project config > defaults`. Defaults are Approval
`guard`, Workflow `adaptive`, TDD disabled, and TDD changed-line coverage threshold 90%. An active
task freezes its effective TDD values when ANALYSIS advances to IMPLEMENT; later project/session
changes affect future tasks and ANALYSIS only.

Approval semantics stay independent from verification depth: `approve` waits at each
non-mechanical edge, `guard` waits at ANALYSIS -> IMPLEMENT and QUALITY -> MEMORY, `confirm`
waits only for the plan, and `auto` advances legal green edges immediately. Every mode temporarily
pauses only when code changes after the frozen QUALITY checkpoint, because the user must see
and accept that exact new diff; this exception does not convert `auto` into `guard`.

## Project configuration

Use `easy-coding config` for project settings. The CLI confirms one atomic update of Approval,
Workflow, TDD, and (when enabled) the threshold. The threshold must be an integer from 1 to 100.
Enabling TDD is rejected atomically unless `ec-tdd-init` readiness is currently `ready`.

## Session configuration

After explicit user selection, use the current logical session file:

```bash
# approval
{{PYTHON_CMD}} {{platform_config_dir}}/hooks/easy_coding_state.py set-approval-mode --mode approve|guard|confirm|auto --agent <agent-id> --session-file <P>
{{PYTHON_CMD}} {{platform_config_dir}}/hooks/easy_coding_state.py clear-approval-mode --agent <agent-id> --session-file <P>

# workflow
{{PYTHON_CMD}} {{platform_config_dir}}/hooks/easy_coding_state.py set-workflow-mode --mode adaptive|fast|standard|strict --agent <agent-id> --session-file <P>
{{PYTHON_CMD}} {{platform_config_dir}}/hooks/easy_coding_state.py clear-workflow-mode --agent <agent-id> --session-file <P>

# TDD; omitting threshold preserves an existing session threshold, otherwise project/default 90 applies
{{PYTHON_CMD}} {{platform_config_dir}}/hooks/easy_coding_state.py set-tdd --enabled true|false [--threshold 1..100] --agent <agent-id> --session-file <P>
{{PYTHON_CMD}} {{platform_config_dir}}/hooks/easy_coding_state.py clear-tdd --agent <agent-id> --session-file <P>
```

Turning TDD off must preserve the existing Fast/Standard/Strict test depth exactly: do not inspect
CI, request JaCoCo, add TDD artifacts, run coverage commands, or strengthen acceptance criteria.
When TDD is on, explain that it applies only to Java code tasks and activates RED/GREEN/REFACTOR,
TDD review, a passed local unit-test gate, and local changed-line JaCoCo coverage. `ec-tdd-init`
still generates the GitLab TEST-stage job, but Harness does not wait for or record remote pipeline
results as acceptance evidence.

Before any project/session enable action, require `tdd_readiness_status=ready`. If it is not ready,
offer only `ec-tdd-init` or cancellation; never offer or persist "enable now, initialize later".
Readiness means infrastructure can measure future changed production lines. It does not certify
repository-wide coverage and does not require tests for unchanged historical code.
