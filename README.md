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

预发布版本使用 `easy-coding-harness@beta`；稳定版本使用默认 `latest` 安装命令。

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

`ec-workflow` 会创建或恢复修改任务，并按阶段调度分析、实现、统一质量检查和记忆归档。

## 工作流

```text
INIT --[always auto]--> ANALYSIS -> IMPLEMENT -> QUALITY -> MEMORY --[always auto]--> COMPLETE
                 ^            ^          |
                 +-- replan ---+          +--- repair ---+
approval --[approve / guard / confirm / auto]--> transition wait policy
workflow --[adaptive => fast / standard / strict]--> stage execution depth
tdd --[off by default / Java changed-line gate]--> optional test discipline
any stage --[user abort via ec-task-close]--> CLOSED
```

- 审批模式优先级为 session 覆盖 > 项目 `behavior.approval_mode` > `guard`；`approve`
  逐边确认，`guard` 确认 ANALYSIS → IMPLEMENT 与 QUALITY → MEMORY，`confirm` 只在
  ANALYSIS → IMPLEMENT 确认一次，随后各阶段在质量门禁通过后自动推进，`auto` 从开始即
  自动推进。所有模式仅在 QUALITY 绿色检查点之后又出现新代码差异时临时暂停：展示
  精确 diff 与摘要，由用户确认该摘要后继续；这不会把 `auto` 永久降级为人工审批。
- 工作流模式优先级为 session 覆盖 > 项目 `behavior.workflow_mode` > `adaptive`。Adaptive
  以 Standard 作为普通业务默认：单仓、最多三个内聚 Unit 且不超过 8 个文件的低风险局部修改
  优先 Fast；只有明确高风险与真实复杂度/大影响面同时存在才进入 Strict。仓库数只按当前
  execution plan 实际修改的 Git root 计算，用户可在机械风险下限之上调整。
- ANALYSIS 会先通过问答闭合影响技术路线、接口、模型、状态、范围或验收的实质性问题，
  并在 Dev-Spec 中记录唯一的 `decision_status: closed`。会话只展示核心方案、验收摘要、
  Workflow Mode 与主要风险；完整 `dev-spec.md` 通过绝对本地链接或路径按需查看。
- Java TDD 默认关闭；优先级为 session 覆盖 > 项目配置 > `false/90%`。首次开启前必须运行 `ec-tdd-init`，只建设 JUnit/JaCoCo/GitLab 增量覆盖率基础设施，不补存量业务单测；readiness 通过后才允许显式开启。开启后在 ANALYSIS → IMPLEMENT 冻结开关、baseline 与阈值，只验收本任务新增/修改生产代码行，执行 RED/GREEN/REFACTOR（纯重构使用 characterization GREEN → GREEN），并要求本地单测通过、本地差异覆盖率达到冻结阈值。GitLab TEST-stage job 仍会生成，但远程 pipeline 结果不属于 Harness 验收证据，也不会触发中间提交推送。关闭时普通任务不扫描 CI/JaCoCo、不增加命令或提高原工作流验收深度。
- 所有修改任务都进入 QUALITY；纯对话分析、解释、报告和只读 review 保持 Ready，不创建任务。文档或配置一旦写入仓库，仍走完整状态机。
- `QUALITY` 同时编排只读 Review Gate 与 Verification Gate。Fast 使用主 Agent 聚焦自审和最小定向验证，Standard 使用一个独立 reviewer 与受影响检查，Strict 使用至少两个独立维度并只对实际修改仓库运行完整适用检查。两个 Gate 绑定同一候选指纹和 attempt，必须完成或明确取消后才形成一次 Repair Bundle；代码/测试缺陷回 IMPLEMENT，契约歧义优先回 ANALYSIS并保留同轮其他缺陷，环境问题留在 QUALITY 重试；候选漂移会审计为 cancelled 并强制先回 IMPLEMENT。
- Canonical repair 后重跑受影响仓库及其 hard/contract 下游；其余未变化仓库必须由状态层以 `quality-carry-forward` 精确引用上一 attempt 的通过证据，不能由 Agent 复制或改写旧记录。
- 非 TDD 的 IMPLEMENT 只负责编码，不运行测试；Verification Gate 统一执行 lint/typecheck/test/build。TDD 的 RED/GREEN/REFACTOR 是唯一例外，当前指纹绿色证据可在 QUALITY 复用。
- QUALITY 通过后冻结验收检查点；若代码随后变化，Harness 展示完整差异并绑定
  `diff_sha256`。用户确认后不重跑 Review Gate：纯非执行差异可沿用
  原验证，可执行差异补定向验证，显式风险豁免单独记录。配置、方案或 Canonical 设计漂移
  不能走这条例外。
- `MEMORY` 先写入本次任务短期记忆，再执行长期记忆阈值门禁；未超过阈值时长期沉淀为 no-op。
- `ec-lite` 仅由用户显式启停，不是 Fast 的别名。它只保留“紧凑方案 → 用户确认 → 最小实现”，
  不创建任务、Dev-Spec、QUALITY 或 MEMORY；存在活动任务时由用户选择取消启动、关闭任务后
  启动，或只清除当前任务指针后启动。活动任务决策使用 session 级原子锁；每次方案生成一次性
  digest，并把当时的 Git 基线一并纳入确认内容；确认时会重新校验基线，确认后不能重放或
  改写。完成时机械校验真实目标改动、范围外文件和 HEAD 漂移；Harness 自身 session 账本
  不计入业务改动范围。

