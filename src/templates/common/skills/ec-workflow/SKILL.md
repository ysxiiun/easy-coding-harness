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

If `[easy-coding:no-harness]` is present, do not start or resume this workflow. The current
session is intentionally using native agent behavior; only `ec-no-harness` may restore Easy
Coding for that session.

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
   stage, and session file. Then call the task list API with the current agent id:
   `{{PYTHON_CMD}} {{platform_config_dir}}/hooks/easy_coding_state.py list-tasks --agent <agent-id>`.
   Use only non-terminal tasks (`active == true`) for routing.

   **Current task pointer exists:**
   - The current task has priority. Resume it by default, even if the user only runs the bare
     skill trigger.
   - If the prompt clearly matches the current task, resume it with the prompt as additional
     context.
   - If the prompt clearly matches a different unfinished task, ask whether to switch to that
     task. Show whether it is `continue` or `takeover`; for takeover show `previous_agent`.
     On confirmation, claim the matched task (see Task switching).
   - If the prompt clearly describes unrelated new work, ask whether to create a new task and
     suspend the current one at its persisted stage.

   **No current task pointer:**
   - If the prompt matches exactly one unfinished task, show that task and ask whether to
     continue/take it over. For takeover show the previous agent and latest handoff summary.
     On confirmation, claim it (see Task switching).
   - If the prompt matches multiple unfinished tasks, list the matches with `continue` /
     `takeover` labels and ask the user to choose one.
   - If the prompt matches none, or there is no prompt beyond the bare skill trigger, list all
     unfinished tasks with `continue` / `takeover` labels. For takeover entries, show the
     previous agent. Let the user choose one to claim, or choose to start a new task.
   - If there are no unfinished tasks, create a new task only when the user supplied a real
     task prompt; otherwise report that the harness is ready for a new task.

4. **New task.** When creating a task (from step 3), create
   the task through the state API, which creates `task.json`, sets `status:"INIT"`, writes
   `stage_history`, and sets the session `current_task`:
   `{{PYTHON_CMD}} {{platform_config_dir}}/hooks/easy_coding_state.py create-task --session-file <P> --task-id <MM-DD-task-slug> --type <feature|bugfix|refactor|perf|doc|analysis|report|workflow> --title "<one-line summary>" --agent <agent-id>`.
   Use the returned `status_context` as the current status source. Then enter INIT.

## State machine

```
INIT --[always auto]--> ANALYSIS -> IMPLEMENT -> REVIEW -> VERIFICATION -> MEMORY --[always auto]--> COMPLETE
                                    \----------------> VERIFICATION
                                    \--[read-only, mode-aware]-----------------------> COMPLETE
                 ^            ^          |             |
                 +-- replan ---+          +--- fix -----+
                              ^                         |
                              +------- repair ----------+
edge behavior --[effective confirm mode: approve / guard / lite / auto]--> target stage
any stage --[user abort via ec-task-close]--> CLOSED
```

| Stage | Owner skill | What happens | Exit condition |
|---|---|---|---|
| INIT | ec-workflow | collect context, settle scope AND delivery form (change code vs. produce a document) | work complete; auto-transition to ANALYSIS |
| ANALYSIS | ec-analysis | dev-spec + execution plan; code tasks also get test strategy | mode-aware transition to IMPLEMENT |
| IMPLEMENT | ec-implementing | code changes or one read-only deliverable | guard/auto default to REVIEW; lite enters VERIFICATION; approve chooses |
| REVIEW | ec-reviewing | multi-dimension code review | verdict selects a legal mode-aware target |
| VERIFICATION | ec-verification | hard gate: lint/typecheck/test + coverage | mode-aware transition to MEMORY or IMPLEMENT |
| MEMORY | ec-memory | write short memory, then run the conditional long-memory gate | memory work complete; auto-transition to COMPLETE |
| COMPLETE | ec-workflow | clear current_task, set task status, summary | automatic terminal after MEMORY or validated read-only IMPLEMENT |
| CLOSED | ec-task-close | user abort; no memory flow | terminal |

> **INIT delivery-form rule.** When creating the task, `type` and `title` must faithfully
> reflect the delivery form implied by the user's request. A refactor/fix/feature is a CODE
> task; do not record it as an analysis/report task. Do not let ANALYSIS later re-interpret a
> code task into a documentation-only task — that is a downgrade (see ec-analysis HARD RULE 5).
> Use `doc`, `analysis`, or `report` only when the user's original request explicitly asks for
> a no-code deliverable. Those task types may carry execution units with an empty file scope;
> code task types may not. After its full deliverable is shown, a successful empty-scope task
> follows the effective confirm mode from IMPLEMENT to COMPLETE; it never creates
> test-strategy.md or enters REVIEW, VERIFICATION, or MEMORY.

