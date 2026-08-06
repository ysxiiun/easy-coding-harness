---
memory_schema: 2
id: SM-20260805-009
date: 2026-08-05
task_type: workflow
project_mode: iteration
domain:
  - "Easy Coding Harness 与 easy-dev-spec Canonical v1 集成"
tags:
  - "0.10.0-beta.0"
  - "easy-dev-spec/v1"
  - "canonical-spec"
  - "multi-repository"
  - "dependency-evidence"
  - "consumption-closure"
  - "ready-validator"
related_files:
  - "src/templates/shared-hooks/easy_dev_spec.py"
  - "src/templates/shared-hooks/easy_dev_spec_protocol.py"
  - "src/templates/shared-hooks/easy_coding_state.py"
  - "src/types/task.ts"
  - "src/templates/common/skills/ec-analysis/SKILL.md"
  - "src/templates/common/skills/ec-workflow/SKILL.md"
  - "test/shared-hooks/easy-dev-spec.test.ts"
  - "test/fixtures/canonical-v1-valid.md"
commit: none
verification: passed
memory_value: technical
target_long: TECHNICAL
---

# 0.10.0-beta.0 Canonical Spec 集成

## 任务摘要

- 目标：让 Harness 能识别、选择并利用最新版 easy-dev-spec 的 `easy-dev-spec/v1` Canonical Spec 产物。
- 范围：Canonical parser、状态 API、Task/Unit/证据类型、ANALYSIS 到 Git 的阶段 skills、运行时骨架、架构说明、三平台安装测试、版本与发布文档。
- 结果：已完成；Harness 固化 `easy-dev-spec@7eb9b64cdb4c8c338c5871c3c759526f2c78fb8e` 的最终 validator/selector，一个或多个 selected Spec task 映射为一个 Harness task，并按来源仓库、任务、步骤、符号、测试和依赖证据保持可追踪。
- 关键约束：Canonical Spec 只读；无 manifest 的历史 Dev-Spec 保持旧流程；`hard`、`contract`、`integration` 三类依赖语义不混用；未提交、未推送、未发布 npm。

## 执行证据

| 类型 | 内容 |
|---|---|
| 关键文件 | `easy_dev_spec_protocol.py`、`easy_dev_spec.py`、`easy_coding_state.py`、`task.ts`、7 个阶段 skill、`dev-spec-skeleton.md`、Canonical fixture 与集成测试 |
| 验证命令 | easy-dev-spec 上游协议测试（67 tests）；`npm run build`；`npm test`（25 files / 269 tests）；`npm run lint`；`npm run typecheck`；`git diff --check`；源码/构建模板对比；隔离 npm cache 的 `npm pack --json`（53 entries）均通过 |
| 人工验收 | 用户确认 `0.10.0-beta.0` 实现结果，并同意进入记忆阶段 |
| 提交信息 | none |

## 业务记忆候选

- 业务概念 / 字段语义：无。
- 业务流程 / 状态流转：无。
- 业务规则 / 兼容背景：无 manifest 的历史 Dev-Spec 不进入 Canonical 选择流程。
- 上下游契约：easy-dev-spec 生产 `easy-dev-spec/v1`；Harness 只读消费并保存来源 SHA-256。
- 业务排障经验：无。

## 技术记忆候选

- 架构 / 接口决策：新增 `inspect-dev-spec`、`select-dev-spec-scope`、`create-task-from-spec`、`satisfy-spec-dependency`；多个 source task 仍只创建一个 Harness task，消费闭包按仓库确定性输出且不包含未选任务正文。
- 工程规则 / 工作流：ANALYSIS 生成带来源追踪的派生 `dev-spec.md`、`execution.jsonl`、`test-strategy.md`，不把运行进度写回 Canonical Spec；dispatch/result/review/verify 证据逐条保留 `repo_id` 和 `source_task_id`，全局证据不能替代 selected task 覆盖。
- 实现模式 / 复用写法：Unit 使用 `repo_id/source_task_id/source_step_ids/symbols/test_commands`；仓库路径通过 normalized remote 唯一匹配并保存为可移植路径。
- 易错点 / 修复策略：dirty 目标代码或来源测试文件即使 HEAD 等于 baseline 也必须判为 `scope-drifted`；相同 dependency target 有多条边时必须用 source task 消歧；持久化依赖记录必须与来源选择逐边一致，不能通过删除或改写记录绕过 `integration` 门禁。
- 验证经验：测试夹具和协议实现都要与最终 easy-dev-spec 产物固定一致，不能只满足 Harness 的 manifest 结构检查；发布包必须同时包含 wrapper 和固定版本的 protocol 模块。

## 不沉淀内容

- 临时 Git fixture SHA、npm pack 临时 cache 路径和逐次测试日志不进入长期记忆。

## 关联记忆

- 前置：`SM-20260804-008`、Easy Coding Harness 0.9 workflow mode upgrade。
- 后续：正式提交、推送或 npm beta 发布由后续显式任务执行。
