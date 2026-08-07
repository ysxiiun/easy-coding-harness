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

For a task with `task.json.spec_source`, re-run `inspect-dev-spec` against the stored source and
every stored `task.repo_paths` repository binding. The schema, spec ID, revision, and SHA-256
must still match. Then call the read-only selector for the exact stored selection:

```bash
{{PYTHON_CMD}} {{platform_config_dir}}/hooks/easy_coding_state.py inspect-dev-spec \
  --spec <stored-source> --repo-path <repo-id>=<stored-path> [--repo-path <repo-id>=<stored-path>]...

{{PYTHON_CMD}} {{platform_config_dir}}/hooks/easy_coding_state.py select-dev-spec-scope \
  --spec <stored-source> --spec-task <selected-task-id> [--spec-task <selected-task-id>]...
```

Load only the returned per-repository consumption closures: manifest/global context, selected
task and repository sections, related contracts, direct dependency summaries, selected
changes/steps/tests, and relevant integration rows. Never replace the selector with a whole-file
read. `scope-drifted` requires current-code conflict analysis before confirmation;
`baseline-unavailable` or unresolved repository identity remains blocked in ANALYSIS.

## Analysis artifacts

Copy `.easy-coding/templates/dev-spec-skeleton.md` first, then replace every `[[EC_TODO:...]]`.
Keep every mandatory section. `### Workflow Mode` is required.

Execution plan records use:

```json
{
  "type": "plan",
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
evidence, not a second maintained Spec. Record the source path/ID/revision/SHA, selected tasks
and repositories, baseline/conflict result, Unit mapping, source test mapping, and pending
integration edges.

Every source test command remains mandatory. Additional commands from the current repository are
allowed only when `test-strategy.md` records why the Canonical command alone is insufficient.
For every selected source test, `test-strategy.md` must spell out its Test ID, source task ID,
owning Unit ID, repository-relative test file, and exact Canonical command; the state gate checks
these markers mechanically.

Prefer one coherent unit over artificial file-level splitting. Use parallel only for truly
independent write scopes. Better unit contracts reduce later REVIEW rework.

Code tasks require `test-strategy.md`; explicit `doc`, `analysis`, and `report` tasks do not.

## Optional Java TDD analysis

Read `effective_tdd_enabled` and `effective_tdd_coverage_threshold` from the state snapshot.
When TDD is disabled, stop here: do not inspect GitLab CI or JaCoCo, do not add TDD fields or
extra tests, and do not strengthen the selected Workflow Mode's ordinary acceptance depth.

When TDD is enabled for a Java code task, make `test-strategy.md` record:

- detected Java/JUnit build system, exact unit-test command, production/test source roots, and
  JaCoCo XML paths;
- immutable Git baseline SHA and the configured changed-production-line threshold; design tests
  toward 100% while treating the threshold as the mechanical minimum;
- feature/bug RED -> GREEN -> REFACTOR evidence, or for pure refactors a pre-change
  characterization GREEN -> post-change GREEN sequence without inventing a RED failure;
- `.gitlab-ci.yml` and included configuration, the TEST-stage job, JUnit/JaCoCo artifacts, and an
  equivalent changed-line gate. Reuse a gate only when its threshold is at least the configured
  value; otherwise include the CI change in the confirmed implementation scope.

The state API mechanically freezes current Git `HEAD` per repository into `task.tdd_baselines`
when ANALYSIS advances to IMPLEMENT. Plan both local and GitLab commands with that exact SHA and
the frozen threshold; never use a mutable `HEAD` fallback at verification time. Non-Canonical TDD
is limited to one Git repository; multi-repository TDD must use Canonical repository bindings.

Also append a `### TDD Mode` section to `dev-spec.md` with enabled state, frozen threshold,
baseline, local gate, GitLab TEST gate, and lifecycle evidence. Do not add this section when TDD
is disabled.

If the task is not a Java project, explain that Java-only TDD cannot be activated and obtain a
mode decision before advancing. The CLI never installs JaCoCo or edits CI automatically.

## Workflow mode calculation

Resolve configured mode from the state snapshot:

`session.workflow_mode > project behavior.workflow_mode > adaptive`

After writing the execution plan, ask the state API to calculate the mechanical minimum:

```bash
{{PYTHON_CMD}} {{platform_config_dir}}/hooks/easy_coding_state.py workflow-floor \
  --agent <agent-id> --session-file <P>
```

Use its `minimum_mode` and `reasons` as the proposal floor. You may raise this result when
uncertainty or user preference requires more rigor, but never lower or replace it with a
self-reported floor. The state API rechecks the floor when the proposal is saved and frozen.

The calculation classifies:

- `fast`: one low-risk unit, local behavior, no public contract/schema/security/concurrency or
  migration impact, targeted test available.
- `standard`: ordinary multi-file feature/fix, bounded contract impact, existing patterns and
  impacted tests available.
- `strict`: state machine, configuration/schema migration, security/payment/data-loss risk,
  public or cross-repository contract, broad concurrency, platform generators, or uncertain
  blast radius.

If configuration is concrete, it is also a floor. The selected mode may be raised by the user
but never placed below either floor. Explain the decision and state-specific effects in the
dev-spec.

Persist the proposal before requesting ANALYSIS -> IMPLEMENT:

```bash
{{PYTHON_CMD}} {{platform_config_dir}}/hooks/easy_coding_state.py propose-workflow-mode \
  --configured <adaptive|fast|standard|strict> \
  --selected <fast|standard|strict> \
  --minimum <fast|standard|strict> \
  --source <project|session|adaptive|user> \
  --reason "<reason>" \
  --agent <agent-id> --session-file <P>
```

Repeat `--reason` for distinct material risks. Re-running the command replaces the proposal
while still in ANALYSIS.

## User presentation and transition

Before the boundary, present:

- proposed scope and units;
- acceptance and test strategy;
- configured, minimum, and selected workflow modes with reasons;
- how IMPLEMENT, REVIEW, VERIFICATION, and MEMORY will run;
- explicit user ability to request a higher mode or a permitted lower mode.

Then request or auto-apply ANALYSIS -> IMPLEMENT according to `effective_approval_mode`.
The state API atomically freezes the proposal when the transition is applied. `approval_mode`
controls waiting; it never changes the selected execution depth.

## Gates

- No project source writes in ANALYSIS.
- No unresolved skeleton placeholders.
- No code task with an empty change scope.
- No unit without acceptance criteria, test points, contracts, and risks.
- No transition without a valid workflow proposal.
- No Canonical-backed transition with changed source SHA, unresolved repository identity,
  incomplete selected-task coverage, or an open Unit/Step/File/Symbol/Test traceability gap.
