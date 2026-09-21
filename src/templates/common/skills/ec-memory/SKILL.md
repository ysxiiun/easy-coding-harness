---
name: ec-memory
description: MEMORY-stage skill. Extracts reusable development knowledge from existing task evidence and performs conditional long-memory distillation.
---

# ec-memory — reusable knowledge for future development

MEMORY remains mandatory for code tasks. Daily task processing and architecture maintenance are
separate responsibilities: every completed code task produces one immutable short-memory fact;
only a long-memory distillation, or the explicit missing-ABSTRACT startup exception, may open an
architecture assessment. Never update architecture merely because MEMORY was entered.

MEMORY must not re-analyze the repository or repeat the entire conversation. Reuse confirmed
decisions and verified findings already available in `dev-spec.md`, implementation results and
Review evidence in `execution.jsonl`; `task.json` supplies identity and frozen mode. The bounded
repository reads below belong only to a required `backfill` or `update` architecture assessment.

## Knowledge value

A short memory is directly usable knowledge, not an acceptance report. Keep a fact when it helps
a later task understand behavior, choose the right change, diagnose a failure, or verify correctly.

- Lead with a knowledge topic and a retrieval summary, not a version release or task-completion
  headline. Prefer business semantics, design reasons, relevant code entrypoints, compatibility
  boundaries, and observed failure causes with their fixes.
- State the applicable situation and useful conclusion. Include reasons, limitations and exact
  symbols or source references where they help the next developer; do not fill a fixed checklist
  for every fact. Preserve only confirmed conclusions, and keep task-specific scope constraints
  scoped to that task rather than turning them into permanent project rules.
- Leave acceptance records in `execution.jsonl`; cite the relevant source instead of copying it.
  Omit approval JSON, fingerprints, execution timelines, test counts, per-run coverage numbers,
  temporary log paths, file inventories and handoff history. Do not add a list of excluded noise.
  A reusable verification command or environment constraint belongs here only when it guides
  future work; a single run's pass/fail and UT/TDD lifecycle evidence stay in the task record.
- When no new reusable knowledge exists, set `memory_value: none` and `target_long: NONE`, write
  a brief reason and retain the source reference. Do not manufacture lessons or duplicate existing
  knowledge merely to populate sections. This still completes the mandatory short-memory step.

For example, preserve that a cache write may return a failure code without throwing, why proceeding
with an unpersisted local value breaks shared counting, and where to bypass that behavior. A count
of passing tests and the user's acceptance timestamp do not teach a future task how to handle it.

Both `default` and `dispatch` use this contract. The coordinator reuses the analysis, implementation
results and Review findings already available. Reuse any executor-only discovery from its existing
result; do not require another report, another handoff, or repeated checks for MEMORY.

## Depth by workflow mode

- `fast`: keep the directly reusable conclusions concise.
- `standard`: include relevant contract, compatibility, and troubleshooting reasons when present.
- `strict`: retain non-obvious architecture, migration and cross-module boundaries needed by
  future changes. Greater depth never requires process logs, more checks, or invented knowledge.

Every memory uses schema 2 and includes `workflow_mode` in frontmatter. Generate its UUIDv7 ID
through:

```bash
{{PYTHON_CMD}} {{platform_config_dir}}/hooks/easy_coding_state.py memory-new-id --agent <agent-id>
```

Name it `{memory_id}_{YYYYMMDD}_{smart_name}.md` and set
`source_task: {current task id, exact}`. Write one immutable short memory under
`.easy-coding/memory/short/`, then register it with
`memory-short-complete`. Task ownership and content integrity remain runtime checks; acceptance
and Canonical evidence remain in their existing records, not duplicated in the memory body.

Upgrades preserve existing project templates. These instructions take precedence over legacy
process sections in `SHORT_MEMORY_TEMPLATE.md`; omit those sections when writing a new memory.
Do not rewrite old memories or user templates to adopt this contract.

Ask the state API for `memory-instruction`. Distill only when it returns `action:distill`;
otherwise record `no-op`. Long memory merges reusable facts, deduplicates matching knowledge and
retires superseded conclusions. Extract useful knowledge from legacy acceptance reports without
carrying over process noise; `memory_value: none` contributes no long-memory topic. Work only
within the frozen candidates and matching topics, without a global history cleanup.

## Architecture assessment

Read the frozen `architecture_assessment` contract returned by `memory-instruction`.

- `required:false`: do not read the repository for architecture purposes and do not modify
  `.easy-coding/ABSTRACT.md` or `.easy-coding/CHANGELOG.md`.
- `trigger:distillation`: finish classifying the frozen `candidate_files`, then assess whether
  their stable, reusable facts make the current architecture cognition stale. Default to
  `no-op`.
- `trigger:missing-abstract`: use `backfill` after the first substantive startup task even when
  long-memory action is `no-op`. This is the only non-distillation architecture exception.

An architecture `update` is justified only by evidence of at least one of these changes:

- a module was added, removed, split, or merged;
- module responsibility, ownership, or dependency direction changed;
- a core request, data, state, or event flow changed;
- the technology stack, runtime, build, or deployment infrastructure changed;
- the existing ABSTRACT conflicts with verified current facts.

Do not update for a bug fix, local implementation detail, DTO/field-only change, local refactor,
temporary workaround, routine dependency patch, or the mere fact that distillation ran. Stable
new coding conventions belong in `TECHNICAL.md` as explicit RULES update candidates; never
silently edit `RULES.md`, `SOUL.md`, or `TEST_STRATEGY.md` from MEMORY.

For `no-op`, use only the frozen memory evidence and give a concrete reason. For `backfill` or
`update`, read only candidate-related modules, entrypoints, dependencies, and affected ABSTRACT
sections. Do not perform an unbounded repository re-analysis. Create or edit only the affected
sections of `.easy-coding/ABSTRACT.md`, and create or append `.easy-coding/CHANGELOG.md`; never
regenerate the whole ABSTRACT when a bounded edit is sufficient.

Whenever `required:true`, record the decision through the command below. For distillation this
must succeed before deleting any candidate; for `missing-abstract` it must succeed before the
`no-op` long-memory action can complete:

```bash
{{PYTHON_CMD}} {{platform_config_dir}}/hooks/easy_coding_state.py memory-architecture-assessment \
  --session-file <P> --action <no-op|backfill|update> --reason <reason> \
  --evidence <frozen-memory-file> [--evidence <frozen-memory-file> ...] \
  [--affected-section <section> ...] --agent <agent-id>
```

`backfill` and `update` require affected sections; `no-op` must not declare them. Evidence must
come from the frozen candidate set, or from the current checkpoint for the missing-ABSTRACT
exception. If assessment or architecture-file validation fails, keep every candidate file and
remain in MEMORY.

After the assessment succeeds, a distillation may delete all frozen `candidate_files` while
preserving every `kept_file`. Then call `memory-complete`. The state API rechecks that no-op
assets stayed unchanged, changed assets still match the recorded assessment, all candidates were
consumed, and all retained memories still exist.

Complete processing with `memory-complete`. When the state API reports
`memory_progress.completed:true`, call `auto-transition --stage COMPLETE`.
For Canonical-backed tasks this automatic edge first writes every verified selected source task
to shared `completed`; pending integration dependencies or failed writeback keep the task in
MEMORY. Do not claim COMPLETE from local memory state alone.
