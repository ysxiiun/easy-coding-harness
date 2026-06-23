---
name: ec-task-close
description: Task interruption and closure skill. Use when the user runs {{skill_trigger}}ec-task-close or signals intent to abandon the current task ("cancel this", "drop it", "this requirement is off"). Confirms intent, records the reason, cleans state, and runs NO memory flow.
---

# ec-task-close — stop a task cleanly

Closure is its own flow because it must NOT archive. A task abandoned mid-flight has no
verified result, so its memory would be dirty data. CLOSED is a terminal state, peer to
COMPLETE, reachable from any stage.

Communicate with the user in the user's language. You may be invoked explicitly, or loaded
when you recognize abandonment intent in the user's message.

## Flow

1. **Confirm intent.** Ask: "Close task «{task name}»? This stops it without archiving."
   Require an explicit yes. (Skip the confirm only if the task is already COMPLETE and the
   user just wants it tidied.)
2. **Record the reason.** Capture the user's reason in one line.
3. **Close through the state API:** run
   `{{PYTHON_CMD}} {{platform_config_dir}}/hooks/easy_coding_state.py close-current --session-file <P> --reason "<reason>" --agent <agent-id>`.
   This sets `task.json.status` to `CLOSED`, records `closed_reason`, updates history, and
   clears session `current_task` so the next hook injection returns to Ready.
4. **No memory flow.** Do not run MEMORY_SHORT/LONG. An incomplete task's memory is dirty data.
5. **Linked tasks.** If the task has `spawned_from` or `spawned_tasks`, note the closure fact
   on the relation so a future agent understands the chain.
6. Optionally append a closure note to `execution.jsonl` if there is context worth keeping for
   a possible future revival.

## Boundaries

- Never delete task folders — CLOSED tasks stay as a record.
- Never run the memory/archive flow.
- This skill closes the `current_task`. If the user wants to close a different (suspended)
  task, they should first switch to it via ec-workflow, then invoke ec-task-close.
- Division of labor: ec-task-management lists/creates (read-only panel), ec-workflow runs the
  stage machine, ec-task-close owns interruption. Stay in your lane.
