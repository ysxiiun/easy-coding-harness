---
name: ec-analysis
description: ANALYSIS-stage skill. Produces the confirmed dev-spec, execution plan, test strategy, and a risk-bounded workflow-mode proposal without modifying project code.
---

# ec-analysis — progressive analysis and mode selection

This stage is read-only for project source. Its outputs are task artifacts only:
`dev-spec.md`, `execution.jsonl` plan, and `test-strategy.md` for code tasks.

Communicate with the user in the user's language.

## Progressive context loading

1. Read task.json, SOUL, RULES index/headings, ABSTRACT index/headings, and the dev-spec
   skeleton.
2. Search short-memory frontmatter and summaries first. Open only memories whose domains,
   tags, related files, or predecessor links match this task. Do not load the newest five
   memories unconditionally.
3. Read full RULES/ABSTRACT sections only for affected modules.
4. Inspect concrete code paths and tests. Expand context only when evidence reveals another
   dependency or risk.

Load context only for the current change and its direct dependencies. Reuse existing findings;
without new evidence, do not repeat discovery or expand into unrelated modules.

For a task with `task.json.spec_source`, use `resume-spec-context` against the stored source, exact
`selected_spec_tasks`, and only their stored `task.repo_paths` bindings. Schema, Spec ID, design
revision, and `design_sha256` must still match. A changed `document_sha256` with the same design is
normal shared progress; refresh `execution_revision` without invalidating plan/QUALITY
evidence. An execution revision rollback is blocking. Reuse the ready consumption returned by
creation/claim in this session; otherwise load it once with:

```bash
{{PYTHON_CMD}} {{platform_config_dir}}/hooks/easy_coding_state.py resume-spec-context \
  --task-id <task-id> --agent <agent-id> --session-file <P>
```

Load only the returned per-repository consumption closures: manifest/global context, selected
task and repository sections, related contracts, direct dependency summaries, selected
changes/steps/tests, and relevant integration rows. Never replace the selector with a whole-file
read. Treat the Canonical closure as frozen design, not as a prompt to design the task again:

- `exact` and `scope-unchanged` use the fast projection path. Confirm the selected paths, symbols,
  and test entry points, then map the closure into Units, `test-strategy.md`, and the derived
  `dev-spec.md` in one pass. Do not reselect interfaces, fields, task boundaries, Steps, or Tests,
  and do not ask questions already answered by the source Spec.
- `scope-drifted` reads and analyzes only changed files and symbols in the selected task scope.
  Escalate to a static design revision only when that evidence changes a frozen contract or task
  boundary; unrelated repository or completed-task changes are background, not current drift.
- `baseline-unavailable` or unresolved selected-repository identity remains blocked in ANALYSIS.

Use shared execution dependency status directly. Do not inspect another local Harness task or Git
history to re-prove a completed hard dependency, and do not repeat dependency or baseline
explanations after the selected inspection has recorded them.

## Local implementation baseline

For every code unit, inspect the nearest same-module, same-role implementation before planning.
Record a concise `local_baseline` covering only evidenced conventions that affect this change:
naming and control flow, null/empty and error handling, layering and dependency direction, object
modeling, method extraction granularity, literal/constant usage, and comments/Javadoc. Prefer the
closest comparable code over a repository-wide average. Explicit requirements, correctness,
security, and project hard rules still take precedence; otherwise do not replace safe local
conventions with generic best practices.

Do not ask the user to choose a style already answered consistently by comparable code. Ask only
when local evidence conflicts or a deviation can change the contract, risk, or acceptance result.

## Analysis artifacts

For a non-TDD Fast task use the compact form below. Otherwise copy
`.easy-coding/templates/dev-spec-skeleton.md` first, then replace every `[[EC_TODO:...]]`.
Keep every mandatory section. The `### 决策闭环` (Decision Closure) and `### Workflow Mode`
sections are required. The decision section must contain exactly one standalone
`decision_status: closed` marker, and no other `decision_status` marker may appear elsewhere in
the document. Record every material question and its resolved conclusion in that section, or
record that no extra decision was needed.

## Decision closure before implementation

Treat uncertainty that can change the technical route, public or internal contract, data model,
state flow, edit scope, compatibility behavior, or acceptance criteria as a material open
question. While any such question remains:

1. stay in ANALYSIS and ask the user focused questions, preferably one decision at a time;
2. do not present a final analysis summary, propose the final Workflow Mode, request
   ANALYSIS -> IMPLEMENT, or suggest that implementation can begin;
3. update the Dev-Spec with each confirmed answer and its evidence;
4. use `decision_status: open` while the artifact is still being developed, then replace it with
   the single `decision_status: closed` marker only after every material question is resolved.

