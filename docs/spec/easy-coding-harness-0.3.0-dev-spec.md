# easy-coding-harness - 0.3.0 升级 Dev Spec

> 本文档为实施级开发说明，描述 0.3.0 应当如何修改，供后续开发者据此实施。
> 文档本身不修改任何代码。涉及两个相互独立的主题：
> ① README 重写 + npm CHANGELOG 链接修复；② 记忆沉淀门控修复。

## 1. 文档适用信息

- 适用项目：`easy-coding-harness`（CLI 脚手架，把 Easy Coding harness 安装到各 agent 平台标准目录）
- 适用范围：0.3.0 版本的文档/打包修复 + 运行时记忆门控修复
- 应由谁引用：负责 0.3.0 实施的开发者（单仓库，无跨项目协同）
- 当前落盘位置：`docs/spec/easy-coding-harness-0.3.0-dev-spec.md`
- 拷贝到目标项目后的建议位置：无（即本仓库内文档，无需拷贝）

## 2. 背景与目标

### 2.1 需求摘要

- 本次需求：发布 0.3.0，解决两个独立问题
  1. README 没把"工具怎么用"讲清楚；且 npm 上 README 里的 CHANGELOG 链接点不动。
  2. 长期记忆沉淀的触发门控失灵：期望短期记忆 > 10 条才触发，实测仅 1 条就触发了长期沉淀。
- 目标用户 / 使用方：harness 使用者（看 README / npm 页面）+ harness 运行时的记忆归档流程。
- 需要解决的问题：见 2.2 与第 4 章现状。

### 2.2 目标与非目标

- 目标：
  - npm 页面 README 中的 CHANGELOG 链接可正常跳转。
  - README 以"如何使用本工具"为主线重写，并对齐真实 skill 清单。
  - 记忆沉淀严格遵守门控：短期记忆 > 10 才触发长期沉淀；触发时沉淀并删除更早的，保留最近 5 条。
- 非目标：
  - 不改动状态机阶段集合（仍是 8 阶段 + 2 终态）。
  - 不引入第三方 Python 依赖（hook 保持纯标准库）。
  - 不回灌完整发布历史到 README（保持版本策略摘要 + CHANGELOG 链接的现有约定）。

## 3. 输入依据

- 用户提示词：进行 0.3.0 升级；重写 README 表达工具用法；修复 npm README 的 CHANGELOG 链接；
  修复"1 条短期记忆即触发长期沉淀"，期望 > 10 触发、保留最近 5 条不沉淀。
- 用户截图：某项目运行 harness 时，短期记忆仅 `SM-20260623-001` 一条，长期记忆
  `BUSINESS + TECHNICAL + MEMORY` 索引各新增 12 条 —— 门控明显失效。
- 项目代码与目录：
  - `package.json`、`README.md`、`CHANGELOG.md`
  - `src/templates/shared-hooks/easy_coding_state.py`（运行时状态 API）
  - `src/templates/common/skills/ec-memory/SKILL.md`、`.../ec-workflow/SKILL.md`
  - `src/utils/config-yaml.ts`（memory 默认值来源）
- 相关全局 spec（非 `spec/dev/`）：`docs/spec/statusline-ready-stuck-fix-dev-spec.md`（0.2.1 状态 API
  收口方案，仅作背景参考，格式为 ec-analysis 风格）。

## 4. 当前代码现状

### 4.1 相关目录 / 模块

- `package.json`：包元数据。**当前不含 `repository` / `homepage` / `bugs` 字段。**
- `README.md`：现以"核心理念/架构"为主线；含一张"12 个 skill"表，**该表已过时**（见 4.3）。
- `CHANGELOG.md`：版本历史单一事实源，最新为 `## 0.2.1`。已在 `package.json` 的 `files` 中纳入。
- `src/templates/shared-hooks/easy_coding_state.py`：运行时状态 API。`transition_task(...)`
  在每次阶段转换写 `task.json` 并返回 `snapshot_state(...)`（JSON）。**纯标准库**
  （仅 `argparse/json/os/datetime/pathlib/sys`），**当前不读 `.easy-coding/config.yaml`，也不感知短期记忆目录。**
