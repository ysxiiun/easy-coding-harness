# Easy Coding Harness 使用说明

## 这是什么

Easy Coding Harness 是一个 AI 编码工作流脚手架。它通过 CLI 将一套标准化的 Skills（技能）、Hooks（钩子）和约束规则安装到你的项目中，让 AI Agent 在编码时遵循严格的工作流程——从需求分析、方案确认、编码实现、代码审查到验证归档，每个阶段都有硬门控，防止 AI 跳步、乱改或空谈。

## 为什么需要它

裸用 AI Agent 编码时，常见问题包括：

- AI 不分析就直接开写，改到一半发现方向错了
- 修改了不该改的文件，引入意外的编码转换
- 方案只是复述需求，没有基于真实代码的落地设计
- 没有测试策略，完成后说 "should pass" 就交差
- 跨会话时丢失所有上下文，每次都要重新解释

easy-coding-harness 解决这些问题：**6 个工作阶段 + 2 个终态、四种确认模式**的状态机控制 AI 行为，**任务持久化**让进度跨会话保存，**记忆系统**让过往决策和教训在新任务中被参考，**跨 Agent 交接**让你在不同 AI 平台间无缝切换。

## 技术亮点

- **三平台原生支持**：Claude Code、Codex、Qoder——安装后 Agent 原生识别 Skills，无需额外配置
- **分层确认模式**：approve 逐边审批、guard 只把关两个关键边、lite 使用相同确认门但跳过 REVIEW、auto 自动执行全部合法工作流边；四者都保留 VERIFICATION 新鲜证据硬门，关闭任务始终要求显式操作
- **子代理并行调度**：大任务自动拆解为并行单元，通过任务卡（Task Card）标准化子代理的输入输出
- **记忆驱动的分析**：短期/长期记忆在分析阶段被强制读取和引用，不只是写入
- **Dead Drop 跨 Agent 协调**：`.easy-coding/` 目录是平台无关的协调层，Agent 间通过文件系统交换状态
- **文件编码保护**：改动范围表强制声明文件编码，防止 AI 擅自转换编码

---

## 安装

### 前置要求

- Node.js >= 18
- Python 3（用于 Hook 脚本）
- 已安装的 AI Agent（Claude Code / Codex / Qoder 至少一个）

### 正式版安装

```bash
npm install -g easy-coding-harness
```

### Beta 版安装

```bash
npm install -g easy-coding-harness@beta
```

### 源码安装（开发者/内网环境）

```bash
git clone <仓库地址>
cd easy-coding-harness
./install.sh
```

### 验证安装

```bash
easy-coding --version
```

### 更新

```bash
# npm 安装
npm update -g easy-coding-harness

# 源码安装
git pull && ./install.sh
```

---

## 快速开始

### 第一步：初始化项目

在你的项目根目录执行：

```bash
easy-coding init
```

交互式菜单会让你选择 Agent 平台（空格勾选，回车确认）：

```
◆ Select agent platforms
│ ◻ Claude Code
│ ◻ Codex
│ ◻ Qoder
└
```

你也可以跳过交互，直接指定平台：

```bash
# 单平台
easy-coding init --agent=claude-code

# 多平台
easy-coding init --agent=claude-code,qoder
```

init 完成后你会看到：

```
┌─────────────────────────────────────────────┐
│                                             │
│  Claude Code: /ec-init                      │
│                                             │
├─────────────────────────────────────────────╯
│
└  easy-coding harness installed. Open your agent and run ec-init.
```

此时 CLI 的工作结束——Skills、Hooks、配置文件都已安装到位，但项目知识（SOUL.md、RULES.md 等）还没有生成。这需要 AI 来做。

### 第二步：在 Agent 中完成项目知识初始化

打开你选择的 AI Agent，执行初始化 Skill：

| 平台 | 命令 |
|------|------|
| Claude Code | `/ec-init` |
| Codex | `$ec-init` |
| Qoder | `/ec-init` |

Agent 会自动分析你的项目代码，生成：

- **SOUL.md**：项目身份和对话标准
- **RULES.md**：编码规范（语言、命名、注释）
- **ABSTRACT.md**：项目架构概要（已有项目）或骨架版（初创项目）
- **TEST_STRATEGY.md**：项目级测试策略

初始化完成后，你的项目就正式接入了 easy-coding 工作流。

---

## 日常使用

### 核心入口：ec-workflow

日常开发只需要记住一个入口——`ec-workflow`：

```
/ec-workflow     （Claude Code / Qoder）
$ec-workflow     （Codex）
```

ec-workflow 会自动处理所有场景：

