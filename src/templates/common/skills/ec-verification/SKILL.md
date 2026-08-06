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

`check_type` is one of `lint`, `typecheck`, `test`, or `build`. In `strict`, append current
evidence for all four types. When a type genuinely does not apply, record `applicable: false`
and a non-empty `not_applicable_reason`; it does not count as the required applicable executed
check, and must not be represented by an invented successful command.

Record failures in `failures[]`. If any current-fingerprint record fails, return to IMPLEMENT;
do not append a later synthetic pass without rerunning the failed command.

## Coverage and acceptance

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
