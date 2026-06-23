---
name: ec-analysis
description: ANALYSIS-stage skill. Use when ec-workflow enters ANALYSIS. Creates the dev-spec skeleton FIRST (template-first), then fills incrementally — producing the narrative plan, execution plan (execution.jsonl), and test strategy. Ends in WAITING_CONFIRM. Grounds every conclusion in real code, never restates the requirement.
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
2. **All subsequent analysis** fills sections of this file via edits. You do NOT hold analysis
   in your head and dump it at the end — you write each section into the file as you go.
3. **Your chat output to the user IS dev-spec.md, verbatim.** After dev-spec.md is complete,
   use the Read tool to read it back, then output exactly what you read as your reply — this
   is a copy operation, not a re-narration. Do NOT reconstruct it from memory, do NOT
   abbreviate, do NOT invent a different format. No "执行计划" summary tables, no bullet-point
   plans, no freestyle answers. The template IS the format. If your reply does not contain
   every mandatory section header from the template, you have failed.
4. **Three files must exist** in `.easy-coding/tasks/{task-id}/` when you finish:
   `dev-spec.md`, `execution.jsonl` (plan record), `test-strategy.md`. Missing any one = failed.
5. **Stay faithful to the user's delivery form (anti-downgrade).** The delivery form —
   change real code vs. produce a document — is set by the user's original request, NOT by
   you. If the user asked to refactor / fix / add a feature (a CODE task), you MUST plan real
   code changes. You may NOT downgrade it to "produce a report / audit / inventory only" or
   "defer all changes to follow-up sub-tasks." A large change surface is NOT a reason to
   downgrade: decompose it into batches/units in 实施拆解, and surface "split into batches? /
   which subset this round?" as an explicit item in 待用户决策 for the user to decide. Never
   make a scope-narrowing decision yourself and present it as settled. Never fabricate a
   premise such as "the user already fixed scope X in INIT" or "auto_mode already selected Y"
   to justify narrowing — `auto_mode` only waives the WAITING_CONFIRM confirmation step and
   carries NO scope or delivery-form decision whatsoever.
6. **改动范围 lists ONLY real project code.** The 改动范围 table carries only changes to real
   project source/config files. Any harness artifact under `.easy-coding/` (dev-spec.md,
   execution.jsonl, test-strategy.md, memory files, generated reports, etc.) is FORBIDDEN in
   this table — those are process outputs, not "changes." The table MAY be empty, but ONLY
   when the user explicitly asked for a no-code delivery form (e.g. a pure documentation
   request); in that case declare the deliverable in 需求解析 > 输出. If the task type is a
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
If a repo name cannot be located locally, ask the user for the path before proceeding.

## Analysis procedure (mandatory sequence)

You MUST execute these steps in exact order. Do not rearrange, skip, or combine steps.

1. **Write skeleton** — FIRST TWO tool calls:
   - Read `.easy-coding/templates/dev-spec-skeleton.md` (the template file).
   - Write its exact content to `.easy-coding/tasks/{task-id}/dev-spec.md`.
   This is a copy operation, not a generation task. Every section header and every `{待填写}`
   placeholder in the template must appear in the written file unchanged.
2. **Fill 项目模式 + 任务类型** — edit dev-spec.md in place.
3. **Fill 需求解析** — edit dev-spec.md: 目标 / 输入 / 输出 / 边界.
4. **Read source code, fill 现状** — read the actual files, then edit dev-spec.md with
   evidence. Every claim must cite file:line. No file references = invalid section.
5. **Fill 冲突摘要 + 待用户决策** — edit dev-spec.md.
6. **Fill 影响面分析 + 改动范围** — edit dev-spec.md, fill the table with encoding evidence.
7. **Fill 修改方案 + 实施拆解** — edit dev-spec.md, design approach and decompose units.
8. **Fill 测试策略 + 风险与注意事项** — edit dev-spec.md.
9. **Fill conditional sections** — edit dev-spec.md: 背景数据应用 / 核心改动明细 /
   前端实现映射 only if applicable. Remove inapplicable conditional sections entirely.
10. **Write execution.jsonl** — append the plan record (see section below).
11. **Write test-strategy.md** — write the testability table (see section below).
12. **Self-check** — run the gates below. Fix any failure in the files.
13. **Present to user** — Read dev-spec.md back from disk and output exactly what you read as
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

