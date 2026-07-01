# Easy Coding Harness

Easy Coding Harness 是一个 CLI 脚手架，用来把 Easy Coding 工作流安装到 Claude Code、Codex、Qoder 的原生目录。它只负责部署 skills、hooks、子代理、主约束文件和 `.easy-coding/` 运行时骨架，不分析项目代码；项目理解由安装后的 agent 通过 `ec-init` 完成。

下文默认用 `/ec-*` 表示 Claude Code / Qoder 的触发方式；Codex 中对应使用 `$ec-*`。

## 安装

```bash
# 方式一：源码安装（开发者 / 内网）
git clone <repo>
cd easy-coding-harness
./install.sh

# 方式二：npm 正式环境（latest）
npm install -g easy-coding-harness
easy-coding --version

# 方式三：npm beta 环境（内测用户）
npm install -g easy-coding-harness@beta
easy-coding --version
```

`0.x.x` 仍按内测版本管理时，优先使用 `easy-coding-harness@beta`；正式发布后使用默认 `latest` 安装命令。

## 快速开始

1. 在目标项目根目录安装 harness 文件：

```bash
easy-coding init
```

默认安装 Claude Code 支持。需要指定平台时：

```bash
easy-coding init --agent=claude-code,codex,qoder
```

如果当前目录是 git supermodule 父仓（存在 `.gitmodules`），`init` 会安装父仓，并列出已检出的一级子仓供选择。父仓和每个选中子仓都会得到独立完整的 harness 运行时：

```bash
# 默认交互选择已检出的子仓；--yes 会全选
easy-coding init --agent=claude-code,codex,qoder

# 只安装父仓，不安装子仓
easy-coding init --no-submodules

# 只安装指定子仓；值可用 submodule path 或 name
easy-coding init --submodules packages/a,packages/b
```

2. 打开目标 agent，运行项目知识初始化：

```text
/ec-init
```

`ec-init` 会让 agent 读取项目，生成 `.easy-coding/SOUL.md`、`.easy-coding/RULES.md`、`.easy-coding/ABSTRACT.md`、`.easy-coding/TEST_STRATEGY.md` 等项目知识文件。这个步骤幂等，重复运行是安全的。

3. 日常开发统一从工作流入口开始：

```text
/ec-workflow 实现 xxx 功能
```

`ec-workflow` 会创建或恢复任务，并按阶段调度分析、实现、审查、验证和记忆归档。

## 工作流

```text
INIT -> ANALYSIS -> WAITING_CONFIRM -> IMPLEMENT -> REVIEW -> VERIFICATION
                          ^                ^                      |
                          |                +---- repair loop -----+
                          +--- revision ---+                      |
                                                        [user acceptance]
                                                                  |
                                          MEMORY_SHORT -> MEMORY_LONG -> COMPLETE
any stage --[user abort via ec-task-close]--> CLOSED
```

- `WAITING_CONFIRM` 是计划确认硬门控，未确认不进入实现。
- `VERIFICATION` 是验证硬门控，未实际运行的 lint、typecheck、test 不算通过。
- `MEMORY_SHORT` 写入本次任务短期记忆。
- `MEMORY_LONG` 只有短期记忆数量超过阈值时才沉淀长期记忆，否则 no-op。

## Supermodule 模型

在包含 `.gitmodules` 的父仓中，Easy Coding Harness 按 git 边界分层运行：

- **安装边界**：父仓必装；已检出的一级子仓可选择安装。未检出的子仓会跳过并提示，不会自动执行 `git submodule update --init`。
- **清理边界**：在父仓执行 `easy-coding clear` 会交互列出父仓和已初始化子仓；无参数交互和 `--yes` 默认只选父仓，子仓需要交互勾选或通过 `--submodules` 指定。
- **运行边界**：跨仓任务在父仓根打开 agent，使用父仓 `.easy-coding` 的任务、状态、spec 和全景记忆；单仓任务进入对应子仓打开 agent，使用子仓自己的 `.easy-coding`。
- **记忆边界**：父仓记录跨仓背景和协议；属于某个子仓的技术记忆写回该子仓 `.easy-coding/memory`，让子仓被单独 clone 时也能带走改动原因。
- **提交边界**：跨仓改动采用两段式提交，先提交并推送各子仓，再提交父仓 gitlink 更新和父仓自身改动。
- **拓扑记录**：每层 `config.yaml` 会写入 `supermodule.role`；父仓记录 `submodules`，子仓记录 `parent`。

