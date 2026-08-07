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
- task `concrete_workflow_mode` and frozen TDD state when present;
- harness enabled/disabled state;
- active and resumable tasks.
- for Canonical-backed tasks: source Spec ID/revision/SHA, selected task IDs, repository
  bindings/baseline status, and pending dependency evidence.

Mode inspection and configuration belongs to `ec-config`. If the user asks to change Approval,
Workflow, TDD, or the TDD coverage threshold, route there and do not mutate those fields here.

## Task actions

Support listing, creating, selecting, claiming, handing off, and closing tasks through the
state API. Preserve pending transitions when inspecting tasks. Never infer user
acceptance from opening this panel.

When creating from a Canonical Spec, call `inspect-dev-spec`, display the complete task and
dependency selection, then call `select-dev-spec-scope` and `create-task-from-spec` only after
explicit user selection. Multiple selected Spec tasks still create one Harness task, while the
selector returns one deterministic consumption closure per selected repository.
