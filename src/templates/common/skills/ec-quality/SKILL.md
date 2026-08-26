---
name: ec-quality
description: QUALITY-stage skill. Freezes one candidate, runs independent Review and Verification gates at the selected workflow depth, and aggregates one repair decision.
---

# ec-quality — one candidate, two read-only gates

Use only while the current task is in `QUALITY`. Communicate in the user's language. QUALITY
does not modify source, tests, configuration, plans, or task scope.

## Candidate freeze

Call `evidence-fingerprints` once and use the returned implementation/config fingerprints for
the whole attempt. It also returns the runtime-owned `quality_attempt` number, start time, evidence
boundary, and repair count. Every Review and Verification record in this attempt must carry that
same candidate fingerprint and `quality_attempt` number. If the candidate changes, return to
IMPLEMENT; the state API finalizes the old attempt as `cancelled` before the transition. Never mix
evidence from two candidates.

`execution.jsonl` is append-only. Do not write `type:"quality"` yourself. The state API appends
exactly one fingerprint-bound finalized record when QUALITY passes, leaves for repair/replan, or is
cancelled by candidate drift, rework, or task closure. Retries reuse that record instead of
duplicating it. An incomplete, duplicate, or out-of-sequence quality record blocks the transition.

Review Gate and Verification Gate are independent and may run in parallel. Review never executes
commands. Verification never edits files. If a hard blocker makes remaining work meaningless,
cancel the other checks explicitly and record the cancellation; do not start repair while a gate
is still running or unacknowledged.

## Workflow depth

### Fast

- Main Agent performs one focused self-review of the exact diff, contract, local style, Javadoc,
  and minimum-change boundary.
- Run the smallest deterministic targeted verification that can prove the changed behavior.
- Do not dispatch an independent reviewer unless a concrete risk appears.

### Standard

- Dispatch one independent reviewer.
- Run affected lint/typecheck/test plus every must-test command from `test-strategy.md`.
- Run Review and Verification in parallel when their inputs are already frozen.

### Strict

- Dispatch at least two independent review dimensions, normally correctness and compliance.
- For each actually modified repository, run all applicable lint, typecheck, test, and build
  checks. A repository merely mentioned by a Spec, dependency, supermodule, or path map is not in
  scope.
- When frozen TDD is enabled, include the required TDD review dimension, local unit test, and
  changed-production-line coverage. Record one coverage result with `coverage_scope:"local"`;
  GitLab coverage is informative, not a task acceptance gate. Reuse current-fingerprint GREEN
  evidence from IMPLEMENT instead of rerunning an identical command.

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

Run only the commands selected by the mode and `test-strategy.md`. Record real exit status and
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
terminal, finalize the decision before transitioning once to IMPLEMENT:

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
Only after every blocked writeback is acknowledged may the task return to IMPLEMENT; the state API
rejects a writeback from another run, attempt, fingerprint, or evidence window. Entering IMPLEMENT
reopens only those blocked source tasks as a new `in_progress` attempt, while unaffected implemented
tasks keep their shared conclusion.

After repair, choose the minimum honest evidence refresh:

- comment/format-only: carry semantic review; rerun affected lint;
- test-only: review the test delta; rerun the affected test;
- localized business code: delta review plus impacted tests;
- contract/config/plan/shared behavior: rerun all applicable gates for the affected scope.

When uncertain, rerun rather than infer. On the next attempt, the state API emits an append-only
`quality-carry-forward` record only for Canonical repositories whose plan and repository content
fingerprints are unchanged and whose sources are not hard/contract downstream of a changed source;
it references the exact passed evidence indices from the consumed repair attempt. Never copy or
relabel old evidence yourself. Strict may consume that state-owned record for independent,
unaffected repositories, but must rerun every affected or dependency-invalidated repository gate.

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
