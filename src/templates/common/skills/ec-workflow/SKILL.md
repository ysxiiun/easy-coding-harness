---
name: ec-workflow
description: Main Easy Coding entrypoint. Creates or resumes a task, orchestrates the unified state machine, separates approval from execution depth, and dispatches the stage skill for the current state.
---

# ec-workflow — state orchestration

Use this as the only normal entrypoint for Easy Coding development work. Communicate in the
user's language.

## State machine

```text
INIT --auto--> ANALYSIS -> IMPLEMENT -> QUALITY -> MEMORY --auto--> COMPLETE
                    ^           ^          |
                    +--replan---+          +---repair-----+

any active stage --explicit user abort--> CLOSED
```

Every repository-mutation task uses this graph. QUALITY owns two independent read-only gates:
Review Gate and Verification Gate. `workflow_mode` changes their evidence depth, not the graph.
Pure conversation, explanation, analysis, and read-only review stay Ready and create no task.

## Independent controls

- `approval_mode = approve|guard|confirm|auto` controls whether a legal transition waits for a
  user. `confirm` waits only at ANALYSIS -> IMPLEMENT; after that, green QUALITY, MEMORY, and
  COMPLETE transitions advance automatically. `auto` advances every legal green
  edge. The only additional pause is an exceptional code diff detected after the frozen
  QUALITY acceptance checkpoint; accepting that exact diff does not change the mode.
- `workflow_mode = adaptive|fast|standard|strict` controls execution cost and assurance depth.
- `tdd_enabled` independently activates Java TDD and changed-line coverage. It defaults off;
  `tdd_coverage_threshold` defaults to 90 and accepts integers from 1 to 100.

Resolution order for each configured value is session override, then project config, then
defaults (`guard`, `adaptive`). ANALYSIS resolves `adaptive` to a concrete mode, presents the
selection and reasons, allows the user to change it within the risk floor, and freezes it when
ANALYSIS -> IMPLEMENT is applied.

TDD resolves with the same session-over-project precedence and freezes its enabled flag and
threshold on ANALYSIS -> IMPLEMENT. It may be enabled only after `ec-tdd-init` readiness passes;
there is no enabled-but-pending-initialization state. A dedicated `tdd-init` task always freezes
TDD off so it can create or repair the required infrastructure without circular gating. When off,
ordinary tasks add no CI scan, artifacts, commands, coverage work, or stronger acceptance. Use
`ec-config` for all mode configuration.

`confirm` and `auto` do not hide the proposal: show it in the plan. Confirm waits for that one
plan decision; Auto continues immediately. Both remove later waiting, not quality gates.

## Startup

Throughout this skill, `<agent-id>` is the canonical workflow owner ID: `claude-code`, `codex`,
or `qoder`. Never use a display or source-author attribution such as `Codex with Easy Coding`.

1. Read the injected state breadcrumbs or call:

   ```bash
   {{PYTHON_CMD}} {{platform_config_dir}}/hooks/easy_coding_state.py snapshot --agent <agent-id> --session-file <P>
   ```

   When `[easy-coding:lite-direct]` is present, route only to `ec-lite`. Do not create, resume,
   inspect, or transition a normal Harness task until Lite is explicitly exited.

2. Check `.easy-coding/tasks/project-init/task.json` before routing work.
   - Missing: tell the user to run `easy-coding init` to install or repair the harness, then stop.
   - Present with `status != "COMPLETE"`: invoke `{{skill_trigger}}ec-init`, then stop.
   - `[easy-coding:upgrade-init-pending:X]`: recommend `{{skill_trigger}}ec-init` for vX
     adaptation, but allow the user to continue; this reminder is not a workflow block.