Risks, integration work that is intentionally deferred by a frozen Spec, and environmental
verification limits are not automatically open questions. Describe them as risks or explicit
acceptance boundaries. Never use `closed` to hide a decision that still needs the user.

Execution plan records use:

```json
{
  "type": "plan",
  "spec_design_sha256": "<Canonical design digest; omit for ordinary tasks>",
  "strategy": "single|sequential|parallel",
  "units": [{
    "id": "U1",
    "title": "...",
    "type": "...",
    "files": ["..."],
    "depends_on": [],
    "rules_sections": [],
    "abstract_modules": [],
    "acceptance_criteria": ["observable result"],
    "test_points": ["targeted check"],
    "contracts": ["input/output/invariant or none"],
    "risks": ["known risk or none"],
    "local_baseline": ["evidenced local convention and source path"],
    "repo_id": "R1",
    "source_task_id": "R1-T1",
    "source_step_ids": ["S1"],
    "symbols": ["Class#method"],
    "test_commands": ["exact source test command", "optional local command"]
  }]
}
```

The five source fields are mandatory only for Canonical-backed code units. Default to one unit
per selected Spec task. A split may cover only one `repo_id` and one `source_task_id`, and all
units together must cover every source step exactly once. Map selected hard dependencies into
`depends_on`, contract dependencies into `contracts`, and dependency levels into
`parallel_groups`.

Canonical-backed `dev-spec.md`, `execution.jsonl`, and `test-strategy.md` are runtime-derived
evidence, not a second maintained Spec. Record the source path/path mode/ID/design revision and
digest, current document digest/execution revision/writeback status, selected tasks
and repositories, baseline/conflict result, Unit mapping, source test mapping, and pending
integration edges.

The required skeleton is a mechanical artifact schema. For a Canonical-backed task it is filled
from the selected closure and current-code delta; it must never become a second round of Spec
authoring.

Every source test command remains mandatory. Additional commands from the current repository are
allowed only when `test-strategy.md` records why the Canonical command alone is insufficient.
For every selected source test, `test-strategy.md` must spell out its Test ID, source task ID,
owning Unit ID, repository-relative test file, and exact Canonical command; the state gate checks
these markers mechanically.

Prefer one coherent unit over artificial file-level splitting. Do not split a class or method by
line count, or create many one-use helpers, merely to make the plan look modular. Extract only a
clear semantic boundary, reuse point, or independently testable responsibility. Use parallel only
for truly independent write scopes. Better unit contracts reduce later QUALITY rework.

Standard/Strict tasks require `test-strategy.md`; compact Fast tasks keep checks in the plan. Pure read-only
conversation never enters ANALYSIS and creates no task.

## Optional Java TDD analysis

Read `effective_tdd_enabled` and `effective_tdd_coverage_threshold` from the state snapshot.
For a `type=tdd-init` task, treat frozen TDD as off even if the project/session requests it. That
task is the sole exception allowed to inspect and plan build/CI coverage infrastructure while TDD
is off. Its scope is infrastructure only: never plan historical business-test backfill or a
repository-wide coverage target, and explicitly record `coverage scope: changed production lines`.

When TDD is disabled, stop here: do not inspect GitLab CI or JaCoCo, do not add TDD fields or
extra tests, and do not strengthen the selected Workflow Mode's ordinary acceptance depth. This
zero-cost rule applies to ordinary tasks, not the explicit `tdd-init` infrastructure task above.

When TDD is enabled for a Java code task, make `test-strategy.md` record:

- detected Java/JUnit build system, exact unit-test command, production/test source roots, and
  JaCoCo XML paths;
- immutable Git baseline SHA and the configured changed-production-line threshold; meet that threshold without adding assertions or tests solely to reach 100%;
- feature/bug RED -> GREEN -> REFACTOR evidence, or for pure refactors a pre-change
  characterization GREEN -> post-change GREEN sequence without inventing a RED failure;
- the local unit-test command and local changed-line acceptance command. Record that
  `ec-tdd-init` generated the GitLab TEST-stage job, but remote execution, pipeline identity, and
  status are non-blocking and never require an intermediate commit or push. Include these exact,
  language-independent contract markers: `local_test_gate: required` and
  `remote_ci_acceptance: non-blocking`.
- current `tdd_readiness_status=ready`; a missing receipt requires `ec-tdd-init`, while
  `needs_repair` requires fixing the reported entry without resetting TDD configuration.
  Build-file content changes use current task tests and coverage; they do not require reinit.

The state API mechanically freezes current Git `HEAD` per repository into `task.tdd_baselines`
when ANALYSIS advances to IMPLEMENT. Plan the local command with that exact SHA and the frozen
threshold. The generated GitLab job remains parameterized for infrastructure parity, but the
Harness acceptance plan never waits for remote CI. Never use a mutable `HEAD` fallback at
verification time. Non-Canonical TDD is limited to one Git repository; multi-repository TDD must
use Canonical repository bindings.

