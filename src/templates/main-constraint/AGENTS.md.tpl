<!-- ═══ easy-coding-harness generated (DO NOT EDIT BETWEEN MARKERS) ═══ -->

## Easy Coding Harness

This project is managed by easy-coding-harness. Coding work runs through the `ec-*` skills,
which enforce a staged workflow with hard confirmation and verification gates. Reply to the
user in the user's language.

## Status line

Start every work reply with the single Markdown blockquote status line injected by the hook,
then a blank line. Do not render the machine breadcrumbs to the user.

`{approval-mode}` is the effective approval mode and `{workflow-mode}` is the configured or
task-frozen execution mode; behavior settings resolve per field: session > optional local ~/.easy-coding/config.yaml > project > defaults.
When effective/frozen unit_test_mode is `ut` or `tdd`, insert `· **UT**` or `· **TDD**`
immediately after Workflow. For `none`, omit this segment and preserve the status-line format.

- Ready: > **Easy Coding** · **Approval: {approval-mode}** · **Workflow: {workflow-mode}** · Ready · Use `ec-workflow` to start or resume a task, `ec-brainstorming` to brainstorm, `ec-task-management` to manage tasks, or `ec-config` to inspect or change modes
- Waiting init: > **Easy Coding** · **Approval: {approval-mode}** · **Workflow: {workflow-mode}** · Waiting init · Use `ec-init` to initialize
- Active task: > **Easy Coding** · **Approval: {approval-mode}** · **Workflow: {workflow-mode}** · `{current-task}` · `{workflow-state}`
- Handoff: > **Easy Coding** · **Approval: {approval-mode}** · **Workflow: {workflow-mode}** · `{current-task}` · `{workflow-state}` · Handoff -> `{source-agent}`
- Lite: > **Easy Coding** · **Lite Direct** · `{Ready|Awaiting Confirmation}` · No Task / Quality / Memory · Use `ec-lite` to exit

Skill names in the status line are bare names (`ec-init`, `ec-workflow`) and never include
platform prefixes such as `/` or `$`. If no status line is injected, do not invent one.

## Skills

Trigger Easy Coding skills with your platform prefix — Codex: `$ec-*`, Qoder: `/ec-*`.

- `ec-init` — one-time project knowledge init (run once after install)
- `ec-workflow` — daily entrypoint: the workflow state machine and task resume
- `ec-brainstorming` — design exploration before building (hard design gate)
- `ec-analysis` `ec-implementing` `ec-quality` — workflow stages
- `ec-memory` — short/long memory archive
- `ec-task-management` — task lifecycle panel · `ec-config` — Approval/Workflow/unit-test settings · `ec-tdd-init` — Java changed-line gate initialization · `ec-task-close` — interrupt a task
- `ec-no-harness` — bypass only Easy Coding for the current session
- `ec-lite` — user-controlled direct mode with one proposal confirmation and no task/QUALITY/MEMORY
- `ec-git` — git discipline · `ec-meta` — understand/customize the harness

First run `ec-init`; daily work goes through `ec-workflow`.

## Workflow discipline

- Approval mode is session override > local ~/.easy-coding/config.yaml > project `behavior.approval_mode` > `guard`; workflow mode
  is the mechanical minimum for the current actual change. Approval controls waiting;
  workflow controls execution depth. Do not recommend or inflate the calculated mode.
  Confirm approval waits only at ANALYSIS -> IMPLEMENT, then advances green later stages
  automatically; Auto advances all legal green edges. Dispatch retains the explicit scope/executor
  decision, merged with any required approval. A new code diff after the QUALITY
  checkpoint also pauses across all modes: show the exact diff, bind acceptance
  to its digest, and continue without rereview when the user accepts.
  Every mutation task runs QUALITY; no mode changes scope, delivery form, or evidence gates.
- Unit test strategy is session override > local ~/.easy-coding/config.yaml > project `behavior.unit_test_mode` > `none`.
  Values are `none`, `ut`, and `tdd`; both enabled strategies share `ut_coverage_threshold`
  (session > local > project > 90, integer 1..100). ANALYSIS -> IMPLEMENT freezes strategy, threshold,
  and repository baselines. `none` adds no coverage work and retains ordinary task verification.
  UT requires passed local unit tests and changed-production-line coverage, without test-first
  ordering, RED/GREEN artifacts, or a separate TDD review. TDD additionally requires its lifecycle
  and review dimension. Assertions remain part of ordinary review in UT.
  Both currently support Java and reuse `ec-tdd-init` readiness, JaCoCo, and existing evidence
  reuse. One test execution supplies tests plus coverage. No new stages or workflow escalation.
  The dedicated `tdd-init` task freezes strategy `none`; readiness failure reports repair rather
  than resetting configuration. CLI upgrades migrate old fields and preserve frozen task progress.
  GitLab automation is infrastructure, not remote acceptance evidence.
