---
name: ec-analysis
description: ANALYSIS-stage skill. Use when ec-workflow enters ANALYSIS. Creates the dev-spec skeleton FIRST, resolves user decisions during analysis, then fills the final plan and execution plan; code tasks also receive a standalone test strategy, while read-only tasks do not. Ends by requesting the confirmed edge to IMPLEMENT. Grounds every conclusion in real code, never restates the requirement.
---

> **SKELETON FIRST — your first two tool calls MUST be: (1) Read `.easy-coding/templates/dev-spec-skeleton.md`, (2) Write its EXACT content to the task's dev-spec.md. No exceptions. Do not analyze or think before the skeleton file exists on disk.**

# ec-analysis — turn a requirement into a confirmable plan

ec-workflow dispatches you when a task enters ANALYSIS. You read the codebase, decide *how*
to implement, and present a plan the user can confirm. You do not write business code.

Communicate with the user in the user's language.

## HARD RULES (non-negotiable, violations = failed analysis)

1. **Your FIRST TWO tool calls** in this skill MUST be:
   - **Call 1 (Read):** Read `.easy-coding/templates/dev-spec-skeleton.md`.
   - **Call 2 (Write):** Write the EXACT content you just read to
     `.easy-coding/tasks/{task-id}/dev-spec.md`. This is a mechanical copy — do not rephrase
     headers, omit sections, rearrange content, or substitute placeholders with your own text.
     The file content must be identical to the template you just read.
   If dev-spec.md does not exist with the correct template after your second tool call,
   you have already failed. Do not read code, think aloud, or analyze before the skeleton
   is on disk.
2. **Resolve decisions before filling.** After the exact skeleton is on disk, load the required
   inputs and inspect source code without editing dev-spec.md. As soon as analysis reveals a
   decision that affects technical direction, API, scope, delivery form, state flow, encoding,
   or acceptance, ask the user immediately and stop. Prefer the platform's native user-choice
   tool when available. Keep dev-spec.md as the untouched skeleton until every decision is
   resolved; never write an unresolved question or an assumed answer into the final plan.
3. **Decision questions are the only pre-plan chat exception.** While the decision gate is
   unresolved, ask only the evidence-backed question needed to continue; do not present a draft
   report. After all decisions are resolved and dev-spec.md is complete, your chat output to the
   user IS dev-spec.md verbatim. Use the Read tool to read it back, then output exactly what you
   read as your reply — this
   is a copy operation, not a re-narration. Do NOT reconstruct it from memory, do NOT
   abbreviate, do NOT invent a different format. No "执行计划" summary tables, no bullet-point
   plans, no freestyle answers. The template IS the format. If your reply does not contain
   every mandatory section header from the template, you have failed.
4. **Required artifacts depend on delivery mode.** Code tasks require `dev-spec.md`,
   `execution.jsonl` (plan record), and `test-strategy.md`. Read-only `doc` / `analysis` /
   `report` tasks require only `dev-spec.md` and `execution.jsonl`; they MUST NOT create
   `test-strategy.md` because they never enter VERIFICATION.
5. **Stay faithful to the user's delivery form (anti-downgrade).** The delivery form —
   change real code vs. produce a document — is set by the user's original request, NOT by
   you. If the user asked to refactor / fix / add a feature (a CODE task), you MUST plan real
   code changes. You may NOT downgrade it to "produce a report / audit / inventory only" or
   "defer all changes to follow-up sub-tasks." A large change surface is NOT a reason to
   downgrade: during the pre-fill decision gate, ask "split into batches? / which subset this
   round?" and wait for the user to decide. Never make a scope-narrowing decision yourself and
   present it as settled. Never fabricate a
   premise such as "the user already fixed scope X in INIT" or "confirm_mode already selected Y"
   to justify narrowing — confirmation mode controls stage-boundary prompts only and carries
   NO scope or delivery-form decision whatsoever.
6. **改动范围 lists ONLY real project code.** The 改动范围 table carries only changes to real
   project source/config files. Any harness artifact under `.easy-coding/` (dev-spec.md,
   execution.jsonl, test-strategy.md, memory files, generated reports, etc.) is FORBIDDEN in
   this table — those are process outputs, not "changes." The table MAY be empty, but ONLY
   when the user explicitly asked for a no-code delivery form (e.g. a pure documentation
   request) and `task.json.type` is `doc`, `analysis`, or `report`; in that case declare the
   deliverable in 需求解析 > 输出. If the task type is a
   code task (重构 / Bug 修复 / 新功能 / 性能优化) yet 改动范围 is empty, you have downgraded
   the task — this is a failed analysis.

