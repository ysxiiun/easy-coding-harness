---
name: ec-workflow
description: Main Easy Coding entrypoint. Creates or resumes a task, orchestrates the unchanged state machine, separates approval from execution depth, and dispatches the stage skill for the current state.
---

# ec-workflow — state orchestration

Use this as the only normal entrypoint for Easy Coding development work. Communicate in the
user's language.

## State machine

```text
INIT --auto--> ANALYSIS -> IMPLEMENT -> REVIEW -> VERIFICATION -> MEMORY --auto--> COMPLETE
                    ^           ^          |              |
                    +--replan---+          +---repair-----+

read-only doc/analysis/report: IMPLEMENT -> COMPLETE
any active stage --explicit user abort--> CLOSED
```

New code tasks never skip REVIEW. `workflow_mode` changes execution depth inside stages, not
the stage graph. Pre-0.9 in-flight tasks may carry `workflow_mode_legacy:true` for proposal or
review-evidence compatibility. Only `workflow_mode_legacy_direct_edge:true`, created from old
lite semantics or an already-persisted edge, permits one IMPLEMENT -> VERIFICATION transition.

## Independent controls

- `approval_mode = approve|guard|confirm|auto` controls whether a legal transition waits for a
  user. `confirm` waits only at ANALYSIS -> IMPLEMENT; after that, green REVIEW, VERIFICATION,
  MEMORY, and COMPLETE transitions advance automatically.
- `workflow_mode = adaptive|fast|standard|strict` controls execution cost and assurance depth.
- `tdd_enabled` independently activates Java TDD and changed-line coverage. It defaults off;
  `tdd_coverage_threshold` defaults to 90 and accepts integers from 1 to 100.

Resolution order for each configured value is session override, then project config, then
defaults (`guard`, `adaptive`). ANALYSIS resolves `adaptive` to a concrete mode, presents the
selection and reasons, allows the user to change it within the risk floor, and freezes it when
ANALYSIS -> IMPLEMENT is applied.

TDD resolves with the same session-over-project precedence and freezes its enabled flag and
threshold on ANALYSIS -> IMPLEMENT. When off, it must add no CI scan, artifacts, commands,
coverage work, or stronger acceptance. Use `ec-config` for all mode configuration.

`confirm` and `auto` do not hide the proposal: show it in the plan. Confirm waits for that one
plan decision; Auto continues immediately. Both remove later waiting, not quality gates.

## Startup

1. Read the injected state breadcrumbs or call:

   ```bash
   {{PYTHON_CMD}} {{platform_config_dir}}/hooks/easy_coding_state.py snapshot --agent <agent-id> --session-file <P>
   ```

2. Check `.easy-coding/tasks/project-init/task.json` before routing work.
   - Missing: tell the user to run `easy-coding init` to install or repair the harness, then stop.
   - Present with `status != "COMPLETE"`: invoke `{{skill_trigger}}ec-init`, then stop.
   - `[easy-coding:upgrade-init-pending:X]`: recommend `{{skill_trigger}}ec-init` for vX
     adaptation, but allow the user to continue; this reminder is not a workflow block.
3. When the user explicitly references a Dev-Spec, run the read-only `inspect-dev-spec` command
   before ordinary task creation. For `protocol=canonical-v1`, show every task ID, repository,
   title, dependency, and baseline status; never select all tasks by default. After the user
   chooses one or more tasks and resolves repository paths or omitted hard-dependency evidence,
   call `create-task-from-spec` once for the complete selection. A document without a Canonical
   manifest remains a legacy ANALYSIS input for an ordinary task. A malformed, DRAFT, or otherwise
   non-READY Canonical Spec stays blocked and must never be downgraded to the legacy route. Never
   edit the source Spec.

   ```bash
   {{PYTHON_CMD}} {{platform_config_dir}}/hooks/easy_coding_state.py inspect-dev-spec \
     --spec <path> [--repo-path <repo-id>=<path>]...

   {{PYTHON_CMD}} {{platform_config_dir}}/hooks/easy_coding_state.py select-dev-spec-scope \
     --spec <path> --spec-task <task-id> [--spec-task <task-id>]...

   {{PYTHON_CMD}} {{platform_config_dir}}/hooks/easy_coding_state.py create-task-from-spec \
     --spec <path> --spec-task <task-id> [--spec-task <task-id>]... \
     --task-id <harness-task-id> --type <type> --title <title> \
     --repo-path <repo-id>=<path> [--dependency-evidence <dependency-id>=<evidence>]... \
     --agent <agent-id> --session-file <P>
   ```

   `select-dev-spec-scope` is read-only and may run only after explicit task selection. Its
   per-repository payload is the authoritative ANALYSIS context; do not load unselected task
   bodies from the source document.

   When multiple selected tasks depend on the same target, disambiguate creation evidence with
   `<source-task-id>-><dependency-task-id>=<evidence>`.