| 场景 | ec-workflow 的行为 |
|------|-------------------|
| 新任务 | 创建任务目录，进入 INIT 阶段 |
| 中断的任务 | 从上次中断的阶段继续 |
| 交接的任务 | 识别来源 Agent，读取交接摘要，从当前阶段继续 |
| 无任务 | 展示 Ready 状态，等待用户输入需求 |

### 完整工作流程

#### 1. 开始一个任务

在 Agent 中调用 `/ec-workflow`（或 `$ec-workflow`），然后描述你的需求：

```
用户：/ec-workflow
Agent：> **Easy Coding** · **Guard** · Ready · ...
       没有活跃任务。请描述你的需求。

用户：给用户列表页添加搜索功能，支持按用户名和邮箱搜索
```

Agent 会创建任务并进入 INIT；INIT 工作完成后自动进入 ANALYSIS。

状态边由生效确认模式控制：session 覆盖优先于项目 `behavior.confirm_mode`。`approve`
除两条机械边外逐边确认，`guard`（默认）与 `lite` 只确认 `ANALYSIS → IMPLEMENT` 与
`VERIFICATION → MEMORY`；lite 从 IMPLEMENT 直接进入 VERIFICATION，`auto` 自动执行其他
合法工作流边。确认模式不会跳过方案、
验证或记忆检查点，也不会自动关闭任务。

#### 2. 需求分析（ANALYSIS）

Agent 进入 ANALYSIS 后严格按以下顺序工作：

1. 前两个工具调用先读取并原样落盘技术方案骨架。
2. 只读分析项目代码、RULES、ABSTRACT 和过往记忆；发现技术路线、接口、范围等待确认问题时立即询问，不提前填充方案。
3. 所有决策解决后，才填充并输出完整技术方案，同时写入有效的 `execution.jsonl` plan。代码任务还要生成非空 `test-strategy.md`；显式无代码任务使用受限空文件范围并禁止生成该文件。
4. 只有对应交付模式要求的产物完整且不含骨架占位符时，状态 API 才允许申请或确认进入 IMPLEMENT。

最终技术方案不包含 `[阶段：ANALYSIS]` 或“待用户决策”章节，内容包括：

- 需求解析（目标/输入/输出/边界）
- 现状分析（基于真实代码，引用文件和行号）
- 改动范围表（文件 + 改动类型 + 编码 + 核心改动）
- 修改方案
- 实施拆解表（并行/串行策略）
- 测试策略表
- 风险与注意事项

#### 3. 确认模式与状态边

当生效模式要求确认时，阶段完成后状态仍停留在当前阶段，同时写入
`pending_transition`。你通常有三个选择：

```
1. 确认进入或返回目标阶段
2. 交接给其他智能体
3. Other（修改、补充或其他指令）
```

`approve` 除 INIT → ANALYSIS、MEMORY → COMPLETE 外都需要上述确认；`guard` 与 `lite` 只在
ANALYSIS → IMPLEMENT、VERIFICATION → MEMORY 确认；lite 跳过 REVIEW，`auto` 不展示状态边确认。自动边仍需
通过状态 API 的合法边与产物校验。

approve 模式下 IMPLEMENT 完成后使用特殊选择：

```text
1. 确认进入 REVIEW（推荐）
2. 跳过 REVIEW，直接进入 VERIFICATION
3. 交接给其他智能体
4. Other（由原生 free-form 输入承接）
```

Agent 必须优先使用当前平台原生的选项功能展示对应业务分支，并使用原生 free-form Other 承接修改意见；仅当平台没有原生选项能力时，才退回纯文本编号选项。

你可以：
- 修改方案中的任何部分（Agent 会输出完整修订版）
- 调整测试策略（推翻不测判定、增减测试点）
- 修改文件编码声明

#### 4. 编码实现（IMPLEMENT）

Agent 按确认的方案执行编码，严格限制在改动范围表列出的文件内。

- 大任务会自动拆解为并行子代理执行
- 每完成一个文件/模块会报告进度
- 按测试策略编写测试

显式 `doc` / `analysis` / `report` 只读任务是例外：不生成 `test-strategy.md`；IMPLEMENT 必须留下匹配的 dispatch/result，由只读子代理返回完整 deliverable，主 Agent 原样展示后按生效模式进入 COMPLETE。此类任务不进入 REVIEW、VERIFICATION 或 MEMORY，也不写任务记忆。

#### 5. 代码审查（REVIEW，可跳过，仅代码任务）

代码任务可选择进入 REVIEW，由 Agent 对代码改动进行多维度审查并自动修复可修问题；也可在 IMPLEMENT 完成后明确跳过 REVIEW，但不能跳过 VERIFICATION。只读任务不会到达本阶段。

#### 6. 验证（VERIFICATION）

lint + typecheck + test 三项并行执行。全部通过后展示结果；approve/guard/lite 等待手动验收，auto 按绿色结果自动进入 MEMORY。