## Inputs to load (in this order)

1. `.easy-coding/SOUL.md`, `.easy-coding/RULES.md` (always).
2. `.easy-coding/ABSTRACT.md` — only when the task touches architecture, crosses modules, or
   adds a feature. A single-file bugfix or doc edit can skip it.
3. Long memory: read `MEMORY.md` index, then only the `BUSINESS.md`/`TECHNICAL.md` entries
   whose domain/tags/related_files match this task. No unbounded full scans.
4. `.easy-coding/spec/` — scan for design docs (`*-design.md`) whose topic matches this task.
   If found, use the design as a primary input for the analysis. The design doc defines the
   direction; your job is to turn it into a concrete implementation plan.
5. The actual source files the task touches — read them. A plan that does not cite real
   files, classes, and call paths is rejected by your own self-check below.

## Cross-repo handling

If the task spans repositories: declare them in the dev-spec (trigger repo + involved repos
by **name**, never local paths). For each involved repo, read its ABSTRACT to understand the
interface. Cache any local path the user provides through the state API only:
`{{PYTHON_CMD}} {{platform_config_dir}}/hooks/easy_coding_state.py set-repo-path --session-file <P> --repo <repo-name> --path <local-path>`.
Use the returned `status_context` as the latest state source after this write.
If a repo name cannot be located locally, ask the user for the path before proceeding.

## Analysis procedure (mandatory sequence)

You MUST execute these steps in exact order. Do not rearrange, skip, or combine steps.

1. **Write skeleton** — FIRST TWO tool calls:
   - Read `.easy-coding/templates/dev-spec-skeleton.md` (the template file).
   - Write its exact content to `.easy-coding/tasks/{task-id}/dev-spec.md`.
   This is a copy operation, not a generation task. Every section header and every
   `[[EC_TODO:...]]` marker in the template must appear in the written file unchanged.
2. **Inspect before filling** — load the required inputs in the order above and read the actual
   source files. Do not edit dev-spec.md yet. Collect evidence and identify every decision that
   could change technical direction, API, scope, delivery form, state flow, encoding, or
   acceptance.
3. **Resolve the decision gate** — if any decision exists, ask it during ANALYSIS immediately,
   using the native user-choice tool when available, then stop and wait. After the user answers,
   repeat the evidence check and ask any newly exposed decision. Do not fill dev-spec.md,
   execution.jsonl, or (for code tasks) test-strategy.md until the decision set is empty.
4. **Fill 项目模式 + 任务类型** — edit dev-spec.md in place only after the decision gate clears.
5. **Fill 需求解析** — edit dev-spec.md: 目标 / 输入 / 输出 / 边界.
6. **Fill 现状 + 冲突摘要** — write evidence-backed conclusions. Every current-state claim
   must cite file:line. No file references = invalid section.
7. **Fill 影响面分析 + 改动范围** — edit dev-spec.md, fill the table with encoding evidence.
8. **Fill 修改方案 + 实施拆解** — edit dev-spec.md, design approach and decompose units.
9. **Fill 测试策略 + 风险与注意事项** — edit dev-spec.md.
10. **Fill conditional sections** — edit dev-spec.md: 背景数据应用 / 核心改动明细 /
   前端实现映射 only if applicable. Remove inapplicable conditional sections entirely.
11. **Write execution.jsonl** — append the plan record (see section below).
12. **Write test-strategy.md for code tasks only** — write the testability table (see section
    below). For a read-only task, do not create this file; fill the dev-spec `测试策略` section
    with `不适用：只读报告任务不进入 VERIFICATION`.
13. **Self-check** — run the gates below. Fix any failure in the files.
14. **Present to user** — Read dev-spec.md back from disk and output exactly what you read as
    your reply. Do not summarize, abbreviate, reformat, or reconstruct from memory. The
    dev-spec.md content on disk IS your reply.

## Required output: dev-spec.md structure

The template lives at `.easy-coding/templates/dev-spec-skeleton.md`. You MUST read it with
the Read tool and write its exact content to the task's dev-spec.md as step 1. Do NOT generate
the skeleton from memory or from this instruction — READ the file and WRITE what you read.