## Task switching

When the user confirms switching from task A to task B:
1. Task A's status is already persisted in its `task.json` — nothing extra to save.
2. Claim the selected task through the state API:
   `{{PYTHON_CMD}} {{platform_config_dir}}/hooks/easy_coding_state.py claim-task --session-file <P> --task-id <task-b-id> --agent <agent-id>`.
3. Use the returned `status_context` as the current status source, then read task B's
   `task.json` to determine its current stage. If the result says `action:"takeover"`, tell
   the user which previous agent owned the task.
4. Resume task B's stage via the appropriate stage skill.

No data is lost — task A's dev-spec and execution.jsonl stay intact, as does test-strategy.md
for a code task. To return to task A later, the same intent routing applies: the user mentions
it, routing matches, and switching happens again.

## Transition rules (hard)

- **Code tasks may skip only REVIEW.** ANALYSIS cannot jump to VERIFICATION and code tasks never
  skip VERIFICATION. In `guard` and `auto`, an automatic code path chooses REVIEW as the default
  successor to IMPLEMENT. In `lite`, IMPLEMENT must enter VERIFICATION directly and the state
  API rejects IMPLEMENT -> REVIEW. In `approve`, the user may explicitly choose REVIEW or skip
  it and enter VERIFICATION.
- **Resolve the effective confirm mode first.** Read `[easy-coding:confirm-mode:X]` or the state
  API snapshot. Session mode overrides project `behavior.confirm_mode`; missing project
  configuration defaults to `guard`.
  - `approve`: every legal edge requires `request-transition` and explicit confirmation except
    INIT -> ANALYSIS and MEMORY -> COMPLETE.
  - `guard` (default): only ANALYSIS -> IMPLEMENT and VERIFICATION -> MEMORY require explicit
    confirmation. Every other legal edge uses `auto-transition` after its owner selects the
    evidence-backed target.
  - `lite`: uses the same two confirmation gates as guard, but code IMPLEMENT automatically
    enters VERIFICATION and never dispatches REVIEW.
  - `auto`: every legal edge uses `auto-transition`.
  `ec-task-close` remains an explicit user abort and is not triggered by confirm mode.
- **Confirmation policy changes prompts, not evidence.** No mode chooses product scope,
  delivery form, API contracts, or risk decisions for the user. Lite intentionally omits REVIEW;
  every mode still preserves its applicable dev-spec, execution, verification, and memory gates.
- **Lite pending-edge compatibility.** If the status context contains
  `[easy-coding:lite-review-bypass-required:IMPLEMENT->REVIEW]`, cancel that stale pending edge,
  then call `auto-transition --stage VERIFICATION`. Never consume or re-request REVIEW in lite.
- **Always-automatic mechanical edges.** After INIT work completes, call `auto-transition` for
  ANALYSIS. After `memory-complete`, call `auto-transition` for COMPLETE. These two edges never
  create `pending_transition` in any mode.
- **Native choice rendering is mandatory (hard requirement).** When the effective mode requires
  confirmation, call `request-transition`. After it succeeds, the boundary is not fully presented
  until the user can actually choose every required business branch. When the agent/platform
  exposes a native user-choice tool, you MUST actually invoke it in the same turn; mentioning the
  tool, recommending a reply, or printing only a confirmation sentence is not a substitute. Offer
  exactly these business branches through that native UI:
  1. Confirm entering/returning to `<target-stage>` (recommended)
  2. Hand off to another agent
  3. Other — use the native tool's built-in free-form Other input.
  Code-task IMPLEMENT completion is the one special gate: offer (1) enter REVIEW (recommended),
  (2) skip REVIEW and enter VERIFICATION, and (3) hand off; use the native free-form Other
  input for revisions. Record REVIEW as the recommended pending edge first. If the user chooses
  VERIFICATION, cancel that edge, request IMPLEMENT -> VERIFICATION, and immediately confirm it
  because that selection is explicit confirmation of the alternate target.
  Plain-text numbered choices are fallback only: use them only when no native user-choice tool
  exists. An ordinary gate must list all three branches rather than collapsing to "reply confirm":
  `1. Confirm entering/returning to <target-stage> (recommended)`,
  `2. Hand off to another agent`, `3. Other (describe revisions or another instruction)`.
  The code-task IMPLEMENT completion fallback must preserve its special branch set:
  `1. Enter REVIEW (recommended)`, `2. Skip REVIEW and enter VERIFICATION`,
  `3. Hand off to another agent`, `4. Other (describe revisions or another instruction)`.
  An empty, dismissed, timed-out, or unparseable choice result is not confirmation. Preserve the
  pending edge and re-present the complete native choice UI at most once per assistant turn. If
  that retry is also empty, dismissed, timed out, or unparseable, stop the current turn with the
  pending edge intact and re-present the gate on the next user interaction; never call the native
  choice tool repeatedly in the same turn. If native choice is no longer available, render the
  appropriate complete numbered fallback. Never report "no valid choice" and then show only a
  confirmation instruction. The runtime hook never mutates workflow state from user-prompt text.
  Native choice results, numbered fallback replies, and every natural-language reply must be
  interpreted by you against the current task and stored target before calling
  `confirm-transition` explicitly.
  On Other feedback, cancel the pending edge before revising work or requesting a different
  legal target. Never interpret silence, enthusiasm, or topic changes as confirmation.
