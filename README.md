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
INIT --[always auto]--> ANALYSIS -> IMPLEMENT -> REVIEW -> VERIFICATION -> MEMORY --[always auto]--> COMPLETE
                                    \--[read-only, mode-aware]-----------------------> COMPLETE
                 ^            ^          |             |
                 +-- replan ---+          +--- fix -----+
                              ^                         |
                              +------- repair ----------+
approval --[approve / guard / confirm / auto]--> transition wait policy
workflow --[adaptive => fast / standard / strict]--> stage execution depth
tdd --[off by default / Java changed-line gate]--> optional test discipline
any stage --[user abort via ec-task-close]--> CLOSED
```

- 审批模式优先级为 session 覆盖 > 项目 `behavior.approval_mode` > `guard`；`approve`
  逐边确认，`guard` 确认 ANALYSIS → IMPLEMENT 与 VERIFICATION → MEMORY，`confirm` 只在
  ANALYSIS → IMPLEMENT 确认一次，随后各阶段在质量门禁通过后自动推进，`auto` 从开始即
  自动推进。
- 工作流模式优先级为 session 覆盖 > 项目 `behavior.workflow_mode` > `adaptive`。Adaptive 在 ANALYSIS 结束时根据风险解析、展示并冻结为 `fast`、`standard` 或 `strict`，用户可在风险下限之上调整。
- ANALYSIS 会先通过问答闭合影响技术路线、接口、模型、状态、范围或验收的实质性问题，
  并在 Dev-Spec 中记录唯一的 `decision_status: closed`。会话只展示核心方案、验收摘要、
  Workflow Mode 与主要风险；完整 `dev-spec.md` 通过绝对本地链接或路径按需查看。
- Java TDD 默认关闭；优先级为 session 覆盖 > 项目配置 > `false/90%`。首次开启前必须运行 `ec-tdd-init`，只建设 JUnit/JaCoCo/GitLab 增量覆盖率基础设施，不补存量业务单测；readiness 通过后才允许显式开启。开启后在 ANALYSIS → IMPLEMENT 冻结开关、baseline 与阈值，只验收本任务新增/修改生产代码行，执行 RED/GREEN/REFACTOR（纯重构使用 characterization GREEN → GREEN），并要求本地单测通过、本地差异覆盖率达到冻结阈值。GitLab TEST-stage job 仍会生成，但远程 pipeline 结果不属于 Harness 验收证据，也不会触发中间提交推送。关闭时普通任务不扫描 CI/JaCoCo、不增加命令或提高原工作流验收深度。
- 所有新代码任务都完整进入 REVIEW；不同工作流模式只调整各状态内部的上下文加载、执行主体、审查独立性、验证范围和记忆深度，不绕过状态或证据门禁。
- 显式 `doc` / `analysis` / `report` 只读任务不生成 `test-strategy.md`；展示完整报告后按生效模式进入 COMPLETE，不执行 REVIEW、VERIFICATION 或 MEMORY，也不写任务记忆。
- `VERIFICATION` 是验证硬门控：Fast 运行最小充分检查，Standard 运行受影响范围检查，
  Strict 运行项目适用的完整 lint/typecheck/test/build；所选模式要求的检查未真实执行
  并留下当前指纹下的绿色证据，就不算通过。
- `MEMORY` 先写入本次任务短期记忆，再执行长期记忆阈值门禁；未超过阈值时长期沉淀为 no-op。

## Canonical Dev Spec

Harness 可选择性消费 easy-dev-spec 生成的单文件 `easy-dev-spec/v1` Canonical Spec：

1. `ec-workflow` 先只读检查 manifest、仓库、任务 DAG、依赖、baseline 与共享 execution；
   旧 Spec 仍可只读检查，但成为可执行任务前必须初始化共享执行区。
2. 用户明确选择一个或多个 Spec task；`select-dev-spec-scope` 按仓库提取确定性消费
   闭包，Harness 不默认导入整份 Spec，也不会读取未选任务正文。
3. 一次选择创建一个 Harness task；ANALYSIS 使用最终 producer READY 门禁，并将
   selected task 映射为带 `repo_id`、`source_task_id`、source steps、文件、符号和测试
   命令的 Unit。
4. `hard` 依赖决定执行顺序，冻结的 `contract` 依赖允许并行编码，`integration` 依赖
   在证据闭合前阻止全链路完成。

Canonical Spec 的静态设计由 design revision + `design_sha256` 冻结；共享
`EDS:EXECUTION` 则接收 Harness 的 Task/Step/dependency 投影。写回使用
`execution_revision` CAS、幂等键和断点对账，执行区变化不会使本地 plan/review/verify
指纹失效，设计变化或 revision 回滚仍会阻塞。显式项目外路径受支持，迁移后只能通过
身份一致的 rebind 修复定位。静态设计调整必须 revision +1、READY 并执行 `sync-design`；
机器执行区禁止手工编辑。无 Canonical manifest 的历史 Dev-Spec 继续走原有整文分析流程。

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
| `easy-coding config` | 交互修改当前项目的 Approval、Workflow、Java TDD 与覆盖率阈值；开启 TDD 前要求 readiness |
| `easy-coding status` | 查看已安装平台、harness 版本、当前任务状态 |
| `easy-coding clear` | 移除 harness 安装物，保留 tasks、spec、memory、project.yaml 等用户资产；supermodule 父仓支持交互选择、`--submodules` 和 `--no-submodules` |

## Skill 清单

### 流程 skills

| skill | 职责 |
| --- | --- |
| `ec-workflow` | 统一入口，负责任务创建、恢复、阶段流转和 stage skill 调度 |
| `ec-brainstorming` | 实现前的设计探索和方案发散 |
| `ec-analysis` | 生成 dev-spec、执行计划和测试策略 |
| `ec-implementing` | 按确认后的计划执行代码实现或显式无代码只读交付 |
| `ec-reviewing` | 多维度代码审查，输出 accept / fix / replan / blocked 结论 |
| `ec-verification` | 执行 lint、typecheck、test 等验证硬门控，并处理验收修复循环 |
| `ec-memory` | 写短期记忆，并在超过阈值时沉淀长期记忆 |
| `ec-task-management` | 任务面板：查看、创建、选择、恢复、交接任务 |
| `ec-config` | 只读查看或显式修改项目/session 的 Approval、Workflow、TDD 与阈值 |
| `ec-tdd-init` | 在 TDD 关闭态初始化/刷新 Java changed-line coverage 基础设施，不补存量单测 |
| `ec-task-close` | 用户主动中断任务并关闭 |
| `ec-no-harness` | 当前会话仅旁路 Easy Coding Harness，使用原生 Agent 能力 |
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

升级到 0.9.0 时，旧 `strict_confirm` / `auto_mode` / `confirm_mode` 会一次性迁移为
`behavior.approval_mode` 与 `behavior.workflow_mode`；旧 `lite` 映射为 `guard + fast`。
项目级模式用 `easy-coding config` 修改（要求
项目 Harness 与 CLI 版本完全一致，否则先执行 `easy-coding upgrade` 或更新 CLI）；当前
session 临时覆盖统一通过 `ec-config` 对话修改。升级到 0.10.0-beta.2 时配置 schema 升至
5；未完成 `ec-tdd-init` readiness 的项目/session TDD 请求迁移为关闭并保留阈值，同时
部署共享 Java 差异覆盖率与 readiness 工具。0.10.0-beta.3 起，TDD 业务任务只依赖本地
单测与本地差异覆盖率，历史远程 CI 证据保留但不再参与验收。已经冻结的活动任务合同
不会被静默改写。0.10.0-beta.4 起，仍停在 ANALYSIS 的旧任务必须补齐决策闭环后才能
进入 IMPLEMENT；已经进入后续阶段的任务不受影响。

若当前会话不希望 Harness 接管，显式调用 `/ec-no-harness`（Codex 使用
`$ec-no-harness`）。它只旁路 Easy Coding，不关闭其他 hooks，也不忽略其他 skills；
当前任务状态会原样保留。

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