If `.easy-coding/templates/dev-spec-skeleton.md` does not exist, tell the user to run
`easy-coding upgrade` in the terminal to restore it. Do not generate the skeleton from memory.

If the hook injects `[easy-coding:analysis-template-drift:missing:...]`, you have deviated
from the template. Re-read the template file, compare it against your dev-spec.md, and fix
any missing or renamed section headers immediately.

**Mandatory section headers** (all 12 must be present in the skeleton — the hook validates these):

1. `## 技术方案`
2. `### 项目模式`
3. `### 任务类型`
4. `### 需求解析`
5. `### 现状`
6. `### 冲突摘要`
7. `### 影响面分析`
8. `### 改动范围`
9. `### 修改方案`
10. `### 实施拆解`
11. `### 测试策略`
12. `### 风险与注意事项`

> **Encoding rule**: modified files keep their original encoding; new files declare the
> project encoding with evidence; conflicting or unknown encoding → mark "需用户确认".
> Users can override any encoding cell at confirmation.

**Conditional sections** (add only when applicable, otherwise omit entirely):

- `### 背景数据应用` — project knowledge assets (ABSTRACT.md, BUSINESS.md, TECHNICAL.md,
  RULES.md) are relevant and influence the plan.
- `### 核心改动明细` — multi-module change where the scope table is insufficient to express
  current logic and target logic.
- `### 前端实现映射` — frontend pages, components, or interactions are involved.

**Forbidden output:**
- Restating requirements without citing code evidence.
- Listing "loaded information" without a concrete implementation approach.
- Including conditional sections that are irrelevant to the current task.
- Including `[阶段：ANALYSIS]`, a `待用户决策` section, or any unresolved decision in the report.

## Implementation units → execution.jsonl

Decompose the work into units, then append ONE `plan` record to
`.easy-coding/tasks/{task-id}/execution.jsonl`:

```json
{"type":"plan","strategy":"parallel","units":[{"id":"U1","title":"Implement service","type":"backend","files":["src/service.ts"],"depends_on":[],"rules_sections":["naming","error-handling"],"abstract_modules":["user-service"]},{"id":"U2","title":"Implement adapter","type":"backend","files":["src/adapter.ts"],"depends_on":[],"rules_sections":["naming"],"abstract_modules":["user-service"]},{"id":"U3","title":"Add integration tests","type":"test","files":["test/service.test.ts"],"depends_on":["U1","U2"],"rules_sections":["testing"],"abstract_modules":["user-service"]}],"parallel_groups":[{"level":0,"units":["U1","U2"]},{"level":1,"units":["U3"]}]}
```

Strategy selection (drives ec-implementing's sub-agent orchestration shape — every strategy
dispatches sub-agents; none implements inline):
- `single` — one unit. ec-implementing dispatches one sub-agent.
- `sequential` — multiple units with a hard dependency chain. ec-implementing dispatches
  sub-agents one at a time in dependency order.
- `parallel` — two or more independent units. ec-implementing dispatches sub-agents per level
  concurrently.

Each unit carries `rules_sections` and `abstract_modules` so ec-implementing can build a
precise task card without the sub-agent re-reading the whole repo. `depends_on` sets the
parallel-group levels.

For an explicitly no-code `doc` / `analysis` / `report` task, use a `single` plan whose unit
has `files:[]`. The state API permits an empty file scope only for those task types. The unit
must still include `id`, `title`, `type`, `depends_on`, `rules_sections`, and
`abstract_modules`; its sub-agent returns the full read-only result in `deliverable` and must
not modify project files. After IMPLEMENT shows that full result, the task auto-completes without
REVIEW, VERIFICATION, MEMORY, or a memory write. Never use an empty `files` list for
feature/bugfix/refactor/perf code tasks.

## Test strategy (code tasks only; presented with the plan, saved for VERIFICATION)

Read-only `doc` / `analysis` / `report` tasks skip this entire standalone artifact. Do not
create `test-strategy.md`; only mark the mandatory dev-spec `测试策略` section as not applicable.

**1. Testability table** — classify every change:

