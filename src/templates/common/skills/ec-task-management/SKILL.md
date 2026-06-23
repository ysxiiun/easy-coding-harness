---
name: ec-task-management
description: Read-only task panel — create and list Easy Coding tasks. Use when the user runs {{skill_trigger}}ec-task-management or asks to see what tasks exist or to create a task. Does NOT perform workflow recovery (that is ec-workflow) or closure (that is ec-task-close).
---

# ec-task-management — the task panel

A focused information panel: create tasks and list them. Recovery and stage progression
belong to ec-workflow; closure belongs to ec-task-close. This skill does neither.

Communicate with the user in the user's language.

## Capabilities

### List tasks
Call the state API:
`{{PYTHON_CMD}} {{platform_config_dir}}/hooks/easy_coding_state.py list-tasks`.
Show each task's id, title, status, created_at, and whether it is active. This is read-only.

### Create a task
Create through the state API, never by hand-editing `task.json` or session files:
`{{PYTHON_CMD}} {{platform_config_dir}}/hooks/easy_coding_state.py create-task --session-file <P> --task-id <MM-DD-short-name> --type <feature|bugfix|refactor|perf> --title "<one-line summary>" --agent <agent-id> --no-set-current`.

If the user explicitly wants to start the task now, omit `--no-set-current`; otherwise leave
the current workflow pointer untouched and tell them to run `{{skill_trigger}}ec-workflow`
when ready.

## Boundaries

- No workflow recovery — point the user to ec-workflow to resume or progress a task.
- No closing/cancelling — that is ec-task-close.
- Do not advance stages or run stage skills from here.
