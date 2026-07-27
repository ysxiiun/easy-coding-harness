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
    "risks": ["known risk or none"]
  }]
}
```

Prefer one coherent unit over artificial file-level splitting. Use parallel only for truly
independent write scopes. Better unit contracts reduce later REVIEW rework.

Code tasks require `test-strategy.md`; explicit `doc`, `analysis`, and `report` tasks do not.

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