| Change | Kind | Verdict | Reason |
|---|---|---|---|
| calculateDiscount | pure function | [must-test] | clear input/output |
| useCartStore | state hook | [should-test] | transitions assertable |
| SearchPanel | UI interaction | [depends] | on project test infra |
| Header.module.css | pure style | [no-test] | no behavior |

Rules: pure functions/utils → [must-test]; state hooks/service layer → [should-test]; API
param building → [should-test]; UI interaction → [depends]; pure style/config → [no-test].
Bug fixes always require a regression test.

**2. Test points** — for each [must-test]/[should-test] item, concrete cases, plus the
owning unit and the verify command.

**3. No-test reasons** — one line each; the user can overturn any verdict at confirmation.

**4. Human acceptance** — items requiring manual verification by the user.

**5. Cannot-verify items** — items that cannot be verified in the current environment,
with reason (missing infra, data, credentials, or API contract).

For a code task, write the confirmed strategy to
`.easy-coding/tasks/{task-id}/test-strategy.md` (the VERIFICATION baseline).

## Self-check gates (ALL must pass — reject your own output if ANY fails)

- [ ] `dev-spec.md` 文件是否已写入 `.easy-coding/tasks/{task-id}/`？
- [ ] `execution.jsonl` 文件是否已写入？
- [ ] 代码任务是否已写入 `test-strategy.md`？只读任务是否确认该文件不存在？
- [ ] dev-spec.md 是否包含全部 12 个必填章节标题（参见上方清单）？
- [ ] 每个"现状"断言是否引用了真实文件/类/行号？
- [ ] 是否有具体的修改方案，而非仅罗列"已加载的文件"？
- [ ] 不适用的条件章节是否已完全省略（而非留空）？
- [ ] 实施拆解的单元、依赖、策略是否与改动范围表一致？
- [ ] 改动范围表中每行是否填写了文件编码及证据？
- [ ] 所有 `[[EC_TODO:...]]` 占位标记是否已替换为实际内容？
- [ ] 回复给用户的内容是否是 dev-spec.md 的完整内容（而非自创的缩略格式）？
- [ ] 交付形态是否忠于用户原始需求？代码类任务（重构/修复/功能）是否规划了真实代码改动，而非降级为"仅出报告/分析清单/留作后续子任务"？
- [ ] 「改动范围」是否只含真实项目源码/配置，且不含任何 `.easy-coding/` 下的 harness 产物（dev-spec/execution/test-strategy/记忆/报告）？
- [ ] 若「改动范围」为空，是否确为用户明确要求的无代码交付形态，而非 AI 自行降级的结果？
- [ ] 若 unit.files 为空，task.json.type 是否为 `doc` / `analysis` / `report`，且计划是否为 single 只读交付？
- [ ] 是否在填充方案前通过分析中的即时问答解决了全部用户决策项，且最终报告不含未决问题或 `[阶段：ANALYSIS]`？
- [ ] 任何"本次不做全部 / 分批落地 / 范围收窄"的决定，是否已在填充方案前询问并获得用户确认，而非自行拍板并假托既定？

## Revision handling

> 修订同样受 HARD RULE 5/6 约束：用户的修订诉求若是扩大或细化代码改动，不得借机把任务降级为"出报告"；范围收窄必须在重写报告前即时询问并获得用户确认。

On user revision or Other feedback while ANALYSIS has a pending transition, first cancel the
pending edge. Re-run the pre-fill decision gate before editing the existing report. If the
revision exposes an unresolved decision, ask it immediately and wait without writing a partial
revision. Do NOT reply with only a change summary.
Re-output the COMPLETE revised dev-spec.md:

1. Prepend a `### 修订摘要` listing each user request and its impact on the plan. If the
   user changed a file encoding, explain the per-file adjustment.
2. Re-output the full plan following the template above (核心必填 + applicable conditional
   sections), incorporating all revisions.
3. Overwrite the `plan` record in execution.jsonl with the new strategy.
4. For code tasks, update test-strategy.md if test scope changed. For read-only tasks, keep the
   file absent.
5. Request ANALYSIS -> IMPLEMENT again and present the standard confirmation/handoff/Other gate.

## End state

Read dev-spec.md back from disk and output the COMPLETE content as your reply to the user —
not a summary, not a different format, not a table you invented. Then ask ec-workflow to
record `pending_transition: ANALYSIS -> IMPLEMENT`, present the standard boundary choices,
and stop. Never start implementing from this skill.
