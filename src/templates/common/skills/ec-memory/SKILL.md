---
name: ec-memory
description: MEMORY_SHORT and MEMORY_LONG stage skill — part of the archive flow, triggered only after user acceptance. Use when ec-workflow enters the memory stages. Writes schema-v2 short memory with a sliding window, distills long memory into BUSINESS/TECHNICAL with conflict resolution, and backfills ABSTRACT on architecture changes.
---

# ec-memory — archive what was learned

ec-workflow dispatches you during MEMORY_SHORT and MEMORY_LONG, which run only after the
user accepts the task. Inputs: the task's `dev-spec.md`, `execution.jsonl` (the `result` and
`verify` records are precise source material), the changed-files list, existing memory files.

Communicate with the user in the user's language. Memory file content follows the project's
recorded comment/doc language.

## MEMORY_SHORT — write one short memory entry

Create one file under `.easy-coding/memory/short/` following the format in
`.easy-coding/memory/SHORT_MEMORY_TEMPLATE.md`. File naming convention:
`{NNN}_{YYYYMMDD}_{smart_name}.md`. The entry is immutable after creation.
Frontmatter (all fields required):

```yaml
---
memory_schema: 2
id: SM-{YYYYMMDD}-{NN}
date: {YYYY-MM-DD}
task_type: {feature | bugfix | refactor | perf | doc | workflow}
project_mode: {startup | iteration}
domain:
  - {business domain or module}
tags:
  - {keyword}
related_files:
  - {key file or module}
commit: {hash | none}
verification: {passed | partial | not_run}
memory_value: {business | technical | both | none}
target_long: {BUSINESS | TECHNICAL | BOTH | NONE}
---
The body follows the template structure: Task Summary, Execution Evidence, Business Memory
Candidates, Technical Memory Candidates, Non-Distillation Content, and Related Memories.
Pull facts from execution.jsonl result/verify records, not from a fuzzy memory of the
conversation. Refer to SHORT_MEMORY_TEMPLATE.md for the complete section format.
```

If the task was cross-repo, record the repo names involved and the collaboration reason.

**Immutability:** Short memories are write-once. Never edit an existing short memory file —
create a new one instead. Short memories serve as both a recent-detail sliding window and a
distillation buffer for long-term memory.

**Sliding window (informational):** The short memory directory has a soft cap defined by
`memory.short_term_max` (default 10). MEMORY_SHORT only WRITES one entry per completed task
— it never counts, trims, or triggers distillation. Trimming is exclusively MEMORY_LONG's
responsibility and only runs when the threshold is exceeded.

## MEMORY_LONG — distill durable knowledge (CONDITIONAL)

<HARD-GATE>
MEMORY_LONG IS CONTROLLED BY THE STATE API `memory_long` INSTRUCTION.

Before performing ANY distillation work:
1. Read the `memory_long` object returned by the state API transition to MEMORY_LONG.
   If it is not visible in context, re-run the same transition command for MEMORY_LONG to
   re-emit the snapshot, then use that `memory_long` object.
2. Treat `memory_long.action` as authoritative. Do NOT recount short memories yourself and
   do NOT override the state API instruction with prompt reasoning.
3. If `action == "no-op"`: output "MEMORY_LONG: no-op (short memory count = {short_count},
   threshold = {short_term_max})" and immediately hand back to ec-workflow to advance to
   COMPLETE. Do NOT read long memory files, do NOT attempt distillation, do NOT modify any file.
4. If `action == "distill"`: distill exactly the older `trim_count` short-memory entries
   and keep the latest `short_term_keep` entries.

This gate is absolute. Even a single short memory entry below threshold does NOT trigger
long-term compression regardless of any other signal.
</HARD-GATE>

### When action == "distill": distillation flow

Three-file long memory:
- `MEMORY.md` — index of all entries with status (active | deprecated | superseded | deleted).
- `BUSINESS.md` — business rules, domain knowledge, product decisions.
- `TECHNICAL.md` — architecture decisions, implementation patterns, gotchas.

Distillation steps:
1. Use `memory_long.short_term_keep` and `memory_long.trim_count`. Keep the latest
   `short_term_keep` entries; the older `trim_count` entries become distillation candidates.
2. Read the `target_long` of candidate short memories; route to business/technical.
3. **Progressive loading** — read only the existing long entries matching this round's
   domain/tags/related_files. No unbounded whole-repo memory scan.
4. **Conflict resolution** by priority: current code > latest user confirmation > this
   round's candidate > older long memory. On conflict, explain it before consolidating —
   never silently pick a side.
5. **Retirement check**: for older entries decide delete (no value) / merge (semantic
   duplicate) / deprecate (was valid, now superseded).
6. Update the `MEMORY.md` index to reflect every change.
7. After the long-memory files and index are successfully written, delete the consumed
   short-memory candidate files. Leave only the latest `short_term_keep` short memories.
   This is sliding-window consumption after successful distillation, not destructive
   deletion of durable long-term knowledge.

## ABSTRACT backfill / update

While distilling technical memory, if you detect an architecture change — module added or
removed, core flow changed, tech stack changed, or (startup projects) ABSTRACT.md does not
exist yet — update `.easy-coding/ABSTRACT.md` and append a CHANGELOG.md entry (what changed,
why). For startup projects this is where the first ABSTRACT gets generated from the now-real
code.

## Boundaries

- Run only inside the archive flow. Memory for an unaccepted or closed task is dirty data.
- Prefer merge/deprecate over destructive delete. Ask before destructive consolidation.
- The main agent confirms and writes; a memory sub-agent may draft but not finalize.
