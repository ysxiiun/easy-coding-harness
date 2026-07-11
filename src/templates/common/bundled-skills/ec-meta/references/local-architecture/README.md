# Local Architecture

How an installed Easy Coding harness is laid out and why.

## Two layers

The harness deliberately separates **platform-native files** from **shared runtime data**:

- **Platform-native** (agent discovers these natively): skills, hooks, sub-agent definitions,
  and the main constraint file. They live in each platform's standard directory
  (`.claude/`, `.agents/` + `.codex/`, `.qoder/`). The agent's own `/` or `$` discovery finds
  them — the harness invents no new discovery mechanism.
- **Shared runtime data** (`.easy-coding/`): `config.yaml`, `project.yaml`, `sessions/`, `tasks/`, `memory/`,
  `spec/`, and the project knowledge assets (SOUL/RULES/ABSTRACT/TEST_STRATEGY/CHANGELOG).
  Skills and hooks read and write these.

The CLI installs the platform-native files. Agent skills do all the thinking (project
analysis, workflow operation). The CLI never analyzes the project.

## `.easy-coding/` runtime layout

```
.easy-coding/
  config.yaml        CLI-owned structural config (in git)
  project.yaml       ec-init project profile (in git)
  sessions/          personal workflow session files (NOT in git)
  SOUL.md            project identity + dialogue standards
  RULES.md           coding rules (per-language sections)
  ABSTRACT.md        architecture cognition
  TEST_STRATEGY.md   project-level test baseline
  CHANGELOG.md       architecture change log (follows ABSTRACT)
  tasks/             one folder per task
    project-init/    created by the CLI; ec-init completes it
    {MM-DD-name}/    task.json · dev-spec.md · test-strategy.md · execution.jsonl
  memory/
    short/           sliding-window short memories (max 10, keep 5)
    long/            MEMORY.md index · BUSINESS.md · TECHNICAL.md
  spec/
    main/            confirmed designs from ec-brainstorming
    dev/             dev-spec candidates (default out of normal commits)
```

## Workflow state machine

6 work stages + 2 terminals, owned by ec-workflow:
`INIT → ANALYSIS → IMPLEMENT → REVIEW → VERIFICATION → MEMORY → COMPLETE`, plus `CLOSED`
(user abort, no memory flow). Every legal stage edge records `task.json.pending_transition`
and requires explicit user confirmation by default. VERIFICATION remains the fresh-evidence
hard gate, and MEMORY keeps the conditional long-memory threshold gate. The active task
pointer lives in `sessions/{ppid}.json`;
when the task reaches `COMPLETE` or `CLOSED`, the state API clears `current_task` so the
session returns to Ready. Each task's stage persists in its `task.json`. Hooks inject the
session and task state as breadcrumbs so every reply can render the status line.

Task switching: the session file has a single `current_task` slot, but the user can switch
between tasks at any time. When a user's prompt doesn't match the active task, ec-workflow's
intent router offers to suspend the current task and switch. The suspended task retains its
stage in `task.json`; no data is lost. Each task folder is self-contained.

## Task persistence

Each task is a folder. `task.json` is metadata, including the current stage and any
`pending_transition`; `dev-spec.md` is the human-readable plan;
`execution.jsonl` is an append-only plan-and-log (one `plan` record, then `dispatch`/`result`
/`review`/`verify`/`handoff` records). Because plan and log live on disk, not in an agent's
context window, a task survives session end and agent switches with zero information loss.

## Memory system

Short memory: one schema-v2 file per task, sliding window (max 10, keep 5). Long memory:
three files (index + business + technical), distilled from out-of-window short memories with
explicit conflict resolution. ABSTRACT.md is backfilled/updated when memory distillation
detects an architecture change.

## Project knowledge — four layers

Identity (SOUL, rarely changes) · Constraints (RULES, stable) · Cognition (ABSTRACT, updated
on architecture change) · Memory (short + long, updated every task). ec-workflow always reads
SOUL + RULES + recent short memory; ec-analysis loads ABSTRACT and matching long memory on
demand.

## Dead-drop coordination

`.easy-coding/` is a dead drop. Agent A writes results and leaves; agent B reads them and
continues. All platform-agnostic artifacts (dev-spec, execution.jsonl, task.json, memory)
make cross-agent handoff lossless. `task.json.last_agent` records the last owner so a new
agent knows a task was handed off rather than self-interrupted.

Handoff is target-less. The leaving agent writes a `handoff` record with `from`, `stage`,
`summary`, and `timestamp`, then releases its session pointer. It does not know or record the
next agent. The receiving agent explicitly claims a task through the state API; that claim sets
the new session pointer and updates `task.json.last_agent`.
