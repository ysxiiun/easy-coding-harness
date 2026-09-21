---
memory_schema: 2
id: {memory_id}
source_task: MM-DD-task-slug
date: YYYY-MM-DD
task_type: feature | bugfix | refactor | perf | doc | workflow
project_mode: startup | iteration
workflow_mode: fast | standard | strict
domain:
  - "{business domain or module}"
tags:
  - "{keyword}"
related_files:
  - "{entrypoint or file useful for applying this knowledge}"
memory_value: business | technical | both | none
target_long: BUSINESS | TECHNICAL | BOTH | NONE
---

# {Reusable knowledge topic}

> This template defines the format for files under `.easy-coding/memory/short/`.
> File naming convention: `{memory_id}_{YYYYMMDD}_{smart_name}.md`
> Generate `memory_id` through the state API `memory-new-id` command and use it unchanged as
> both the filename prefix and this frontmatter `id`. The UUIDv7 id is safe for concurrent agents.
> Keep `smart_name` as the readable summary suffix.
> `source_task` must exactly match the current workflow task id from `task.json`.
> Short memories are immutable and directly useful for later development before distillation.
> When short memories exceed the threshold (default 10), the newest 5 are kept as recent
> context; older entries are distillation candidates for long-term memory.
> Sorting: by frontmatter `date` ascending, then by frontmatter `id`, then by filename. Legacy
> `SM-YYYYMMDD-NNN` ids sort before UUIDv7 ids on the same date for upgrade compatibility.

## Knowledge Summary

{When this knowledge is useful and the main conclusion a future developer should find.}

## Reusable Knowledge

{Write only confirmed facts with future reuse value. Use natural paragraphs or bullets; omit
inapplicable categories rather than filling a checklist. Useful material includes business rules,
design reasons, change entrypoints, compatibility boundaries, and failure causes with their fixes.
Add applicable conditions, necessary reasons and exact symbols where they guide the next change.
Do not promote a task-specific restriction into a permanent project rule.}

## Sources

- {Relevant dev-spec section, implementation result or Review finding; reference instead of copying.}
- {Related memory or existing knowledge topic, only when useful.}

> Authoring guidance, not memory content: remove these instructions and unused placeholders.
> If nothing new is reusable, set `memory_value: none` and `target_long: NONE`, give a brief reason
> in Knowledge Summary and retain Sources; omit Reusable Knowledge rather than inventing lessons.
> Leave task status, approvals, fingerprints, test statistics and temporary logs in task records.
> Keep a verification command only when it teaches a reusable method or environment requirement.
> Do not include an acceptance report or a list of excluded noise.
