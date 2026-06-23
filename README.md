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

# 方式二：npm 正式环境（latest）
npm install -g easy-coding-harness
easy-coding --version

# 方式三：npm beta 环境（内测用户）
npm install -g easy-coding-harness@beta
easy-coding --version
```

三种方式都注册全局命令 `easy-coding`，效果一致。

当前 `0.x.x` 版本仍为内测版本时，优先使用 `beta` dist-tag；正式发布后使用默认 latest 安装命令。

## 版本

版本号严格使用 `x.y.z`：

- `x`：大的功能迭代；`0.x.x` 表示内测版本
- `y`：常规功能升级
- `z`：日常 bug 修复

完整更新日志见 [CHANGELOG.md](CHANGELOG.md)。

## 命令

| 命令 | 用途 |
|------|------|
| `easy-coding init` | 首次接入。`--agent=claude-code,codex,qoder` 选平台，`-y` 默认 claude-code |
| `easy-coding add-agent` | 给已有项目追加平台支持 |
| `easy-coding upgrade` | CLI 更新后同步项目里的功能文件（生成区覆盖，用户资产不动） |
| `easy-coding status` | 查看已装平台、版本、当前任务状态 |
| `easy-coding clear` | 移除 harness 安装物并保留 tasks / spec / memory / project.yaml；优先按 install manifest 精准清理，旧配置或损坏 manifest 会回退到模板兜底清理 |

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
