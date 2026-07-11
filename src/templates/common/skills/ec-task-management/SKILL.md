---
name: ec-task-management
description: Task and session panel for Easy Coding. Use when the user runs {{skill_trigger}}ec-task-management, asks to see/create/continue/take over tasks, or asks to view or change the current session confirm mode.
---

# ec-task-management — the task panel

A focused task panel: list unfinished tasks, create tasks, and let the user choose one task
to continue or take over. Stage progression still belongs to ec-workflow; closure belongs
to ec-task-close.

Communicate with the user in the user's language.

## Capabilities

### List unfinished tasks

Call the state API with the current agent id:
`{{PYTHON_CMD}} {{platform_config_dir}}/hooks/easy_coding_state.py list-tasks --agent <agent-id>`.

Show only tasks whose `active` is true. For each task show:
- id
- title
- status
- created_at
- action label:
  - `continue` when `action == "continue"`
  - `take over` when `action == "takeover"`
- previous agent when `previous_agent` is present
- latest handoff summary when `latest_handoff.summary` is present

Use wording in the user's language. The important distinction is:
- Continue: the current agent was already the last agent.
- Take over: another agent was the last agent; show that previous agent.

### Continue or take over a selected task

When the user chooses a listed task, call:
`{{PYTHON_CMD}} {{platform_config_dir}}/hooks/easy_coding_state.py claim-task --session-file <P> --task-id <task-id> --agent <agent-id>`.

Use the returned `status_context` as the authoritative status source for the rest of the
current turn. Then report:
- whether this was `continue` or `takeover`
- the previous agent if returned
- the latest handoff summary if returned
- the current stage

After claiming, hand control to ec-workflow semantics: read the task metadata and latest
execution records, then resume from the current stage. Do not advance stages from this skill
unless ec-workflow is explicitly invoked or the agent environment routes into it.

### Create a task

Create through the state API, never by hand-editing `task.json` or session files:
`{{PYTHON_CMD}} {{platform_config_dir}}/hooks/easy_coding_state.py create-task --session-file <P> --task-id <MM-DD-short-name> --type <feature|bugfix|refactor|perf|doc|analysis|report|workflow> --title "<one-line summary>" --agent <agent-id> --no-set-current`.

If the user explicitly wants to start the task now, omit `--no-set-current`; otherwise leave
the current workflow pointer untouched and tell them to run `{{skill_trigger}}ec-workflow`
when ready.

The command returns `status_line` and `status_context`. If the command sets or changes
`current_task`, use the returned context as the authoritative status source for the rest of
the current turn instead of older hook-injected status text.

### View or change this session's confirm mode

Call `snapshot --session-file <P>` and show:
- `project_confirm_mode`
- `session_confirm_mode` (`project default` when null)
- `effective_confirm_mode`

When the user asks to change the current session, use native choice UI when available and offer
exactly `approve`, `guard` (recommended default), and `auto`. The native free-form Other input
may receive `restore project default`; do not invent a fourth button when the UI is limited to
three choices.

Set an override through the state API, never by editing the session JSON:
`{{PYTHON_CMD}} {{platform_config_dir}}/hooks/easy_coding_state.py set-confirm-mode --session-file <P> --mode <approve|guard|auto> --agent <agent-id>`.

Restore project configuration through:
`{{PYTHON_CMD}} {{platform_config_dir}}/hooks/easy_coding_state.py clear-confirm-mode --session-file <P> --agent <agent-id>`.

Use the returned snapshot as authoritative and report the effective mode. Preserve any existing
`pending_transition`; when it becomes automatic, ec-workflow consumes its original target via
`auto-transition` instead of losing the completed stage outcome.

## Boundaries

- Do not close or cancel tasks — that is ec-task-close.
- Do not advance stages directly from this skill.
- Do not ask who the next agent will be. A takeover is decided by the agent that claims the
  task, not by the agent that last handed it off.