- **State before action.** Every confirmation-required stage advance is a two-step protocol: first
  consume the pending edge through `confirm-transition`, then run that stage's real work. The
  automatic edges use `auto-transition` instead. Do not start
  analysis, implementation, review, verification, memory writing, or closeout while
  `task.json.status` still names the previous stage. After every state API call, treat the
  returned snapshot/read-after-write state as authoritative for the next action and status line.
- **ANALYSIS entry gate.** When entering ANALYSIS, your FIRST TWO tool calls must be:
  (1) Read `.easy-coding/templates/dev-spec-skeleton.md`, then (2) Write its exact content
  to the task's dev-spec.md. This is a mechanical copy, not a generation task. Do not read
  code, load memory, or analyze before the skeleton is on disk. This is ec-analysis
  HARD RULE 1 — violating it means the analysis has failed. After the skeleton is written,
  inspect the required evidence without editing it. Ask and resolve every user decision during
  ANALYSIS before filling any section; the final report must not contain a `待用户决策` section
  or `[阶段：ANALYSIS]`. Once decisions are resolved, your plan reply must be the complete
  dev-spec.md content, not a summary or custom format.
  Additionally, ANALYSIS must stay faithful to the user's delivery form — it may NOT downgrade
  a code task to a report-only task — and the 改动范围 table must list only real project code,
  never `.easy-coding/` harness artifacts (ec-analysis HARD RULES 5 and 6).
- **At confirmation-required stage completion** request the legal target immediately:
  `{{PYTHON_CMD}} {{platform_config_dir}}/hooks/easy_coding_state.py request-transition --session-file <P> --stage <STAGE> --agent <agent-id> --reason "<why this edge is ready>"`.
  This writes only `pending_transition`; it does not change the stage.
- **No-code IMPLEMENT delivery:** before completing the task, ec-implementing must
  have output the successful unit's complete non-empty `deliverable` verbatim to the user.
  A summary or execution.jsonl record is not a substitute; missing user-visible delivery keeps
  the task in IMPLEMENT. The execution log must contain a matching `dispatch` immediately before
  the accepted result for that unit. After delivery, use `request-transition` in approve mode
  or `auto-transition` in guard/lite/auto mode for COMPLETE; do not enter REVIEW, VERIFICATION, or
  MEMORY and do not write memory.
- **On an automatic edge** call:
  `{{PYTHON_CMD}} {{platform_config_dir}}/hooks/easy_coding_state.py auto-transition --session-file <P> --stage <TARGET> --agent <agent-id>`.
  The state API validates both the legal edge and the effective confirm mode before changing
  the stage.
- **On user confirmation** read the current task's pending edge and call:
  `{{PYTHON_CMD}} {{platform_config_dir}}/hooks/easy_coding_state.py confirm-transition --session-file <P> --stage <STAGE> --agent <agent-id>`.
  Only after the read-after-write status names the target stage may its action start.
- **On Other feedback or a changed outcome** call:
  `{{PYTHON_CMD}} {{platform_config_dir}}/hooks/easy_coding_state.py cancel-transition --session-file <P> --agent <agent-id>`
  before revising the current stage or requesting a different target.
  Do not hand-edit `status`, `stage_history`, `last_agent`, `current_task`, or session files.
  The command returns `status_line` and `status_context`; after any state-changing command,
  discard older hook-injected status text and use this returned context as the authoritative
  status source for the rest of the current turn.
