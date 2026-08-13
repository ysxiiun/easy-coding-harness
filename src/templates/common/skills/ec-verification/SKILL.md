---
name: ec-verification
description: VERIFICATION-stage skill. Runs the minimum sufficient final gate for the frozen workflow mode and binds green evidence to implementation and config fingerprints.
---

# ec-verification — fingerprinted final evidence

Read-only tasks never enter this stage. Obtain fresh fingerprints before running checks:

```bash
{{PYTHON_CMD}} {{platform_config_dir}}/hooks/easy_coding_state.py evidence-fingerprints --agent <agent-id> --session-file <P>
```

## Iron laws

- No completion claim without executed verification evidence.
- Evidence is reusable only while both returned fingerprints remain unchanged.
- Relevant code or config changes invalidate old evidence automatically unless the exact
  post-verification code diff is explicitly accepted under the checkpoint protocol below.
- Failed or missing evidence never becomes acceptance because of approval mode.

## Verification depth

- `fast`: run the smallest command(s) that directly cover changed behavior plus required
  regression tests.
- `standard`: run impacted lint/typecheck/test scopes and every must-test item.
- `strict`: run the project's full applicable lint, typecheck, test, and build gates.

These rules remain unchanged when frozen TDD is off: do not discover JaCoCo reports, run the
coverage tool, inspect GitLab, or add a coverage record. The explicit `type=tdd-init` task is an
infrastructure exception: run its planned build/CI syntax checks and readiness tool, but do not
measure repository-wide coverage or append TDD coverage evidence for unchanged production code.

When frozen TDD is on, first run the planned local Java unit command and generate JaCoCo XML,
then run the deterministic local acceptance gate:

```bash
python3 .easy-coding/tools/easy_coding_java_coverage.py check \
  --base <task.tdd_baselines[repo-id-or-project]> \
  --threshold <task.tdd_coverage_threshold> [--report <jacoco.xml>]...
```

The tool measures covered added/modified production Java executable lines only. Deleted,
comment, blank, import, and test-source lines are excluded by diff/JaCoCo intersection. Missing
or ambiguous source files and reports older than their modified source fail; zero modified
executable lines is explicit N/A. Always regenerate JaCoCo XML after the final source change.
Never substitute `HEAD`, a mutable ref, project defaults, or current session settings for the
task-frozen baseline SHA and threshold. `ec-tdd-init` still generates a GitLab job that can run
the same tool, but remote pipeline execution and status are outside Harness acceptance. Never
request an intermediate commit or push merely to obtain CI evidence.

The main Agent may run commands inline. Dispatch verifier sub-agents only when checks are
independent and parallel execution materially saves time or isolates specialist environments.
Platform spawn rule: {{platform_spawn_instruction}}

## Evidence

Append one record per executed check:

```json
{
  "type": "verify",
  "check": "test",
  "check_type": "test",
  "command": "npm test",
  "passed": true,
  "implementation_fingerprint": "<state-api value>",
  "config_fingerprint": "<state-api value>",
  "timestamp": "<ISO-8601>",
  "repo_id": "<canonical repo-id; omit for non-Canonical tasks>",
  "source_task_id": "<canonical task-id; omit for non-Canonical tasks>"
}
```

`check_type` is one of `lint`, `typecheck`, `test`, `build`, or (TDD only) `coverage`. In `strict`, append current
evidence for all four types. When a type genuinely does not apply, record `applicable: false`
and a non-empty `not_applicable_reason`; it does not count as the required applicable executed
check, and must not be represented by an invented successful command.

Record failures in `failures[]`. If any current-fingerprint record fails, return to IMPLEMENT;
do not append a later synthetic pass without rerunning the failed command. For a Canonical-backed
failure, append the local verify record first, then write the owning source task `blocked` with a
concise reference to that record. The repair transition automatically reopens blocked source tasks
only; unaffected implemented tasks retain their latest shared conclusion.

## Coverage and acceptance

For TDD coverage, copy the tool output into `coverage`: `baseline_sha`, `covered_lines`,
`total_lines`, `percentage`, frozen `threshold`, `report_paths`, and `report_sha256`. Set
`applicable:false` plus the tool's reason only for zero executable modified lines. A percentage
below the frozen threshold fails even when ordinary tests pass.

Append one coverage record with `coverage_scope:"local"` per repository (and per Canonical
source task). The state gate also requires a passed local `check_type:"test"` record for the same
owner. The coverage record preserves the task-frozen baseline and threshold. Do not append or
wait for GitLab pipeline evidence; historical remote coverage records are ignored by acceptance
without modifying or deleting the stored records.