Also append a `### TDD Mode` section to `dev-spec.md` with enabled state, frozen threshold,
baseline, local unit-test gate, local coverage gate, generated GitLab job as non-blocking
infrastructure, and lifecycle evidence. Do not add this section when TDD is disabled.

If the task is not a Java project, explain that Java-only TDD cannot be activated and obtain a
mode decision before advancing. The CLI never installs JaCoCo or edits CI automatically.

## Workflow mode calculation

Execution mode equals the mechanical minimum for the actual current scope. Do not propose a
higher mode or ask the user to select one. Old configured/frozen modes do not raise the minimum.
Use `propose-workflow-mode --agent <agent-id> --session-file <P>` once after the plan exists;
it returns the calculated mode and reasons, so a separate floor/proposal round is unnecessary.

For a non-TDD Fast task, dev-spec.md may use the compact form:

```markdown
<!-- easy-coding:compact -->
decision_status: closed
Goal: <confirmed behavior>
Scope: <exact files and preservation boundary>
Acceptance: <observable outcome and minimum check>
```

Record Unit `input_files` for the known additional direct inputs (an empty list means the
Unit files are self-contained). Include shared helpers, fixtures, schemas and configuration
actually consumed by its checks. Without a declared closure, checks cover the owning module.
Build commands still include their module compilation inputs. Do not infer a whole-program call graph. Keep Unit contracts and test points in the existing execution plan. Do not duplicate them across
full template chapters or create a separate test strategy for this compact form. Canonical work
consumes the selected source closure; it does not redesign unrelated selected tasks.

## User presentation and transition

After decision closure and before the boundary, prepare a concise proposal receipt instead of
pasting the full `dev-spec.md`. The receipt must contain:

- the core solution and affected scope/units;
- acceptance and test-strategy highlights;
- the computed minimum workflow mode and its concrete reasons;
- the material risks and explicit acceptance boundaries;
- the computed minimum mode as an execution fact, without offering mode choices.

End the summary with the absolute path to
`.easy-coding/tasks/<task-id>/dev-spec.md`. When the current client supports local-file Markdown
links, render `[View full Dev-Spec](</absolute/path/to/dev-spec.md>)`; otherwise print the
copyable absolute path. Do not dump the full artifact merely because the client cannot link it.
If the user asks to inspect the full plan, open or read that stored file on demand using the
current Agent's supported file capability.

The proposal receipt must survive the client boundary. Assistant text emitted before a later
tool call is only a process presentation: a host may group or collapse it, so it does not satisfy
the durable receipt requirement. For a confirmation-required ANALYSIS -> IMPLEMENT edge, the last
assistant response after a native choice returns or a matching transition call completes must be
self-contained. Repeat the compact receipt and full Dev-Spec link/path even when the same content
was visible before the tool call. If the edge remains pending, also repeat the complete choices;
if it was confirmed, identify the accepted branch and target stage. Never reduce this response to
only a confirmation prompt or transition result.

For an automatic edge, do not add a pause or turn it into a confirmation gate. Apply the edge and
carry the full Dev-Spec link/path into the next durable final response in the same turn. The state
API atomically freezes the proposal when the transition is applied. `approval_mode` controls
waiting; it never changes the selected execution depth.

## Gates

- No project source writes in ANALYSIS.
- No unresolved skeleton placeholders.
- No code task with an empty change scope.
- No unit without acceptance criteria, test points, contracts, and risks.
- No final summary, workflow proposal, or transition while a material decision is unresolved.
- No transition without exactly one `decision_status: closed` marker in `dev-spec.md`.
- No transition without a valid workflow proposal.
- No Canonical-backed transition with changed design revision/digest, a backward execution
  revision, pending/conflicted writeback, unresolved repository identity,
  incomplete selected-task coverage, or an open Unit/Step/File/Symbol/Test traceability gap.

If evidence requires changing Canonical task boundaries, contracts, files, symbols, Steps, Tests,
or dependencies, obtain confirmation and run `begin-spec-change --affected-task <id> --summary
<confirmed-change> --agent <agent-id> --session-file <P>` before editing. This persists the
intent across handoffs and blocks implementation/acceptance until synchronization. Update the original static design with revision +1,
restore READY, and call `sync-spec-design --affected-task ...`. For bounded corrections this refreshes only affected Unit mappings; other design changes
invalidate the old local plan. Run `resume-spec-context` after synchronization, then refresh derived artifacts. Never
substitute edits to the derived `dev-spec.md`, and never edit `EDS:EXECUTION` by hand.
