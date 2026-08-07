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
per-repository `task_tdd_baselines` frozen state.

Explain precedence as `session override > project config > defaults`. Defaults are Approval
`guard`, Workflow `adaptive`, TDD disabled, and TDD changed-line coverage threshold 90%. An active
task freezes its effective TDD values when ANALYSIS advances to IMPLEMENT; later project/session
changes affect future tasks and ANALYSIS only.

## Project configuration

Use `easy-coding config` for project settings. The CLI confirms one atomic update of Approval,
Workflow, TDD, and (when enabled) the threshold. The threshold must be an integer from 1 to 100.

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
TDD review, local changed-line JaCoCo coverage, and GitLab TEST-stage gate planning.