- `src/templates/common/skills/ec-memory/SKILL.md`：MEMORY_SHORT / MEMORY_LONG 阶段 skill。
- `src/utils/config-yaml.ts`：`createDefaultConfig` 给出 `memory.short_term_max: 10`、
  `memory.short_term_keep: 5`、`schema_version: 2`。

### 4.2 当前实现方式

- **CHANGELOG 链接**：README 第 43 行为 `完整更新日志见 [CHANGELOG.md](CHANGELOG.md)。`，相对链接。
- **记忆门控**：`ec-memory/SKILL.md` 的 `MEMORY_LONG` 段已有 `<HARD-GATE>`：
  > MEMORY_LONG IS A NO-OP WHEN SHORT MEMORY COUNT <= threshold.
  > 1. Count `.md` files in `.easy-coding/memory/short/`（schema-v2）。
  > 2. Read `memory.short_term_max`（default 10）。
  > 3. count <= max → 输出 no-op 并交回 ec-workflow 推进 COMPLETE；
  > 4. count > max → 进入蒸馏。

  即门控逻辑**依赖 agent 自己数文件并自觉遵守**。
- **状态机转换**：`ec-workflow/SKILL.md` 状态机表 `MEMORY_LONG` 行描述为
  "archive: long memory distillation"，**未标注其为条件性 no-op**，给"进入即蒸馏"留了暗示。
- **沉淀流程**：`ec-memory/SKILL.md` 的 distillation steps：
  > 1. Read `short_term_keep`（default 5）。Keep the latest N entries; the older entries become candidates.
  > 5. Retirement check：for older **long** entries decide delete / merge / deprecate.

  其中第 5 步针对**长期记忆**条目，**全流程没有"删除已消费的短期记忆文件"的动作**。

### 4.3 当前缺口

- **缺口 A（链接）**：`package.json` 缺 `repository` 字段。npm 渲染 README 时靠该字段把相对链接
  重写为仓库 blob URL；缺字段时相对链接落到 `https://www.npmjs.com/package/easy-coding-harness/CHANGELOG.md`
  → 404，因而"跳不动"。仓库实际在内网 GitLab：`gitlab.alibaba-inc.com:shixin.ysx/easy-coding-harness`。
- **缺口 B（README 内容）**：README 偏架构叙事，未以"如何使用"为主线；且 skill 表过时——
  `ec-init` 已从 `src/templates/common/skills/` 迁至 `src/templates/common/bundled-skills/`，
  现状为 10 个流程 skill + 2 个内置 skill（`ec-init`、`ec-meta`）。
- **缺口 C（门控失灵）**：HARD-GATE 文案已存在却被绕过（截图 1 条即触发）。
  **纯 prompt 文案约束不足以可靠拦截**，需要由脚本机械下发权威指令。
- **缺口 D（窗口不收敛）**：沉淀后不删除已消费的短期记忆。后果：短期目录无界增长；一旦 > 10，
  此后每个任务都会重复触发沉淀，与"滑动窗口"语义相悖，也与缺口 C 叠加放大问题。

## 5. 范围与非目标

### 5.1 本次范围

- 主题①：`package.json`（版本 + repository/homepage/bugs）、`README.md`（重写 + 绝对链接）、
  `CHANGELOG.md`（新增 0.3.0 段）、`package-lock.json`（版本同步）。
- 主题②：`easy_coding_state.py`（机械门控指令）、`ec-memory/SKILL.md`（消费指令 + 删除步骤）、
  `ec-workflow/SKILL.md`（标注 conditional）、新增 1 个 vitest 覆盖门控指令。

