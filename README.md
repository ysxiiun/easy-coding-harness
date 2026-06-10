# Easy Coding Harness

把"AI 编码 Harness"一键安装到各 agent 平台标准目录的 CLI 脚手架。在项目里跑一次
`easy-coding init`，按所选平台把 skills / hooks / 子代理 / 主约束文件写入平台标准目录，
agent 原生识别——用 `/ec-`（Claude Code / Qoder）或 `$ec-`（Codex）即可调用。

## 核心理念

- **平台标准目录**：skills / hooks / agents 写进 `.claude/`、`.agents/` + `.codex/`、
  `.qoder/`，复用 agent 已有的发现机制，不造新轮子。
- **运行时 dead-drop**：`.easy-coding/` 存放 config / state / tasks / memory，所有产物
  平台无关。换 agent、跨会话，信息零损失。
- **约束即护城河**：8 阶段状态机 + 2 终态，WAITING_CONFIRM 与 VERIFICATION 是硬门控，
  "没跑过的命令不算通过"。

## 安装

```bash
# 方式一：源码（开发者 / 内网）
git clone <repo> && cd easy-coding-harness && ./install.sh

# 方式二：npm beta（内测用户）
npm install -g easy-coding-harness@beta
easy-coding --version
```

两种方式都注册全局命令 `easy-coding`，效果一致。

当前 `0.x.x` 版本为内测版本，npm 使用 `beta` dist-tag 发布。稳定版发布后，普通用户可使用
`npm install -g easy-coding-harness` 安装默认 latest 版本。

## 版本与更新日志

版本号严格使用 `x.y.z`：

- `x`：大的功能迭代；`0.x.x` 表示内测版本
- `y`：常规功能升级
- `z`：日常 bug 修复

### 0.1.8

- 状态重构：废弃全局 `state.json`，工作流阶段信息迁入 `task.json`。新增 per-session 文件（`.easy-coding/sessions/{ppid}.json`）隔离并行开发会话。
- `task.json` 新增 `last_agent`、`stage_history`、`confirmed_by_user`、`test_strategy_confirmed`、`repo_paths` 字段，每次阶段转换实时更新 `status`。
- 新增 `src/utils/session.ts` 模块，删除 `src/utils/state-json.ts`。
- 强制子代理派发：IMPLEMENT（parallel 策略）、REVIEW、VERIFICATION 阶段使用 `<HARD-GATE>` 标记强制派发子代理，防止上下文污染。
- 移除 REVIEW 阶段 ">=5 文件才派子代理" 的门槛，改为始终派发。
- REVIEW auto-fix：bug 级问题由 ec-fixer 子代理直接修复，仅设计决策类问题才向用户确认。
- 新增 ec-fixer 子代理模板（claude/codex/qoder 三平台）。
- 修复 MEMORY_LONG 误触发：短期记忆 <= `memory.short_term_max`（默认 10）条时 MEMORY_LONG 为 no-op，仅超出阈值时执行蒸馏。
- 新增状态机转换校验：hook 在每次 prompt 提交时验证阶段转换合法性，非法转换注入 `[ILLEGAL-TRANSITION]` 强警告。
- session-start hook 自动检测并迁移旧格式 `state.json`，启动时清理 stale session 文件（>24h 且 PID 无占用）。

### 0.1.7

- ec-workflow 新增意图路由：用户带提示词进入时，自动匹配当前任务和已有任务，不匹配则询问切换或新建。
- 支持任务切换：可在任何阶段挂起当前任务并切换到另一个任务，挂起任务的数据完整保留。
- TaskJson 新增 `title` 可选字段，用于意图匹配和任务展示。
- ec-task-management 任务创建和列表展示支持 title 字段。
- CLI `easy-coding status` 命令在活跃任务列表中展示任务标题。
- ec-brainstorming 设计确认后新增入口：询问用户是否立即创建任务，确认后自动衔接 ec-workflow 流程。
- ec-analysis 新增 spec 文档扫描：自动读取 `.easy-coding/spec/` 下匹配的设计文档作为分析输入。
- ec-analysis 新增 HARD RULES 强约束：首个 tool call 必须写 dev-spec.md 骨架文件，分析过程逐步回填，回复内容必须是 dev-spec.md 完整内容而非自创缩略格式。
- 自检门禁增加文件存在性检查（dev-spec.md、execution.jsonl、test-strategy.md）和回复格式检查。
- 修复 READY_LINE 引导用户使用 `ec-analysis` 启动任务的错误提示，改为 `ec-workflow`。
- 同步修复 CLAUDE.md.tpl、AGENTS.md.tpl 主约束模板中的状态栏示例。

### 0.1.6

- ec-analysis 改为模板先行（template-first）工作流：分析阶段先创建 dev-spec.md 骨架，再逐步填充各章节。
- ec-analysis 模板从英文简写替换为完整中文结构化模板，12 个核心必填章节 + 3 个条件展开章节。
- 新增修订处理规则：用户修改意见必须重新输出完整方案，不允许只回差异摘要。
- 自检门禁新增"占位符是否全部替换"检查项。
- 测试策略补充人工验收和无法验证项。
- 将版本记录从 CHANGELOG.md 迁移到 README.md 统一维护。
- 新增项目级 CLAUDE.md 和 AGENTS.md 约束文件。

### 0.1.5

- ec-analysis 模板结构化改进：Change plan 改为五项一行式，Implementation units 输出完整 unit 表，Test strategy 内嵌 testability table + test points。

