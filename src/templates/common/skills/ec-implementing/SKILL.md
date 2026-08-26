---
name: ec-implementing
description: IMPLEMENT-stage skill. Executes the confirmed plan with workflow-mode-aware orchestration, strict scope control, minimal diffs, and structured execution evidence.
---

# ec-implementing — execute the confirmed plan

Use only after ANALYSIS has frozen `task.json.workflow_mode` to `fast`, `standard`, or
`strict`. Read `dev-spec.md`, the latest `plan` record in `execution.jsonl`, relevant RULES
and ABSTRACT sections, and `test-strategy.md` for code tasks.

If frozen `task.tdd_enabled` is not `true`, IMPLEMENT writes production and planned test code but
does not run lint, typecheck, test, build, or coverage commands. Deterministic execution belongs
to QUALITY's Verification Gate. TDD is the only exception because RED/GREEN/REFACTOR commands are
part of the implementation method; current-fingerprint green evidence may be reused by QUALITY.

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
4. Do not execute quality commands in non-TDD IMPLEMENT. Preserve exact commands and test points
   for the Verification Gate instead of duplicating them here.
5. Append `dispatch` and `result` records for every unit, including main-agent execution.
   Main-agent execution uses `reason:"main-inline:<workflow_mode>"`.
6. Every Harness task transitions from IMPLEMENT to QUALITY.
7. When a project template, local convention, or new source header uses author attribution, the
   author value must be `<Current Agent Name> with Easy Coding`, for example
   `Codex with Easy Coding`. `Current Agent Name` means the user-facing host Agent (for example,
   Codex, Claude, or Qoder), never an implementation sub-agent role such as `ec-implementer`.
   This value is display attribution only: never pass it to the workflow state API's `--agent`,
   which accepts only `claude-code`, `codex`, or `qoder`. Never copy a previous human or Agent name
   into newly authored code.
8. Every newly added field in a data-bearing model must have a meaningful field-level comment.
   This includes new or extended entity/DO/DTO/VO/BO, request/response, configuration, and similar
   model types. Document enum members and stable domain constants when the local style or
   non-obvious semantics require it; do not extract a literal merely to create a documented name.
   Describe the semantic meaning and, when relevant, units, format, allowed values, nullability,
   default behavior, or compatibility constraints. A type-level comment does not replace comments
   on its fields or members; do not add low-value comments to ordinary local variables.
9. Treat the task card's `Local Baseline` as the default implementation shape. Match the nearest
    comparable code's naming, control flow, null/empty and error handling, layering, object model,
    and extraction granularity unless correctness, security, an explicit requirement, or a hard
    project rule requires a deviation. Do not add defensive null checks solely because they are a
    generic best practice when the evidenced local contract intentionally omits them.
10. Implement the smallest coherent design. Do not add speculative abstractions, wrappers,
    factories, layers, or extension points, and do not fragment one readable flow into many
    single-use micro-methods. Extract code only for a clear semantic boundary, real reuse,
    independent testability, or a material reduction in complexity.
11. Literals and magic values are allowed when they are obvious, local, and consistent with the
    surrounding code. Introduce a constant for repeated use, stable domain/config/protocol
    semantics, or an established project convention—not merely to hold the single return value of
    a getter.
12. In a newly added core Java class, every method and field requires meaningful Javadoc. In an
    existing core Java class, every added or materially modified method and field requires it.
    An implementation method may omit its own Javadoc when the interface method it implements has
    meaningful, accurate, accessible Javadoc and the implementation adds no implementation-specific
    contract, constraint, side effect, or other behavior beyond that documented interface method's
    contract. Do not add an empty `{@inheritDoc}` block solely to satisfy this normal rule. Add
    implementation Javadoc for any implementation-specific behavior or when an explicit project
    hard rule requires it. A generic project rule requiring Javadoc on every core Java method
    does not by itself override the
    documented interface method exception. Only an explicit project rule requiring implementation
    methods to repeat interface Javadoc does.
    Add focused inline comments to core or complex logic to explain intent, constraints, or
    non-obvious tradeoffs. Do not mass-retrofit untouched legacy code, and for non-Java code
    follow the language's doc-comment form plus the evidenced project convention. Java Javadoc
    must use a multiline `/** ... */` block; use `//` for an ordinary one-line logic note.
13. Apply the minimum-change rule to existing files. Do not reformat, rename, comment, reorder
    imports, or refactor unrelated code. Revert formatter spillover outside the required diff;
    report unrelated defects instead of fixing them without an approved scope change.
