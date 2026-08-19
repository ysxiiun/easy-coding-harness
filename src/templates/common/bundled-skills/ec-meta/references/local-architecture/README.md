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

5 work stages + 2 terminals, owned by ec-workflow:
`INIT → ANALYSIS → IMPLEMENT → QUALITY → MEMORY → COMPLETE`, plus `CLOSED`
(user abort, no memory flow). INIT → ANALYSIS and completed MEMORY → COMPLETE are restricted
automatic edges. Pure read-only conversation stays Ready and creates no task; repository writes,
including documentation and configuration, use the full graph. Approval mode controls edge waiting: approve confirms each edge,
guard confirms two critical gates, confirm waits only at ANALYSIS -> IMPLEMENT, and auto
advances every legal edge after mechanical gates. After green QUALITY, Harness freezes an
acceptance checkpoint. A later code diff temporarily pauses every mode so the exact digest can be
accepted; unchanged `confirm`/`auto` tasks remain automatic.
Workflow mode is independently configured as adaptive/fast/standard/strict; ANALYSIS freezes
adaptive to a concrete mode, and every mutation task still enters QUALITY. Its Review Gate is
bound to the final implementation fingerprint; Verification Gate evidence is bound to implementation
and config fingerprints, and an accepted post-checkpoint diff records its authorization plus
carry-forward/targeted/waived policy without forcing a second review. MEMORY keeps the conditional
long-memory threshold gate.

`ec-lite` is an explicit session mode outside this graph. It offers one compact proposal and user
confirmation before a minimal mutation, creates no task/QUALITY/MEMORY artifacts, and remains on
until the user invokes it again. If a task is active, the user chooses whether to cancel startup,
close the task, or clear only the session task pointer before Lite starts.

Java TDD is a third independent, default-off control managed by `ec-config`. Session overrides
project configuration; ANALYSIS freezes enabled state and the 1..100 changed-line threshold
(default 90) on entry to IMPLEMENT. Disabled TDD changes no ordinary workflow test depth. Enabled
TDD adds lifecycle evidence, a TDD review dimension, passed local unit-test evidence, and a local
JaCoCo diff gate. `ec-tdd-init` still generates the equivalent GitLab TEST-stage job, but remote
pipeline execution and status are not Harness acceptance dependencies.

The active task pointer lives in `sessions/{agent}-{session-id}.json` (with an agent-prefixed PPID fallback only
when a hook payload has no logical session ID);
when the task reaches `COMPLETE` or `CLOSED`, the state API clears `current_task` so the
session returns to Ready. Each task's stage persists in its `task.json`. Hooks inject the
session and task state as breadcrumbs so every reply can render the status line.

Task switching: the session file has a single `current_task` slot, but the user can switch
between tasks at any time. When a user's prompt doesn't match the active task, ec-workflow's
intent router offers to suspend the current task and switch. The suspended task retains its
stage in `task.json`; no data is lost. Each task folder is self-contained.

## Task persistence

Each task is a folder. `task.json` is metadata, including the current stage, workflow proposal,
frozen concrete mode, and any `pending_transition`; `dev-spec.md` is the human-readable plan;
`execution.jsonl` is an append-only plan-and-log (one `plan` record, then `dispatch`/`result`
/`quality`/`review`/`verify`/`acceptance`/`handoff` records). Because plan and log live on disk, not in an agent's
context window, a task survives session end and agent switches with zero information loss.

## Canonical Spec integration

An `easy-dev-spec/v1` Canonical Spec separates frozen static design from a shared execution ledger.
`inspect-dev-spec` validates the document with the protocol implementation pinned from
`easy-dev-spec@7eb9b64`; after explicit task selection, `select-dev-spec-scope` returns one
deterministic producer-compatible closure per repository, and `create-task-from-spec` creates one
Harness task with source locator mode, ID/design revision and digest, document digest, execution
revision, selected task IDs, repository bindings,
baseline classifications, and dependency evidence.

ANALYSIS derives local `dev-spec.md`, `execution.jsonl`, and `test-strategy.md` for the selected
consumption closure. Canonical-backed units keep repository, source task/steps, files, symbols,
and test commands. Hard dependencies shape the Unit DAG, READY contracts can run in parallel,
and integration dependencies block end-to-end completion until evidence is recorded. Harness
keeps detailed evidence locally and projects cross-application Task/Step/dependency outcomes into
`EDS:EXECUTION` through one CAS/idempotent writer. Static changes use revision + READY +
`sync-spec-design`; agents never hand-edit the machine ledger. Explicit external locators are
allowed and rebind only by exact Canonical identity. Source tasks stay `implemented` after local
checks and become `verified` only when QUALITY -> MEMORY is applied under explicit or
standing approval-mode authorization; the shared event includes the acceptance digest.

## Memory system

Short memory: one schema-v2 file per task, sliding window (max 10, keep 5). Long memory:
three files (index + business + technical), distilled from out-of-window short memories with
explicit conflict resolution. Daily tasks only produce facts. When distillation runs, MEMORY
performs a separate, default-no-op architecture assessment and updates only affected ABSTRACT
sections when frozen evidence proves the architecture cognition is stale. A missing ABSTRACT
after the first substantive startup task is the only non-distillation backfill exception.

## Project knowledge — four layers

Identity (SOUL, rarely changes) · Constraints (RULES, stable) · Cognition (ABSTRACT, updated
only after evidence-backed architecture assessment) · Memory (short every task, long only on
distillation). Stable convention changes become RULES candidates in technical memory, never
silent RULES edits. ec-workflow always reads
SOUL + RULES + recent short memory; ec-analysis loads ABSTRACT and matching long memory on
demand.

## Dead-drop coordination

`.easy-coding/` is a dead drop. Agent A writes results and leaves; agent B reads them and
continues. All platform-agnostic artifacts (dev-spec, execution.jsonl, task.json, memory)
make cross-agent handoff lossless. `task.json.last_agent` records the last owner so a new
agent knows a task was handed off rather than self-interrupted.
Owner identities use platform namespaces. Codex root identities such as `root`, `/root`, and
their collaboration subpaths normalize to `codex`, so internal Codex delegation is not mistaken
for a cross-agent handoff; existing task files with those identities remain compatible without
migration.

Handoff is target-less. The leaving agent writes a `handoff` record with `from`, `stage`,
`summary`, and `timestamp`, then releases its session pointer. It does not know or record the
next agent. The receiving agent explicitly claims a task through the state API; that claim sets
the new session pointer and updates `task.json.last_agent`.
