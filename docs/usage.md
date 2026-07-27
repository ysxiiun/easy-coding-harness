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

easy-coding-harness 解决这些问题：**6 个工作阶段 + 2 个终态、审批与执行深度双模式**的状态机控制 AI 行为，**任务持久化**让进度跨会话保存，**记忆系统**让过往决策和教训在新任务中被参考，**跨 Agent 交接**让你在不同 AI 平台间无缝切换。

## 技术亮点

- **三平台原生支持**：Claude Code、Codex、Qoder——安装后 Agent 原生识别 Skills，无需额外配置
- **双模式控制**：approval_mode 控制等待，workflow_mode 控制状态内执行深度；Adaptive 默认按任务风险解析为 Fast、Standard 或 Strict
- **按需 Agent 调度**：低风险单元允许主 Agent 执行，大任务和高风险任务仍通过任务卡分派独立 Agent
- **按需记忆分析**：先检索元数据，只读取与当前模块、文件和历史决策相关的记忆
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
Agent：> **Easy Coding** · **Approval: Guard** · **Workflow: Adaptive** · Ready · ...
       没有活跃任务。请描述你的需求。

用户：给用户列表页添加搜索功能，支持按用户名和邮箱搜索
```

Agent 会创建任务并进入 INIT；INIT 工作完成后自动进入 ANALYSIS。

状态边是否等待由 `approval_mode` 控制：session 覆盖优先于项目配置。状态内执行深度由
`workflow_mode` 控制，默认 Adaptive 在 ANALYSIS 结束时解析并冻结具体模式。所有新代码
任务都进入 REVIEW；任何模式都不会跳过方案、审查、验证或记忆检查点。Confirm 只在
ANALYSIS → IMPLEMENT 等待一次，之后的自动推进仍必须先通过对应检查点。

#### 2. 需求分析（ANALYSIS）

Agent 进入 ANALYSIS 后严格按以下顺序工作：

1. 前两个工具调用先读取并原样落盘技术方案骨架。
2. 只读分析项目代码、相关 RULES/ABSTRACT 章节，并先检索记忆元数据再按需读取正文。
3. 所有决策解决后，才填充并输出完整技术方案，同时写入有效的 `execution.jsonl` plan。代码任务还要生成非空 `test-strategy.md`；显式无代码任务使用受限空文件范围并禁止生成该文件。
4. 只有对应交付模式要求的产物完整且不含骨架占位符时，状态 API 才允许申请或确认进入 IMPLEMENT。

最终技术方案不包含 `[阶段：ANALYSIS]` 或“待用户决策”章节，内容包括：

- 需求解析（目标/输入/输出/边界）
- 现状分析（基于真实代码，引用文件和行号）
- 改动范围表（文件 + 改动类型 + 编码 + 核心改动）
- 修改方案
- 实施拆解表（并行/串行策略）
- 测试策略表
- Workflow Mode（配置值、风险下限、推荐值、原因和各状态执行差异）
- 风险与注意事项

#### 3. 审批模式、工作流模式与状态边

当生效模式要求确认时，阶段完成后状态仍停留在当前阶段，同时写入
`pending_transition`。你通常有三个选择：

```
1. 确认进入或返回目标阶段
2. 交接给其他智能体
3. Other（修改、补充或其他指令）
```

`approve` 除机械边外逐边确认；`guard` 只确认 ANALYSIS → IMPLEMENT 与
VERIFICATION → MEMORY；`confirm` 只确认 ANALYSIS → IMPLEMENT，之后自动推进；
`auto` 不展示状态边确认。自动边仍需通过状态 API 的方案、工作流模式、REVIEW 指纹和
VERIFICATION 指纹门禁。IMPLEMENT 完成后的代码主链固定进入 REVIEW。

Agent 必须实际调用当前平台原生的选项功能展示对应业务分支，并使用原生 free-form Other 承接修改意见。只有平台明确保证永久等待时，Agent 才可仅调用原生选择，并禁用或省略 timeout / auto-resolution；较长的有限超时不算永久等待。无法确认永久等待时，Agent 会先在普通消息中输出完整文本编号兜底，再调用一次原生选择；即使超时直接结束当前轮，编号仍留在会话中。原生选择返回空值、被取消、超时或无法解析时，任务继续停留在当前阶段并保留 `pending_transition`，Agent 不再重试；若此前未预输出编号且控制权返回，则立即补充编号。稍后回复 `1` 确认、`2` 交接，回复 `3` 或 `3: 修改内容` 进入 Other。恢复流程会先消费这个编号，再决定是否重新展示门禁，因此无需重新唤起原生选择框。

你可以：
- 修改方案中的任何部分（Agent 会输出完整修订版）
- 调整测试策略（推翻不测判定、增减测试点）
- 修改文件编码声明
- 在机械风险下限之上调整本任务的 Fast / Standard / Strict 模式

#### 4. 编码实现（IMPLEMENT）

Agent 按确认的方案执行编码，严格限制在改动范围表列出的文件内。

- Fast 的单一低风险单元可由主 Agent 直接实现
- Standard 按复杂度选择主 Agent 或独立 Agent；Strict 对多单元和高风险改动保持独立执行
- 每个单元都携带验收条件、测试点、跨单元契约和风险，并在单元完成后运行定向测试

显式 `doc` / `analysis` / `report` 只读任务是例外：不生成 `test-strategy.md`；IMPLEMENT 必须留下匹配的 dispatch/result，由只读执行者返回完整 deliverable，主 Agent 原样展示后按生效模式进入 COMPLETE。此类任务不进入 REVIEW、VERIFICATION 或 MEMORY，也不写任务记忆。

#### 5. 代码审查（REVIEW，仅代码任务）

所有新代码任务都进入 REVIEW。Fast 使用最终 diff 自审，Standard 使用一次聚焦独立审查，
Strict 使用多维独立审查。审查证据绑定实现指纹；代码变化后旧证据自动失效。返工按语义
单元合并，同类问题连续两轮仍存在时停止盲目循环并重新分析。

#### 6. 验证（VERIFICATION）

Fast 运行最小充分的定向命令，Standard 运行受影响范围检查，Strict 运行项目适用的完整
lint、typecheck、test、build。验证证据绑定实现与配置指纹；未变化时可以复用，变化后
自动失效。全部通过后展示结果；approve/guard 等待手动验收，confirm/auto 按绿色结果
自动进入 MEMORY。Confirm 与 Auto 的区别是前者仍在 ANALYSIS → IMPLEMENT 等待一次
方案确认。

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
项目/会话的审批模式、配置工作流模式和任务冻结模式，即使任务列表为空也不会省略；可
通过对话分别设置 `approve/guard/confirm/auto` 与
`adaptive/fast/standard/strict` 覆盖，或恢复项目默认值。

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

handoff 会保留当前阶段、冻结工作流模式和 `pending_transition`。代码 IMPLEMENT 完成后可
交给另一个 Agent 继续 REVIEW，REVIEW 完成后也可交给另一个做 VERIFICATION；接手方不会
重复执行已完成阶段。自动边不提供交接，只读任务展示报告后直接结束。

### 跨会话恢复

即使不换 Agent，只是关闭了会话再重新打开，ec-workflow 也能自动恢复之前的任务进度。

状态行会提示当前状态：

```
> **Easy Coding** · **Approval: Guard** · **Workflow: Standard** · `add-search` · `IMPLEMENT`
```

如果是交接来的任务：

```
> **Easy Coding** · **Approval: Guard** · **Workflow: Standard** · `add-search` · `IMPLEMENT` · Handoff -> `claude-code`
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
- **原位迁移**：config.yaml 更新 `harness_version`；旧确认设置迁移为
  `behavior.approval_mode` 与 `behavior.workflow_mode`，其中 lite 映射为 guard + fast；
  旧 task/session 状态元数据继续幂等迁移
- **内容保留**：任务 dev-spec / execution / test-strategy、memory 内容、SOUL.md、RULES.md、ABSTRACT.md 等用户资产不被覆盖

### easy-coding config

交互修改当前项目的审批模式与工作流模式：

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
