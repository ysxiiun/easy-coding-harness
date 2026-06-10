---
name: ec-implementing
description: IMPLEMENT-stage skill. Use when ec-workflow enters IMPLEMENT with a confirmed plan. Executes execution.jsonl units under strict file-scope control, enforces RULES compliance and encoding preservation, writes tests per strategy, and dispatches sub-agents for parallel work.
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

Read the `plan` record's `strategy` field. Then:

- `single` → main agent implements directly, no sub-agents.
- `sequential` → main agent implements units one by one in dependency order.
- `parallel` → sub-agents are MANDATORY (see gate below).

<HARD-GATE>
PARALLEL STRATEGY = MANDATORY SUB-AGENT DISPATCH. NO EXCEPTIONS.

If the plan record says `"strategy":"parallel"`, you MUST dispatch sub-agents using
{{sub_agent_dispatch}}. You are FORBIDDEN from implementing parallel units yourself.
Doing the work inline instead of dispatching is a protocol violation equivalent to
skipping WAITING_CONFIRM.

Self-check before writing ANY implementation code:
- Is strategy "parallel"? → Did I dispatch via {{sub_agent_dispatch}}? If no → STOP.
- Am I working on a unit in a parallel level without dispatching? → STOP.

The ONLY case where you implement code directly is strategy "single" or "sequential".
</HARD-GATE>

Parallel dispatch loop:
1. Sort `parallel_groups` by level.
2. Read RULES.md and ABSTRACT.md once.
3. For each unit in the current level, build a **task card** (next section) and dispatch.
4. Dispatch all units in the level concurrently via {{sub_agent_dispatch}}.
   Platform spawn rule: {{platform_spawn_instruction}}
5. Append a `dispatch` record per unit, then a `result` record per returned unit, to
   execution.jsonl.
6. After the level returns: check for file conflicts (two units touched the same file),
   collect `issues` and `needs_attention`. Resolve conflicts before advancing.
7. Advance to the next level. After all levels, summarize.

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

All units done and self-audited → hand back to ec-workflow to advance to REVIEW. If you
hit something that invalidates the plan, return to ANALYSIS instead of improvising.

## Self-check gates (before handing back)

- [ ] Strategy was "parallel" → ALL units dispatched via sub-agents? (VIOLATION if no)
- [ ] Strategy was "sequential" → units implemented in dependency order?
- [ ] Each dispatched unit has a `dispatch` record in execution.jsonl?
- [ ] Each returned unit has a `result` record?
- [ ] No files modified outside the change-scope table?