3. When the user explicitly references a Dev-Spec, first run read-only `inspect-dev-spec
   --manifest-only`. This routing pass validates the document, identifies the current worktree by
   normalized remote, and returns the task catalog without resolving unrelated repositories. For
   `protocol=canonical-v1`, show every task ID, repository, title, static status, actual execution
   status, and dependency; never select all tasks by default and never calculate baseline drift
   before selection.

   After the user chooses one or more tasks, run one selected inspection with repeated
   `--spec-task`. Resolve paths only for repositories that own selected tasks. The current
   worktree needs no explicit mapping when its normalized remote matches uniquely; pass
   `--repo-path` only for an additional selected repository or to confirm an ambiguous current
   match. A differing `path_hint` is a one-time runtime mapping notice, not a Spec portability
   failure: never copy, mirror, or rewrite the source Spec because of it.

   Then call `create-task-from-spec` once for the complete selection. Do not call
   `select-dev-spec-scope` during routing; `ec-analysis` owns the single consumption-closure read
   after task creation. A document without a Canonical manifest remains a legacy ANALYSIS input
   for an ordinary task. A malformed, DRAFT, or otherwise non-READY Canonical Spec stays blocked
   and must never be downgraded to the legacy route. A READY Canonical Spec without shared
   execution remains readable, but run `initialize-spec-execution` before selection can become an
   executable Harness task.

   ```bash
   {{PYTHON_CMD}} {{platform_config_dir}}/hooks/easy_coding_state.py inspect-dev-spec \
     --spec <path> --manifest-only

   {{PYTHON_CMD}} {{platform_config_dir}}/hooks/easy_coding_state.py inspect-dev-spec \
     --spec <path> --spec-task <task-id> [--spec-task <task-id>]... \
     [--repo-path <repo-id>=<path>]...

   {{PYTHON_CMD}} {{platform_config_dir}}/hooks/easy_coding_state.py initialize-spec-execution \
     --spec <path>

   {{PYTHON_CMD}} {{platform_config_dir}}/hooks/easy_coding_state.py create-task-from-spec \
     --spec <path> --spec-task <task-id> [--spec-task <task-id>]... \
     --task-id <harness-task-id> --type <type> --title <title> \
     [--repo-path <repo-id>=<path>]... \
     [--dependency-evidence <dependency-id>=<evidence>]... \
     --agent <agent-id> --session-file <P>
   ```

   Shared `EDS:EXECUTION` is the dependency fact source. Accept a completed hard dependency or a
   satisfied edge directly from that snapshot. Only accept manual dependency evidence when the
   shared edge is still pending and the user explicitly supplies independently verifiable
   evidence; never reconstruct completion from another local Harness task, Git history, or an
   agent's inference.

   When multiple selected tasks depend on the same target, disambiguate creation evidence with
   `<source-task-id>-><dependency-task-id>=<evidence>`.
   Explicit project-external Spec files are supported and stored as absolute locators. If that
   locator moves, use `rebind-spec-source`; never guess by basename. Shared execution progress is
   written only through state API writer commands. Static design edits require revision + READY +
   `sync-spec-design`; never hand-edit the `EDS:EXECUTION` region.
4. When the user explicitly invokes `ec-tdd-init`, let that skill own preflight and create a
   `type=tdd-init` code task only after scope confirmation. Do not reinterpret it as an ordinary
   TDD-enabled feature task and do not require readiness before creating it.
5. Match the user's intent against `current_task` and the active task list before resuming.
   If the user names or clearly matches another task, confirm the switch and call
   `claim-task --task-id <id> --agent <agent-id> --session-file <P>`. Do not execute task A
   under task B's request.
   - With no explicit repository-mutation request, stay Ready and answer normally. Ambiguous
     intent remains Ready until conversation establishes a concrete mutation.
   - For concrete unrelated work while another task is current, confirm creating the new task
     and suspending the current pointer before changing ownership.
   - Create a new task only after routing is settled, using a safe unique ID and a type faithful
     to the requested repository mutation. A document, config, or report file write is still a
     mutation task. Never create `doc`, `analysis`, or `report` tasks for a chat-only result.
