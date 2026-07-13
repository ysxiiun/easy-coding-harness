---
name: ec-verification
description: VERIFICATION-stage skill — the hard evidence gate between implementation/review and archive. Runs lint/typecheck/test in parallel, verifies coverage against test-strategy, then follows the effective confirm mode for archive or repair.
---

# ec-verification — the hard gate

ec-workflow dispatches you when REVIEW returns `accept` or the user explicitly skips REVIEW
after code IMPLEMENT. Read-only tasks auto-complete from IMPLEMENT and never enter this stage.
You are the last gate before code-task archive. Nothing passes on assumption.

Communicate with the user in the user's language.

## Two iron laws

```
NO COMPLETION CLAIMS WITHOUT FRESH VERIFICATION EVIDENCE
- A command you did not run this round did not pass.
- A previous round's result does not count.
- "should pass" / "looks correct" is not evidence.

NO ARCHIVE WITHOUT A GREEN GATE
- Verification passing evidence is mandatory in every confirm mode.
- approve/guard/lite require user acceptance before MEMORY; auto advances after the green gate.
- Confirmation mode never turns failed or missing evidence into acceptance.
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

- All three pass AND coverage satisfied → present the verification result; approve/guard/lite wait
  for user acceptance, while auto hands the green result to ec-workflow for automatic MEMORY.
- Any failure → append the failing `verify` record, summarize failures, select
  VERIFICATION -> IMPLEMENT, and follow the effective confirm mode.

## 4. User acceptance and repair loop

After a green gate, present an acceptance summary: what changed (files + summaries), the
verification results (lint/type/test), and the coverage status. Then the user takes time to
test manually. Their response routes:

- **"accepted"** (approve/guard/lite) → request VERIFICATION -> MEMORY and present the standard boundary gate.
- **"problem here"** → scope judgment against the dev-spec:
  - in scope → select VERIFICATION -> IMPLEMENT and follow the effective confirm mode; after
    repair, approve presents the IMPLEMENT choice, guard/auto default to REVIEW, and lite
    returns directly to VERIFICATION.
  - out of scope → propose a new task (`spawned_from` = current task id); the current task
    may archive now (if already satisfactory) or stay suspended.
- **"cancel"** → ec-task-close.

Repair sizing: a trivial tweak is fixed and re-verified inside VERIFICATION; a logic/structure
change formally returns to IMPLEMENT. After repair, approve presents the standard IMPLEMENT
completion choice again; guard/auto enter REVIEW, while lite returns directly to VERIFICATION
without offering REVIEW.

## 5. Archive entry

In approve/guard/lite, acceptance does not mutate the stage directly. Hand control to ec-workflow
to call `request-transition --stage MEMORY`, then present:
1. Confirm entering MEMORY
2. Hand off to another agent
3. Other (native free-form Other, or the third text option)

Only after confirmation may ec-workflow consume the pending edge and dispatch ec-memory.
In auto, hand the green gate directly to ec-workflow for `auto-transition --stage MEMORY`.
ec-memory owns both short-memory creation and the conditional long-memory gate inside the
single MEMORY stage. After memory processing completes, MEMORY -> COMPLETE advances
automatically without another confirmation or handoff gate.