## Canonical Dev Spec

Harness 可选择性消费 easy-dev-spec 生成的单文件 `easy-dev-spec/v1` Canonical Spec：

1. `ec-workflow` 先用 `inspect-dev-spec --manifest-only` 只读校验 manifest，通过 normalized
   remote 识别当前 worktree，并展示任务 DAG 与共享 execution；不会解析未选仓库路径，也
   不在选择前计算任何任务的 baseline。旧 Spec 仍可只读检查，但成为可执行任务前必须
   初始化共享执行区。
2. 用户明确选择一个或多个 Spec task 后，Harness 用 `--spec-task` 只检查所选任务仓库和
   change/test 范围。当前 worktree remote 唯一匹配时无需手工路径；`path_hint` 不一致只会
   形成一次运行时映射提示，不会复制或修复原 Spec。
3. 一次选择创建一个 Harness task；ANALYSIS 唯一一次调用 `select-dev-spec-scope` 提取确定性
   消费闭包。`exact` / `scope-unchanged` 直接快速投影为 Unit、测试策略和派生 dev-spec，
   `scope-drifted` 才读取所选范围内的漂移文件与符号；未选任务正文始终不进入上下文。
4. `EDS:EXECUTION` 是依赖事实来源：`hard` 依赖决定执行顺序，冻结的 `contract` 依赖允许
   并行编码，`integration` 依赖在证据闭合前阻止全链路完成；不会再从本地任务或 Git 历史
   重复推断共享状态。

Canonical Spec 的静态设计由 design revision + `design_sha256` 冻结；共享
`EDS:EXECUTION` 则接收 Harness 的 Task/Step/dependency 投影。写回使用
`execution_revision` CAS、幂等键和断点对账，执行区变化不会使本地 plan/QUALITY
指纹失效，设计变化或 revision 回滚仍会阻塞。显式项目外路径受支持，迁移后只能通过
身份一致的 rebind 修复定位。静态设计调整必须 revision +1、READY 并执行 `sync-design`；
机器执行区禁止手工编辑。Canonical task 在 Harness 本地校验完成后仍保持 `implemented`，
只有 QUALITY → MEMORY 边界按显式确认或既有审批模式真正应用时才写为 `verified`，
并携带验收差异摘要；MEMORY 完成后再写为 `completed`。无 Canonical manifest 的历史
Dev-Spec 继续走原有整文分析流程。

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
| `easy-coding add-agent` | 给同版本已接入项目追加 Claude Code、Codex 或 Qoder 支持；版本不一致时先执行 upgrade |
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
| `ec-implementing` | 按确认后的计划执行代码实现；非 TDD 不运行质量命令 |
| `ec-quality` | 编排 Review/Verification 双门、证据复用和一次性 Repair Bundle |
| `ec-memory` | 写短期记忆，并在超过阈值时沉淀长期记忆 |
| `ec-task-management` | 任务面板：查看、创建、选择、恢复、交接任务 |
| `ec-config` | 只读查看或显式修改项目/session 的 Approval、Workflow、TDD 与阈值 |
| `ec-tdd-init` | 在 TDD 关闭态初始化/刷新 Java changed-line coverage 基础设施，不补存量单测 |
| `ec-task-close` | 用户主动中断任务并关闭 |
| `ec-no-harness` | 当前会话仅旁路 Easy Coding Harness，使用原生 Agent 能力 |
| `ec-lite` | 用户显式启停的极简直达模式：一次方案确认后最小实现，不创建任务/QUALITY/MEMORY |
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

`upgrade` 会刷新生成区内的 skills、hooks、agents、主约束模板和运行时模板，不会删除已有任务、spec、memory、project.yaml 或项目知识文件。0.10.0-beta.10 起，实际升级还会执行一次 session GC；`--dry-run` 不删除数据。升级到 1.0.0-beta.0 时，活动 REVIEW/VERIFICATION 合并为 QUALITY；活动旧只读任务以 `legacy-read-only-task-retired` 关闭并保留全部历史。

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

session GC 只在创建新逻辑会话前和实际升级时触发：无任务绑定的会话保留 7 天、仍绑定
任务的会话保留 30 天，并按最近活动时间将根目录 JSON 控制在 100 个以内。活动任务仍在
引用的 acceptance 验收快照会被保留；任务、记忆、Spec 和项目知识不参与清理。

若当前会话不希望 Harness 接管，显式调用 `/ec-no-harness`（Codex 使用
`$ec-no-harness`）。它只旁路 Easy Coding，不关闭其他 hooks，也不忽略其他 skills；
当前任务状态会原样保留。

## 版本与更新日志

版本号使用 `x.y.z`：

- `x`：大的功能迭代；带 `-beta.*` 的版本表示预发布版本
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
