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
Scan `.easy-coding/tasks/`. For each task folder show: id, `title` (if present), `status`,
`created_at`, and whether it is active (status not in {COMPLETE, CLOSED}). Group by active
vs finished so the user sees at a glance what is in flight. This is read-only — change
nothing.

### Create a task
Create `.easy-coding/tasks/{MM-DD-short-name}/task.json` using the runtime schema:

```json
{
  "type": "feature | bugfix | refactor | perf",
  "title": "<one-line summary of the task>",
  "status": "INIT",
  "created_at": "<ISO 8601>",
  "created_by": "<agent id>",
  "context": {},
  "spawned_from": null,
  "spawned_tasks": [],
  "closed_reason": null,
  "repos": []
}
```

Only set `current_task`/`current_stage` in state.json if the user explicitly wants to start
the task now — otherwise leave the workflow state untouched and tell them to run
`{{skill_trigger}}ec-workflow` when ready.

## Boundaries

- No workflow recovery — point the user to ec-workflow to resume or progress a task.
- No closing/cancelling — that is ec-task-close.
- Do not advance stages or run stage skills from here.
