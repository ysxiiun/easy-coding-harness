<!-- ═══ easy-coding-harness generated (DO NOT EDIT BETWEEN MARKERS) ═══ -->

## Easy Coding Harness

This project is managed by easy-coding-harness. Coding work runs through the `ec-*` skills,
which enforce a staged workflow with hard confirmation and verification gates. Reply to the
user in the user's language.

## Status line

Start every work reply with the single Markdown blockquote status line injected by the hook,
then a blank line. Do not render the machine breadcrumbs to the user.

- Ready: > **Easy Coding** · Ready · Use `ec-workflow` to start or resume a task, `ec-brainstorming` to brainstorm, or `ec-task-management` to view tasks
- Waiting init: > **Easy Coding** · Waiting init · Use `ec-init` to initialize
- Active task: > **Easy Coding** · `{current-task}` · `{workflow-state}`
- Handoff: > **Easy Coding** · `{current-task}` · `{workflow-state}` · Handoff -> `{source-agent}`

Skill names in the status line are bare names (`ec-init`, `ec-workflow`) and never include
platform prefixes such as `/` or `$`. If no status line is injected, do not invent one.

## Skills

- `/ec-init` — one-time project knowledge init (run once after install)
- `/ec-workflow` — daily entrypoint: the workflow state machine and task resume
- `/ec-brainstorming` — design exploration before building (hard design gate)
- `/ec-analysis` `/ec-implementing` `/ec-reviewing` `/ec-verification` — workflow stages
- `/ec-memory` — short/long memory archive
- `/ec-task-management` — list/create tasks · `/ec-task-close` — interrupt a task
- `/ec-git` — git discipline · `/ec-meta` — understand/customize the harness

First run `/ec-init`; daily work goes through `/ec-workflow`.

## Workflow discipline

- Code tasks do not skip stages except when the user explicitly skips REVIEW after IMPLEMENT.
  User-decision edges use `pending_transition`; offer the target and handoff, and offer
  free-form Other through native UI when available. IMPLEMENT additionally offers direct entry
  to VERIFICATION.
  INIT -> ANALYSIS, completed MEMORY -> COMPLETE, and validated read-only
  IMPLEMENT -> COMPLETE use restricted `auto-transition` without confirmation or handoff. A
  read-only task creates no test-strategy.md, never enters REVIEW, VERIFICATION, or MEMORY, and
  writes no task memory.
  `auto_mode` only waives remaining prompts; it never changes scope or delivery form.
- ANALYSIS must follow template-first: read `.easy-coding/templates/dev-spec-skeleton.md` then
  write its exact content to the task's dev-spec.md as the FIRST tool calls. Next inspect evidence
  without editing the skeleton, ask every unresolved decision during analysis, and wait. Only
  after all decisions are resolved may the agent fill the complete dev-spec.md. The final report
  contains neither `[阶段：ANALYSIS]` nor a `待用户决策` section.
- For code tasks, VERIFICATION is a hard gate: lint + typecheck + test must pass on fresh
  evidence, and coverage must match the test strategy, before completion.
- MEMORY combines short-memory creation and the conditional long-memory gate. Archive starts
  only after explicit user acceptance; once memory processing completes, COMPLETE is automatic.
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
