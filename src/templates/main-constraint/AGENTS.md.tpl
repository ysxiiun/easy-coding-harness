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

Trigger Easy Coding skills with your platform prefix — Codex: `$ec-*`, Qoder: `/ec-*`.

- `ec-init` — one-time project knowledge init (run once after install)
- `ec-workflow` — daily entrypoint: the workflow state machine and task resume
- `ec-brainstorming` — design exploration before building (hard design gate)
- `ec-analysis` `ec-implementing` `ec-reviewing` `ec-verification` — workflow stages
- `ec-memory` — short/long memory archive
- `ec-task-management` — list/create tasks · `ec-task-close` — interrupt a task
- `ec-git` — git discipline · `ec-meta` — understand/customize the harness

First run `ec-init`; daily work goes through `ec-workflow`.

## Workflow discipline

- Stages do not skip. WAITING_CONFIRM is a real gate — implement only after the user confirms
  the plan and test strategy (unless `behavior.auto_mode` is on and the user asked for it).
- VERIFICATION is a hard gate: lint + typecheck + test must pass on fresh evidence, and
  coverage must match the test strategy, before a task can complete.
- Archive (memory flow) runs only after explicit user acceptance — an unaccepted task's
  memory is dirty data.
- NO COMPLETION CLAIMS WITHOUT FRESH VERIFICATION EVIDENCE.

## Runtime contract

- Workflow state lives at `{{workflow_state_path}}`; the CLI only installs files and creates
  the project-init task — agent skills perform all project analysis.
- Cross-repo references in git-tracked task artifacts use repo NAMES, never local paths.
  Cache local paths only in `.easy-coding/state.json.repo_paths`.

<!-- ═══ end easy-coding-harness generated ═══ -->

## Project Custom Instructions

Add project-specific instructions below this line. The generated region above is managed by
easy-coding-harness and is replaced on `easy-coding upgrade`.
