---
name: ec-memory
description: MEMORY-stage skill — part of the archive flow, triggered only after user acceptance and a confirmed stage edge. Writes one schema-v2 short memory, then runs the authoritative conditional long-memory gate, performs optional distillation, and requests COMPLETE.
---

# ec-memory — archive what was learned

ec-workflow dispatches you during MEMORY, which runs only after the user accepts the task and
confirms entry. Inputs: the task's `dev-spec.md`, `execution.jsonl` (the `result` and
`verify` records are precise source material), the changed-files list, existing memory files.

Communicate with the user in the user's language. Memory file content follows the project's
recorded comment/doc language.

## Step 1 — write one short memory entry

Create one file under `.easy-coding/memory/short/` following the format in
`.easy-coding/memory/SHORT_MEMORY_TEMPLATE.md`. File naming convention:
`{NNN}_{YYYYMMDD}_{smart_name}.md`. The entry is immutable after creation.
Frontmatter (all fields required):

```yaml
---
memory_schema: 2
id: SM-{YYYYMMDD}-{NN}
source_task: {current task id, exact}
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

After the file is successfully written, record the checkpoint immediately:
`{{PYTHON_CMD}} {{platform_config_dir}}/hooks/easy_coding_state.py memory-short-complete --session-file <P> --file "<relative-short-memory-path>" --agent <agent-id>`.
Use the returned `status_context` as authoritative. On resume, if `memory_progress` already
shows `short_memory_written:true`, do not create a duplicate entry; continue from Step 2.
The state API validates `memory_schema: 2`, requires `source_task` to equal the current task id,
and fingerprints the file. Do not reuse an older task's memory file as this checkpoint.

## Supermodule memory routing

If the current project config contains `supermodule.role: super-parent`, archive memory by
ownership:

- Cross-repo business context, parent orchestration decisions, and multi-repo contracts stay
  in the parent `.easy-coding/memory`.
- Technical memory that belongs to one child repo must be written to that child's
  `.easy-coding/memory`, not only to the parent. Use changed file paths and module ownership
  to decide the child.
- Only write child memory files during this routing. Do not edit child task, session, state,
  or dev-spec files from the parent workflow.
- If a touched child repo has no initialized `.easy-coding/memory` directory, keep the memory
  in the parent and mark it as "original child: <path>; child not initialized".
- When child memory is written, the later git flow must commit and push the child repo before
  the parent gitlink update.

**Immutability:** Short memories are write-once. Never edit an existing short memory file —
create a new one instead. Short memories serve as both a recent-detail sliding window and a
distillation buffer for long-term memory.

**Sliding window (informational):** The short memory directory has a soft cap defined by
`memory.short_term_max` (default 10). Step 1 only writes and checkpoints one entry per
completed task. It never decides whether to distill.

## Step 2 — run the long-memory gate (CONDITIONAL)

<HARD-GATE>
LONG-MEMORY WORK IS CONTROLLED BY THE STATE API `memory` INSTRUCTION.

Before performing ANY distillation work:
1. After Step 1 is checkpointed, call
   `{{PYTHON_CMD}} {{platform_config_dir}}/hooks/easy_coding_state.py memory-instruction --session-file <P>`.
   This ordering is mandatory: the current task's short entry must be counted first.
   The first successful call is frozen in `memory_progress.instruction`; resumed work reuses
   the same action and trim count even after consumed short files are deleted.
2. Treat the returned `memory.action` as authoritative. Do NOT recount short memories yourself and
   do NOT override the state API instruction with prompt reasoning.
3. If `action == "no-op"`: output "MEMORY: long-memory no-op (short memory count =
   {short_count}, threshold = {short_term_max})". Do NOT read or modify long memory files.
4. If `action == "distill"`: treat `memory.candidate_files` and `memory.kept_files` as the
   frozen authoritative sets. Distill and delete exactly `candidate_files`; preserve every
   `kept_files` entry. Do not rebuild either set from the live directory.

This gate is absolute. Even a single short memory entry below threshold does NOT trigger
long-term compression regardless of any other signal.
</HARD-GATE>

### When action == "distill": distillation flow

Three-file long memory:
- `MEMORY.md` — index of all entries with status (active | deprecated | superseded | deleted).
- `BUSINESS.md` — business rules, domain knowledge, product decisions.
- `TECHNICAL.md` — architecture decisions, implementation patterns, gotchas.

Distillation steps:
1. Use `memory.candidate_files` and `memory.kept_files`; their sizes correspond to
   `memory.trim_count` and the retained window calculated at instruction time.
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

After either branch succeeds, record completion with the same authoritative action:
`{{PYTHON_CMD}} {{platform_config_dir}}/hooks/easy_coding_state.py memory-complete --session-file <P> --action <no-op|distill> --agent <agent-id>`.
The state API rejects an action that disagrees with the current threshold calculation.
For `distill`, it also rejects completion while any frozen candidate still exists or any
frozen retained file is missing. A candidate checkpoint may disappear only because it is
explicitly listed in `candidate_files`.

## Step 3 — request COMPLETE

Only after `memory_progress.completed:true`, hand control to ec-workflow to request
MEMORY -> COMPLETE. Present the standard confirmation/handoff/Other gate and stop. Do not
mark the task COMPLETE automatically.

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
