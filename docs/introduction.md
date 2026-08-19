# Easy Coding Harness 介绍

## 它解决什么问题

AI 写代码越来越能干，但放开手让它自己跑，几个老毛病会反复出现：

- 需求还没对齐就开始写，方向错了返工一大片；
- 说"改完了"，但 lint、类型、测试根本没真跑过；
- 会话一长，上下文塞满实现细节，主线越聊越糊涂；
- 换一个 agent 接手，前因后果全断，得从头解释一遍；
- 团队里 Claude Code、Codex、Qoder 各用各的，规则各配一套，谁也对不齐。

Easy Coding Harness 不是又一个编程工具，而是给 AI 编程套上的一套**工作流规范**。它把"什么时候必须停下来让人确认""哪些活儿必须验证过才算数""记忆怎么跨会话留下来"这些纪律，固化成 agent 装好即用的 skills、hooks 和约束文件。

一句话：**让 AI 编程有章可循，而不是全凭 agent 当时的发挥。**

## 设计理念

### 纯部署，理解交给运行时

CLI 本身很克制——它只往 `.claude` / `.agents` / `.qoder` 这些目录里铺文件：skills、hooks、子代理、主约束、`.easy-coding/` 运行时骨架。它**不读一行项目代码**。

真正的项目理解（这是什么技术栈、有哪些约定、测试怎么跑）留给装好之后的 `ec-init` skill 在 agent 里现场完成。

好处是职责边界干净：CLI 只管把规范铺到位，怎么理解具体项目是 agent 的事。CLI 升级不会碰你的项目知识，重新初始化也不会污染部署物。

### 人机共创，关键节点设硬门控

整个工作流是固定状态机。审批模式控制状态边是否等待，工作流模式控制各状态执行深度：

- `pending_transition`（需要确认的状态边）——当前阶段完成后仍不改状态，用户确认后才迁移；
- `auto-transition`（模式允许的自动边）——只在合法边和产物检查通过后迁移；
- `QUALITY`（质量）——同一候选指纹下并行编排只读 Review Gate 与 Verification Gate；
  Fast 运行主 Agent 聚焦自审和最小定向验证，Standard 使用一个独立 reviewer 与受影响
  检查，Strict 使用至少两个独立维度并只对实际修改仓库运行完整适用检查。

`approval_mode` 支持 `approve / guard / confirm / auto`；`workflow_mode` 支持默认
`adaptive` 以及 `fast / standard / strict`。Confirm 只在 ANALYSIS 后确认一次，随后
依次自动 QUALITY、MEMORY、COMPLETE；自动推进仍受质量证据门禁约束。
Adaptive 在 ANALYSIS 结束时解析并冻结具体模式。普通业务默认 Standard；单仓最多三个
内聚 Unit、最多 8 个文件的低风险局部修改优先 Fast；只有明确高风险与真实复杂度同时存在
才进入 Strict。仓库数按当前 plan 实际修改文件所属 Git root 计算，Canonical Spec 或
supermodule 中未修改的仓库不会抬级。所有修改任务都进入 QUALITY，模式只改变状态内部
的成本与保障深度。纯只读对话保持 Ready，不创建任务；任何模式下关闭任务都必须显式执行。

### 上下文卫生

Fast 的单一低风险工作允许主代理直接完成。Standard / Strict 只有在单元相互独立、并行确实
节省成本，或高风险工作需要上下文隔离时才派**子代理**；审查与验证也按冻结模式选择足够的
独立性。这样既避免简单任务承担不必要的调度成本，也能让复杂任务的主线只保留决策和证据。

### 记忆要沉淀，不能只活在当前会话

任务过程中写**短期记忆**；短期记忆攒够阈值，才蒸馏成**长期记忆**。

这样 agent 跨会话、跨仓库还记得住"当初为什么这么改"，而不是每次都从零开始。长期沉淀是有门槛的——量不够就是 no-op，避免把琐碎的一次性信息也当成经验固化下来。

## 特色亮点

### 一条能恢复、能交接的工作流

```text
INIT --[always auto]--> ANALYSIS -> IMPLEMENT -> QUALITY -> MEMORY --[always auto]--> COMPLETE
                 ^            ^          |
                 +-- replan ---+          +--- repair ---+
approval --[approve / guard / confirm / auto]--> transition wait policy
workflow --[adaptive => fast / standard / strict]--> stage execution depth
```

任务状态持久化在 `.easy-coding/` 里，不绑死在某次会话上。所以：

- 中途切别的任务，回来能接着跑；
- 审查发现问题，能走 repair loop 回到实现，或者 replan 回到分析重新对齐；
- 换个人、换个 agent 接手，通过 handoff / claim 拿到上一任的阶段和交接摘要，不用重新解释。

逻辑 session 采用事件触发的有界保留：仅在创建新 session 前和实际升级时清理，空闲会话
保留 7 天、仍绑定任务的会话保留 30 天，并按最近活动时间限制为 100 个。任务、记忆、
Spec、项目知识和活动验收证据不会随 session GC 删除。