14. Use one blank line between coherent logic sections. Do not create noisy blank-line gaps or
    compress unrelated steps into an unreadable block.

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
  independence; record why and require independent Review Gate evidence in QUALITY.
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
## Editable Scope {unit.files}
## Acceptance     {unit.acceptance_criteria}
## Test Points    {unit.test_points and exact targeted commands}
## Contracts      {inputs, outputs, invariants shared with other units}
## Risks          {known edge cases and compatibility risks}
## Local Baseline {nearest comparable code conventions and evidence paths}
## Code Comments  {resolved host Agent author value; model-field, enum-member, and constant rules}
## Coding Rules   {pre-digested RULES sections}
## Architecture   {pre-digested ABSTRACT sections}
## Output
status:"completed", repo_id|null, source_task_id|null, changed_files[], summary,
checks:[], issues:[], needs_attention:[]
```

## Dispatch and result loop

1. Append a `dispatch` record before work begins. Canonical-backed records include `repo_id` and
   `source_task_id`; resolve every file relative to `task.repo_paths[repo_id]` before dispatch.
   Before dispatching a selected task that is not already `in_progress`, call
   `writeback-spec-task --status in_progress` with a key stable for that dispatch/recovery
   attempt but distinct from any earlier accepted `in_progress` event. Do this only after its
   hard/contract dependencies are ready; do not batch-start dependent tasks at the initial
   IMPLEMENT boundary.
   Populate `Code Comments` on every code task card with the resolved user-facing host Agent
   author value, the field/member/constant rules, and the core Java Javadoc rule above, including
   its documented-interface exception. Populate `Local Baseline` from the Unit's analyzed
   evidence; sub-agents do not read this Skill.
2. Execute according to dependency order and selected owner.
3. For non-TDD work, do not run tests; self-audit scope, contracts, TODOs, and introduced warnings.
   For TDD, run only the lifecycle commands required by RED/GREEN/REFACTOR. Also audit new author
   attributions and every new model field against
   the comment requirements above, then check local-style deviations, unnecessary abstractions,
   one-use constant extraction, and affected core Java Javadoc before recording success.
4. Append one `result` record. Only a successful unit uses `status:"completed"`; include
   unresolved issues rather than hiding them, and do not advance while `issues` or
   `needs_attention` is non-empty.
   For Canonical-backed success, write each owned source Step `completed` through
   `writeback-spec-step`, with implementation evidence and a stable key. Canonical Test evidence
   is written by QUALITY after deterministic verification, not fabricated during implementation.
   After every source Step for that task is complete, write the task `implemented`. On failure,
   write the affected Step `failed`; the shared writer moves its task to `blocked`. Local evidence
   is appended first, shared projection second, and the returned acknowledgment last.
5. If a result changes a cross-unit contract, stop dependent units and return to ANALYSIS.
6. For parallel units, detect overlapping writes before advancing.
7. If implementation needs a file, symbol, repository, or source step outside the mapped
   Canonical change set, stop and return to ANALYSIS instead of expanding scope implicitly.
8. If a static Canonical change is confirmed, revise the original design by exactly one revision
   and use `sync-spec-design`; never edit the machine-owned execution block. If a writeback was
   interrupted, run `reconcile-spec-execution` with the stored idempotent pending action.
   Reconciliation only consumes dispatch/result evidence created after the current `in_progress`
   acknowledgment; it never opens a new repair attempt or reuses an earlier attempt's result.

Do not emit a progress message for every trivial edit. Report at unit boundaries to reduce
conversation overhead while keeping work observable.

## End state

- After all units are implemented, hand control to ec-workflow for IMPLEMENT -> QUALITY.
- New risk above the frozen mode: call `raise-workflow-mode`; modes may rise but never silently
  fall after ANALYSIS.

## Self-check

- [ ] Every changed file is in scope and keeps its encoding.
- [ ] Every unit has a dispatch/result pair and satisfied its acceptance criteria.
- [ ] Non-TDD quality commands were deferred; required TDD lifecycle commands have real evidence.
- [ ] Cross-unit contracts still match.
- [ ] The implementation follows the evidenced Local Baseline or records a required deviation.
- [ ] No speculative layer, fragmented micro-method set, or single-use getter constant was added.
- [ ] New author attributions use the user-facing host `<Current Agent Name> with Easy Coding`.
- [ ] Every new model field and every non-obvious documented member follows the local comment rule.
- [ ] Every method/field in a new core Java class, and every added or materially modified one in
      an existing core Java class, has Javadoc unless it qualifies for the documented-interface
      implementation exception.
- [ ] The task enters QUALITY, regardless of workflow mode.
