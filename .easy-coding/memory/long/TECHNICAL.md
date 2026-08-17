---
memory_schema: 2
memory_file: TECHNICAL
last_updated: 2026-08-17
---

# 技术记忆

> 保存“代码怎么组织、工程怎么做、以后怎么避免踩坑”的长期事实。

## 架构与接口决策

| 决策 | 原因 | 影响范围 | 来源 | 状态 |
|---|---|---|---|---|
| supermodule 拓扑写入 `config.yaml.supermodule` | 让父仓、子仓和普通仓可被后续命令稳定识别 | `runtime-scaffold`、`config-yaml`、主约束模板、命令目标解析 | supermodule-support | active |
| supermodule 目标解析集中在 command target 层 | `init`、`add-agent`、`upgrade`、`clear` 都需要父仓/子仓范围判断 | `src/commands/supermodule-targets.ts`、`src/commands/platforms.ts` | supermodule-support | active |
| `init` 支持重入追加子仓 | 父仓已安装后仍要允许新增 AB 等后续检出的子仓 | `init` 读取父仓已安装 agents，安装新子仓后刷新父仓 topology 和主约束 | supermodule-support | active |
| Git 共享 Harness 产物必须去本地化 | 防止团队提交本机路径或 Python 编译产物 | task/config/install 产物、hook launcher、init/add-agent/upgrade | SM-20260703-001 | active |
| 状态 API 是任务阶段、行为模式和面板数据的单一事实源 | 避免 skills、状态栏和平台模板各自重复解析优先级 | `easy_coding_state.py`、阶段 skills、三平台主约束 | SM-20260711-002, SM-20260711-003, SM-20260711-004 | active |
| 新代码任务统一经过 REVIEW，旧 direct edge 仅保留迁移兼容 | 0.9 起审批等待与执行深度拆分，不能继续沿用旧 Lite 的跳审语义 | 状态图、legacy migration marker、review/verification evidence | current code, SM-20260711-002, SM-20260713-005 | active |
| 平台 owner、展示归属和 handoff 协调事件彼此独立 | 防止 `root`、展示署名或共用约束路径被误当成跨 Agent 交接 | 状态脚本内嵌平台身份；可变 owner 只用三种 canonical ID；handoff/claim 以 execution 协调事件为事实源 | SM-20260722-007, SM-20260804-008, SM-20260806-010, current code | active |
| Canonical Spec 以所选任务闭包共享设计和执行事实 | 多仓 Spec 只应加载当前选择及直接依赖，路径提示不能替代仓库身份 | normalized remote 绑定、selected-task closure、共享 execution writer 与本地 Harness 投影 | SM-20260805-009, current code | active |
| Java TDD 是 readiness 保护的可选任务合同 | 关闭时保持零额外门禁，开启时冻结测试与 changed-line coverage 要求 | 项目/session 配置、TDD readiness receipt、任务快照、JaCoCo 本地门禁 | SM-20260807-011, current code | active |

## 工程规则与工作流

| 规则 | 适用场景 | 执行方式 | 来源 | 状态 |
|---|---|---|---|---|
| 无参数 TUI 也必须覆盖 supermodule 范围 | `init`、`clear` 等常用命令 | `init` 默认勾选未安装但已检出的子仓；`clear` 默认只勾选父仓 | supermodule-support | active |
| 删除类命令默认值必须保守 | `clear --yes` 和无参数 TUI | 默认只处理父仓，子仓清理必须交互勾选或显式 `--submodules` | supermodule-support | active |
| Python hook launcher 必须禁止字节码并保留 gitignore 兜底 | 多文件 hook 在用户项目内互相 import | launcher 在 import 前设置 `sys.dont_write_bytecode=True`；init/add-agent/upgrade 幂等追加 `__pycache__/` | SM-20260703-001 | active |
| ANALYSIS 派生物必须先过机械门禁再推进 | 代码任务和只读任务的交付契约不同 | 骨架使用 `[[EC_TODO:...]]`；代码任务要求完整 dev-spec/plan/test-strategy，只读任务要求 single 空文件 plan 与完整 deliverable | SM-20260711-002 | active |
| 任务/session 面板默认展示解析后的行为配置 | 裸唤起也要能解释当前有效行为 | 同时调用 `list-tasks` 与 `snapshot`，展示 project/session/effective approval 与 workflow；仅在用户明确要求时写 override | SM-20260711-003, SM-20260711-004 | active |
| 确认边必须保留可恢复的真实用户决策 | 原生选择失败或会话切换不能丢失 `pending_transition`，自动化输出不能替代用户选择 | 优先使用宿主原生选择；不可用时展示完整编号分支；取消、超时或无法解析时不推进状态 | SM-20260714-006, SM-019f82c7-8558-79cc-9b9f-c6748e807754 | active |
| 身份校验在状态写入前闭合 | 共用 AGENTS、错误脚本或展示署名都可能污染 owner | 安装脚本身份、`--agent`、注入 session 命名空间三方一致；upgrade 与首次 SessionStart 幂等迁移旧可变状态 | SM-20260722-007, SM-20260804-008, SM-20260806-010, current code | active |

