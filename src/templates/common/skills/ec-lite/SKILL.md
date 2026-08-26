---
name: ec-lite
description: Toggle and operate Easy Coding Lite Direct mode for explicit minimal repository changes without task, QUALITY, or MEMORY artifacts.
---

# ec-lite — explicit direct mode

`ec-lite` is controlled only by the user. Never enable it automatically from task size, Workflow
Mode, or inferred intent. Communicate in the user's language.

## Toggle

Read the current snapshot. If Lite is enabled, a repeated explicit invocation exits it:

```bash
{{PYTHON_CMD}} {{platform_config_dir}}/hooks/easy_coding_state.py disable-lite \
  --agent <agent-id> --session-file <P>
```

If Lite is disabled, call `enable-lite` without a policy. When there is no active task it enables
immediately. When the API returns `lite-active-task-decision-required`, show the task ID, title,
and stage, then use the native choice UI with exactly these actions:

1. Cancel Lite startup: call `enable-lite --active-task-policy cancel`.
2. Close the task and start Lite: call
   `enable-lite --active-task-policy close --expected-task-id <shown-id>`; this preserves task
   files/history and records `user-switched-to-lite`.
3. Ignore the original task and start Lite: call
   `enable-lite --active-task-policy ignore --expected-task-id <shown-id>`; this clears only the
   current session task pointer and does not change the task or Canonical state.

Never select a branch for the user. If the task ID changed while waiting, show the new decision
instead of applying the old choice. Legacy `confirm_mode:lite` is only a migration alias for Guard
+ Fast and is unrelated to Lite Direct.

## Lite behavior

The status line must remain `Lite Direct` with `No Task / Quality / Memory`. Do not create task
folders, Dev-Specs, plans, test strategies, execution records, QUALITY evidence, or memory.

Pure read-only or ambiguous requests stay `Lite Direct · Ready` and use ordinary conversation.
For an explicit repository mutation:

1. Read only relevant EC rules, architecture, memory, nearest comparable code, and Git diff.
2. Present one compact proposal: behavior, exact target files, minimum-change boundary, and any
   necessary risk. Do not edit yet.
3. Record the proposal and use its returned digest:

   ```bash
   {{PYTHON_CMD}} {{platform_config_dir}}/hooks/easy_coding_state.py set-lite-proposal \
     --summary "<safe compact summary>" [--target-file <path>]... \
     --agent <agent-id> --session-file <P>
   ```

4. Ask the user to confirm the exact proposal. On confirmation call
   `confirm-lite-proposal --digest <digest>`. The state API captures the current Git baseline when
   the proposal is created and includes it in the digest; each proposal carries a fresh one-time
   nonce, so even an identical replacement has a new digest and a confirmed digest cannot be
   replayed or used with a rewritten baseline. Confirmation also requires the current Git state
   to still match the captured baseline; otherwise replace and re-present the proposal;
   target files must be 1..50 safe project-relative files in the current project repository.
   Harness-owned `.easy-coding/sessions/` metadata is excluded from business change detection and
   cannot be a target. Then implement only those files.
5. If scope expands, stop, replace the proposal, and confirm again.
6. Apply local style, core Java Javadoc, logical blank lines, and minimum modification exactly as
   normal Easy Coding. This includes the implementation exception for a documented interface method:
   omit repeated Javadoc only when the interface method has meaningful, accurate, accessible
   Javadoc and the implementation adds no implementation-specific contract, constraint, side
   effect, or other behavior beyond that documented interface method's contract.
   Document implementation-specific behavior and obey explicit project hard rules. A generic
   project rule requiring Javadoc on every core Java method does not by itself override the
   documented interface method exception. Only an explicit project rule requiring implementation
   methods to repeat interface Javadoc does. Do not run tests by default; run only a command
   explicitly requested by the user or mandated by a project/global hard rule.
7. Report changed files and any command actually run, then call
   `complete-lite-proposal --digest <digest>`. Completion fails if no confirmed target changed,
   another file changed after confirmation, or Git HEAD moved. Re-present the proposal rather
   than bypassing that result. Lite remains enabled for the next request.

Lite intentionally omits TDD, QUALITY, MEMORY, task history, and completion transitions. Use a
normal Fast task instead when the user wants those guarantees.
