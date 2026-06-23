---
name: ec-workflow
description: Unified Easy Coding workflow entrypoint. Use when the user runs {{skill_trigger}}ec-workflow, asks to start or continue coding work, or when hook breadcrumbs show an active or handed-off task. Owns the stage state machine, task discovery and resume, and stage-skill dispatch.
---

# ec-workflow — the workflow state machine

You are the conductor. You own stage transitions and the task lifecycle. Stage-specific work
is delegated to the stage skills (ec-analysis, ec-implementing, ec-reviewing,
ec-verification, ec-memory) — you decide *when* they run, they define *how*.

Communicate with the user in the user's language. Skill text being English does not mean
replies are English.

## Startup sequence (run on every activation, in order)

1. **Init guard.** Read `.easy-coding/tasks/project-init/task.json`.
   - Missing → tell the user to run the `easy-coding init` CLI first. Stop.
   - `status != "COMPLETE"` → tell the user to run `{{skill_trigger}}ec-init` first. Stop.
     Do not perform project initialization yourself; that is ec-init's job.
   - `[easy-coding:upgrade-init-pending:X]` in breadcrumbs → tell the user: "Harness upgraded
     to vX. Running `{{skill_trigger}}ec-init` is recommended to adapt project knowledge and
     complete migration. You can skip and start working — the reminder will persist until
     ec-init runs." Do NOT stop. Proceed with normal startup.
2. **Required reading** (cheap, always):
   - `.easy-coding/SOUL.md` — project identity and dialogue standards; obey for the session.
   - `.easy-coding/RULES.md` — coding rules; re-checked before every write.
   - Latest 5 entries in `.easy-coding/memory/short/` — recent task context.
   Do NOT bulk-read ABSTRACT.md or long memory here; ec-analysis loads them on demand.
3. **State check + Intent routing.** Read the hook-injected breadcrumbs (`[current-task:X]`,
   `[workflow-state:Y]`, `[easy-coding:session-file:P]`) to determine the active task,
   stage, and session file, then decide based on whether the user's message carries a
   task-related prompt beyond the bare skill trigger.

   **No prompt (bare trigger):**
   - `current_task` set with an active stage → resume that stage (see Resume and handoff).
   - `current_task` null → scan `.easy-coding/tasks/` for tasks whose status is not in
     {COMPLETE, CLOSED}. Found → list them, let the user pick one to resume or start new.
     None → ready for a new task.

   **With prompt — intent routing:**
   1. Collect all non-terminal tasks in `.easy-coding/tasks/`: read each task's folder name,
      `task.json` fields (`title`, `type`, `status`). If a task passed ANALYSIS, also read
      its dev-spec title line as extra matching signal.
   2. Match the user's prompt against these identifiers (semantic match — the user saying
      "继续做搜索" should match a task titled "添加搜索功能").
   3. Route:
      - Prompt matches `current_task` → resume with the prompt as additional context (the
        user may be providing supplementary info, a revision request, or an answer to a
        previous question).
      - Prompt matches a different non-terminal task → ask the user: "Switch to «{matched
        task title}»? Current task «{current task title}» will be suspended at {stage}."
        On confirmation, perform a task switch (see Task switching below).
      - Prompt matches no existing task AND `current_task` is set → ask the user: "Start a
        new task? Current task «{current task title}» will be suspended at {stage}."
        On confirmation, create the new task (step 4).
      - Prompt matches no existing task AND `current_task` is null → create the new task
        directly (step 4).

4. **New task.** When creating a task (from step 3), create
   the task through the state API, which creates `task.json`, sets `status:"INIT"`, writes
   `stage_history`, and sets the session `current_task`:
   `{{PYTHON_CMD}} {{platform_config_dir}}/hooks/easy_coding_state.py create-task --session-file <P> --task-id <MM-DD-task-slug> --type <type> --title "<one-line summary>" --agent <agent-id>`.
   Then enter INIT.

## State machine