6. Resume the matched/current task, then load only state-relevant assets. Do not read five full
   memories at every startup; ANALYSIS searches memory metadata and opens relevant entries on
   demand.
7. If another Agent last owned the task, summarize the stored handoff before continuing.

## Stage dispatch

- `INIT`: call `auto-transition --stage ANALYSIS`.
- `ANALYSIS`: dispatch `ec-analysis`; it produces artifacts and a workflow proposal.
- `IMPLEMENT`: dispatch `ec-implementing` using the frozen concrete mode.
- `QUALITY`: dispatch `ec-quality`; it freezes one candidate, runs Review and Verification Gates,
  aggregates one repair bundle, and requires an unchanged or explicitly accepted checkpoint.
- `MEMORY`: dispatch `ec-memory`.
- `COMPLETE` / `CLOSED`: report terminal status and clear stale session ownership.

For a Canonical-backed task whose snapshot reports pending writeback, call
`reconcile-spec-execution` before dispatching the stage. Do not advance locally while shared
writeback remains pending or conflicted. A deterministic writer rejection reports `error` and
clears the pending action so the corrected action can proceed; never overwrite a different
pending action.

## Boundary handling

Use `request-transition` for a boundary that requires approval, then present the complete
choice set before invoking the platform's native choice UI:

1. Confirm the target transition.
2. Hand off to another Agent.
3. Other / revise.

Preserve `pending_transition` on cancellation, timeout, or invalid UI output. A later ordinary
reply may consume it. Use `confirm-transition` only for a matching stored edge.

Text emitted before a later tool call is a non-durable process presentation because the host may
group or collapse it. For ANALYSIS -> IMPLEMENT, preserve the compact proposal receipt produced by
`ec-analysis`. After a native choice returns or a matching transition call completes, the last
assistant response in that turn must repeat the receipt and full Dev-Spec link/path even if they
were already visible. When the edge remains pending, include the complete numbered fallback;
when confirmed, name the accepted branch and target stage. An empty, cancelled, timed-out, or
invalid native result is not grounds to omit this final receipt.

Use `auto-transition` only when the state API says the edge is automatic. Mechanical gates
(analysis artifacts and proposal, review fingerprint, verification fingerprint, memory
completion) apply in every approval mode. An automatic ANALYSIS -> IMPLEMENT edge must not pause;
carry its full Dev-Spec link/path into the next durable final response in the same turn.

`[easy-coding:acceptance-drift-confirmation-required]` is a narrow exception to automatic-edge
handling. Call `inspect-transition-drift`, present every returned patch/binary/mode change and the
current `diff_sha256`, then use the platform's native choice UI for these branches:

1. Accept this exact diff and continue to MEMORY (recommended only with the stated verification
   policy).
2. Return to IMPLEMENT because the change needs normal repair/quality checks.
3. Hand off to another Agent.
4. Other / revise.

Never call `auto-transition` repeatedly to hide this pause. If the user accepts, preserve the
existing Review Gate conclusion and call `confirm-transition` with the exact digest,
`--verification-policy carry-forward|targeted|waived`, and a decision summary. `targeted` needs a
passed current-fingerprint targeted check first. If the digest changes, inspect and present the
new diff. Config, plan, workflow, Canonical-design, or nested-repository drift is not an
acceptance-diff choice and returns to the stage required by the state API.

## Mode escalation

When implementation reveals a higher risk, call:

```bash
{{PYTHON_CMD}} {{platform_config_dir}}/hooks/easy_coding_state.py raise-workflow-mode \
  --mode standard|strict --reason "<new risk>" \
  --agent <agent-id> --session-file <P>
```

Only upward changes are legal after ANALYSIS. During QUALITY, return to IMPLEMENT before
raising the mode so the task re-enters QUALITY with fresh evidence. Scope or design changes return
to ANALYSIS.

## Handoff and closure

Handoff writes a concise execution record and releases session ownership without changing
the task stage. Closing is destructive to the active workflow and always requires an explicit
user action, regardless of approval mode.
