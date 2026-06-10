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

Create one file under `.easy-coding/memory/short/` with schema-v2 frontmatter:

```yaml
---
id: SM-{YYYYMMDD}-{NN}
date: {YYYY-MM-DD}
task_type: {feature | bugfix | refactor | perf}
domain: {business domain}
tags: [tag1, tag2]
related_files: [file1, file2]
target_long: {business | technical | both | none}
---
{body: what was done, why this approach, key decisions. Pull facts from execution.jsonl
result/verify records, not from a fuzzy memory of the conversation.}
```

If the task was cross-repo, record the repo names involved and the collaboration reason.

**Sliding window (informational):** The short memory directory has a soft cap defined by
`memory.short_term_max` (default 10). MEMORY_SHORT only WRITES one entry per completed task
— it never counts, trims, or triggers distillation. Trimming is exclusively MEMORY_LONG's
responsibility and only runs when the threshold is exceeded.

## MEMORY_LONG — distill durable knowledge (CONDITIONAL)

<HARD-GATE>
MEMORY_LONG IS A NO-OP WHEN SHORT MEMORY COUNT <= threshold.

Before performing ANY distillation work:
1. Count `.md` files in `.easy-coding/memory/short/` (only files with schema-v2 frontmatter).
2. Read `memory.short_term_max` from `.easy-coding/config.yaml` (default: 10).
3. If count <= short_term_max: output "MEMORY_LONG: no-op (short memory count = {N},
   threshold = {short_term_max})" and immediately hand back to ec-workflow to advance to
   COMPLETE. Do NOT read long memory files, do NOT attempt distillation, do NOT modify any file.
4. If count > short_term_max: proceed with distillation below.

This gate is absolute. Even a single short memory entry below threshold does NOT trigger
long-term compression regardless of any other signal.
</HARD-GATE>

### When count > threshold: distillation flow

Three-file long memory:
- `MEMORY.md` — index of all entries with status (active | deprecated | superseded | deleted).
- `BUSINESS.md` — business rules, domain knowledge, product decisions.
- `TECHNICAL.md` — architecture decisions, implementation patterns, gotchas.

Distillation steps:
1. Read `memory.short_term_keep` from config (default: 5). Keep the latest N entries;
   the older entries become distillation candidates.
2. Read the `target_long` of candidate short memories; route to business/technical.
3. **Progressive loading** — read only the existing long entries matching this round's
   domain/tags/related_files. No unbounded whole-repo memory scan.
4. **Conflict resolution** by priority: current code > latest user confirmation > this
   round's candidate > older long memory. On conflict, explain it before consolidating —
   never silently pick a side.
5. **Retirement check**: for older entries decide delete (no value) / merge (semantic
   duplicate) / deprecate (was valid, now superseded).
6. Update the `MEMORY.md` index to reflect every change.

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