当前仅支持一级 submodule，不自动处理子仓里的二级 submodule。

## CLI 命令

| 命令 | 用途 |
| --- | --- |
| `easy-coding init` | 首次接入项目，安装所选平台的 skills、hooks、agents、主约束和运行时骨架；supermodule 父仓支持 `--submodules` / `--no-submodules` |
| `easy-coding add-agent` | 给已接入项目追加 Claude Code、Codex 或 Qoder 支持；supermodule 父仓可按已初始化子仓分层追加 |
| `easy-coding upgrade` | CLI 升级后同步项目内生成文件，生成区覆盖，用户资产保留；supermodule 父仓会同步升级已初始化子仓 |
| `easy-coding update` | 更新全局 CLI 到最新发布版 |
| `easy-coding status` | 查看已安装平台、harness 版本、当前任务状态 |
| `easy-coding clear` | 移除 harness 安装物，保留 tasks、spec、memory、project.yaml 等用户资产；supermodule 父仓支持交互选择、`--submodules` 和 `--no-submodules` |

## Skill 清单

### 流程 skills

| skill | 职责 |
| --- | --- |
| `ec-workflow` | 统一入口，负责任务创建、恢复、阶段流转和 stage skill 调度 |
| `ec-brainstorming` | 实现前的设计探索和方案发散 |
| `ec-analysis` | 生成 dev-spec、执行计划和测试策略 |
| `ec-implementing` | 按确认后的计划执行代码实现 |
| `ec-reviewing` | 多维度代码审查，输出 accept / fix / replan / blocked 结论 |
| `ec-verification` | 执行 lint、typecheck、test 等验证硬门控，并处理验收修复循环 |
| `ec-memory` | 写短期记忆，并在超过阈值时沉淀长期记忆 |
| `ec-task-management` | 查看、创建、选择、恢复任务 |
| `ec-task-close` | 用户主动中断任务并关闭 |
| `ec-git` | 约束 git diff、commit、push、跨仓库提交等交付动作 |

### 内置 skills

| skill | 职责 |
| --- | --- |
| `ec-init` | 项目知识初始化和升级后的知识适配 |
| `ec-meta` | 理解 harness 自身架构、平台文件和本地定制方式 |

## 平台支持

| 平台 | Skills 目录 | 触发符 | Hook 配置 | 主约束 |
| --- | --- | --- | --- | --- |
| Claude Code | `.claude/skills/` | `/` | `.claude/settings.json` | `CLAUDE.md` |
| Codex | `.agents/skills/` | `$` | `.codex/hooks.json` | `AGENTS.md` |
| Qoder | `.qoder/skills/` | `/` | `.qoder/settings.json` | `AGENTS.md` |
| Qoder 中国版 | `.qodercn/skills/` | `/` | `.qodercn/settings.json` | `AGENTS.md` |

同一份 skill 模板会在安装时根据平台替换 `{{placeholder}}`，因此日常使用遵循各平台自己的触发符和目录约定。

## 升级

全局 CLI 更新后，已接入的项目需要在项目根目录执行：

```bash
easy-coding upgrade
```

`upgrade` 会刷新生成区内的 skills、hooks、agents、主约束模板和运行时模板，不会删除已有任务、spec、memory、project.yaml 或项目知识文件。

## 版本与更新日志

版本号使用 `x.y.z`：

- `x`：大的功能迭代；`0.x.x` 表示内测版本
- `y`：常规功能升级
- `z`：日常 bug 修复

完整更新日志见 [CHANGELOG.md](https://github.com/ysxiiun/easy-coding-harness/blob/master/CHANGELOG.md)。

## 开发者命令

```bash
npm install
npm run build       # tsup 编译 + 拷贝 src/templates 到 templates/
npm test            # vitest
npm run lint        # biome check src/
npm run typecheck   # tsc --noEmit
```

源码结构：

| 目录 | 职责 |
| --- | --- |
| `src/commands/` | CLI 命令 |
| `src/configurators/` | Claude Code、Codex、Qoder 平台安装器 |
| `src/templates/` | skills、hooks、agents、主约束、运行时模板源 |
| `src/types/` | 运行时状态和平台类型 |
| `src/utils/` | 文件写入、配置、模板路径、gitignore、marked region 等工具 |
