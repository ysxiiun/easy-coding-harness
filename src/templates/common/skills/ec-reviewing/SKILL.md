---
name: ec-reviewing
description: REVIEW-stage skill. Performs workflow-mode-aware review against the final implementation fingerprint, blocks only actionable acceptance risks, and records reusable evidence.
---

# ec-reviewing — proportional but mandatory review

Every new code task enters REVIEW. Read-only tasks do not. Obtain the current fingerprints:

```bash
{{PYTHON_CMD}} {{platform_config_dir}}/hooks/easy_coding_state.py evidence-fingerprints --agent <agent-id> --session-file <P>
```

Review the final diff against `dev-spec.md`, RULES, unit acceptance criteria, tests, contracts,
and obvious security risks. Every finding cites `file:line`.

For Canonical-backed tasks, group evidence by `repo_id` and `source_task_id`. Every selected
Spec task needs an implementation result and source test evidence; file references remain
repo-relative within the owning repository. Missing or expanded source change/step coverage is
a blocking correctness finding. Every Canonical review record includes its `repo_id` and
`source_task_id`; emit at least one current-fingerprint record per selected task and required
review dimension. A global record without source ownership cannot satisfy the gate.

When frozen TDD is enabled, add a passed review dimension named exactly `tdd` for each source
task. Review whether RED/GREEN/REFACTOR (or characterization GREEN for pure refactors) is genuine,
tests exercise changed behavior and boundaries, mocks do not merely mirror implementation, and
the local/CI changed-line coverage gates share the frozen threshold. When TDD is off, do not add
this dimension or raise the ordinary review depth.

## Depth by workflow mode

- `fast`: main Agent performs one final-diff self-review across correctness, scope, tests, and
  obvious security risks.
- `standard`: dispatch one independent focused reviewer covering correctness, contract
  completeness, tests, and compliance.
- `strict`: dispatch at least two independent dimensions (correctness/contracts and
  compliance/tests/security) in parallel via {{sub_agent_dispatch}}.

Platform spawn rule: {{platform_spawn_instruction}}

Reducing reviewer count must not reduce checked dimensions; it only combines them into fewer
passes when the change is low risk.

## Severity and verdict

- `error`: demonstrably breaks an acceptance criterion, contract, security boundary, or build.
  Blocks transition.
- `warning`: credible risk. Blocks only when it can affect a confirmed acceptance criterion.
- `info`: maintainability suggestion or optional improvement. Never blocks the current task.

Verdict:

- `accept`: no blocking finding.
- `fix`: in-scope implementation defect.
- `replan`: design/scope/contract is wrong.
- `blocked`: missing external input or environment.

## Fix loop

1. Merge findings by semantic unit, not by file or reviewer.
2. Prefer returning the bundle to the original implementation context.
3. Run targeted checks for the affected unit, then re-review only the affected dimensions.
4. Expand to full review only if the fix changes scope, public contracts, or shared behavior.
5. If the same issue class survives two consecutive rounds, stop blind repair and return
   `replan` or `blocked` with evidence.

In-scope defects are fixed automatically. Ask the user only for a new design choice, changed
public contract, or contradiction with a confirmed decision.

## Evidence record

Append one final record per executed dimension for the current implementation fingerprint.
Fast and Standard normally use `combined`; Strict uses at least two distinct dimension names:

```json
{
  "type": "review",
  "dimension": "correctness-contracts",
  "passed": true,
  "reviewer": "main-or-independent-agent",
  "implementation_fingerprint": "<state-api value>",
  "timestamp": "<ISO-8601>",
  "repo_id": "<canonical repo-id; omit for non-Canonical tasks>",
  "source_task_id": "<canonical task-id; omit for non-Canonical tasks>",
  "findings": []
}
```

The state API rejects REVIEW -> VERIFICATION when any latest dimension evidence is missing,
stale, failed, or contains an `error`. Strict also requires at least two passed dimensions. A
code change after review produces a new fingerprint and invalidates all prior dimensions.