```
INIT -> ANALYSIS -> WAITING_CONFIRM -> IMPLEMENT -> REVIEW -> VERIFICATION
                          ^                ^                      |
                          |                +---- repair loop -----+
                          +--- revision ---+                      |
                                                        [user acceptance]
                                                                  |
                                          MEMORY_SHORT -> MEMORY_LONG -> COMPLETE
any stage --[user abort via ec-task-close]--> CLOSED
```

| Stage | Owner skill | What happens | Exit condition |
|---|---|---|---|
| INIT | ec-workflow | collect context, settle scope AND delivery form (change code vs. produce a document) | task understood |
| ANALYSIS | ec-analysis | dev-spec + execution plan + test strategy | analysis presented |
| WAITING_CONFIRM | ec-workflow | blocking gate; user reviews the plan | explicit user confirmation |
| IMPLEMENT | ec-implementing | code changes per confirmed plan | all units done |
| REVIEW | ec-reviewing | multi-dimension code review | verdict = accept |
| VERIFICATION | ec-verification | hard gate: lint/typecheck/test + coverage | all pass AND user accepts |
| MEMORY_SHORT | ec-memory | archive: short memory entry | written |
| MEMORY_LONG | ec-memory | archive: long memory distillation | written |
| COMPLETE | ec-workflow | clear current_task, set task status, summary | terminal |
| CLOSED | ec-task-close | user abort; no memory flow | terminal |

> **INIT delivery-form rule.** When creating the task, `type` and `title` must faithfully
> reflect the delivery form implied by the user's request. A refactor/fix/feature is a CODE
> task; do not record it as an analysis/report task. Do not let ANALYSIS later re-interpret a
> code task into a documentation-only task — that is a downgrade (see ec-analysis HARD RULE 5).

## Task switching

When the user confirms switching from task A to task B:
1. Task A's status is already persisted in its `task.json` — nothing extra to save.
2. Set the current task through the state API:
   `{{PYTHON_CMD}} {{platform_config_dir}}/hooks/easy_coding_state.py set-current --session-file <P> --task-id <task-b-id> --agent <agent-id>`.
3. Read task B's `task.json` to determine its current stage.
4. Resume task B's stage via the appropriate stage skill.

No data is lost — task A's dev-spec, execution.jsonl, and test-strategy.md stay intact on
disk. To return to task A later, the same intent routing applies: the user mentions it,
routing matches, and switching happens again.

## Transition rules (hard)

- **Never skip a stage.** ANALYSIS cannot jump to VERIFICATION; IMPLEMENT cannot start before
  WAITING_CONFIRM passes. No exception for "simple" tasks — simple tasks have short analyses,
  not skipped ones.
- **ANALYSIS entry gate.** When entering ANALYSIS, your FIRST TWO tool calls must be:
  (1) Read `.easy-coding/templates/dev-spec-skeleton.md`, then (2) Write its exact content
  to the task's dev-spec.md. This is a mechanical copy, not a generation task. Do not read
  code, load memory, or analyze before the skeleton is on disk. This is ec-analysis
  HARD RULE 1 — violating it means the analysis has failed. Your reply to the user must
  be the complete dev-spec.md content, not a summary or custom format.
  Additionally, ANALYSIS must stay faithful to the user's delivery form — it may NOT downgrade
  a code task to a report-only task — and the 改动范围 table must list only real project code,
  never `.easy-coding/` harness artifacts (ec-analysis HARD RULES 5 and 6).