### 5.2 非目标

- 不改状态机阶段集合与既有 `VALID_TRANSITIONS`。
- 不引入 PyYAML 等第三方依赖。
- 不处理 `docs/spec/` 下既有 statusline 文档（不同需求，格式不同，并存即可）。

## 6. 模块与目录职责

| 模块 / 目录 | 职责 | 是否改动 | 说明 |
| --- | --- | --- | --- |
| `package.json` | 包元数据 | 是 | 版本 0.3.0 + repository/homepage/bugs |
| `package-lock.json` | 锁定版本 | 是 | 顶层 version 同步 0.3.0 |
| `README.md` | 使用说明 | 是 | 使用导向重写 + 绝对 CHANGELOG 链接 + 真实 skill 表 |
| `CHANGELOG.md` | 版本历史单一事实源 | 是 | 顶部新增 `## 0.3.0` |
| `src/templates/shared-hooks/easy_coding_state.py` | 运行时状态 API | 是 | MEMORY_LONG 门控指令计算与下发 |
| `src/templates/common/skills/ec-memory/SKILL.md` | 记忆归档 skill | 是 | 消费指令 + 补删除步骤 |
| `src/templates/common/skills/ec-workflow/SKILL.md` | 工作流状态机 | 是 | MEMORY_LONG 行标注 conditional |
| `src/utils/config-yaml.ts` | 配置默认值 | 否 | 仅作为 10/5 默认值的事实来源参考 |
| `test/` | 测试 | 是（新增） | 1 个 vitest 覆盖门控指令 |

## 7. 接口契约

### 7.1 对外接口

| 接口 / 方法 | 请求 | 响应 | 调用方 | 说明 |
| --- | --- | --- | --- | --- |
| `easy_coding_state.py transition --stage MEMORY_LONG --agent <id> [--session-file P]` | CLI args | JSON snapshot（**新增** `memory_long` 子对象） | ec-memory（经 skill 文案触发的工具调用） | 见 7.2 的 `memory_long` 结构 |

### 7.2 对内契约 / 共享类型

| 名称 | 位置 | 字段 / 方法 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `memory_long` 指令 | `easy_coding_state.py` transition 返回 | `action` `short_count` `short_term_max` `short_term_keep` `trim_count` | 仅当 `--stage == MEMORY_LONG` 时存在 | 见下 |

`memory_long` 结构（仅在 stage == MEMORY_LONG 时注入 snapshot）：

```json
"memory_long": {
  "short_count": 12,
  "short_term_max": 10,
  "short_term_keep": 5,
  "action": "distill",
  "trim_count": 7
}
```

判定规则：
- `action = "distill" if short_count > short_term_max else "no-op"`。
- `trim_count = max(0, short_count - short_term_keep)`（distill 时表示要沉淀并删除的更早条数；no-op 时为 0 或省略）。
- `short_term_max` / `short_term_keep` 来自 `.easy-coding/config.yaml` 的 `memory` 段，缺失回退 `10 / 5`。

## 8. 关键类 / 对象职责

| 类 / 对象 | 当前职责 | 本次改动 | 备注 |
| --- | --- | --- | --- |
| `transition_task(root, stage, agent, ...)` | 写 `task.json` 状态并返回 snapshot | stage==MEMORY_LONG 时计算并注入 `memory_long` | 复用既有 `snapshot_state` 返回结构 |
| `read_memory_config(root)`（新增） | — | 从 config.yaml 取 short_term_max/keep，缺失回退 10/5 | 极简定向解析，无 PyYAML |
| `count_short_memories(root)`（新增） | — | 数 `.easy-coding/memory/short/` 下含 `memory_schema:` 的 `.md` 文件 | schema-v2 计数 |

## 9. 数据结构与状态

### 9.1 关键数据结构

