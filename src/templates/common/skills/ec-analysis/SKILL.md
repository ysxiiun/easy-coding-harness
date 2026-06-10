---
name: ec-analysis
description: ANALYSIS-stage skill. Use when ec-workflow enters ANALYSIS. Creates the dev-spec skeleton FIRST (template-first), then fills incrementally — producing the narrative plan, execution plan (execution.jsonl), and test strategy. Ends in WAITING_CONFIRM. Grounds every conclusion in real code, never restates the requirement.
---

# ec-analysis — turn a requirement into a confirmable plan

ec-workflow dispatches you when a task enters ANALYSIS. You read the codebase, decide *how*
to implement, and present a plan the user can confirm. You do not write business code.

Communicate with the user in the user's language.

## HARD RULES (non-negotiable, violations = failed analysis)

1. **Your FIRST tool call** in this skill MUST be a file-write that creates
   `.easy-coding/tasks/{task-id}/dev-spec.md` with the COMPLETE template skeleton from the
   "Required output" section below. No reading, no thinking out loud, no "let me analyze
   first" — skeleton file FIRST. If this file does not exist after your first tool call, you
   have already failed.
2. **All subsequent analysis** fills sections of this file via edits. You do NOT hold analysis
   in your head and dump it at the end — you write each section into the file as you go.
3. **Your chat output to the user** MUST be the final content of dev-spec.md (copy it into
   your reply or reference it). You MUST NOT invent a different, abbreviated format. No
   "执行计划" summary tables, no bullet-point plans, no freestyle answers. The template IS
   the format. If your reply to the user does not contain every mandatory section header from
   the template, you have failed.
4. **Three files must exist** in `.easy-coding/tasks/{task-id}/` when you finish:
   `dev-spec.md`, `execution.jsonl` (plan record), `test-strategy.md`. Missing any one = failed.

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
interface. Cache any local path the user provides only in `state.json.repo_paths`. If a repo
name cannot be located locally, ask the user for the path before proceeding.

## Analysis procedure (mandatory sequence)

You MUST execute these steps in exact order. Do not rearrange, skip, or combine steps.

1. **Write skeleton** — FIRST tool call: write `.easy-coding/tasks/{task-id}/dev-spec.md`
   using the full template from the next section. Every section header and every `{待填写}`
   placeholder must be present. This is not optional.
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
13. **Present to user** — output the FINAL content of dev-spec.md to the user as your reply.
    Do not summarize, abbreviate, or reformat. The dev-spec.md content IS your reply.

## Required output: dev-spec.md template

The skeleton below is the EXACT file you MUST write as step 1. Copy it character-for-character
into `.easy-coding/tasks/{task-id}/dev-spec.md`. Do not rephrase headers, do not omit
sections, do not invent alternative formats. Later steps fill the `{待填写}` placeholders
via edits. Conditional sections are added only if applicable.

````markdown
[阶段：ANALYSIS]

## 技术方案：{任务标题}

### 项目模式
{初创项目/迭代项目}

### 任务类型
{新功能 / Bug 修复 / 重构 / 性能优化 / 前端设计实现}

### 需求解析
- **目标**：{待填写 — 真正要解决的问题}
- **输入**：{待填写 — 用户输入 / 系统输入 / 触发条件}
- **输出**：{待填写 — 最终交付结果}
- **边界**：{待填写 — 明确不做什么}

### 现状
- **相关代码 / 页面 / 接口 / 模块**：{待填写 — 基于实际文件与代码的现状说明}
- **当前实现方式**：{待填写 — 现在是如何工作的}
- **现有问题 / 缺口**：{待填写 — 为什么需要改}
- **证据**：{待填写 — 引用的关键文件、类、页面、接口，含 file:line}

### 冲突摘要
- 需求 vs RULES：{待填写 或 "无冲突"}
- 需求 vs ABSTRACT：{待填写 或 "无冲突"}
- 需求 vs 现有代码：{待填写 或 "无冲突"}
- Dev-Spec vs 现有代码：{待填写 或 "无冲突"}

### 待用户决策
- {待填写 — 影响技术路线、接口、改动范围的问题逐条列出；若无则写"无"}

