---
name: ec-memory
description: MEMORY-stage skill. Creates a workflow-mode-aware schema-v2 checkpoint from existing task evidence and performs conditional long-memory distillation.
---

# ec-memory — evidence-derived checkpoint and knowledge governance

MEMORY remains mandatory for code tasks. Daily task processing and architecture maintenance are
separate responsibilities: every completed code task produces one immutable short-memory fact;
only a long-memory distillation, or the explicit missing-ABSTRACT startup exception, may open an
architecture assessment. Never update architecture merely because MEMORY was entered.

The short-memory checkpoint must not re-analyze the repository or repeat the entire conversation.
Generate it only from the verified evidence already stored in `task.json`, `dev-spec.md`, and
`execution.jsonl`. The bounded repository reads described below belong only to a required
`backfill` or `update` architecture assessment.

## Depth by workflow mode

- `fast`: mechanically produce a compact checkpoint: goal, scope, result, frozen mode,
  commands/results, and only clearly reusable decisions.
- `standard`: add reusable contract, compatibility, and troubleshooting facts when present.
- `strict`: preserve architecture, migration, risk, verification, and cross-module decisions
  needed for future high-risk work.

Every memory uses schema 2 and includes `workflow_mode` in frontmatter. Generate its UUIDv7 ID
through:

```bash
{{PYTHON_CMD}} {{platform_config_dir}}/hooks/easy_coding_state.py memory-new-id --agent <agent-id>
```

Name it `{memory_id}_{YYYYMMDD}_{smart_name}.md` and set
`source_task: {current task id, exact}`. Write one immutable short memory under
`.easy-coding/memory/short/`, then register it with
`memory-short-complete`. Never invent test results or commit hashes.

Copy the final `acceptance` record from `execution.jsonl` into the checkpoint as a concise
decision fact: authorization source, decision summary, `diff_sha256`, review policy, verification
policy, changed files, and any Canonical source tasks that required targeted verification.
`memory-short-complete` rejects a checkpoint that omits any of those decision fields. This records
the user's accepted exception without re-reviewing or re-analyzing the code. Canonical writeback
already carries the same digest and authorization as shared `acceptance` evidence.

When frozen TDD is enabled, add its threshold, lifecycle evidence, passed local unit-test result,
and local changed-line result to the short memory's execution evidence. Remote CI status is not
part of Harness acceptance or task memory. When TDD is off, omit TDD fields entirely so ordinary
tasks incur no additional memory work.

Ask the state API for `memory-instruction`. Distill only when it returns `action:distill`;
otherwise record `no-op`. Long memory receives reusable facts only, not file dumps, transient
logs, routine command output, or speculation.

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