- **Hook enforcement.** The `inject-workflow-state` hook validates every stage transition
  against the state machine. If you see `[ILLEGAL-TRANSITION:...]` in the injected context,
  you MUST revert the task's status to the previous valid stage and explain why the
  transition was rejected. Do not proceed with an illegal stage.
- **Repair loop sizing** (after VERIFICATION): a trivial tweak may be fixed inside
  VERIFICATION and re-verified without a status change; a logic or structure change selects
  VERIFICATION -> IMPLEMENT and follows the effective mode. After repair, approve mode presents
  the IMPLEMENT choice again; guard/auto follow the default REVIEW path, while lite returns
  directly to VERIFICATION.
- **Scope guard** (repair loop): if the user's fix request falls outside the dev-spec scope
  (features or files absent from the change-scope table), say so explicitly and propose a
  new task with `spawned_from` set to the current task id. Never silently absorb scope creep.
- **Task switching is allowed at any stage.** The suspended task retains its stage in
  task.json. Do not run memory flows for suspended tasks — only completed tasks get archived.
- **Archive only after the configured acceptance gate.** VERIFICATION passing does not complete
  the task. A green gate requests VERIFICATION -> MEMORY in approve/guard/lite, or advances
  automatically in auto. After entry, MEMORY writes one short entry first, records it through `memory-short-complete`,
  then asks the state API for the authoritative `memory` instruction. `action == "no-op"`
  skips long-memory reads/writes; `action == "distill"` processes exactly `trim_count` older
  entries. After `memory-complete`, ec-memory automatically advances MEMORY -> COMPLETE.
- **COMPLETE closeout:** COMPLETE is automatic after successful memory processing, or directly
  after a validated read-only deliverable. The state API clears session `current_task`, so the
  next hook injection returns to Ready. Then output a summary; for read-only tasks, the full
  report must already have appeared before this closeout.

## Resume and handoff

Hook breadcrumbs you may receive: `[workflow-state:X]`, `[current-task:Y]`,
`[easy-coding:session-file:P]`, `[easy-coding:confirm-mode:M]`,
`[easy-coding:handoff-from:Z]`,
`[easy-coding:lite-review-bypass-required:IMPLEMENT->REVIEW]`,
`[easy-coding:init-required]`.

Resuming an active task (whether from session restart, claim, handoff, or task switch):
1. Read `task.json` and the dev-spec sections relevant to the current stage.
2. Read the tail of `execution.jsonl` — the latest `plan` / `result` / `verify` / `handoff`
   records tell you exactly where work stopped.
3. If the task was claimed from another agent, read the latest `handoff` record first for the
   fast summary and tell the user which previous agent handed it off.
4. If `pending_transition` exists, do not rerun the completed stage action. Handle
   `[easy-coding:lite-review-bypass-required:IMPLEMENT->REVIEW]` before the generic pending-edge
   rule: call `cancel-transition`, then `auto-transition --stage VERIFICATION`. Otherwise compare
   the stored edge with `effective_confirm_mode`. If the edge is now automatic, call
   `auto-transition` for its stored target; otherwise re-present the confirmation/handoff/Other
   choices. For a read-only task in IMPLEMENT, cancel any stale REVIEW/VERIFICATION edge before
   the terminal check below. At an approve-mode IMPLEMENT boundary for a code task, re-present
   the special REVIEW / skip to VERIFICATION / handoff choices.
5. If a read-only task resumes in IMPLEMENT with a valid successful result, output its complete
   deliverable again and follow the effective mode to COMPLETE. Otherwise tell the user what is
   being resumed and from which stage, then continue.

After a task switch, the same resume flow applies — the only difference is that `current_task`
was just changed by the switching procedure rather than being loaded from a prior session.

Offering handoff — every confirmation-required pending edge includes the handoff option. On that
option, call:
`{{PYTHON_CMD}} {{platform_config_dir}}/hooks/easy_coding_state.py handoff-task --session-file <P> --agent <agent-id> --summary "<dense context: plan shape, key decisions, user emphases>"`.

The handoff record is target-less:
`{"type":"handoff","from":"<agent>","stage":"<stage>","summary":"<dense context>","timestamp":"<ISO>"}`.
It records who handed the task off, not who will take it next. Do not ask the user to name
the next agent, and do not invent or store a next-agent field. After writing handoff, stop
owning the task; another agent can use ec-task-management or ec-workflow to claim it.

Handoff preserves `pending_transition`, so the next agent resumes the same completed boundary
without rerunning stage work. The harness never switches agents by itself; the next agent
claims the task explicitly.

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
