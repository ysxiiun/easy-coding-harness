---
name: ec-no-harness
description: Disable Easy Coding Harness orchestration for the current agent session and use native agent behavior. Use only when the user explicitly invokes {{skill_trigger}}ec-no-harness or explicitly asks to restore Easy Coding after this bypass.
---

# ec-no-harness — current-session Easy Coding bypass

This skill bypasses only Easy Coding Harness for the current session. It does not disable the
platform's hook system, alter `EC_HOOKS`, or suppress non-Easy-Coding skills and instructions.

Communicate with the user in the user's language.

## Disable for this session

Read `[easy-coding:session-file:P]` from the injected context, then call:

`{{PYTHON_CMD}} {{platform_config_dir}}/hooks/easy_coding_state.py disable-harness --session-file <P> --agent <agent-id>`

After the command succeeds:
- Do not enter or resume ec-workflow in this session.
- Do not emit an Easy Coding status line or apply Easy Coding stages, confirmation gates,
  task artifacts, verification orchestration, or memory workflow.
- Process the user's request with the platform's native agent behavior.
- Continue honoring project/user/global instructions, explicitly requested non-Easy-Coding
  skills, and every other hook.
- Do not clear `current_task`, delete a pending transition, or modify task state. The task is
  suspended intact and can resume after restoring Easy Coding or in a new session.

If the invocation contains no request beyond enabling the bypass, briefly confirm that native
mode is active for the current session.

## Restore Easy Coding in the same session

Only when the user explicitly asks to restore/resume Easy Coding, call:

`{{PYTHON_CMD}} {{platform_config_dir}}/hooks/easy_coding_state.py enable-harness --session-file <P> --agent <agent-id>`

Use the returned `status_context` as authoritative. Do not advance the task automatically;
hand control back to ec-workflow routing semantics.
