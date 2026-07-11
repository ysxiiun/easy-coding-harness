---
name: ec-brainstorming
description: Pre-implementation design skill. Use when the user runs {{skill_trigger}}ec-brainstorming, asks to brainstorm/explore/shape a design, or when a startup project needs its first direction after ec-init. Turns an idea into a confirmed design doc through one-question-at-a-time dialogue. Hard gate — no implementation before the user approves the design.
---

# ec-brainstorming — ideas into confirmed designs

Adapted from the Superpowers brainstorming method for the Easy Coding context. You turn a
raw idea into a validated design through natural, collaborative, one-question-at-a-time
dialogue, then hand a confirmed design doc to ec-workflow. You never write implementation
code here.

Communicate with the user in the user's language.

## Hard gate

```
<HARD-GATE>
Do NOT invoke any implementation skill, write any code, or scaffold anything until you have
presented a design AND the user has approved it. This applies to EVERY idea regardless of
perceived simplicity.
</HARD-GATE>
```

### Anti-pattern: "this is too simple to need a design"

Every idea goes through this. A todo list, a one-function utility, a config change — all of
them. "Simple" work is exactly where unexamined assumptions waste the most effort. The design
can be three sentences for a truly simple idea, but you MUST present it and get approval.

## Flow

1. **Explore context.** Read `.easy-coding/SOUL.md`, `.easy-coding/RULES.md`, and (for
   iterative projects) `.easy-coding/ABSTRACT.md` to understand positioning and existing
   architecture. Check recent files and commits.
2. **Scope check first.** If the idea describes multiple independent subsystems (e.g. "a
   platform with chat, billing, and analytics"), flag it immediately. Help the user
   decompose into independent pieces — what they are, how they relate, what order to build —
   then brainstorm only the first piece through the normal flow. Do not spend questions
   refining a thing that must be split first.
3. **Clarify, one question at a time.** Multiple-choice preferred to lower the user's load;
   open questions are fine but never stacked. Focus on purpose, constraints, success
   criteria, boundaries. One question per message.
4. **Propose 2-3 approaches** with tradeoffs and complexity. Lead with your recommendation
   and the reason for it.
5. **Present the design in sections** scaled to complexity (a few sentences if simple, more
   if nuanced). Confirm each section before moving on. Cover: goal, core design, interfaces,
   data flow, error handling, boundary conditions.
6. **Design self-review** (fix inline, no second pass needed):
   - Placeholder scan — any TBD/TODO/incomplete sections?
   - Internal consistency — do sections contradict each other?
   - Scope check — focused enough for one implementation cycle, or needs decomposition?
   - Ambiguity — could any requirement be read two ways? Pick one, make it explicit.
   - RULES check — does anything violate `.easy-coding/RULES.md`?
   - YAGNI — strip features that do not serve the stated goal.
7. **User review gate.** Save the design to `.easy-coding/spec/{topic}-design.md`, then ask
   the user to review the written doc before proceeding. Make requested changes and re-run
   the self-review. Proceed only on explicit approval.

## After approval — handoff to ec-workflow

The confirmed design doc is an INPUT to ec-workflow's ANALYSIS stage — it does not replace
ANALYSIS (brainstorming is design; ANALYSIS is the implementation plan).

After saving the design doc, ask the user: "Design confirmed. Start a task based on this
design now?" Offer two options:

1. **Start task now** — invoke `{{skill_trigger}}ec-workflow` with the design topic as the
   task prompt. ec-workflow will create the task and enter INIT. After INIT completes, it
   presents the standard confirmation/handoff/Other gate before entering ANALYSIS.
   ec-analysis will discover the design doc in `.easy-coding/spec/` and use it as input.
2. **Later** — tell the user the design is saved and they can run
   `{{skill_trigger}}ec-workflow` whenever ready.

If `current_task` is set when the user chooses option 1, mention that the current task will
be suspended (ec-workflow's intent routing handles the rest).

## Boundaries

- Write no implementation code, scaffold nothing, take no implementation action.
- The only ec-* skill you may invoke is `ec-workflow` (on user confirmation after approval).
  Do not touch session files, task status fields, or the state machine directly.
- One question per message — never overwhelm.
