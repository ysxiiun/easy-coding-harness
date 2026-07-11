---
name: ec-reviewing
description: REVIEW-stage skill. Use when ec-workflow enters REVIEW. Reviews changed files across correctness, RULES compliance, completeness, tests, and security; returns a graded verdict (accept/fix/replan/blocked) with file-and-line evidence; dispatches multi-dimension sub-agents for every review regardless of change-set size.
---

# ec-reviewing — graded, evidence-backed review

ec-workflow dispatches you when code IMPLEMENT finishes. Read-only `doc` / `analysis` / `report`
tasks auto-complete from IMPLEMENT and never enter REVIEW. You judge the code change set and
return a verdict that drives the next transition. Inputs: the changed files (from
execution.jsonl `result` records), `dev-spec.md`, `.easy-coding/RULES.md`, `test-strategy.md`.

Communicate with the user in the user's language.

## Dimensions (check every one)

1. **Correctness** — does the change satisfy the dev-spec's requirement parse and change
   plan? Edge cases, null/empty handling, off-by-one, async races.
2. **Compliance** — RULES.md: naming, format, comment language, error handling.
3. **Completeness** — is every file in the change-scope table actually handled? No half-done
   units.
4. **Tests** — do [must-test]/[should-test] items have real test cases? Bug fix has a
   regression test?
5. **Security** — obvious risks only: hardcoded secrets, SQL string concatenation, unvalidated
   external input, path traversal.

## Evidence gate

Every finding cites a concrete `file:line`. "Looks good" / "seems fine" is not a review
result. No finding without a location.

## Verdict (exactly one)

- `accept` — all dimensions pass. Request REVIEW -> VERIFICATION.
- `fix` — problems found, fixable within the current plan. Auto-fix via sub-agents (see below).
- `replan` — the plan itself is flawed (wrong approach, missing design). Request REVIEW -> ANALYSIS.
- `blocked` — external blocker (missing dependency, environment). Pause and report.

## Auto-fix flow (on `fix` verdict)

<HARD-GATE>
Bug-level issues (correctness errors, compliance violations, missing edge-case handling)
are fixed DIRECTLY by dispatching fix sub-agents. Do NOT ask the user for permission to
fix bugs. The user confirmed the plan — bugs in that plan's execution are implementation
defects, not design decisions.

ONLY escalate to the user when:
- The fix requires a DESIGN CHOICE (two equally valid approaches, ambiguous requirement)
- The fix would change the public API contract beyond what the dev-spec specifies
- The finding contradicts something the user explicitly confirmed at a stage boundary
</HARD-GATE>

Fix dispatch flow:
1. Collect all `fix`-worthy findings from review sub-agents.
2. Group findings by file. For each group, build a fix task card:
   - Files to fix (from the findings)
   - The specific issues with file:line citations
   - The suggested fix direction from the reviewer
   - Relevant RULES sections
3. Dispatch fix sub-agents (ec-fixer, one per file group) via {{sub_agent_dispatch}}.
   Platform spawn rule: {{platform_spawn_instruction}}
4. On return: merge results, append `result` records to execution.jsonl.
5. Re-enter REVIEW (counts toward the fix-loop ceiling of 3).

## Fix-loop ceiling

Maximum 3 fix rounds. A 4th would mean the approach is wrong → auto-escalate to `replan`.

## Sub-agent dispatch (ALWAYS)

<HARD-GATE>
REVIEW ALWAYS USES SUB-AGENTS regardless of the number of changed files. This prevents
context pollution in the main agent's window. You MUST NOT review code inline — dispatch
sub-agents for every review.
</HARD-GATE>

Dispatch two parallel review sub-agents:
- R1: correctness — does the implementation match the dev-spec requirement?
- R2: compliance — does the code obey RULES?

Each sub-agent returns `{dimension, findings[], severity, suggestion}`. The MAIN agent
merges and dedups findings and decides the verdict — sub-agents cannot trigger stage
transitions.

Platform spawn rule: {{platform_spawn_instruction}}

## Output

Append `review` records to execution.jsonl, one per dimension:
`{"type":"review","dimension":"correctness","findings":[{"file":"...","line":42,"issue":"...","severity":"warn"}]}`.
Then state the verdict and hand back to ec-workflow.
For `accept` or `replan`, ec-workflow records the corresponding pending transition and presents
the standard confirmation/handoff/Other gate. A `fix` round stays inside REVIEW and therefore
does not create a status transition unless the outcome changes.
