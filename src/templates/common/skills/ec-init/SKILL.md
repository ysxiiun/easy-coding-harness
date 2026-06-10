---
name: ec-init
description: One-time project knowledge initialization after the easy-coding CLI install. Use when the user runs {{skill_trigger}}ec-init or hook context shows [easy-coding:init-required]. Idempotent. Detects startup vs iterative projects automatically and generates SOUL, RULES, ABSTRACT, and TEST_STRATEGY.
---

# ec-init — project knowledge initialization

The CLI is a dumb file mover; you are the smart half. You analyze the project and produce
the knowledge assets every later stage depends on. This runs once per project; re-runs are
safe.

Communicate with the user in the user's language.

## Entry guard (idempotency — run first)

1. Read `.easy-coding/tasks/project-init/task.json`.
   - File missing → the CLI never ran. Tell the user to run `easy-coding init` first. Stop.
   - `status == "COMPLETE"` → already initialized. Show a short summary (project mode,
     generated files, init date from `init_log`) and exit without changing anything.
   - `status == "PENDING"` → proceed.
2. Repeated calls must never duplicate files or corrupt existing ones.

## Project mode detection (automatic — never ask the user)

Scan the project root, excluding `.easy-coding/`, platform dirs (`.claude/`, `.agents/`,
`.codex/`, `.qoder/`), lockfiles, and pure config skeletons (package.json, tsconfig,
linter configs, CI yaml).

- Substantive source files exist (.ts/.js/.java/.py/.go/.rs/... containing real logic)
  → **iterative** (existing project).
- Empty, or config skeleton only → **startup** (new project).

Record the verdict in `config.yaml` under `project.mode` and in `init_log`.

## Iterative project flow

After each step append `{step, summary, timestamp}` to `init_log` in task.json — a later
agent must be able to see what was generated and on what evidence.

1. **SOUL.md — project identity.** Analyze README, package metadata, and code purpose. Write:
   - What this project is (2-3 sentences, concrete, no marketing fluff)
   - Dialogue standards (language to use with the user, tone, verbosity expectations)
   - Hard prohibitions (e.g. never commit secrets, never edit generated directories)
   Keep it under ~40 lines; SOUL is loaded on every task.
2. **RULES.md — coding rules grounded in evidence,** not generic best practice. Detect:
   - Languages and versions (from configs and sources)
   - Naming conventions actually in use (scan representative files)
   - Comment language: if more than 70% of existing comments are Chinese, the rule is
     "comments in Chinese"; same logic for English; mixed → follow each file's dominant language
   - Error handling style, import ordering, formatter/linter in use (read their configs)
   Structure as one section per language plus a General section. Every rule must be
   mechanically checkable — "be clean" is not a rule; "exported functions carry explicit
   return types" is.
3. **ABSTRACT.md — architecture cognition.** Scan directory structure and entrypoints. Write:
   modules and their responsibilities, core data flow, tech stack with versions, external
   dependencies and services, build and run commands. Use a named section per module —
   later stages extract sections by name (the `abstract_modules` field in execution plans).
4. **TEST_STRATEGY.md — project test baseline:** detected framework, test command, where
   tests live, naming conventions, coverage expectations, which classes of code this project
   tests vs skips. Also fill `config.yaml` `test.framework` and `test.command` with commands
   you verified exist (read package.json scripts or equivalent — do not guess).
5. **Memory init** — ensure `.easy-coding/memory/short/` and `memory/long/` exist with the
   three long files (MEMORY.md, BUSINESS.md, TECHNICAL.md). Never write fake entries.
6. **Mark complete** — task.json `status:"COMPLETE"` plus a final `init_log` entry. Tell the
   user initialization is done and daily work goes through `{{skill_trigger}}ec-workflow`.

## Startup project flow

1. **Lightweight interview** — 3-5 questions, strictly one at a time, multiple-choice
   preferred: project name and positioning, primary language and framework, test framework
   preference, special coding conventions (optional), comment language (optional).
2. Generate from the answers:
   - SOUL.md (identity from answers, dialogue standards, prohibitions)
   - RULES.md (baseline rules for the chosen language; mark sections "refine as code grows")
   - TEST_STRATEGY.md (skeleton for the chosen framework)
3. **Skip ABSTRACT.md** — no architecture exists yet. Note in init_log:
   "ABSTRACT pending; ec-memory backfills after the first substantive task." (ec-memory
   detects the missing file during MEMORY_LONG and generates it from the then-current code.)
4. Memory init and completion marking, same as iterative steps 5-6.
5. Recommend: design first with `{{skill_trigger}}ec-brainstorming`, then build via
   `{{skill_trigger}}ec-workflow`.

## Quality bar for generated files

- Every claim grounded in observed evidence — file paths and configs you actually read.
  No filler like "follow best practices".
- SOUL stays short. RULES and ABSTRACT run as long as the evidence supports, in named
  sections. TEST_STRATEGY must be concrete enough that ec-verification can derive runnable
  commands from it.

## Boundaries

- Never modify business source code, dependencies, or git state.
- Never create workflow tasks or touch `current_task` / `current_stage` in state.json.
- Never regenerate knowledge files for a COMPLETE project-init — the user edits them
  manually or asks ec-meta for guided customization.
