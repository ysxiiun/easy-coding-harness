---
name: ec-task-management
description: View and manage Easy Coding tasks plus project/session approval and workflow-mode settings.
---

# ec-task-management — tasks and session modes

Communicate with the user in the user's language. A bare invocation is read-only: show the
panel and available actions, but do not mutate a session without an explicit choice.

## Default panel

Call the state API snapshot and show:

- current task, stage, last Agent, and pending transition;
- `project_approval_mode`, `session_approval_mode`, `effective_approval_mode`;
- `project_workflow_mode`, `session_workflow_mode`, `configured_workflow_mode`;
- task `concrete_workflow_mode` or ANALYSIS proposal when present;
- harness enabled/disabled state;
- active and resumable tasks.
- for Canonical-backed tasks: source Spec ID/revision/SHA, selected task IDs, repository
  bindings/baseline status, and pending dependency evidence.

Explain precedence:

`session override > project config > approval:guard / workflow:adaptive`

## Session settings

After explicit user selection:

```bash
# approval
{{PYTHON_CMD}} {{platform_config_dir}}/hooks/easy_coding_state.py set-approval-mode --mode approve|guard|confirm|auto --agent <agent-id> --session-file <P>
{{PYTHON_CMD}} {{platform_config_dir}}/hooks/easy_coding_state.py clear-approval-mode --agent <agent-id> --session-file <P>

# workflow
{{PYTHON_CMD}} {{platform_config_dir}}/hooks/easy_coding_state.py set-workflow-mode --mode adaptive|fast|standard|strict --agent <agent-id> --session-file <P>
{{PYTHON_CMD}} {{platform_config_dir}}/hooks/easy_coding_state.py clear-workflow-mode --agent <agent-id> --session-file <P>
```

Changing a session setting affects future ANALYSIS proposals. It does not silently rewrite a
mode already frozen on an active task. During ANALYSIS, regenerate and show the proposal. During
IMPLEMENT or REVIEW, use `raise-workflow-mode` for a justified increase; lowering is forbidden.
From VERIFICATION, return to IMPLEMENT first so the raised mode receives fresh REVIEW evidence.

Project settings are changed with `easy-coding config`, which edits both dimensions in one
confirmed interaction.

## Task actions

Support listing, creating, selecting, claiming, handing off, and closing tasks through the
state API. Preserve pending transitions when merely changing approval mode. Never infer user
acceptance from opening this panel.

When creating from a Canonical Spec, call `inspect-dev-spec`, display the complete task and
dependency selection, then call `select-dev-spec-scope` and `create-task-from-spec` only after
explicit user selection. Multiple selected Spec tasks still create one Harness task, while the
selector returns one deterministic consumption closure per selected repository.