- Confirmation-required edges use `pending_transition`; automatic edges use the restricted
  `auto-transition` API. Pure read-only conversation stays Ready and creates no task. Any
  repository write, including documentation or configuration, uses the full state machine.
- A confirmation-required boundary is not fully presented until the user can choose its complete
  business branches. When a native user-choice tool is available, invoke it in the same turn with
  the complete gate. An ordinary gate offers "confirm entering/returning to the target stage"
  (recommended) and "hand off to another agent", with free-form Other for revisions. The special
  IMPLEMENT gate must preserve enter QUALITY and handoff, with free-form Other. Use a native
  choice without a text pre-fallback only when the tool
  explicitly guarantees an indefinite wait; disable or omit automatic timeout/resolution in that
  case. Otherwise pre-render the matching numbered fallback before invoking native choice once,
  so timeout cannot remove the user's path forward. Empty, dismissed, timed-out, or unparseable
  native results preserve the pending edge; never retry native choice in that turn. On resume,
  consume a matching
  numbered reply against the stored edge before re-presenting the gate. Never degrade to only
  "reply confirm". Text shown before a later tool call is non-durable because the
  host may group or collapse it. For ANALYSIS -> IMPLEMENT, the last assistant response after a
  native choice or transition call must repeat a compact core-solution, acceptance, workflow,
  and risk receipt plus the full Dev-Spec link/path, even if already visible. Repeat the complete
  fallback while the edge is pending; after confirmation, identify the accepted branch and target
  stage. Auto adds no pause and carries the Dev-Spec link/path into the next durable final response.
- When `[easy-coding:no-harness]` is injected, do not emit an Easy Coding status line and ignore
  only Easy Coding workflow/stage orchestration for this session. Continue honoring every
  non-Easy-Coding skill, hook, and instruction. Do not clear or mutate the suspended task.
- When `[easy-coding:lite-direct]` is injected, use only `ec-lite`. Lite is enabled or disabled
  solely by explicit user invocation, creates no task or evidence artifacts, and requires one
  confirmed compact proposal before each mutation. With an active task, present cancel startup,
  close-and-start, and clear-pointer-and-start; never choose for the user.
- ANALYSIS must follow template-first: read `.easy-coding/templates/dev-spec-skeleton.md` then
  write its exact content to the task's dev-spec.md as the FIRST tool calls. Next inspect evidence,
  set `decision_status: open`, ask every unresolved material decision, and progressively record
  each confirmed answer and its evidence in `### 决策闭环`. Only after all material decisions are
  resolved may the agent set the single `decision_status: closed`, finalize the artifacts, and
  propose IMPLEMENT. The session presentation is a concise core-solution, acceptance, workflow,
  and risk receipt with an absolute local link/path to the full dev-spec.md; repeat that durable
  receipt after a later native choice or transition call instead of relying on collapsible process
  text; never paste the full artifact by default. The final artifact contains neither
  `[阶段：ANALYSIS]` nor a `待用户决策` section.
- QUALITY contains fingerprinted Review and Verification Gates. Review evidence must match the final
  implementation; verification evidence must match final implementation and config. The frozen
  workflow mode selects targeted, impacted, or full commands without weakening the green gate.
  Freeze a quality checkpoint after green checks. Unchanged checkpoints follow approval
  mode normally; post-checkpoint code drift requires exact digest acceptance and
  carry-forward/targeted/waived verification policy, but never an automatic second Review Gate.
- Canonical-backed tasks bind static validity to design revision + `design_sha256`, while
  `document_sha256` and `execution_revision` may advance through shared writer commands. Project-
  external explicit Spec paths are allowed and may be repaired only with identity-checked rebind.
  Runtime progress must use the shared writer with CAS/idempotency and reconciliation; static
  confirmed design changes first use `begin-spec-change`, then revision + READY + `sync-spec-design`.
  Creation/claim returns selected source context; session resume and design sync require
  `resume-spec-context` only when current-session context is missing or design changed; otherwise reuse it. Pending changes block implementation/acceptance across agents.
  Preserve the original writer actor while retaining the current owner during reconciliation.
  Never hand-edit `EDS:EXECUTION`.
  Selected source tasks remain `implemented` through local QUALITY and become `verified`
  only when the accepted QUALITY -> MEMORY boundary is actually applied.