### 一份模板，喂三个平台

Claude Code、Codex、Qoder 用的是**同一份** skill 模板，靠安装时替换占位符（触发符、目录、子代理调度方式）适配各自的原生约定。

不是给每个平台各写一套规则，所以团队里不管谁用哪个 agent，遵循的是同一套纪律。日常触发时各随各的习惯：Claude Code / Qoder 是 `/ec-*`，Codex 是 `$ec-*`。

### 按 git 边界分层的 Supermodule 支持

在带 `.gitmodules` 的父仓里，harness 按 git 边界分层运行，父仓和每个子仓各拿一套完整运行时：

- **安装**：父仓必装，已检出的子仓可选装；不会替你 `git submodule update --init`。
- **运行**：跨仓任务在父仓根跑，用父仓的全景记忆；单仓任务进子仓跑，用子仓自己的记忆。
- **记忆**：属于某个子仓的技术记忆写回该子仓，单独 clone 也带得走改动原因。
- **提交**：跨仓改动两段式提交，先各子仓、再父仓 gitlink。

当前支持到一级 submodule。

## 使用方法

### 1. 安装 CLI

```bash
# npm 预发布版本
npm install -g easy-coding-harness@beta

# 或源码安装（开发者 / 内网）
git clone <repo> && cd easy-coding-harness && ./install.sh

easy-coding --version
```

### 2. 在项目里部署 harness

在目标项目根目录：

```bash
easy-coding init                                  # 默认装 Claude Code
easy-coding init --agent=claude-code,codex,qoder  # 指定多个平台
```

如果当前目录是 supermodule 父仓，`init` 会列出已检出的子仓让你选。

### 3. 初始化项目知识

打开目标 agent，运行：

```text
/ec-init
```

agent 会读项目，生成 `SOUL.md`、`RULES.md`、`ABSTRACT.md`、`TEST_STRATEGY.md` 等项目知识文件。这一步幂等，重复跑是安全的。

### 4. 日常开发从统一入口进

```text
/ec-workflow 实现 xxx 功能
```

`ec-workflow` 负责创建或恢复修改任务。项目和当前 session 可分别覆盖审批模式、工作流模式与 Java TDD；ANALYSIS 先闭合会影响技术路线、接口、模型、状态、范围和验收的问题，只有 Dev-Spec 写入唯一的 `decision_status: closed` 后才允许进入 IMPLEMENT。分析按实际修改闭包渐进加载上下文，Canonical Spec 使用 normalized remote 绑定当前 worktree，只消费 selected task 与直接依赖，不因未修改仓库或 supermodule 子项目抬级。非 TDD 的 IMPLEMENT 只编码，不运行质量命令；QUALITY 对同一候选并行执行 Review/Verification，汇总后只回修一次。TDD 的 RED/GREEN/REFACTOR 是实现职责内的唯一测试例外，绿色证据可以复用。编码贴合最近邻风格，避免投机抽象、碎片方法、冗余校验和无意义常量，并坚持最小修改；核心 Java 新增或实质修改的方法与字段使用多行 Javadoc，普通单行说明使用 `//`，逻辑段之间保留一个空行。纯只读请求保持 Ready，不创建任务。

明确的极简修改可由用户显式调用 `/ec-lite`（Codex 使用 `$ec-lite`）。Lite 只执行“紧凑方案 → 用户确认 → 最小实现”，不创建任务、QUALITY 或 MEMORY，并持续到用户再次调用退出；存在活动任务时，用户自行选择取消启动、关闭任务后启动，或只清除当前任务指针后启动。

如果当前会话不希望 Harness 接管，显式调用 `/ec-no-harness`（Codex 使用 `$ec-no-harness`）。它只旁路 Easy Coding，其他 skills 和 hooks 仍正常工作，任务状态也会原样保留。

### 常用命令

| 命令 | 用途 |
| --- | --- |
| `easy-coding init` | 首次接入项目，部署所选平台的全部 harness 文件 |
| `easy-coding add-agent` | 给同版本已接入项目追加平台支持；版本不一致时先 upgrade |
| `easy-coding upgrade` | CLI 升级后同步项目内生成文件，用户资产保留 |
| `easy-coding update` | 更新全局 CLI 到最新发布版 |
| `easy-coding config` | 交互修改项目级 Approval、Workflow 与 Java TDD；开启 TDD 前要求 readiness |
| `easy-coding status` | 查看已安装平台、harness 版本、当前任务状态 |
| `easy-coding clear` | 移除 harness 安装物，保留 tasks、spec、memory 等用户资产 |

### 一句话记住整个流程

**装 CLI → `init` 铺文件 → `/ec-init` 让 agent 认识项目 → `/ec-workflow` 开始干活。**

之后每个需求都从 `/ec-workflow` 进，剩下的交给状态机。