- **WAITING_CONFIRM is a real gate.** Proceed only on explicit user confirmation of BOTH the
  analysis conclusion and the test strategy. Silence, enthusiasm, or a topic change is not
  confirmation. Sole exception: `behavior.auto_mode: true` in `.easy-coding/config.yaml`
  AND the user asked for autonomous execution. `auto_mode` ONLY waives this confirmation step;
  it carries NO scope or delivery-form decision. Never cite `auto_mode` (or "the user already
  decided in INIT") to justify narrowing scope or downgrading a code task to a report.
- **On every transition** call the state API immediately (not at turn end):
  `{{PYTHON_CMD}} {{platform_config_dir}}/hooks/easy_coding_state.py transition --session-file <P> --stage <STAGE> --agent <agent-id>`.
  Do not hand-edit `status`, `stage_history`, `last_agent`, `current_task`, or session files.
- **Hook enforcement.** The `inject-workflow-state` hook validates every stage transition
  against the state machine. If you see `[ILLEGAL-TRANSITION:...]` in the injected context,
  you MUST revert the task's status to the previous valid stage and explain why the
  transition was rejected. Do not proceed with an illegal stage.
- **Repair loop sizing** (user acceptance window after VERIFICATION): a trivial tweak
  (one-line style fix, copy text) is fixed inside VERIFICATION and re-verified; a logic or
  structure change formally returns to IMPLEMENT and re-walks REVIEW → VERIFICATION.
- **Scope guard** (repair loop): if the user's fix request falls outside the dev-spec scope
  (features or files absent from the change-scope table), say so explicitly and propose a
  new task with `spawned_from` set to the current task id. Never silently absorb scope creep.
- **Task switching is allowed at any stage.** The suspended task retains its stage in
  task.json. Do not run memory flows for suspended tasks — only completed tasks get archived.
- **Archive only after user acceptance.** VERIFICATION passing does not complete the task.
  After the user accepts, call state API transitions in order:
  MEMORY_SHORT → MEMORY_LONG → COMPLETE. Do not jump directly from VERIFICATION to COMPLETE.
- **COMPLETE closeout:** call the state API with `--stage COMPLETE`. The state API clears
  session `current_task` for terminal tasks, so the next hook injection returns to Ready.
  Then output a summary (what was done, files changed, key decisions).

## Resume and handoff

Hook breadcrumbs you may receive: `[workflow-state:X]`, `[current-task:Y]`,
`[easy-coding:session-file:P]`, `[easy-coding:handoff-from:Z]`,
`[easy-coding:init-required]`.

Resuming an active task (whether from session restart, handoff, or task switch):
1. Read `task.json` and the dev-spec sections relevant to the current stage.
2. Read the tail of `execution.jsonl` — the latest `plan` / `result` / `verify` / `handoff`
   records tell you exactly where work stopped.
3. If `last_agent` differs from the current agent this is a cross-agent handoff: read the
   latest `handoff` record first for the fast summary, then set `last_agent` to yourself.
4. Tell the user what is being resumed and from which stage, then continue.

After a task switch, the same resume flow applies — the only difference is that `current_task`
was just changed by the switching procedure rather than being loaded from a prior session.

Offering handoff — at WAITING_CONFIRM, after presenting the plan, offer exactly:
1. Start implementation
2. Hand off to another agent
3. Revise the plan
On option 2: append a `handoff` record to `execution.jsonl` —
`{"type":"handoff","from":"<agent>","stage":"<stage>","summary":"<dense context: plan shape, key decisions, user emphases>","timestamp":"<ISO>"}` —
update the task's `last_agent` in task.json, then tell the user to open the target agent and run ec-workflow there.
Handoff is also legal at any other stage boundary on user request. The harness never
switches agents by itself.

## Status line

Start every reply with the single Markdown blockquote status line injected by the hook,
then a blank line. Do not render machine breadcrumbs such as `[workflow-state:...]` to the
user. If no status line is injected (harness inactive), do not invent one. Status display is
script-owned; skills must never construct or "fix" the status line manually.

## Boundaries

- Do not perform project knowledge initialization (ec-init owns it).
- Do not write business code from this skill (IMPLEMENT delegates to ec-implementing).
- Do not run git commit/push flows (ec-git owns git discipline).
- Do not generate memories outside the archive flow — an unaccepted task's memory is dirty data.
- Do not edit files under `.easy-coding/spec/` (read-only input here).
