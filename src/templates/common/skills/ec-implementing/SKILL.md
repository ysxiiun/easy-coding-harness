---
name: ec-implementing
description: IMPLEMENT-stage skill. Executes the confirmed plan with workflow-mode-aware orchestration, strict scope control, shift-left tests, and structured execution evidence.
---

# ec-implementing — execute the confirmed plan

Use only after ANALYSIS has frozen `task.json.workflow_mode` to `fast`, `standard`, or
`strict`. Read `dev-spec.md`, the latest `plan` record in `execution.jsonl`, relevant RULES
and ABSTRACT sections, and `test-strategy.md` for code tasks.

If frozen `task.tdd_enabled` is not `true`, preserve the existing shift-left behavior exactly;
do not load the Java coverage tool, require RED/GREEN/REFACTOR, inspect CI, or run extra test
commands. TDD is an independent opt-in mode, not an implicit consequence of strict workflow.

When frozen TDD is enabled, every feature/bug unit must capture a meaningful failing unit test
before production code (RED), the smallest passing implementation (GREEN), and a green refactor.
Pure refactors instead capture a passing characterization test before the change and rerun it
afterward. Never fake RED evidence. Keep tests deterministic, boundary-focused, and minimally
mocked, and design changed production code toward 100% unit coverage.

Communicate with the user in the user's language.

## Non-negotiable gates

1. Modify only files in the confirmed change-scope table. A new file requirement returns the
   task to ANALYSIS.
2. Preserve existing encoding and project comment conventions.
3. Each unit must carry `acceptance_criteria`, `test_points`, `contracts`, and `risks`.
   Missing unit context is an analysis defect; do not make the implementer rediscover it.
4. Run the unit's cheapest meaningful test immediately after its implementation. Do not wait
   until VERIFICATION to discover local contract mistakes.
5. Append `dispatch` and `result` records for every unit, including main-agent execution.
   Main-agent execution uses `reason:"main-inline:<workflow_mode>"`.
6. A code task never transitions directly from IMPLEMENT to VERIFICATION. Every new code task
   enters REVIEW.
7. Read-only `doc` / `analysis` / `report` tasks remain `single` with `files:[]`, make no writes,
   return a non-empty `deliverable`, then follow the mode-aware IMPLEMENT -> COMPLETE edge.
8. When a project template, local convention, or new source header uses author attribution, the
   author value must be `<Current Agent Name> with Easy Coding`, for example
   `Codex with Easy Coding`. `Current Agent Name` means the user-facing host Agent (for example,
   Codex, Claude, or Qoder), never an implementation sub-agent role such as `ec-implementer`.
   Never copy a previous human or Agent name into newly authored code.
9. Every newly added field in a data-bearing model must have a meaningful field-level comment.
   This includes new or extended entity/DO/DTO/VO/BO, request/response, configuration, and similar
   model types. Every new enum member and every new declared constant requires the same treatment.
   Describe the semantic meaning and, when relevant, units, format, allowed values, nullability,
   default behavior, or compatibility constraints. A type-level comment does not replace comments
   on its fields or members; do not add low-value comments to ordinary local variables.

## Choose the execution owner

`strategy` defines dependency shape; `workflow_mode` defines assurance depth.

### Fast

- A single low-risk unit may be implemented inline by the main Agent.
- Sequential units may stay inline when they share one small context and have no risky contract.
- Dispatch a sub-agent only for genuine parallelism, specialist context, or context isolation.

### Standard

- A single bounded unit may be implemented inline.
- Dispatch independent parallel units and units with distinct technical context.
- Keep dependent units sequential and pass the completed contract forward.

### Strict

- Dispatch multi-unit or high-risk implementation to sub-agents using {{sub_agent_dispatch}}.
- For a truly indivisible unit, the main Agent may implement only when dispatch adds no
  independence; record why and require independent REVIEW later.
- Process dependency levels in order. Platform spawn rule: {{platform_spawn_instruction}}

The main Agent owns orchestration, conflict resolution, evidence writing, and stage decisions.
Sub-agents never dispatch other sub-agents or read `.easy-coding` workflow assets.

## Task card

```text
# Task Card
## Identity       Easy Coding implementation unit
## Workflow Mode  {fast|standard|strict}
## TDD            {off | on, frozen changed-line threshold N%}
## Task           {unit description}
## Source Spec    {spec_id@revision + sha256 | NONE}
## Source Task    {source_task_id | NONE}
## Repository     {repo_id + resolved repository root | current project}
## Source Steps   {source_step_ids | NONE}
## Symbols        {symbols | confirmed local symbols}
## Editable Scope {unit.files | NONE — read-only}
## Acceptance     {unit.acceptance_criteria}
## Test Points    {unit.test_points and exact targeted commands}
## Contracts      {inputs, outputs, invariants shared with other units}
## Risks          {known edge cases and compatibility risks}
## Code Comments  {resolved host Agent author value; model-field, enum-member, and constant rules}
## Coding Rules   {pre-digested RULES sections}
## Architecture   {pre-digested ABSTRACT sections}
## Output
status:"completed", repo_id|null, source_task_id|null, changed_files[], summary,
deliverable|null, issues:[], needs_attention:[]
```

## Dispatch and result loop

1. Append a `dispatch` record before work begins. Canonical-backed records include `repo_id` and
   `source_task_id`; resolve every file relative to `task.repo_paths[repo_id]` before dispatch.
   Populate `Code Comments` on every code task card with the resolved user-facing host Agent
   author value and the field/member/constant rules above; sub-agents do not read this Skill.
2. Execute according to dependency order and selected owner.
3. Run targeted unit tests and self-audit scope, contracts, TODOs, and introduced warnings.
   Also audit new author attributions and every new model field, enum member, and constant against
   the comment requirements above before recording success.
4. Append one `result` record. Only a successful unit uses `status:"completed"`; include
   unresolved issues rather than hiding them, and do not advance while `issues` or
   `needs_attention` is non-empty.
5. If a result changes a cross-unit contract, stop dependent units and return to ANALYSIS.
6. For parallel units, detect overlapping writes before advancing.
7. If implementation needs a file, symbol, repository, or source step outside the mapped
   Canonical change set, stop and return to ANALYSIS instead of expanding scope implicitly.

Do not emit a progress message for every trivial edit. Report at unit boundaries to reduce
conversation overhead while keeping work observable.

## End state

- Code task: after all units and targeted checks pass, hand control to ec-workflow for
  IMPLEMENT -> REVIEW.
- Read-only task: output the full deliverable, then request or auto-apply IMPLEMENT -> COMPLETE.
- New risk above the frozen mode: call `raise-workflow-mode`; modes may rise but never silently
  fall after ANALYSIS.

## Self-check

- [ ] Every changed file is in scope and keeps its encoding.
- [ ] Every unit has a dispatch/result pair and satisfied its acceptance criteria.
- [ ] Targeted tests ran or a concrete blocker is recorded.
- [ ] Cross-unit contracts still match.
- [ ] New author attributions use the user-facing host `<Current Agent Name> with Easy Coding`.
- [ ] Every new model field, enum member, and constant has a meaningful field-level comment.
- [ ] Code tasks enter REVIEW, regardless of workflow mode.
