---
memory_schema: 2
id: {memory_id}
source_task: MM-DD-task-slug
date: YYYY-MM-DD
task_type: feature | bugfix | refactor | perf | doc | workflow
project_mode: startup | iteration
domain:
  - "{business domain or module}"
tags:
  - "{keyword}"
related_files:
  - "{key file or module}"
commit: none
verification: passed | partial | not_run
memory_value: business | technical | both | none
target_long: BUSINESS | TECHNICAL | BOTH | NONE
---

# Short Memory Template

> This template defines the format for files under `.easy-coding/memory/short/`.
> File naming convention: `{memory_id}_{YYYYMMDD}_{smart_name}.md`
> Generate `memory_id` through the state API `memory-new-id` command and use it unchanged as
> both the filename prefix and this frontmatter `id`. The UUIDv7 id is safe for concurrent agents.
> Keep `smart_name` as the readable summary suffix.
> `source_task` must exactly match the current workflow task id from `task.json`.
> Short memories are immutable after creation — they serve as a sliding window of recent
> details and a buffer for long-term distillation candidates.
> When short memories reach the threshold (default 10), the newest 5 are kept as recent
> context; older entries are distillation candidates for long-term memory.
> Sorting: by frontmatter `date` ascending, then by frontmatter `id`, then by filename. Legacy
> `SM-YYYYMMDD-NNN` ids sort before UUIDv7 ids on the same date for upgrade compatibility.

## Task Summary

- Goal: {the actual problem solved}
- Scope: {modules, pages, interfaces, or files involved}
- Result: {completed / partially completed / not completed, with reasons}
- Key Constraints: {encoding, compatibility, interface, spec, or user-specified constraints; "none" if none}

## Execution Evidence

| Type | Content |
|---|---|
| Key Files | {file or module list; "none" if none} |
| Verification Commands | {test / build / lint commands and results; explain if not run} |
| Manual Acceptance | {key behaviors checked; "none" if none} |
| Commit Info | {commit hash; "none" if not committed} |

## Business Memory Candidates

> Only record business facts with future reuse value. Write "none" if none.

- Concepts / Field Semantics: {concepts, fields, enums, state meanings}
- Workflows / State Transitions: {chain steps, pre/post conditions, exception branches}
- Business Rules / Compatibility: {admission criteria, decision basis, grayscale or legacy reasons}
- Upstream/Downstream Contracts: {producers, consumers, interface or message fields}
- Business Troubleshooting: {common misdiagnosis, priority check paths}

## Technical Memory Candidates

> Only record engineering facts with future reuse value. Write "none" if none.

- Architecture / Interface Decisions: {module boundaries, dependency direction, interface contracts}
- Engineering Rules / Workflows: {coding, commit, release, installation, directory boundaries}
- Implementation Patterns / Reusable Approaches: {recommended approaches, fallback strategies, compatibility patterns}
- Pitfalls / Fix Strategies: {root cause, fix approach, verification method}
- Verification Experience: {test commands, environment constraints, acceptance paths}

## Non-Distillation Content

> Content that should NOT enter long-term memory, with reasons — prevents accidental absorption of noise.

- {routine file lists / temp logs / one-time data / non-reusable implementation details; "none" if none}

## Related Memories

- Predecessor: {related short memory id, long-term topic, or "none"}
- Successor: {follow-up task; "none" if none}