**Mandatory section headers** (all 13 must be present in the skeleton — the hook validates these):

1. `## 技术方案`
2. `### 项目模式`
3. `### 任务类型`
4. `### 需求解析`
5. `### 现状`
6. `### 冲突摘要`
7. `### 待用户决策`
8. `### 影响面分析`
9. `### 改动范围`
10. `### 修改方案`
11. `### 实施拆解`
12. `### 测试策略`
13. `### 风险与注意事项`

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

## Implementation units → execution.jsonl

Decompose the work into units, then append ONE `plan` record to
`.easy-coding/tasks/{task-id}/execution.jsonl`:

```json
{"type":"plan","strategy":"parallel","units":[{"id":"U1","title":"...","type":"backend","files":["..."],"depends_on":[],"rules_sections":["naming","error-handling"],"abstract_modules":["user-service"]}],"parallel_groups":[{"level":0,"units":["U1","U2"]},{"level":1,"units":["U3"]}]}
```

Strategy selection (drives whether ec-implementing spawns sub-agents):
- `single` — one unit. Main agent implements directly.
- `sequential` — multiple units with a hard dependency chain.
- `parallel` — two or more independent units. ec-implementing MUST use sub-agents.

Each unit carries `rules_sections` and `abstract_modules` so ec-implementing can build a
precise task card without the sub-agent re-reading the whole repo. `depends_on` sets the
parallel-group levels.

## Test strategy (presented with the plan, saved for VERIFICATION)

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

Write the confirmed strategy to `.easy-coding/tasks/{task-id}/test-strategy.md` (the
VERIFICATION baseline).

## Self-check gates (ALL must pass — reject your own output if ANY fails)

- [ ] `dev-spec.md` 文件是否已写入 `.easy-coding/tasks/{task-id}/`？
- [ ] `execution.jsonl` 文件是否已写入？
- [ ] `test-strategy.md` 文件是否已写入？
- [ ] dev-spec.md 是否包含全部 13 个必填章节标题（参见上方清单）？
- [ ] 每个"现状"断言是否引用了真实文件/类/行号？
- [ ] 是否有具体的修改方案，而非仅罗列"已加载的文件"？
- [ ] 不适用的条件章节是否已完全省略（而非留空）？
- [ ] 实施拆解的单元、依赖、策略是否与改动范围表一致？
- [ ] 改动范围表中每行是否填写了文件编码及证据？
- [ ] 所有 `{待填写}` 占位符是否已替换为实际内容？
- [ ] 回复给用户的内容是否是 dev-spec.md 的完整内容（而非自创的缩略格式）？
- [ ] 交付形态是否忠于用户原始需求？代码类任务（重构/修复/功能）是否规划了真实代码改动，而非降级为"仅出报告/分析清单/留作后续子任务"？
- [ ] 「改动范围」是否只含真实项目源码/配置，且不含任何 `.easy-coding/` 下的 harness 产物（dev-spec/execution/test-strategy/记忆/报告）？
- [ ] 若「改动范围」为空，是否确为用户明确要求的无代码交付形态，而非 AI 自行降级的结果？
- [ ] 任何"本次不做全部 / 分批落地 / 范围收窄"的决定，是否已列入「待用户决策」交由用户拍板，而非自行拍板并假托既定？

## Revision handling

> 修订同样受 HARD RULE 5/6 约束：用户的修订诉求若是扩大或细化代码改动，不得借机把任务降级为"出报告"；范围收窄仍须作为 待用户决策 项由用户确认。

On user revision request at WAITING_CONFIRM, do NOT reply with only a change summary.
Re-output the COMPLETE revised dev-spec.md:

1. Prepend a `### 修订摘要` listing each user request and its impact on the plan. If the
   user changed a file encoding, explain the per-file adjustment.
2. Re-output the full plan following the template above (核心必填 + applicable conditional
   sections), incorporating all revisions.
3. Overwrite the `plan` record in execution.jsonl with the new strategy.
4. Update test-strategy.md if test scope changed.
5. Re-enter WAITING_CONFIRM and wait for explicit user confirmation.

## End state

Read dev-spec.md back from disk and output the COMPLETE content as your reply to the user —
not a summary, not a different format, not a table you invented. Then set stage to
WAITING_CONFIRM and hand control back to ec-workflow. Never start implementing from this
skill.
