---
name: ec-quality
description: QUALITY-stage skill. Freezes one candidate, runs independent Review and Verification gates at the selected workflow depth, and aggregates one repair decision.
---

# ec-quality — one candidate, two read-only gates

Use only while the current task is in `QUALITY`. Communicate in the user's language. QUALITY
keeps Review and Verification read-only while permitting approved bounded repairs between checks.
Ordinary fixes stay in QUALITY; changed requirements/contracts or a replaced implementation plan
return to ANALYSIS/IMPLEMENT. Bug severity or line count alone does not decide the route.

## Candidate freeze

For Canonical-backed tasks, load the current session's bound selection through `resume-spec-context`
only when the current session lacks that context or the design changed. Pass that original consumption closure to both gates and compare selected contracts,
changes, Steps and Tests against the candidate. Pending `spec_change` blocks QUALITY acceptance
until the source revision is synchronized. Bounded corrections refresh only their affected Unit
mappings and retain the current stage; substantive expansion returns to ANALYSIS.

Call `evidence-fingerprints` once to obtain the runtime-owned attempt and candidate. The runtime
owns signatures and prior-evidence references. Never calculate historical fingerprints, import
runtime internals to reconstruct old candidates, or ask a reviewer to audit workflow bookkeeping.

Prepare independent checks for the same unchanged candidate in one batch before executing them:

```bash
{{PYTHON_CMD}} {{platform_config_dir}}/hooks/easy_coding_state.py prepare-check \
  --record '[<review/verify JSON with unit_id, dimension or check/check_type/command>, ...]' \
  --agent <agent-id> --session-file <P>
```

For each returned item with `reusable:true`, use its evidence index and skip that check. Run the
remaining checks once, then register their real results in one batch:

```bash
{{PYTHON_CMD}} {{platform_config_dir}}/hooks/easy_coding_state.py record-check \
  --result '[{"prepared_id":"<returned-id>","result":<JSON with passed, exit_code for verification, findings/reviewer for review>}, ...]' \
  --agent <agent-id> --session-file <P>
```

Preparation binds code/test inputs, module dependencies, build files and the actual command.
Batching preserves each check's result and evidence identity. A single check may still use
`--prepared-id` with one result object. Start a new preparation batch after a code change;
never reuse a pre-edit input snapshot for post-edit checks.
Use the analyzed Unit `input_files` closure for additional helpers/fixtures/configuration, and record intentional
environment overrides in the check descriptor. Production-only reviews may declare
`review_scope:"production"`; test review still covers changed test behavior. A result is accepted
only if its inputs remained unchanged. One grouped Maven `-Dtest=A,B` execution covers both source
commands when all other arguments agree. Do not run individual commands and then repeat a combined
clean run. IMPLEMENT results and prior attempts use the same reuse mechanism.

Record failed checks with failure_classes. Review and Verification remain independent; cancel a
meaningless remaining check when a concrete blocker is found. Aggregate the repair once.

## Workflow depth

### Fast

- Main Agent performs one focused self-review of the exact diff, contract, local style, Javadoc,
  and minimum-change boundary.
- Run the smallest deterministic targeted verification that can prove the changed behavior.
- Do not dispatch an independent reviewer unless a concrete risk appears.

### Standard

- Use one independent reviewer. A coordinator who did not author the candidate can provide this
  review after another Agent implemented it; do not launch a duplicate reviewer merely for form.
- Run affected lint/typecheck/test plus every must-test command from `test-strategy.md`.
- Run Review and Verification in parallel when their inputs are already frozen.

### Strict

- Dispatch at least two independent review dimensions, normally correctness and compliance.
- For each actually modified repository, run all applicable lint, typecheck, test, and build
  checks. A repository merely mentioned by a Spec, dependency, supermodule, or path map is not in
  scope.

### Unit test strategy (all depths)

For frozen `unit_test_mode=ut|tdd` at any workflow depth, require passed local unit tests and
changed-production-line coverage at `ut_coverage_threshold`. Run the related tests with coverage
collection once and record both results from that execution (`coverage_scope:"local"`). Reuse
unchanged input-bound evidence from IMPLEMENT or earlier attempts. Only `tdd` adds the TDD review
dimension and lifecycle contract. UT reviews assertions within ordinary review and does not add a
separate review. `none` adds no coverage gate. GitLab results are informative, not acceptance gates.

## Review Gate

Review only the confirmed diff and its direct interactions. Check acceptance behavior, contract
compatibility, security/correctness, test design, nearest local style, required core Java
Javadoc, logical blank-line grouping, and minimum modification.

Do not report missing Javadoc on an implementation method when its interface method has
meaningful, accurate, accessible Javadoc and the implementation adds no implementation-specific
contract, constraint, side effect, or other behavior beyond that documented interface method's
contract. Require implementation Javadoc for implementation-specific behavior or when an explicit
project hard rule requires it.

A generic project rule requiring Javadoc on every core Java method does not by itself override the
documented interface method exception. Only an explicit project rule requiring implementation
methods to repeat interface Javadoc does.

Do not demand defensive null checks, constant extraction, abstractions, method splitting,
comments, formatting, or cleanup solely as generic best practice. Do not report unrelated legacy
issues as task findings. The first review must report the complete in-scope finding set; after a
repair, review only the repair delta and directly affected interactions, without introducing new
unrelated style findings.

Each review record uses the existing `type:"review"` contract and includes the active
`quality_attempt`. `error` is blocking; `warning` is a credible risk; `info` is non-blocking. Fast
self-review still writes a record with reviewer set to the current canonical Agent identity. A
blocking record also carries a `failure_classes` array; do not defer classification to prose.

