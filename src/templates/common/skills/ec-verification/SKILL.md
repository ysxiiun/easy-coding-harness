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
- Relevant code or config changes invalidate old evidence automatically.
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

For Canonical-backed tasks, run each repository's commands from `task.repo_paths[repo_id]` and
cover every selected task's source test IDs. Report pending integration edges separately from
local green checks. They do not block local implementation evidence, but the state API blocks
`VERIFICATION -> MEMORY` until evidence is recorded with `satisfy-spec-dependency`. Never claim
end-to-end completion while an integration edge remains pending. Every Canonical verify record
includes the owning `repo_id` and `source_task_id`; duplicate check names in different source
tasks remain separate evidence records. In `strict`, every involved repository independently
records all four check types; a repository-specific non-applicable record still needs its reason
and source ownership.

After all current-fingerprint local checks pass for a Canonical source task, call
`writeback-spec-task --status verified`. Include passed `kind:"test"` evidence for every bound
Canonical Test ID plus concise references to local review/build/coverage records. The subsequent
VERIFICATION -> MEMORY application requires every selected shared task to be `verified` or
`completed`; remote CI remains outside this acceptance gate. If writeback is interrupted, run
`reconcile-spec-execution` before requesting the transition.

Record the exact integration edge only after its evidence exists:

```bash
{{PYTHON_CMD}} {{platform_config_dir}}/hooks/easy_coding_state.py satisfy-spec-dependency \
  --task-id <harness-task-id> \
  --source-task <source-spec-task-id> \
  --spec-task <target-spec-task-id> \
  --evidence "<verifiable evidence>" \
  --agent <agent>
```

The state API rejects VERIFICATION -> MEMORY unless all evidence for the current implementation
and config fingerprints is green.
