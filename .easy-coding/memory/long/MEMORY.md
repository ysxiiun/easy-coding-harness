---
memory_schema: 2
memory_file: MEMORY
last_updated: 2026-08-17
---

# 长期记忆索引

> 本文件只作为索引与读取导航，不承载大量正文。
> 业务事实写入 `BUSINESS.md`，技术/架构/工程事实写入 `TECHNICAL.md`。
> 状态仅使用 `active / deprecated / superseded`；默认分析只读取 `active` 主题。

## 快速导航

| 主题 | 类型 | 关键词 | 详情文件 | 状态 | 最近更新 | 来源 |
|---|---|---|---|---|---|---|
| Supermodule CLI 支持 | technical/business | supermodule, init re-entry, clear tui, submodules | `TECHNICAL.md`, `BUSINESS.md` | active | 2026-06-30 | supermodule-support |
| 共享产物去本地化 | technical | absolute path, project_path, bytecode, __pycache__, portable artifacts | `TECHNICAL.md` | active | 2026-08-05 | SM-20260703-001 |
| 状态机与 ANALYSIS 交付契约 | technical | auto-transition, dev-spec skeleton, read-only completion, evidence gate | `TECHNICAL.md` | active | 2026-08-05 | SM-20260711-002 |
| 行为模式与任务/session 面板 | technical | approval_mode, workflow_mode, snapshot, task management, status line | `TECHNICAL.md` | active | 2026-08-05 | SM-20260711-003, SM-20260711-004 |
| 旧 Lite 跳审语义 | technical | lite, review bypass, legacy direct edge | `TECHNICAL.md` | deprecated | 2026-08-05 | SM-20260713-005 |
| 原生确认与待决策恢复 | technical | native choice, pending transition, timeout, numbered fallback | `TECHNICAL.md` | active | 2026-08-17 | SM-20260714-006, SM-019f82c7-8558-79cc-9b9f-c6748e807754 |
| Session、canonical owner 与 Handoff 协调 | technical | session namespace, canonical agent, handoff, claim, root | `TECHNICAL.md` | active | 2026-08-17 | SM-20260722-007, SM-20260804-008, SM-20260806-010, current code |
| Canonical Spec 共享执行 | technical | easy-dev-spec/v1, selected task closure, normalized remote, execution writer | `TECHNICAL.md` | active | 2026-08-17 | SM-20260805-009, current code |
| Java 可选 TDD 与本地门禁 | technical | TDD readiness, changed-line coverage, JaCoCo, task freeze | `TECHNICAL.md` | active | 2026-08-17 | SM-20260807-011, current code |

## 当前重点业务域

- Easy Coding Harness supermodule 父仓/子仓安装、清理和运行边界

## 当前重点技术域

- CLI supermodule 目标解析、父仓拓扑刷新、无参数 TUI 安全默认值
- Harness 共享产物可移植性、状态机机械门禁、行为配置与任务/session 可观察性
- 原生确认恢复、canonical Agent 身份、显式 handoff/claim 协调事件
- Canonical Spec 所选任务闭包与共享 execution、Java TDD readiness 和修改行覆盖门禁

## 读取策略

- 涉及业务概念、字段语义、业务流程、业务规则、上下游契约或业务排障时，读取 `BUSINESS.md`。
- 涉及架构决策、接口决策、工程规则、实现模式、易错点、验证或发布经验时，读取 `TECHNICAL.md`。
- 默认只读取状态为 `active` 的主题；`deprecated` / `superseded` 仅在迁移、冲突排查或用户追溯历史原因时读取。
- 若长期记忆与当前代码或用户最新表达冲突，优先相信当前代码和用户最新表达，并在后续沉淀中更新记忆状态。

## 迁移审计

| 日期 | 来源 | 处理结果 |
|---|---|---|
| 2026-06-30 | interactive_init | 新建 schema v2 长期记忆索引 |
| 2026-08-05 | SM-20260703-001 至 SM-20260713-005 | 归纳 5 条窗口外短期记忆；淘汰旧 Lite 跳审语义，保留当前 migration 兼容边界 |