## 实现模式与复用写法

| 模式 | 适用场景 | 推荐做法 | 反例 / 注意事项 | 来源 |
|---|---|---|---|---|
| `resolveSubmodules(opts, available, defaultSelection)` | 需要同一套 `--submodules` / `--no-submodules` / TUI 解析，但不同命令默认勾选不同 | 显式参数走 path/name 解析；`--yes` 走命令传入的 defaultSelection；TUI 使用 initialValues | 不要把所有命令都默认全选，`clear` 不能沿用 `init` 的默认值 | supermodule-support |
| `refreshSupermoduleParent` | 子仓安装或清理后刷新父仓拓扑 | 更新父仓 `config.yaml.supermodule.submodules`，并重写各平台主约束生成区的 Supermodule Boundary | 只刷新父仓生成区，不重装父仓全部文件 | supermodule-support |
| 存量 task 产物幂等清洗 | upgrade 修复历史共享文件中的本机数据 | `stripInitTaskProjectPath` 将旧 `context.project_path` 置为 `undefined` 后由 JSON 序列化移除 | Biome 禁止 `delete`；不要为零消费字段保留绝对路径 | SM-20260703-001 |
| 快照驱动的统一渲染 | Ready、Waiting、活动任务、Handoff 和管理面板 | 只消费 snapshot 已解析的 `effective_approval_mode` / concrete workflow，不在渲染层重算覆盖关系 | 旧 `confirm_mode` / `lite` 只用于迁移兼容 | SM-20260711-003, SM-20260711-004 |
| 受限自动迁移接口 | 只有不需要用户决策的边可自动推进 | 使用固定边白名单，并在目标阶段执行 artifact/evidence gate | 不得把 `auto-transition` 变成通用确认绕过接口 | SM-20260711-002 |
| 显式 coordination ledger | 跨 Agent 接手与恢复 | `handoff-task` 追加 handoff，`claim-task` 追加 claim；状态行只读取最新协调事件 | 不从 `last_agent` 字符串差异制造 handoff；历史 execution 归属不重写 | SM-20260804-008, SM-20260806-010, current code |
| Canonical 消费闭包与执行投影 | `easy-dev-spec/v1` 多任务、多仓库执行 | 一个 Harness task 保存 selected source tasks、repo/task/step/test 追踪和依赖证据，共享 writer 原地更新 execution | 未选仓库和 `path_hint` 不参与本地强校验；设计变化走显式同步门禁 | SM-20260805-009, current code |
| Java changed-line coverage 门禁 | 已完成 TDD 初始化的 Java 代码任务 | 基于 Git diff 与 JaCoCo XML 计算修改行覆盖，支持未跟踪文件、多模块和 aggregate 报告 | 报告过期、源码歧义或 readiness 缺失时失败关闭；TDD 关闭时不运行 | SM-20260807-011, current code |

## 易错点与修复策略