验收期间：
- 小修复：Agent 修复后重新验证
- 满意：确认归档
- 取消：中断任务

#### 7. 归档（MEMORY → COMPLETE）

你确认满意并进入 MEMORY 后，Agent 在同一状态内：
1. 生成短期记忆
2. 调用状态 API 检查长期记忆门禁，按结果沉淀或 no-op
3. 更新 ABSTRACT（如有架构变更）
4. 记忆处理完成后调用受限 `auto-transition` 自动进入 COMPLETE，并输出任务总结

---

## 头脑风暴

在开始编码前，可以先用头脑风暴探索设计方向：

```
/ec-brainstorming     （Claude Code / Qoder）
$ec-brainstorming     （Codex）
```

Agent 会通过一次一个问题的方式帮你梳理需求、提出方案、呈现设计文档。

设计确认后会**自动创建任务并进入分析阶段**——无需手动调用 ec-workflow。

---

## 任务管理

### 查看和创建任务、配置当前 session

```
/ec-task-management     （Claude Code / Qoder）
$ec-task-management     （Codex）
```

展示所有任务列表（活跃/已完成/已关闭），或创建新任务。每次唤起都会同时展示项目
确认模式、session 覆盖和最终生效模式，即使任务列表为空也不会省略；可通过对话设置
`approve/guard/lite/auto` session 覆盖，或恢复项目默认值。

### 当前会话不使用 Harness

```
/ec-no-harness     （Claude Code / Qoder）
$ec-no-harness     （Codex）
```

该 skill 只在当前 session 旁路 Easy Coding，不关闭其他 hooks，也不忽略其他 skills。
现有任务和 pending 状态保持不变，新会话自动恢复 Harness。

### 中断任务

```
/ec-task-close     （Claude Code / Qoder）
$ec-task-close     （Codex）
```

或者直接告诉 Agent"取消当前任务"——Agent 会自动识别中断意图。

中断的任务不会执行记忆归档（未完成的记忆是脏数据）。

---

## 跨 Agent 使用

easy-coding-harness 支持在不同 Agent 之间无缝切换——比如用 Claude Code 做分析、Codex 做编码、再回 Claude Code 做审查。

### 安装多个 Agent

初始化时选择多个平台：

```bash
easy-coding init --agent=claude-code,qoder
```

已有项目追加新平台：

```bash
easy-coding add-agent --agent=codex
```

### 交接流程

**每个需要确认的边界都可自然交接**：

1. 在 Claude Code 中完成任一阶段，看到待确认的目标边
2. 选择"交接给其他智能体"
3. Claude Code 写入交接记录（handoff），通过状态 API 更新当前任务指针
4. 打开 Qoder（或其他 Agent）
5. 执行 `/ec-workflow`，自动发现交接任务并恢复

handoff 会保留当前阶段和 `pending_transition`。因此代码 IMPLEMENT 完成后可交给另一个 Agent 决定进入 REVIEW 或跳过 REVIEW，REVIEW 完成后也可交给另一个做 VERIFICATION；接手方不会重复执行已完成阶段。自动边不提供交接，只读任务展示报告后直接结束。

### 跨会话恢复

即使不换 Agent，只是关闭了会话再重新打开，ec-workflow 也能自动恢复之前的任务进度。

状态行会提示当前状态：

```
> **Easy Coding** · **Guard** · `add-search` · `IMPLEMENT`
```

如果是交接来的任务：

```
> **Easy Coding** · **Guard** · `add-search` · `IMPLEMENT` · Handoff -> `claude-code`
```

---

## CLI 命令参考

### easy-coding init

初始化项目，安装 Skills、Hooks、配置文件。

```bash
# 交互式（推荐首次使用）
easy-coding init

# 指定平台
easy-coding init --agent=claude-code
easy-coding init --agent=claude-code,codex,qoder
```

### easy-coding add-agent

为已初始化的项目追加 Agent 平台支持。

```bash
# 交互式
easy-coding add-agent

# 指定平台
easy-coding add-agent --agent=qoder
```

### easy-coding upgrade

将项目中的功能文件升级到当前 CLI 版本。

```bash
easy-coding upgrade
```

升级策略：
- **覆盖**：Skills、Hooks、子代理定义、平台配置、主约束文件生成区域
- **原位迁移**：config.yaml 更新 `harness_version`，并在 0.7.0 将旧确认布尔值迁移为 `behavior.confirm_mode` 后删除旧字段；旧 task/session 状态元数据继续幂等迁移
- **内容保留**：任务 dev-spec / execution / test-strategy、memory 内容、SOUL.md、RULES.md、ABSTRACT.md 等用户资产不被覆盖

### easy-coding config