### 0.1.4

- 将宽终端 CLI banner 调整为 `ANSI Shadow` 厚重色块字形，恢复类似截图中的块状阴影质感。
- 中等宽度终端使用 `Small Shadow`，窄终端继续使用 `Small Slant`，避免标题溢出。
- 保留 0.1.3 的 cyan/blue 分层配色和副标题样式。
- 修复主约束模板中状态栏示例使用外层双反引号，可能导致 agent 复述 Ready 状态栏时在末尾多带一个反引号的问题。

### 0.1.3

- 修复 0.1.2 CLI banner 字体过于块状、左右压缩导致难以辨认的问题。
- 默认字体改为更舒展的 `Big`，中等宽度终端使用 `Doom`，窄终端继续使用 `Small Slant`。
- 保留 0.1.2 的 cyan/blue 分层配色和副标题样式。
- 将 hook 注入的 Easy Coding 状态提示收口为单行 Markdown 状态栏，展示 Ready、Waiting init、当前任务、任务状态和 handoff 来源。

### 0.1.2

- 改进 agent 平台选择提示，明确说明使用 Space 切换选择、Enter 进入确认。
- 平台选择后增加二次确认，避免误按回车直接按默认平台安装。
- 优化 CLI 启动标题，默认使用带阴影感的 `ANSI Shadow` 字体，并为窄终端提供 fallback。

### 0.1.1

- 修复 `easy-coding init` 将任意 `.easy-coding` 目录误判为已安装 harness 的问题。
- 新增旧版 `easy-coding` skill 产物识别，允许在保留旧数据的前提下接入新 harness。
- `project-init` 任务会记录旧资产清单，供 `ec-init` 校验、保留和补全旧数据产物。
- 将 CLI 版本源统一到 `package.json`，避免源码常量与包版本漂移。

### 0.1.0

- 首个内测基线版本。
- 提供 `easy-coding init`、`add-agent`、`upgrade`、`status` 基础命令。
- 支持 Claude Code、Codex、Qoder 三个平台的 skills、hooks、agents 和主约束安装。

## 命令

| 命令 | 用途 |
|------|------|
| `easy-coding init` | 首次接入。`--agent=claude-code,codex,qoder` 选平台，`-y` 默认 claude-code |
| `easy-coding add-agent` | 给已有项目追加平台支持 |
| `easy-coding upgrade` | CLI 更新后同步项目里的功能文件（生成区覆盖，用户资产不动） |
| `easy-coding status` | 查看已装平台、版本、当前任务状态 |

## 两阶段初始化

CLI 是纯文件搬运工，不做任何项目分析。初始化分两步：

1. **CLI** `easy-coding init` —— 装文件 + 建 `project-init` 占位任务。
2. **Agent** `/ec-init` —— agent 分析代码，生成 SOUL / RULES / ABSTRACT / TEST_STRATEGY，
   自动判断初创 vs 迭代项目。幂等，重复跑安全。

之后日常工作统一走 `/ec-workflow`。

## 12 个 skill

| skill | 职责 |
|------|------|
| ec-init | 项目知识初始化（幂等，一次性） |
| ec-workflow | 工作流状态机 + 任务发现/恢复（日常入口） |
| ec-brainstorming | 实现前设计探索（硬设计门，复刻 Superpowers 方法论） |
| ec-analysis | 需求分析 + 执行计划 + 测试策略 |
| ec-implementing | 编码实现 + 子代理并行调度 + 任务卡 |
| ec-reviewing | 多维度审查（accept/fix/replan/blocked） |
| ec-verification | 验证硬闸门 + 用户验收修复循环 |
| ec-memory | 短期滑动窗口 + 长期记忆沉淀（schema v2） |
| ec-task-management | 任务面板（创建 / 列表） |
| ec-task-close | 任务中断与关闭 |
| ec-git | git 操作约束 + 跨仓库提交 |
| ec-meta | harness 自身架构理解 + 本地定制 |

## 三平台支持

| | Claude Code | Codex | Qoder |
|---|---|---|---|
| Skills 目录 | `.claude/skills/` | `.agents/skills/` | `.qoder/skills/` |
| 触发符 | `/` | `$` | `/` |
| Hook 配置 | `.claude/settings.json` | `.codex/hooks.json` | `.qoder/settings.json` |
| 主约束 | `CLAUDE.md` | `AGENTS.md` | `AGENTS.md` |
| 中国版 | — | — | `.qodercn/` |

同一份 skill 模板，平台差异通过 `{{placeholder}}` 在安装时解析。

## 工作流状态机

```
INIT → ANALYSIS → WAITING_CONFIRM → IMPLEMENT → REVIEW → VERIFICATION
                                        ↑                     │
                                        └──── 修复循环 ────────┘
                                                       [用户验收]
                                        MEMORY_SHORT → MEMORY_LONG → COMPLETE
任何阶段 ──[用户中断]──→ CLOSED
```

## 开发

```bash
npm install
npm run build      # tsup 编译 + 拷贝模板到 templates/
npm test           # vitest
npm run lint       # biome
```

源码结构：`src/commands/`（CLI 命令）、`src/configurators/`（平台配置器）、
`src/templates/`（skills / hooks / 子代理 / 主约束模板）、`src/types/`（运行时数据契约）、
`src/utils/`（文件写入 / 配置 / 分区替换等）。