- Canonical routing is two-pass: first use manifest-only discovery for the current worktree, then
  inspect only the explicitly selected task IDs and repositories. A remote-confirmed worktree
  overrides a stale `path_hint`; never mirror the source Spec or re-check unselected repositories.
  ANALYSIS reads the selected consumption closure once and treats exact/scope-unchanged as a fast
  projection, while shared execution is the dependency fact source.
- MEMORY combines short-memory creation and the conditional long-memory gate. Entry follows the
  effective confirmation mode. Record reusable development knowledge and source references;
  acceptance digests and process evidence stay in task records. Do not add reports or repeated
  checks for memory. Once memory processing completes, COMPLETE is automatic.
- NO CODE-TASK COMPLETION CLAIMS WITHOUT FRESH VERIFICATION EVIDENCE.
- All cross-platform modules (skills, hooks, references) must use universal agent protocols.
  Do not rely on any specific agent's proprietary conventions unless the module is explicitly
  a platform-specific compatibility layer. Reference files use descriptive filenames (e.g.,
  `memory-migration.md`), not platform convention names.

## Runtime contract

- Workflow state operations use the script installed for the active host: Codex uses
  `.codex/hooks/easy_coding_state.py`, while Qoder uses its installed `.qoder/hooks/easy_coding_state.py`
  or `.qodercn/hooks/easy_coding_state.py` variant.
  Never substitute one platform's script for the other, and pass only the canonical owner ID
  (`codex` or `qoder`) to `--agent`; display attribution such as `Codex with Easy Coding` is not
  a workflow identity. The installed script's embedded platform identity, canonical owner, and
  injected session namespace must agree. Do not hand-edit session files, `current_task`, task
  `status`, `stage_history`,
  `pending_transition`, `quality_checkpoint`, `lite_mode`, `lite_proposal`, workflow/TDD proposal or freeze fields,
  `memory_progress`, or `last_agent`.
- The hook injects `[easy-coding:session-file:P]`; pass that path to the state script with
  `--session-file <P>` when changing the current task or stage.
- Workflow session files live at `{{workflow_state_path}}`; the CLI only installs files and
  creates the project-init task — agent skills perform all project analysis.
- Cross-repo references in git-tracked task artifacts use repo NAMES, never local paths.
  Cache local paths only through the state script so they land on the current task.
- Shared Canonical writeback is a stage gate but not proof of Git commit/push, and Git delivery is
  not proof of writeback. Keep those facts and scopes separate.
{{supermodule_boundary}}


Execution efficiency: use begin-correction for confirmed bounded repairs; preserve unrelated
Units and reuse input-bound checks through prepare-check/record-check. Stage or Spec revision
changes alone do not invalidate tests. No execution budget. No repeated internal validation,
speculative fallback/retry/compatibility logic, or defensive copying.

<!-- ═══ end easy-coding-harness generated ═══ -->

## Project Custom Instructions

Add project-specific instructions below this line. The generated region above is managed by
easy-coding-harness and is replaced on `easy-coding upgrade`.

## Cooperation and bounded QUALITY repair

`cooperate_mode: default | dispatch` is independent of approval and unit-test strategy, with
session > optional local `~/.easy-coding/config.yaml` > project > default precedence. Reads never
create local config; ec-config changes only explicitly selected fields and can restore inheritance.
Default preserves stage-boundary handoff. Dispatch supports manual implementation and QUALITY
repair handoff; the user can always select current-Agent execution. Preserve the task coordinator,
use existing plan/evidence references and stop at the handoff's `stop_after`. Never launch another Agent.
Dispatch requires one user decision on scope and executor, even under Auto; combine any approval
with that same decision and never ask again on claim. Ordinary repairs stay in QUALITY using
begin-correction, start-quality-repair and complete-quality-repair. Only changed requirements,
contracts or a replaced main implementation plan justify returning to ANALYSIS/IMPLEMENT.
Review and verification remain read-only checks; approved repairs happen between them. Reuse
unaffected evidence, review the repair delta and run affected checks only. Do not rebuild the plan
or repeat completed checks because of handoff, stage labels or descriptive check-name changes.