交互修改当前项目的确认模式：

```bash
easy-coding config
```

命令仅在项目 Harness 与 CLI 版本完全一致时修改配置；若版本不一致，先执行
`easy-coding upgrade` 或更新 CLI。

### easy-coding status

查看项目安装状态。

```bash
easy-coding status
```

---

## Skill 速查表

| Skill | 用途 | 何时使用 |
|-------|------|---------|
| `ec-init` | 项目知识初始化 | CLI init 后首次使用 |
| `ec-workflow` | 工作流主入口 | 日常开发——新任务/恢复/交接 |
| `ec-brainstorming` | 头脑风暴设计 | 编码前探索设计方向 |
| `ec-analysis` | 需求分析 | ec-workflow 自动派发 |
| `ec-implementing` | 代码实现或只读交付 | ec-workflow 自动派发 |
| `ec-reviewing` | 代码审查 | ec-workflow 自动派发 |
| `ec-verification` | 验证闸门 | ec-workflow 自动派发 |
| `ec-memory` | 记忆归档 | ec-workflow 自动派发 |
| `ec-task-management` | 任务与 session 面板 | 查看/创建任务，查看或修改当前会话确认模式 |
| `ec-task-close` | 中断任务 | 取消当前任务 |
| `ec-no-harness` | 当前 session 旁路 Harness | 临时使用原生 Agent 能力 |
| `ec-git` | Git 纪律 | 涉及 git 操作时自动激活 |
| `ec-meta` | Harness 自身信息 | 理解/定制本地架构 |

其中 `ec-analysis` 到 `ec-memory` 是工作流阶段 Skill，由 ec-workflow 自动派发，通常不需要手动调用。

---

## 项目目录结构

init 后项目中会出现以下目录：

```
my-project/
├── .claude/                    # Claude Code 平台（如已安装）
│   ├── skills/ec-*/SKILL.md   # Agent 原生识别的 Skills
│   ├── hooks/*.py             # Agent 原生触发的 Hooks
│   ├── agents/*.md            # 子代理定义
│   └── settings.json          # Hook 配置
│
├── .qoder/                    # Qoder 平台（如已安装）
│   ├── hooks/*.py
│   ├── agents/*.md
│   └── settings.json
│
├── CLAUDE.md                  # Claude Code 主约束文件
├── AGENTS.md                  # Codex/Qoder 主约束文件
│
└── .easy-coding/              # 运行时数据（所有平台共享）
    ├── config.yaml            # 项目配置
    ├── sessions/              # 会话状态（不入 git）
    ├── SOUL.md                # 项目身份（ec-init 生成）
    ├── RULES.md               # 编码规范（ec-init 生成）
    ├── ABSTRACT.md            # 项目架构（ec-init 生成）
    ├── TEST_STRATEGY.md       # 项目级测试策略
    ├── tasks/                 # 任务持久化
    │   └── {MM-DD-name}/
    │       ├── task.json      # 任务元数据
    │       ├── dev-spec.md    # 技术方案
    │       ├── execution.jsonl # 执行计划+日志
    │       └── test-strategy.md # 仅代码任务生成
    ├── memory/                # 记忆系统
    │   ├── short/             # 短期记忆
    │   └── long/              # 长期记忆
    └── spec/                  # 设计文档
```

---

## FAQ

### Q: 同时安装 Claude Code 和 Qoder 时 Skill 出现重复怎么办？

v0.1.5 已修复。Qoder 运行时会同时扫描 `.claude/skills/` 和 `.qoder/skills/`，新版本在检测到 `.claude/skills/` 已有 ec-* 时自动跳过 `.qoder/skills/` 的写入。

如果你是从旧版本升级，执行 `easy-coding upgrade` 即可。

### Q: 更新了 CLI 后项目中的 Skills 还是旧版？

执行 `easy-coding upgrade`，会将项目中的功能文件更新到最新版本，同时保留你的配置和任务数据。

### Q: 安装后能不走 easy-coding 工作流直接对话吗？

不能完全绕过。easy-coding 通过 Hook 在每次用户输入时自动注入工作流状态，状态行会始终出现在 Agent 回复中。如果你想在某个项目中暂时禁用 easy-coding 行为，可以设置环境变量 `EC_HOOKS=0` 来跳过 Hook 注入，或者在不需要 easy-coding 的项目中不执行 `easy-coding init`。

### Q: 如何自定义编码规范？

ec-init 生成的 RULES.md 可以直接编辑。修改后下次任务分析会自动读取更新后的规范。

### Q: 如何理解和定制 harness 架构？

使用 `/ec-meta`（或 `$ec-meta`）——它提供架构说明和本地定制指导，包括修改工作流、修改规范、添加自定义 Skill 等。
