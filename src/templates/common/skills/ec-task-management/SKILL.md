---
name: ec-task-management
description: Task panel for Easy Coding tasks. Use when the user runs {{skill_trigger}}ec-task-management, asks to see tasks, create a task, continue a task, or take over a task handed off by another agent.
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
`{{PYTHON_CMD}} {{platform_config_dir}}/hooks/easy_coding_state.py create-task --session-file <P> --task-id <MM-DD-short-name> --type <feature|bugfix|refactor|perf> --title "<one-line summary>" --agent <agent-id> --no-set-current`.

If the user explicitly wants to start the task now, omit `--no-set-current`; otherwise leave
the current workflow pointer untouched and tell them to run `{{skill_trigger}}ec-workflow`
when ready.

The command returns `status_line` and `status_context`. If the command sets or changes
`current_task`, use the returned context as the authoritative status source for the rest of
the current turn instead of older hook-injected status text.

## Boundaries

- Do not close or cancel tasks — that is ec-task-close.
- Do not advance stages directly from this skill.
- Do not ask who the next agent will be. A takeover is decided by the agent that claims the
  task, not by the agent that last handed it off.
