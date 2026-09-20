---
name: ec-config
description: Inspect and configure Easy Coding project/session Approval, Workflow, and Java unit test strategies.
---

# ec-config — mode configuration

Communicate in the user's language. A bare invocation is read-only: show the configuration panel
and available actions. Never mutate project or session settings without an explicit user choice.

## Configuration panel

Call `snapshot` and show project, session, effective, and frozen task values for `approval_mode`,
the mechanically calculated workflow mode (read-only), `unit_test_mode`, and `ut_coverage_threshold`.
Use `project_unit_test_mode`, `session_unit_test_mode`, `effective_unit_test_mode`, their threshold
counterparts, `task_unit_test_mode`, `task_tdd_baselines`, and `unit_test_readiness_status` directly.
When readiness is `not_checked`, report it as not checked; do not scan infrastructure merely to
populate the panel. Inspect readiness when the user requests it or selects UT/TDD.

Precedence is `session override > project config > defaults`. Defaults are Approval `guard`,
Workflow `adaptive`, unit test strategy `none`, and shared changed-line coverage threshold 90%.
The strategies are:

- `none`: ordinary task-required verification, with no additional coverage gate.
- `ut`: passed local unit tests and changed-production-line JaCoCo coverage at the threshold.
  No test-first order, RED/GREEN history, refactor cycle, or separate TDD review is required.
- `tdd`: test-first development plus the same local test and coverage gates; retain TDD lifecycle
  evidence and the TDD review dimension.

UT/TDD currently apply to Java code tasks. Neither strategy raises the mechanical workflow depth.
ANALYSIS -> IMPLEMENT freezes strategy, threshold, and repository baselines; later project/session
changes affect future tasks and ANALYSIS only. `none` preserves the threshold for later use.

Approval semantics stay independent from verification depth: `approve` waits at each
non-mechanical edge, `guard` waits at ANALYSIS -> IMPLEMENT and QUALITY -> MEMORY, `confirm`
waits only for the plan, and `auto` advances legal green edges immediately. A new code diff after
the QUALITY checkpoint requires acceptance of that exact diff without changing the approval mode.

## Project configuration

Use `easy-coding config`. The CLI confirms an atomic update of Approval, unit test strategy, and
its shared threshold (integer 1..100). Execution depth remains calculated automatically.

## Session configuration

After explicit user selection, use the current logical session file:

```bash
{{PYTHON_CMD}} {{platform_config_dir}}/hooks/easy_coding_state.py set-approval-mode --mode approve|guard|confirm|auto --agent <agent-id> --session-file <P>
{{PYTHON_CMD}} {{platform_config_dir}}/hooks/easy_coding_state.py clear-approval-mode --agent <agent-id> --session-file <P>

# Omitting threshold preserves the session threshold or inherits project/default 90.
{{PYTHON_CMD}} {{platform_config_dir}}/hooks/easy_coding_state.py set-unit-test-mode --mode none|ut|tdd [--threshold 1..100] --agent <agent-id> --session-file <P>
{{PYTHON_CMD}} {{platform_config_dir}}/hooks/easy_coding_state.py clear-unit-test-mode --agent <agent-id> --session-file <P>
```

Selecting UT/TDD requires ready infrastructure. Reuse `ec-tdd-init` and its existing readiness
receipt for both strategies. Route `needs_init` to initialization and `needs_repair` to the reported
repair, preserving existing settings. Normal build-file changes do not require reinitialization.
The shared gate measures changed production lines, not historical repository-wide coverage.
GitLab automation may reuse it, but remote pipelines are not Harness acceptance dependencies.

Run related unit tests once with coverage collection, and reuse that execution for both test and
coverage evidence. Inputs unchanged means reuse; only rerun affected checks after relevant changes.
Test assertions stay in ordinary review for UT. Do not add a separate UT review or workflow stage.

Execution depth always equals the current mechanical minimum. Legacy workflow settings do not
raise it. Do not offer execution-depth choices or recommend changing to Lite.
