<!-- ═══ easy-coding-harness generated (DO NOT EDIT BETWEEN MARKERS) ═══ -->

## Easy Coding Harness

This project is managed by easy-coding-harness. Coding work runs through the `ec-*` skills,
which enforce a staged workflow with hard confirmation and verification gates. Reply to the
user in the user's language.

## Status line

Start every work reply with the single Markdown blockquote status line injected by the hook,
then a blank line. Do not render the machine breadcrumbs to the user.

`{confirm-mode}` is the capitalized effective mode (`Approve`, `Guard`, `Lite`, or `Auto`); a session
override takes precedence over the project mode.

- Ready: > **Easy Coding** · **{confirm-mode}** · Ready · Use `ec-workflow` to start or resume a task, `ec-brainstorming` to brainstorm, or `ec-task-management` to manage tasks or session settings
- Waiting init: > **Easy Coding** · **{confirm-mode}** · Waiting init · Use `ec-init` to initialize
- Active task: > **Easy Coding** · **{confirm-mode}** · `{current-task}` · `{workflow-state}`
- Handoff: > **Easy Coding** · **{confirm-mode}** · `{current-task}` · `{workflow-state}` · Handoff -> `{source-agent}`

Skill names in the status line are bare names (`ec-init`, `ec-workflow`) and never include
platform prefixes such as `/` or `$`. If no status line is injected, do not invent one.

## Skills

Trigger Easy Coding skills with your platform prefix — Codex: `$ec-*`, Qoder: `/ec-*`.

- `ec-init` — one-time project knowledge init (run once after install)
- `ec-workflow` — daily entrypoint: the workflow state machine and task resume
- `ec-brainstorming` — design exploration before building (hard design gate)
- `ec-analysis` `ec-implementing` `ec-reviewing` `ec-verification` — workflow stages
- `ec-memory` — short/long memory archive
- `ec-task-management` — task/session panel: list/create tasks and view/change the session confirm mode · `ec-task-close` — interrupt a task
- `ec-no-harness` — bypass only Easy Coding for the current session
- `ec-git` — git discipline · `ec-meta` — understand/customize the harness

First run `ec-init`; daily work goes through `ec-workflow`.

## Workflow discipline

- Effective confirm mode is session override > project `behavior.confirm_mode` > `guard`.
  `approve` confirms every legal edge except INIT -> ANALYSIS and MEMORY -> COMPLETE; `guard`
  and `lite` confirm only ANALYSIS -> IMPLEMENT and VERIFICATION -> MEMORY; `auto` confirms none.
  Guard/auto code flow chooses IMPLEMENT -> REVIEW; lite chooses IMPLEMENT -> VERIFICATION and
  never runs REVIEW. Confirmation mode never changes scope, delivery form, or evidence gates.
- Confirmation-required edges use `pending_transition`; automatic edges use the restricted
  `auto-transition` API. A read-only task creates no test-strategy.md, never enters REVIEW,
  VERIFICATION, or MEMORY, and writes no task memory.
- A confirmation-required boundary is not fully presented until the user can choose its complete
  business branches. When a native user-choice tool is available, invoke it in the same turn with
  the complete gate. An ordinary gate offers "confirm entering/returning to the target stage"
  (recommended) and "hand off to another agent", with free-form Other for revisions. The special
  approve-mode code IMPLEMENT gate must instead preserve enter REVIEW, skip to VERIFICATION, and
  handoff, with free-form Other. Only when no native choice tool exists may you show the matching
  complete numbered fallback. Empty, dismissed, timed-out, or unparseable results preserve the
  pending edge and may retry native choice at most once per assistant turn; after a failed retry,
  stop the turn and re-present the gate on the next user interaction. Never degrade to only
  "reply confirm" or repeatedly invoke native choice in the same turn.
- When `[easy-coding:no-harness]` is injected, do not emit an Easy Coding status line and ignore
  only Easy Coding workflow/stage orchestration for this session. Continue honoring every
  non-Easy-Coding skill, hook, and instruction. Do not clear or mutate the suspended task.
- ANALYSIS must follow template-first: read `.easy-coding/templates/dev-spec-skeleton.md` then
  write its exact content to the task's dev-spec.md as the FIRST tool calls. Next inspect evidence
  without editing the skeleton, ask every unresolved decision during analysis, and wait. Only
  after all decisions are resolved may the agent fill the complete dev-spec.md. The final report
  contains neither `[阶段：ANALYSIS]` nor a `待用户决策` section.
- For code tasks, VERIFICATION is a hard gate: lint + typecheck + test must pass on fresh
  evidence, and coverage must match the test strategy, before completion.
- MEMORY combines short-memory creation and the conditional long-memory gate. Entry follows the
  effective confirmation mode; once memory processing completes, COMPLETE is automatic.
- NO CODE-TASK COMPLETION CLAIMS WITHOUT FRESH VERIFICATION EVIDENCE.
- All cross-platform modules (skills, hooks, references) must use universal agent protocols.
  Do not rely on any specific agent's proprietary conventions unless the module is explicitly
  a platform-specific compatibility layer. Reference files use descriptive filenames (e.g.,
  `memory-migration.md`), not platform convention names.

## Runtime contract

- Workflow state operations go through `{{platform_config_dir}}/hooks/easy_coding_state.py`;
  do not hand-edit session files, `current_task`, task `status`, `stage_history`,
  `pending_transition`, `memory_progress`, or `last_agent`.
- The hook injects `[easy-coding:session-file:P]`; pass that path to the state script with
  `--session-file <P>` when changing the current task or stage.
- Workflow session files live at `{{workflow_state_path}}`; the CLI only installs files and
  creates the project-init task — agent skills perform all project analysis.
- Cross-repo references in git-tracked task artifacts use repo NAMES, never local paths.
  Cache local paths only through the state script so they land on the current task.
{{supermodule_boundary}}

<!-- ═══ end easy-coding-harness generated ═══ -->

## Project Custom Instructions

Add project-specific instructions below this line. The generated region above is managed by
easy-coding-harness and is replaced on `easy-coding upgrade`.