## Verification Gate

Run only commands selected by the mode and the existing plan/test strategy. Record real exit status and
current implementation/config fingerprints plus the active `quality_attempt` using the existing
`type:"verify"` contract. Do not run a command inside Review Gate, and do not fix a failure inside
Verification Gate. A failed applicable check also carries its structured `failure_classes` array.

Classify an unavailable tool, dependency outage, or other environmental failure as
`environment`. Keep the task in QUALITY and retry that check when possible; environmental retry
does not invalidate a passed Review Gate.

## One repair bundle

Wait for both gates, then aggregate all blocking results once. Classify each item as:

- `code-defect`
- `test-defect`
- `contract-ambiguity`
- `environment`
- `suggestion`

If code or tests need edits, create one concise Repair Bundle containing every in-scope blocking
item, affected files, required verification, and evidence that may be reused. After both Gates are
terminal, finalize the decision, then prepare the bounded repair while remaining in QUALITY:

```bash
{{PYTHON_CMD}} {{platform_config_dir}}/hooks/easy_coding_state.py finalize-quality \
  --outcome repair --review-gate failed --verification-gate cancelled \
  --failure-class code-defect \
  --summary "<aggregated repair decision>" \
  --agent <agent-id> --session-file <P>
```

Use one `--failure-class` per class. A failed Gate requires blocking evidence in the active attempt;
a Gate stopped after another hard blocker must be explicitly `cancelled`. Contract ambiguity has
routing priority: finalize `--outcome replan --failure-class contract-ambiguity`, preserve every
code/test class found in the same attempt, and return once to ANALYSIS. Environment failures are not
finalized as repair or replan: keep the attempt in QUALITY and retry the affected check. Suggestions
do not block.

For a Canonical-backed task, group the bundle by `source_task_id`. Append every failed local
review/verify record first, then write each affected source task `blocked` through
`writeback-spec-task`. For attempt `<A>`, candidate `<F>`, Harness task `<H>`, and source task `<S>`,
use the exact idempotency key `<H>:<S>:<F>:quality-<A>:blocked`. Add one failed evidence object for
each affected Gate kind with ref
`execution.jsonl#quality-attempt=<A>;implementation=<F>;source-task=<S>;kind=review|verify`.
After blocked writeback is acknowledged, start the approved repair. The runtime reopens only those
source tasks with a repair-specific idempotency key, keeping local status QUALITY and unaffected
source progress. Record affected Step/result completion and source `implemented` before completing
the repair. Reuse the existing writer and ledger, never copy a second implementation plan.

Use `begin-correction --file <existing-unit-file> --summary <bundle>` to prepare one `quality_repair`.
In dispatch mode, present this complete bundle once with choices: current Agent, another Agent,
or defer/revise. This human dispatch decision remains under every approval mode; Approve shares
the same decision. The user may explicitly authorize current-Agent execution. Default mode uses
its existing approval policy for local repair, with no handoff inside the stage.

```bash
{{PYTHON_CMD}} {{platform_config_dir}}/hooks/easy_coding_state.py start-quality-repair \
  --repair-id <id> --executor current|other [--confirmed] --agent <agent-id> --session-file <P>
```

Pass `--confirmed` only for a real user decision on this bundle. For other-Agent execution the call
also writes the handoff. The recipient claims the task and directly repairs the approved files;
it must not ask again or return to IMPLEMENT. Bounded code and necessary tests follow the existing
unit test strategy, including TDD lifecycle checks only when TDD is frozen. The recipient finishes:

```bash
{{PYTHON_CMD}} {{platform_config_dir}}/hooks/easy_coding_state.py complete-quality-repair \
  --repair-id <id> --agent <agent-id> --session-file <P>
```

This returns other-Agent repairs to the coordinator for delta review/verification. No quality gate
may pass while the repair is pending. Scope/contract changes must be resolved rather than silently
included in the accepted bundle. Repeated starts/completions reuse the existing repair ID.

Use the same batch prepare/record flow for repair checks. Consume returned state and next-action
fields directly; do not follow a successful state operation with an unchanged `snapshot` or
Spec inspection merely to retrieve fields already returned.

After repair, choose the minimum honest evidence refresh:

- comment/format-only: carry semantic review; rerun affected lint;
- test-only: review the test delta; rerun the affected test;
- localized business code: delta review plus impacted tests;
- contract/config/plan/shared behavior: rerun all applicable gates for the affected scope.

Use the runtime's reusable/changed-input result to decide what remains. Changes to a plan
narrative, stage, approval mode or Spec revision alone do not require test execution. Refresh only
affected evidence, including actual shared dependencies; never restart all Units in the repository.
Passed checks are terminal until their inputs change or a concrete new defect invalidates them.
Suggestions never trigger another review round. No reviewer may demand new defensive checks
without a concrete triggering input and demonstrated failure. Preserve the original error strategy.

## Acceptance boundary

When both gates pass, call:

```bash
{{PYTHON_CMD}} {{platform_config_dir}}/hooks/easy_coding_state.py quality-checkpoint \
  --agent <agent-id> --session-file <P>
```

Request or auto-apply `QUALITY -> MEMORY` according to Approval mode. If the checkpoint detects a
later user edit, call `inspect-transition-drift`, display the exact diff, and honor the user's
decision. An accepted diff may use carry-forward, targeted, or waived verification as recorded by
the state API; do not rerun Review after the user explicitly accepts the displayed change.

Canonical-backed tasks write selected tasks `verified` only when `QUALITY -> MEMORY` is actually
applied. Pending integration evidence blocks that transition before MEMORY begins.
