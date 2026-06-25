---
name: ec-verification
description: VERIFICATION-stage skill — the hard gate between REVIEW and archive. Use when ec-workflow enters VERIFICATION. Runs lint/typecheck/test in parallel, verifies coverage against test-strategy, gates on fresh evidence, then drives the user-acceptance and repair loop. Archive never happens without explicit user acceptance.
---

# ec-verification — the hard gate

ec-workflow dispatches you when REVIEW returns `accept`. You are the last gate before
archive. Nothing passes on assumption.

Communicate with the user in the user's language.

## Two iron laws

```
NO COMPLETION CLAIMS WITHOUT FRESH VERIFICATION EVIDENCE
- A command you did not run this round did not pass.
- A previous round's result does not count.
- "should pass" / "looks correct" is not evidence.

NO AUTO-ARCHIVE WITHOUT USER ACCEPTANCE
- Verification passing does not complete the task.
- The memory flow is part of archive; it runs only after the user accepts.
- An unaccepted task's memory is dirty data.
```

## 1. Run the gate (parallel, always sub-agents)

<HARD-GATE>
VERIFICATION ALWAYS USES SUB-AGENTS for each check. This prevents context pollution and
ensures true parallelism. You MUST NOT run lint/typecheck/test inline in the main agent.
</HARD-GATE>

Dispatch three sub-agents concurrently (one per check):
1. V1: lint (eslint/biome/project linter)
2. V2: typecheck (`tsc --noEmit` or equivalent)
3. V3: test (project test command)

Each sub-agent runs its command and returns `{check, passed, failures[]}`.
Platform spawn rule: {{platform_spawn_instruction}}

Append one `verify` record per check:
`{"type":"verify","check":"test","passed":true}` (add `"failures":[...]` on failure).

## 2. Coverage check (against test-strategy.md)

- Every [must-test] item → must have a corresponding test case.
- Every [should-test] item → must have a corresponding test case.
- A [depends] item the user confirmed as must-test → must have one.
- Bug fix → must have a regression test.
- Missing coverage → blocked: return to IMPLEMENT to add tests.

## 3. Gate decision

- All three pass AND coverage satisfied → present the verification result; wait for user
  acceptance. Do NOT archive yet.
- Any failure → append the failing `verify` record, summarize failures, return to IMPLEMENT.

## 4. User acceptance and repair loop

After a green gate, present an acceptance summary: what changed (files + summaries), the
verification results (lint/type/test), and the coverage status. Then the user takes time to
test manually. Their response routes:

- **"accepted"** → trigger the archive flow (section 5).
- **"problem here"** → scope judgment against the dev-spec:
  - in scope → return to IMPLEMENT to fix → re-REVIEW → re-VERIFICATION.
  - out of scope → propose a new task (`spawned_from` = current task id); the current task
    may archive now (if already satisfactory) or stay suspended.
- **"cancel"** → ec-task-close.

Repair sizing: a trivial tweak is fixed and re-verified inside VERIFICATION; a logic/structure
change formally returns to IMPLEMENT and re-walks REVIEW → VERIFICATION.

## 5. Archive flow (only after acceptance)

Runs automatically once the user accepts:
1. MEMORY_SHORT — call
   `{{PYTHON_CMD}} {{platform_config_dir}}/hooks/easy_coding_state.py transition --session-file <P> --stage MEMORY_SHORT --agent <agent-id>`,
   use the returned `status_context` as the latest status source, then hand control to
   ec-memory to write the short memory entry.
2. MEMORY_LONG — after MEMORY_SHORT returns, call
   `{{PYTHON_CMD}} {{platform_config_dir}}/hooks/easy_coding_state.py transition --session-file <P> --stage MEMORY_LONG --agent <agent-id>`,
   use the returned `status_context` and `memory_long` object as authoritative, then hand
   control to ec-memory to distill long memory or perform its no-op gate.
3. COMPLETE — after MEMORY_LONG returns, call
   `{{PYTHON_CMD}} {{platform_config_dir}}/hooks/easy_coding_state.py transition --session-file <P> --stage COMPLETE --agent <agent-id>`,
   which clears session `current_task` for the completed task. Use the returned
   `status_context`, then output the task summary (what was done, files changed, key
   decisions).

Hand control back to ec-workflow at each transition; ec-workflow owns the stage writes.
