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

整个工作流是固定状态机，状态边按 `approve / guard / lite / auto` 确认模式流转，机械边始终自动：

- `pending_transition`（需要确认的状态边）——当前阶段完成后仍不改状态，用户确认后才迁移；
- `auto-transition`（模式允许的自动边）——只在合法边和产物检查通过后迁移；
- `VERIFICATION`（验证）——代码任务没有真实跑过的 lint、typecheck、test，不算通过；只读任务不进入该阶段。

`approve` 除 INIT → ANALYSIS、MEMORY → COMPLETE 外逐边确认；`guard`（默认）与 `lite` 只确认 ANALYSIS → IMPLEMENT、VERIFICATION → MEMORY；lite 不执行 REVIEW，直接从 IMPLEMENT 进入 VERIFICATION；`auto` 自动执行全部合法工作流边。任何模式下关闭任务都必须显式执行。需要确认时优先使用智能体原生选项。只读任务展示完整报告后按生效模式结束，不审查、不验证、不归档记忆。

### 上下文卫生

实现、审查、验证这几个阶段，主代理都不亲自下场，而是派**子代理**去干。

原因很直接：实现细节是上下文的噪声源，一旦灌进主代理，长会话必然越来越糊。把脏活隔离在子代理里，主代理只拿结论，主线才能一直清醒。

### 记忆要沉淀，不能只活在当前会话

任务过程中写**短期记忆**；短期记忆攒够阈值，才蒸馏成**长期记忆**。

这样 agent 跨会话、跨仓库还记得住"当初为什么这么改"，而不是每次都从零开始。长期沉淀是有门槛的——量不够就是 no-op，避免把琐碎的一次性信息也当成经验固化下来。

## 特色亮点

### 一条能恢复、能交接的工作流

```text
INIT --[always auto]--> ANALYSIS -> IMPLEMENT -> REVIEW -> VERIFICATION -> MEMORY --[always auto]--> COMPLETE
                                    \----------------> VERIFICATION
                                    \--[read-only, mode-aware]-----------------------> COMPLETE
                 ^            ^          |             |
                 +-- replan ---+          +--- fix -----+
                              ^                         |
                              +------- repair ----------+
edge behavior --[approve / guard / lite / auto]--> target stage
```

任务状态持久化在 `.easy-coding/` 里，不绑死在某次会话上。所以：

- 中途切别的任务，回来能接着跑；
- 审查发现问题，能走 repair loop 回到实现，或者 replan 回到分析重新对齐；
- 换个人、换个 agent 接手，通过 handoff / claim 拿到上一任的阶段和交接摘要，不用重新解释。

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
# npm 内测环境（0.x 阶段推荐）
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

`ec-workflow` 负责创建或恢复任务。项目可用 `approve`、`guard`（默认）、`lite`、`auto` 控制状态边确认范围，当前 session 可通过 `ec-task-management` 临时覆盖；guard/auto 的自动代码主链在 IMPLEMENT 后进入 REVIEW，lite 直接进入 VERIFICATION。只读任务展示完整报告后按生效模式进入 COMPLETE，不执行 REVIEW、VERIFICATION 或 MEMORY。

如果当前会话不希望 Harness 接管，显式调用 `/ec-no-harness`（Codex 使用 `$ec-no-harness`）。它只旁路 Easy Coding，其他 skills 和 hooks 仍正常工作，任务状态也会原样保留。

### 常用命令

| 命令 | 用途 |
| --- | --- |
| `easy-coding init` | 首次接入项目，部署所选平台的全部 harness 文件 |
| `easy-coding add-agent` | 给已接入项目追加某个平台支持 |
| `easy-coding upgrade` | CLI 升级后同步项目内生成文件，用户资产保留 |
| `easy-coding update` | 更新全局 CLI 到最新发布版 |
| `easy-coding config` | 交互修改项目级确认模式 |
| `easy-coding status` | 查看已安装平台、harness 版本、当前任务状态 |
| `easy-coding clear` | 移除 harness 安装物，保留 tasks、spec、memory 等用户资产 |

### 一句话记住整个流程

**装 CLI → `init` 铺文件 → `/ec-init` 让 agent 认识项目 → `/ec-workflow` 开始干活。**

之后每个需求都从 `/ec-workflow` 进，剩下的交给状态机。