| 对象 | 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| `.easy-coding/config.yaml` `memory` | `short_term_max` | int | 是 | 触发阈值，默认 10 |
| `.easy-coding/config.yaml` `memory` | `short_term_keep` | int | 是 | 沉淀时保留的最近条数，默认 5 |
| 短期记忆文件 | 文件名 `{NNN}_{YYYYMMDD}_{slug}.md` | file | — | frontmatter 含 `memory_schema: 2` |

### 9.2 状态与流转

- 核心阶段：`MEMORY_SHORT → MEMORY_LONG → COMPLETE`（归档流，仅在用户验收后进入）。
- MEMORY_LONG 流转条件：
  - `short_count <= short_term_max` → **no-op**：不读长期记忆、不改任何文件，直接交回 ec-workflow 推进 COMPLETE。
  - `short_count > short_term_max` → **distill**：沉淀更早的 `short_count - short_term_keep` 条进长期记忆，
    更新 MEMORY.md 索引，**删除这些已消费的短期记忆文件**，只留最近 `short_term_keep` 条。
- 异常 / 拒绝条件：config.yaml 缺失或不可解析时按默认 10/5 处理，不报错。

## 10. 详细实施方案

### 10.1 总体改法

两个主题相互独立，可分别提交。主题①为文档/打包，主题②为运行时门控的"机械化 + 补删除"。

### 10.2 实施步骤

**主题①：README + CHANGELOG 链接**

1. `package.json`：`version` 改 `0.3.0`；新增字段：
   ```json
   "repository": { "type": "git", "url": "git+https://gitlab.alibaba-inc.com/shixin.ysx/easy-coding-harness.git" },
   "homepage": "https://gitlab.alibaba-inc.com/shixin.ysx/easy-coding-harness#readme",
   "bugs": { "url": "https://gitlab.alibaba-inc.com/shixin.ysx/easy-coding-harness/-/issues" }
   ```
2. `package-lock.json`：顶层 `version` 同步 `0.3.0`。
3. `README.md`：CHANGELOG 链接改绝对 URL
   `https://gitlab.alibaba-inc.com/shixin.ysx/easy-coding-harness/-/blob/master/CHANGELOG.md`（双保险，
   不依赖 npm 相对链接重写）。
4. `README.md` 重写为使用导向，建议结构：
   - 一句话定位 → 安装（保留三种方式 + beta 说明）→ **两阶段初始化**（`easy-coding init` 装文件，
     `/ec-init` 让 agent 理解项目）→ **日常入口 `/ec-workflow`** + 8 阶段状态机简图 → 命令表 →
     平台/触发符表 → 版本策略摘要 + CHANGELOG 链接 → 开发者构建。
   - skill 表对齐真实清单：10 个流程 skill（ec-workflow / ec-brainstorming / ec-analysis /
     ec-implementing / ec-reviewing / ec-verification / ec-memory / ec-task-management /
     ec-task-close / ec-git）+ 2 个内置 skill（ec-init、ec-meta），按"流程 / 内置"分组。
5. `CHANGELOG.md`：顶部新增 `## 0.3.0`，bullet 覆盖：repository 字段修复 npm 链接、README 使用导向重写、
   记忆沉淀门控机械化 + 补删除步骤。

**主题②：记忆门控**

6. `easy_coding_state.py`：新增 `read_memory_config(root)`、`count_short_memories(root)`；
   在 `transition_task` 内，`stage == "MEMORY_LONG"` 时把 `memory_long` 指令并入返回的 snapshot dict。
   - `read_memory_config`：逐行读 config.yaml，在 `memory:` 段下匹配 `short_term_max:` / `short_term_keep:`
     的整数；任一缺失回退 10 / 5。**不依赖 PyYAML。**
   - `count_short_memories`：遍历 `.easy-coding/memory/short/*.md`，统计内容含 `memory_schema:` 的文件数。
