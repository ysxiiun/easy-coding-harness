---
name: ec-task-management
description: View and manage Easy Coding task lifecycle, ownership, handoff, and closure.
---

# ec-task-management — task lifecycle

Communicate with the user in the user's language. A bare invocation is read-only: show the
panel and available actions, but do not mutate a session without an explicit choice.

## Default panel

Call the state API snapshot and show:

- current task, stage, last Agent, and pending transition;
- task `concrete_workflow_mode` and frozen unit test strategy when present;
- harness enabled/disabled and Lite Direct state;
- active and resumable tasks.
- for Canonical-backed tasks: source locator/path mode, Spec ID/design revision/design digest,
  document digest, execution revision, writeback status, selected task IDs, repository
  bindings/baseline status, pending dependency evidence, loaded context version/session, and
  pending confirmed Spec change.

Mode inspection and configuration belongs to `ec-config`. If the user asks to change Approval,
Workflow, unit test strategy, or the shared coverage threshold, route there and do not mutate those fields here.

## Task actions

Support listing, creating, selecting, claiming, handing off, and closing tasks through the
state API. Preserve pending transitions when inspecting tasks. Never infer user
acceptance from opening this panel.

Create tasks only for explicit repository mutations. Pure analysis, explanation, reporting, and
read-only review stay Ready and are answered directly. If Lite Direct is enabled, route task
selection or creation to `ec-lite` so the user can exit it first.

When creating from a Canonical Spec, call `inspect-dev-spec --manifest-only`, display the complete
task and dependency selection, then call `create-task-from-spec` only after explicit user
selection. Multiple selected Spec tasks still create one Harness task. Do not call
`select-dev-spec-scope` during discovery. Creation and claim return the selected consumption
closure; consume it before stage work. On a resumed session, use `resume-spec-context` with
the current agent/session. A blocked context allows repair/rebind/sync, but blocks advancement.
Initialize missing shared execution before creation. Support `rebind-spec-source` only when the
new file matches schema + spec_id + design revision + design_sha256 and does not roll execution
revision backward. A pending writeback is repaired with `reconcile-spec-execution`, never by
editing the execution JSON block or starting a different writeback. A deterministic rejected
action is cleared with `status:error`; correct its input instead of replaying it.

Confirmed requirement changes use `begin-spec-change` before editing the original source.
Its summary and affected tasks survive handoff. Finish revision + READY + `sync-spec-design`,
then reload context and refresh the plan in ANALYSIS. Do not clear a pending change manually.