4. Match the user's intent against `current_task` and the active task list before resuming.
   If the user names or clearly matches another task, confirm the switch and call
   `claim-task --task-id <id> --agent <agent-id> --session-file <P>`. Do not execute task A
   under task B's request.
   - With no concrete task request, show resumable tasks or report readiness; never create an
     empty task from a bare workflow invocation.
   - For concrete unrelated work while another task is current, confirm creating the new task
     and suspending the current pointer before changing ownership.
   - Create a new task only after routing is settled, using a safe unique ID and a type faithful
     to the requested deliverable. Feature, bugfix, refactor, performance, and workflow changes
     are code tasks. Use `doc`, `analysis`, or `report` only when the user explicitly requested
     a no-code deliverable; never downgrade a code request to the read-only completion path.
5. Resume the matched/current task, then load only state-relevant assets. Do not read five full
   memories at every startup; ANALYSIS searches memory metadata and opens relevant entries on
   demand.
6. If another Agent last owned the task, summarize the stored handoff before continuing.

## Stage dispatch

- `INIT`: call `auto-transition --stage ANALYSIS`.
- `ANALYSIS`: dispatch `ec-analysis`; it produces artifacts and a workflow proposal.
- `IMPLEMENT`: dispatch `ec-implementing` using the frozen concrete mode.
- `REVIEW`: dispatch `ec-reviewing`; the transition requires current fingerprint evidence.
- `VERIFICATION`: dispatch `ec-verification`; archive requires current green evidence.
- `MEMORY`: dispatch `ec-memory`.
- `COMPLETE` / `CLOSED`: report terminal status and clear stale session ownership.

## Boundary handling

Use `request-transition` for a boundary that requires approval, then present the complete
choice set before invoking the platform's native choice UI:

1. Confirm the target transition.
2. Hand off to another Agent.
3. Other / revise.

Preserve `pending_transition` on cancellation, timeout, or invalid UI output. A later ordinary
reply may consume it. Use `confirm-transition` only for a matching stored edge.

Use `auto-transition` only when the state API says the edge is automatic. Mechanical gates
(analysis artifacts and proposal, review fingerprint, verification fingerprint, memory
completion) apply in every approval mode.

For a migrated pre-0.9 Lite task, the breadcrumb
`[easy-coding:lite-review-bypass-required:IMPLEMENT->REVIEW]` means the stored REVIEW edge is
stale. Call `cancel-transition`, then immediately call `auto-transition --stage VERIFICATION`.
Do not consume, confirm, or recreate the REVIEW edge; the state API will consume the task's
one-time `workflow_mode_legacy_direct_edge` compatibility marker on the direct transition.

## Mode escalation

When implementation reveals a higher risk, call:

```bash
{{PYTHON_CMD}} {{platform_config_dir}}/hooks/easy_coding_state.py raise-workflow-mode \
  --mode standard|strict --reason "<new risk>" \
  --agent <agent-id> --session-file <P>
```

Only upward changes are legal after ANALYSIS. During VERIFICATION, return to IMPLEMENT before
raising the mode so the task re-enters REVIEW with fresh evidence. Scope or design changes return
to ANALYSIS.

## Handoff and closure

Handoff writes a concise execution record and releases session ownership without changing
the task stage. Closing is destructive to the active workflow and always requires an explicit
user action, regardless of approval mode.
