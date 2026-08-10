## 技术方案：[[EC_TODO:任务标题]]

### 项目模式
[[EC_TODO:初创项目/迭代项目]]

### 任务类型
[[EC_TODO:新功能 / Bug 修复 / 重构 / 性能优化 / 前端设计实现]]

### 需求解析
- **目标**：[[EC_TODO:真正要解决的问题]]
- **输入**：[[EC_TODO:用户输入 / 系统输入 / 触发条件]]
- **输出**：[[EC_TODO:先声明交付形态（改代码 / 出文档），再写最终交付结果。交付形态须忠于用户原始需求，不得擅自降级]]
- **边界**：[[EC_TODO:明确不做什么]]

### 现状
- **相关代码 / 页面 / 接口 / 模块**：[[EC_TODO:基于实际文件与代码的现状说明]]
- **当前实现方式**：[[EC_TODO:现在是如何工作的]]
- **现有问题 / 缺口**：[[EC_TODO:为什么需要改]]
- **证据**：[[EC_TODO:引用的关键文件、类、页面、接口，含 file:line]]

### 冲突摘要
- 需求 vs RULES：[[EC_TODO:填写结果或“无冲突”]]
- 需求 vs ABSTRACT：[[EC_TODO:填写结果或“无冲突”]]
- 需求 vs 现有代码：[[EC_TODO:填写结果或“无冲突”]]
- Dev-Spec vs 现有代码：[[EC_TODO:填写结果或“无冲突”]]

### 决策闭环
decision_status: [[EC_TODO:仅当所有实质性问题均已解决并回填后写 closed]]
- **已解决问题与结论**：[[EC_TODO:逐项记录影响技术路线、接口、模型、状态、范围或验收的问题及最终结论；无则写“无”]]
- **确认依据**：[[EC_TODO:用户答复、冻结 Spec、现有代码证据或“无额外决策”]]

### Canonical Spec 来源
- **来源**：[[EC_TODO:非 Canonical 任务写“无”；否则填写 repo-relative path、spec_id、revision、SHA-256]]
- **选择任务 / 仓库**：[[EC_TODO:非 Canonical 任务写“无”；否则填写 selected task IDs 与 repo IDs]]
- **消费闭包**：[[EC_TODO:非 Canonical 任务写“无”；否则填写 contracts、direct dependencies、changes、steps、tests 摘要]]
- **基线与冲突**：[[EC_TODO:非 Canonical 任务写“无”；否则逐仓填写 exact/scope-unchanged/scope-drifted/baseline-unavailable 及处理结论]]
- **待闭合 integration**：[[EC_TODO:非 Canonical 任务或不存在时写“无”；否则列依赖边和证据要求]]

### 影响面分析
- **涉及模块**：[[EC_TODO:涉及模块]]
- **核心类 / 页面 / 接口**：[[EC_TODO:核心类 / 页面 / 接口]]
- **数据库变更**：[[EC_TODO:有/无]]
- **接口变更**：[[EC_TODO:有/无]]
- **关联历史任务**：[[EC_TODO:相关短期记忆 ID；无则“无”]]

### 改动范围
> 只列真实项目源码/配置文件的改动。禁止把 `.easy-coding/` 下的 harness 产物（dev-spec / execution.jsonl / test-strategy / 记忆 / 报告等）当作改动对象。本表为空仅允许用于"用户明确要求的无代码交付形态"；代码类任务（重构/修复/功能）若此表为空，即为自我降级。

| 改动文件 | 改动类型 | 文件编码 | 改动核心内容 |
|----------|---------|---------|-------------|
| `[[EC_TODO:文件路径]]` | 新增 | 项目编码 [[EC_TODO:编码]]，依据：[[EC_TODO:编码依据]] | [[EC_TODO:核心改动]] |
| `[[EC_TODO:文件路径]]` | 修改 | 保持原编码 [[EC_TODO:编码]] | [[EC_TODO:核心改动]] |
| `[[EC_TODO:文件路径]]` | 删除 | — | [[EC_TODO:删除原因]] |

### 修改方案
- **总体改法**：[[EC_TODO:一句话说清改哪里、怎么改]]
- **后端改动**：[[EC_TODO:填写改动；不涉及则写“不涉及”]]
- **前端改动**：[[EC_TODO:填写改动；不涉及则写“不涉及”]]
- **兼容处理**：[[EC_TODO:旧逻辑如何迁移、保留或替换]]
- **风险点**：[[EC_TODO:最容易出问题的位置]]

### 实施拆解

| 单元 | 说明 | 类型 | 仓库 / 来源任务 / 步骤 | 涉及文件 / 符号 | 依赖 | 验收条件 | 测试点 / 命令 | 跨单元契约 |
|------|------|------|----------------------|-----------------|------|---------|---------------|-----------|
| U1 | [[EC_TODO:单元标题]] | [[EC_TODO:backend/frontend/test/...]] | [[EC_TODO:普通任务写“当前仓库 / 无 / 无”；Canonical 写 repo_id / source_task_id / source_step_ids]] | [[EC_TODO:文件与 symbols]] | — | [[EC_TODO:可验证结果]] | [[EC_TODO:定向验证与 test_commands]] | [[EC_TODO:输入输出或“无”]] |
| U2 | [[EC_TODO:单元标题]] | [[EC_TODO:单元类型]] | [[EC_TODO:仓库 / 来源任务 / 步骤]] | [[EC_TODO:文件与 symbols]] | — | [[EC_TODO:可验证结果]] | [[EC_TODO:定向验证与命令]] | [[EC_TODO:输入输出或“无”]] |
| U3 | [[EC_TODO:单元标题]] | [[EC_TODO:单元类型]] | [[EC_TODO:仓库 / 来源任务 / 步骤]] | [[EC_TODO:文件与 symbols]] | U1, U2 | [[EC_TODO:可验证结果]] | [[EC_TODO:定向验证与命令]] | [[EC_TODO:与 U1/U2 的契约]] |

**执行策略**：[[EC_TODO:parallel / sequential / single]]
- 第一批（并行）：U1 [[EC_TODO:单元标题]] ｜ U2 [[EC_TODO:单元标题]]
- 第二批（等待第一批）：U3 [[EC_TODO:单元标题]]
（若 single：按 Workflow Mode 决定由主 Agent 直接执行或派发子 Agent）

### 测试策略

| 测试点 | 级别 | 归属单元 | 方式 | 验证命令 |
|--------|------|---------|------|---------|
| [[EC_TODO:测试点描述]] | 必测 | U1 | 单测 | `npm test -- --filter=xxx` |
| [[EC_TODO:测试点描述]] | 应测 | U2 | 快照 | `npm test -- --snapshot` |

- **人工验收**：[[EC_TODO:用户需要检查的关键行为]]
- **无法验证项**：[[EC_TODO:无 / 说明缺失环境、数据或权限]]

### Workflow Mode
- **项目配置**：[[EC_TODO:adaptive / fast / standard / strict]]
- **Session 覆盖**：[[EC_TODO:无 / adaptive / fast / standard / strict]]
- **机械最低模式**：[[EC_TODO:fast / standard / strict]]
- **推荐并选择**：[[EC_TODO:fast / standard / strict]]
- **选择原因**：[[EC_TODO:风险、范围和兼容性依据]]
- **状态内执行差异**：[[EC_TODO:IMPLEMENT / REVIEW / VERIFICATION / MEMORY 将采用的深度]]

### 风险与注意事项
- [[EC_TODO:风险 1]]
- [[EC_TODO:风险 2]]
