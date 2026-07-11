---
name: ec-implementing
description: IMPLEMENT-stage skill. Use when ec-workflow enters IMPLEMENT with a confirmed plan. Executes execution.jsonl units under strict file-scope control, enforces RULES compliance and encoding preservation, writes tests per strategy, and dispatches sub-agents for every unit regardless of strategy.
---

# ec-implementing — execute the confirmed plan

ec-workflow dispatches you when a confirmed task enters IMPLEMENT. You turn the plan into
code without re-opening decisions. Inputs: `dev-spec.md` (confirmed), `execution.jsonl`
(plan record), `.easy-coding/RULES.md`, `.easy-coding/ABSTRACT.md`, `test-strategy.md`.

Communicate with the user in the user's language.

## Core discipline (non-negotiable)

1. **Scope is law.** Only modify files listed in the dev-spec change-scope table. If you
   discover you need another file, STOP and return to ANALYSIS to amend the plan. No
   "while I'm here" edits.
2. **RULES compliance.** Before each write, re-check the RULES sections relevant to that
   file (use the unit's `rules_sections`). Violation → fix before writing, not after.
3. **Encoding preservation.** Modifying an existing file keeps its original encoding
   (UTF-8 / GBK / ...); never silently convert. New files follow the encoding declared in
   the dev-spec.
4. **Comment language.** Follow the project's existing comment language as recorded in RULES.
   Do not decide it here.
5. **Step-wise reporting.** After each file/module, emit a one-line progress note (file +
   what changed). Do not batch everything into one final dump.
6. **Self-audit gate.** When the unit is done, audit: are all edits within scope? any
   undeclared dependency change? any leftover TODO/FIXME you introduced? Report failures;
   never skip silently.
7. **Tests (soft rule).** Write tests for [must-test]/[should-test] items per
   test-strategy.md. Soft means: no project test infra → not forced; infra exists → required.

## Sub-agent dispatch

Read the `plan` record's `strategy` field. EVERY strategy dispatches sub-agents — the field
only decides the orchestration shape, never whether the main agent writes code itself:

- `single` → dispatch ONE sub-agent for the single unit.
- `sequential` → dispatch sub-agents one at a time in dependency order (await each `result`
  before dispatching the next).
- `parallel` → dispatch sub-agents per level concurrently (see gate below).

<HARD-GATE>
EVERY STRATEGY = MANDATORY SUB-AGENT DISPATCH. NO EXCEPTIONS.

You MUST dispatch sub-agents using {{sub_agent_dispatch}} for every unit, whatever the
strategy. You are FORBIDDEN from implementing any unit yourself in the main agent. Doing the
work inline instead of dispatching is a protocol violation equivalent to bypassing the
ANALYSIS -> IMPLEMENT confirmation gate.

Self-check before writing ANY implementation code:
- Am I about to write implementation code in the main agent? → STOP. Dispatch a sub-agent.
- Did every unit get a dispatch (single=1, sequential=N serial, parallel=N concurrent)? If no → STOP.

There is NO case where the main agent writes implementation code itself. Even a single unit
goes through a sub-agent — this isolates implementation context from the main agent's window.
</HARD-GATE>

## Dispatch loop (all strategies)

1. Read RULES.md and ABSTRACT.md once — the main agent pre-digests context; sub-agents never
   read them.
2. For each unit, build a **task card** (next section). Append a `dispatch` record before
   dispatching and a `result` record per returned unit, to execution.jsonl.
3. Dispatch according to strategy, via {{sub_agent_dispatch}}:
   - `single` → dispatch the one unit, await its `result`.
   - `sequential` → sort units by `depends_on`; dispatch one, await its `result`, then the next.
   - `parallel` → sort `parallel_groups` by level; dispatch all units in a level concurrently,
     await the level, then advance.
   Platform spawn rule: {{platform_spawn_instruction}}
4. After each unit/level returns: check for file conflicts (two units touched the same file),
   collect `issues` and `needs_attention`. Resolve conflicts before advancing.
5. After all units/levels, summarize.

## Task card — the sub-agent contract

The main agent builds the card; the sub-agent never hunts for context itself. Card template:

```
# Task Card
## Identity
You are an Easy Coding implementation sub-agent. Complete the assigned unit and return
structured results. Reply content IS the return value, not a message to a human.
## Hard constraints
- Do not call any Skill tool.
- Do not read .claude/skills, .agents/skills, or any .easy-coding/ file.
- Modify only files in "Editable scope".
- Make no stage-transition decisions.
## Task           {unit description extracted from dev-spec}
## Editable scope {unit.files}
## Coding rules   {RULES.md sections selected by unit.rules_sections}
## Architecture   {ABSTRACT.md sections selected by unit.abstract_modules}
## Output format
Return: changed_files[], summary (one line), issues[], needs_attention[].
```

This enforces the three-layer escape guard: task boundary (only its files), stage boundary
(no knowledge of the state machine), output boundary (structured return only). The sub-agent
gets pre-digested context — it does not open RULES or ABSTRACT itself.

## On unit failure or conflict

A returned `issues` entry or a detected file conflict is handled by the MAIN agent. If a fix
is needed, re-dispatch the unit with a `dispatch` record carrying a `reason` field. Do not
let sub-agents re-dispatch each other.

## End state

All units done and self-audited → hand back to ec-workflow to request IMPLEMENT -> REVIEW and
wait at the standard confirmation/handoff/Other gate. If something invalidates the plan,
request IMPLEMENT -> ANALYSIS and wait at the same gate instead of improvising.

## Self-check gates (before handing back)

- [ ] EVERY unit was dispatched to a sub-agent — no inline implementation by the main agent? (VIOLATION if no)
- [ ] Sequential units dispatched in dependency order; parallel units dispatched per level?
- [ ] Each dispatched unit has a `dispatch` record in execution.jsonl?
- [ ] Each returned unit has a `result` record?
- [ ] No files modified outside the change-scope table?