For `type=tdd-init`, the infrastructure receipt must already have been recorded during IMPLEMENT
and reviewed with the rest of the implementation. Run only `easy_coding_tdd_readiness.py check`
here. If it reports drift, return to IMPLEMENT to refresh the receipt and repeat REVIEW; never
rewrite it inside VERIFICATION. The state gate requires `ready` before MEMORY. This does not
enable TDD; report the explicit `ec-config`/`easy-coding config` next step.

- Every must-test item has an executed check.
- Bug fixes include a regression test when project infrastructure exists.
- Present changed scope, commands, results, and unverified items.
- `approve` and `guard` request VERIFICATION -> MEMORY after acceptance.
- `confirm` and `auto` advance after the green gate without introducing another mandatory
  user wait.
- A reported in-scope problem returns to IMPLEMENT; out-of-scope work becomes a separate task.

After the final green evidence is recorded, freeze the acceptance baseline before presenting the
result or applying the boundary:

```bash
{{PYTHON_CMD}} {{platform_config_dir}}/hooks/easy_coding_state.py verification-checkpoint \
  --agent <agent-id> --session-file <P>
```

Then request or auto-apply VERIFICATION -> MEMORY according to `approval_mode`. `auto` remains
automatic when the checkpoint is unchanged. If any in-scope code changed after the checkpoint,
the state API returns `action:"acceptance-drift"`, keeps the task in VERIFICATION, and includes
the exact unified patches or binary/mode-change descriptions plus a stable `diff_sha256`. This
exceptional drift pauses every approval mode, including `auto`; it does not permanently change
the configured mode.

Show the complete returned diff and ask whether to accept that exact digest. Do not re-enter
IMPLEMENT or rerun REVIEW merely because this drift exists. On acceptance, call
`confirm-transition --stage MEMORY --diff-sha256 <digest>` with exactly one policy:

- `carry-forward`: only when every changed hunk is confidently non-executable and existing
  verification remains applicable;
- `targeted`: executable behavior changed; append passed current-fingerprint targeted verification
  before confirming. Canonical tasks must cover every affected source task reported by the
  acceptance record, without rerunning checks for unaffected source tasks;
- `waived`: the user explicitly accepts the stated unverified risk.

Include `--decision-summary` with the user's decision. A changed digest invalidates the pending
confirmation and must be shown again. Behavior config, execution plan, workflow, Canonical
design, or nested-repository metadata drift cannot use this shortcut; return to ANALYSIS or
IMPLEMENT as reported by the state API. The acceptance record bridges only the accepted
implementation fingerprints, so prior REVIEW evidence remains valid without a second REVIEW.

For Canonical-backed tasks, run each repository's commands from `task.repo_paths[repo_id]` and
cover every selected task's source test IDs. Report pending integration edges separately from
local green checks. They do not block local implementation evidence, but the state API blocks
`VERIFICATION -> MEMORY` until evidence is recorded with `satisfy-spec-dependency`. Never claim
end-to-end completion while an integration edge remains pending. Every Canonical verify record
includes the owning `repo_id` and `source_task_id`; duplicate check names in different source
tasks remain separate evidence records. In `strict`, every involved repository independently
records all four check types; a repository-specific non-applicable record still needs its reason
and source ownership.

After implementation and local checks, each selected Canonical source task remains
`implemented`. Do not call `writeback-spec-task --status verified` from VERIFICATION. Applying
VERIFICATION -> MEMORY is the authoritative acceptance boundary: the state API writes each
still-implemented source task to `verified` through CAS/idempotent recoverable events with its
accepted test evidence and acceptance digest, then enters MEMORY only after every write is
confirmed. For `approve`/`guard`, that authority is the explicit boundary
confirmation; for `confirm`/`auto`, it is the standing approval-mode authorization when no new
drift exists. If writeback is interrupted, run `reconcile-spec-execution` before retrying the
transition. Remote CI remains outside this acceptance gate.

Record the exact integration edge only after its evidence exists:

```bash
{{PYTHON_CMD}} {{platform_config_dir}}/hooks/easy_coding_state.py satisfy-spec-dependency \
  --task-id <harness-task-id> \
  --source-task <source-spec-task-id> \
  --spec-task <target-spec-task-id> \
  --evidence "<verifiable evidence>" \
  --agent <agent>
```

The state API rejects VERIFICATION -> MEMORY unless all effective evidence is green and the
checkpoint is either unchanged or bound to an exact accepted diff.