7. `ec-memory/SKILL.md`：
   - 把 HARD-GATE 改为"**以 transition 输出里的 `memory_long` 指令为权威**：`action == no-op` 即交回
     ec-workflow，不读长期记忆、不改任何文件；不要自己数文件来推翻指令"。
   - distillation 流程**补删除步骤**：成功蒸馏更早的 `trim_count` 条并更新 MEMORY.md 索引后，
     **删除这些已消费的短期记忆文件**，只保留最近 `short_term_keep` 条。
   - 明确区分语义：此处"删除短期记忆"是**蒸馏后窗口滑动**（知识已转入长期记忆），不属于 Boundaries 里
     "对长期知识的破坏性删除（需先问用户）"，两条规则不冲突。
8. `ec-workflow/SKILL.md`：状态机表 `MEMORY_LONG` 行改为 "archive: long memory distillation
   **(conditional — no-op 当短期记忆未超阈值)**"，并注明以 transition 返回的 `memory_long` 指令为准。
9. 新增 1 个 vitest（参照 `test/configurators/*.test.ts` 的 child_process 思路），spawn
   `easy_coding_state.py transition --stage MEMORY_LONG` 打到临时 `.easy-coding` fixture，断言指令。

### 10.3 关键注意点

- 模板（`src/templates/**`）改完需执行 `npm run build`（`copy-templates` 纯拷贝）同步到 `templates/`，
  否则发布物里的 hook/skill 仍是旧版。
- 存量项目要拿到新 hook/skill 需执行 `easy-coding upgrade`。
- `memory_long` 指令在 transition 时刻计算——此时 MEMORY_SHORT 已写入本任务的短期记忆条目，
  计数时序正确。
- 删除短期记忆只在**蒸馏成功后**执行，避免知识未落长期记忆就丢失。

## 11. 联调依赖

无（单仓库、无上下游项目联调）。

## 12. 验收标准

- npm 页面（或 `npm pack` 后本地校验）README 中 CHANGELOG 链接指向可访问的 GitLab blob URL，可跳转；
  `package.json` 含 repository 字段，npm 页面 "Repository" 侧栏可点。
- README 主链路为 install → init → /ec-init → /ec-workflow；skill 表与磁盘实际目录一致（10 + 2）。
- `CHANGELOG.md` 顶部有 `## 0.3.0` 段；`package.json` / `package-lock.json` 版本为 0.3.0。
- 记忆门控：
  - 短期记忆 1 条时 `transition --stage MEMORY_LONG` 返回 `memory_long.action == "no-op"`，
    且 ec-memory 文案要求据此直接 no-op。
  - 短期记忆 12 条时返回 `action == "distill"`、`trim_count == 7`、`short_term_keep == 5`；
    ec-memory 文案要求蒸馏更早 7 条、删除之、保留最近 5 条。
- `npm run build && npm test && npm run lint && npm run typecheck` 全绿。

## 13. 风险与回退点

### 13.1 主要风险

- **内网仓库可达性**：GitLab 链接对外网 npmjs.com 访问者不可达；但该工具面向内网用户，可接受。
  若改为公开发布，需把 CHANGELOG 指向公开可达位置。
- **config.yaml 极简解析**：定向行匹配若遇到非常规缩进/注释可能漏读 → 已用默认 10/5 兜底，不致崩溃。
- **删除短期记忆不可逆**：必须确保删除前蒸馏与索引更新已成功；建议实施时按"先沉淀落盘、再删除"顺序。
- **存量项目未 upgrade**：旧安装仍是旧行为；CHANGELOG/升级说明需提示运行 `easy-coding upgrade`。

### 13.2 回退方案

- 主题①纯文档/元数据，回退即还原 `package.json` / `README.md` / `CHANGELOG.md`。
- 主题②回退：移除 `easy_coding_state.py` 的 `memory_long` 注入与两个 helper、还原两个 SKILL.md；
  门控退回纯文案版本（即 0.2.1 行为）。两主题独立提交，可单独回退。