### 影响面分析
- **涉及模块**：{待填写}
- **核心类 / 页面 / 接口**：{待填写}
- **数据库变更**：{有/无}
- **接口变更**：{有/无}
- **关联历史任务**：{待填写 — 相关短期记忆序号；无则"无"}

### 改动范围
| 改动文件 | 改动类型 | 文件编码 | 改动核心内容 |
|----------|---------|---------|-------------|
| `{文件路径}` | 新增 | 项目编码 {X}，依据：{xxx} | {核心改动} |
| `{文件路径}` | 修改 | 保持原编码 {X} | {核心改动} |
| `{文件路径}` | 删除 | — | {删除原因} |

### 修改方案
- **总体改法**：{待填写 — 一句话说清改哪里、怎么改}
- **后端改动**：{待填写；不涉及则写"不涉及"}
- **前端改动**：{待填写；不涉及则写"不涉及"}
- **兼容处理**：{待填写 — 旧逻辑如何迁移、保留或替换}
- **风险点**：{待填写 — 最容易出问题的位置}

### 实施拆解

| 单元 | 说明 | 类型 | 涉及文件 | 依赖 |
|------|------|------|---------|------|
| U1 | {title} | {backend/frontend/test/...} | {files} | — |
| U2 | {title} | {type} | {files} | — |
| U3 | {title} | {type} | {files} | U1, U2 |

**执行策略**：{parallel / sequential / single}
- 第一批（并行）：U1 {title} ｜ U2 {title}
- 第二批（等待第一批）：U3 {title}
（若 single：单一实施单元，主 agent 直接执行）

### 测试策略

| 测试点 | 级别 | 归属单元 | 方式 | 验证命令 |
|--------|------|---------|------|---------|
| {描述} | 必测 | U1 | 单测 | `npm test -- --filter=xxx` |
| {描述} | 应测 | U2 | 快照 | `npm test -- --snapshot` |

- **人工验收**：{待填写 — 用户需要检查的关键行为}
- **无法验证项**：{待填写 — 无 / 说明缺失环境、数据或权限}

### 风险与注意事项
- {风险 1}
- {风险 2}
````

> **编码规则**：修改已有文件必须保持原始编码；新文件声明项目编码并附证据；证据冲突或
> 未知时标记"需用户确认"。用户可在确认前覆盖任何编码单元格。

**条件展开章节**（仅在满足条件时添加，否则完全不出现）：

- `### 背景数据应用` — 命中项目知识资产（ABSTRACT.md、BUSINESS.md、TECHNICAL.md、RULES.md）
  且其内容影响本次方案时展开。含架构参考、业务记忆、技术记忆、记忆冲突、规范约束。
- `### 核心改动明细` — 多模块且改动范围表不足以表达当前逻辑和目标逻辑时展开。
  逐文件列出"当前逻辑 → 准备怎么改"。
- `### 前端实现映射` — 涉及前端页面、组件、交互时展开。含页面/模块映射、组件映射、
  数据来源、Mock 使用计划。

**禁止输出**：
- 仅复述需求、几乎不引用代码现状的空泛方案。
- 只列"已加载哪些信息"但不给出具体可实施改法。
- 为了凑格式输出与本次任务无关的条件章节。

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
- [ ] dev-spec.md 是否包含全部 12 个核心章节标题？
- [ ] 每个"现状"断言是否引用了真实文件/类/行号？
- [ ] 是否有具体的修改方案，而非仅罗列"已加载的文件"？
- [ ] 不适用的条件章节是否已完全省略（而非留空）？
- [ ] 实施拆解的单元、依赖、策略是否与改动范围表一致？
- [ ] 改动范围表中每行是否填写了文件编码及证据？
- [ ] 所有 `{待填写}` 占位符是否已替换为实际内容？
- [ ] 回复给用户的内容是否是 dev-spec.md 的完整内容（而非自创的缩略格式）？

## Revision handling

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

Output the COMPLETE content of dev-spec.md as your reply to the user — not a summary, not a
different format, not a table you invented. Then set stage to WAITING_CONFIRM and hand
control back to ec-workflow. Never start implementing from this skill.