| 问题 | 成因 | 修复方式 | 验证方式 | 来源 |
|---|---|---|---|---|
| `init` 重入时重复执行被误判为已安装即退出 | 原单仓逻辑看到父仓 `.easy-coding/config.yaml` 后直接拒绝/退出 | supermodule 分支先解析目标，父仓已安装时仍允许选中新子仓安装；没有新目标时只刷新父仓拓扑 | `test/commands/init.test.ts` 覆盖追加子仓 | supermodule-support |
| `clear` 父仓误清所有子仓 | 删除类命令如果默认继承 init 全选会扩大破坏面 | `resolveClearTargets` 对 `--yes` 和 TUI 默认只选父仓，子仓需显式选择 | `test/commands/supermodule-targets-interactive.test.ts` 覆盖默认勾选 | supermodule-support |
| task.json 泄漏本机绝对路径 | 共享的 project-init task 曾写入零消费的 `context.project_path` | 新任务不写该字段，upgrade 幂等清洗存量字段 | `task-json.test.ts` 验证新建与存量清洗 | SM-20260703-001 |
| Python hooks 产生 `__pycache__` | launcher 执行入口后，被 import 的共享库默认写 `.pyc` | import 前禁写字节码，并让模板复制器过滤 `__pycache__` / `.pyc` | launcher A/B 测试、打包文件清单 | SM-20260703-001 |
| 把旧 Lite 当作当前执行模式 | 0.9 已拆分 `approval_mode` 与 `workflow_mode`，Lite 只剩迁移别名 | 旧 Lite 映射为 Guard + Fast；新任务仍进入 REVIEW，direct edge 仅限有显式 legacy marker 的存量任务 | 状态迁移与 upgrade 回归测试 | SM-20260713-005, current code |
| SemVer 预发布字符串按直觉递增 | `0.7.1-beta.1` 会低于历史命名 `0.7.1-beta0` | 延续同核心历史命名并用 `compareVersions` 固化顺序 | version/upgrade prerelease tests | SM-20260711-004 |
| 同一 Agent 被反复显示为 Handoff | 把 `last_agent` 差异、`root` 路径或展示署名当成交接事实 | owner 在边界规范化，状态行只消费未被 claim 关闭的显式 handoff | 无 handoff、handoff 后、claim 后、三平台错配和升级迁移回归 | SM-20260722-007, SM-20260804-008, SM-20260806-010, current code |
| Canonical Spec 分析重复整仓寻址和依赖考古 | 把 path_hint 当仓库身份，或读取未选任务/仓库 | normalized remote 绑定当前 worktree，只消费 selected-task closure 与共享依赖证据 | 多仓 fixture 验证未选仓库不解析、不抬高执行范围 | SM-20260805-009, current code |
| TDD 在未初始化项目中被部分开启 | 配置写入与 readiness 校验分离，导致任务合同不可执行 | 保存前复查 readiness；upgrade 关闭无 receipt 的旧项目/session 开关 | config、readiness、Java coverage 与 upgrade 回归 | SM-20260807-011, current code |

## 验证、发布与安装经验

| 场景 | 推荐命令 / 路径 | 注意事项 | 来源 |
|---|---|---|---|
| supermodule CLI 改动验收 | `npm run lint`; `npm run typecheck`; `npm test`; `npm run build`; `git diff --check`; `npm_config_cache=/private/tmp/codex-npm-cache npm pack --dry-run --json` | 包内容 dry-run 应确认 README、CHANGELOG、dist、templates 都进入 package | supermodule-support |
| 状态机、模板或发布改动验收 | lint、typecheck、全量 test、build、源模板/构建模板 diff、`git diff --check`、pack dry-run | 真实 Python hook 集成测试并发时可能因 CPU 抢占超时；先单独复跑失败组再判定回归 | SM-20260703-001, SM-20260711-002, SM-20260711-004 |
| 身份与 handoff 修复验收 | 三平台生成产物、脚本/agent/session 错配、handoff/claim 顺序、beta 升级整链 | 同时验证无事件不展示、真实事件可见、claim 关闭、旧 task/session 自愈、历史 execution 字节不变 | SM-20260722-007, SM-20260804-008, SM-20260806-010, current code |
| Canonical 与 Java TDD 验收 | Canonical 多仓 fixture；临时 Git/JaCoCo fixture；readiness receipt | 证据必须绑定 source task/repo 和当前实现；覆盖 tracked/untracked、多模块、旧布局、歧义和过期报告 | SM-20260805-009, SM-20260807-011, current code |

## 已淘汰记录

> 审计区，只保存短摘要；默认不进入 ANALYSIS 读取上下文。

| 淘汰日期 | 原内容摘要 | 淘汰原因 | 替代内容 / 来源 |
|---|---|---|---|
| 2026-08-05 | 新代码任务可跳过 REVIEW；Lite 是当前独立确认模式 | 0.9 已拆分 `approval_mode` / `workflow_mode`，并要求所有新代码任务进入 REVIEW；旧 direct edge 仅用于迁移兼容 | 当前状态图与 0.9 migration tests |
| 2026-08-17 | `last_agent` 不同即可推断 handoff，Codex 自报路径可直接作为 owner | 当前实现将 owner 收口为 canonical 平台身份，并以显式 handoff/claim 协调事件为交接事实 | 当前 `easy_coding_state.py` 与跨平台回归测试 |
| 2026-08-17 | Canonical Spec 始终只读且运行进度不写回原文件 | 当前协议保留静态设计边界，但通过 bundled writer 原地维护共享 execution | 当前 Canonical writer 与集成测试 |
| 2026-08-17 | Java TDD 可仅凭配置开关直接启用 | 当前实现要求 readiness receipt，并在任务冻结前复查项目与会话状态 | 当前 TDD readiness、config 与 upgrade tests |
