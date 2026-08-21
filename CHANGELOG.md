# 更新日志

版本号严格使用 `x.y.z`：

- `x`：大的功能迭代；带 `-beta.*` 的版本表示预发布版本
- `y`：常规功能升级
- `z`：日常 bug 修复

## 1.0.0-beta.1

- ANALYSIS 的方案展示改为持久方案回执：后续仍有工具调用时，先前文本只算可能被宿主折叠的
  过程展示；原生选择返回或迁移调用结束后，最终消息会重新包含核心方案、验收、Workflow、
  风险与完整 Dev-Spec 链接/路径，不再被一句确认提示覆盖。
- Guard/Confirm 的取消、超时、空结果或无效结果继续保留 `pending_transition`，并在最终回执中
  重现完整选择；确认成功会注明接受的分支和目标阶段。Auto 不新增确认或停顿，只把完整
  Dev-Spec 入口带入同轮下一条持久最终消息。
- 修复只调整 Agent 展示协议与三平台模板测试，不依赖客户端字符串匹配，不改变状态机、
  状态 API、任务文件或审批模式语义。

## 1.0.0-beta.0

- 正常修改任务统一使用 `INIT → ANALYSIS → IMPLEMENT → QUALITY → MEMORY → COMPLETE`；
  QUALITY 在同一候选指纹下编排只读 Review/Verification 双门并汇总一次 Repair Bundle，
  Fast/Standard/Strict 仅改变证据深度，不再改变状态拓扑。
- 非 TDD 的 IMPLEMENT 回归纯编码职责，lint/typecheck/test/build 统一由 Verification Gate
  执行；TDD 的 RED/GREEN/REFACTOR 证据可以在 QUALITY 复用。环境失败留在 QUALITY 重试，
  用户明确接受检查点后差异时遵从其决策，不自动重跑 Review。
- 删除新建 `doc` / `analysis` / `report` 只读任务能力：纯对话请求保持 Ready，仓库内文档或
  配置写入仍走完整状态机。升级会把活动旧只读任务关闭为
  `legacy-read-only-task-retired`，保留文件和历史。
- 新增用户显式控制的 `ec-lite`：一次紧凑方案确认后执行最小修改，不生成任务、QUALITY
  或 MEMORY。活动任务决策由 session 命令锁原子绑定用户看到的 task ID；每次方案生成不可
  重放 digest，并把当时的 Git 基线一并纳入确认内容；确认时重新校验当前 Git 状态，确认
  只能执行一次且不能改写基线，完成时校验目标文件的真实变化、范围外改动与 HEAD 漂移。
  `ec-no-harness` 临时旁路不会清除 Lite 状态或方案。
- Canonical QUALITY 修复先把当前候选的失败证据写回对应 source task 为 `blocked`，再由
  IMPLEMENT 仅重开受影响任务；多来源重开先持久化可续跑意图，部分写回失败后可幂等恢复。
  写回事件必须绑定当前 Harness task、source task、候选指纹、QUALITY attempt 与失败证据，
  无关 `blocked` 状态不能冒充本轮投影。`execution.jsonl` 的 QUALITY 尝试由状态 API 在两个
  Gate 结束后一次性 append 并机械校验；repair/replan 按结构化失败类型路由，契约歧义对同轮
  混合缺陷具有 replan 优先级；候选漂移终结为 cancelled 后强制先回 IMPLEMENT，迟到的旧
  attempt 证据不会污染新一轮。主动返工与关闭任务同样会终结活动 attempt。
- Canonical repair 为内容指纹未变化且不依赖变化 source 的仓库追加状态层
  `quality-carry-forward`，按来源 attempt 和证据索引复用已通过门禁；hard/contract 下游及
  受影响仓库仍提供当前 attempt 的完整模式级证据。
- Canonical repair intent 随决策立即持久化，确认边绑定 attempt、双指纹与 affected source；
  blocked 投影后的候选/配置漂移和部分重开失败都幂等续跑原事务。
  `add-agent` 遇到项目 Harness 与 CLI 版本不一致时要求先整体 upgrade，避免新旧状态机混装。
- Adaptive 分级降低误判成本：简单局部修改优先 Fast，普通业务以 Standard 为主，Strict
  仅在明确高风险与真实复杂度同时存在时触发；未修改仓库、Spec 未选任务和 supermodule
  子项目不参与抬级。
- 编码规则强化最近邻风格、最小修改和适度设计：不补无依据防御校验、不为单次 getter
  return 提取常量、不拆碎方法，不修改无关格式或注释；核心 Java Javadoc 使用多行格式，
  普通单行说明使用 `//`，逻辑段落使用一个空行分隔。
- 活动 `REVIEW` / `VERIFICATION` 状态和验收检查点在升级时迁移为 `QUALITY` /
  `quality_checkpoint`，保留既有审查、验证和历史执行证据。
- 升级会依据旧安装清单清理已退役的 `ec-reviewing`、`ec-verification` 与三平台
  `ec-fixer`；仅删除哈希仍与旧版托管内容一致的文件，用户改过的副本会保留且不再写入新清单。

## 0.10.0-beta.10

- `.easy-coding/sessions/` 改为事件触发的有界 GC：只在创建新逻辑 session 前执行，
  无任务绑定的 session 保留 7 天、仍绑定任务的 session 保留 30 天，并按最近活动时间将
  根目录 session JSON 控制在 100 个以内；创建前会预留一个名额，已存在 session 的日常
  turn 不重复扫描。
- 清理依据 session 内容与活动时间，不依赖 Codex、Claude Code、Qoder、PPID 或旧文件名
  的字符串匹配；缺失或损坏的时间字段回退到文件修改时间，删除前重新比对内容，避免覆盖
  并发刷新。
- `easy-coding upgrade` 在实际升级目标中执行一次存量 GC，`--dry-run` 仅展示影响而不删除；
  acceptance 快照只清理任务不存在、任务已终态或不再被当前验收检查点引用的孤儿文件，
  tasks、memory、spec、project.yaml 与项目知识文件保持不变。
- 新增 TypeScript、共享 Python hook 与 upgrade 集成回归，覆盖双 TTL、LRU 上限、损坏旧
  session、仅新建触发、dry-run 和活动验收证据保留。

## 0.10.0-beta.9

- 工作流 owner 改为规范平台身份边界：每份安装后的状态脚本固化宿主身份，新写入只接受
  `claude-code` / `codex` / `qoder`，脚本身份、`--agent` 与已注入 session 命名空间三方
  不一致时在落盘前拒绝；`Codex with Easy Coding` 等作者/Canonical 展示归属不再允许进入
  `last_agent`。
- Codex 与 Qoder 共用的 `AGENTS.md` 生成区改为安装顺序无关的双平台路径合同，
  明确当前宿主只能调用自己的状态脚本，防止 Qoder 最后写入后误导 Codex 执行
  `.qoder/hooks/easy_coding_state.py`。
- handoff 提示改为显式协调事件驱动：只有未消费的 `handoff` 记录才显示交接，
  `claim-task` 新增 immutable `claim` 审计记录并关闭交接；单纯 owner 差异不再被伪造成
  handoff。
- upgrade 与首次 SessionStart 幂等迁移旧任务/session 中的 `root` 系列和误写展示名，
  即使版本号已经更新也能继续检测并自愈，但保留 `execution.jsonl` 及 Canonical Spec 的
  历史审计展示；新增生产形态、跨平台路径冲突、安装顺序和真实 handoff/claim 回归测试。

## 0.10.0-beta.8

- VERIFICATION 绿色后新增可审计验收检查点。无漂移时 `confirm` / `auto` 继续按原审批模式
  自动流转；检查点后出现代码变化时，所有模式只临时暂停一次，返回完整文本 diff、二进制/
  mode 变化、逐文件 old/new SHA-256 和稳定 `diff_sha256`，防止把同一次外部保存误判成必须
  重走完整流程；执行计划中的非 Git 文件同样支持精确差异确认。
- 用户确认精确差异后保留原 REVIEW 结论，不回退 IMPLEMENT 或重复审查；非执行差异可
  `carry-forward` 原验证，可执行差异必须补当前指纹的 `targeted` 验证，`waived` 仅用于用户
  显式接受未验证风险；Canonical 多任务只要求实际受影响 source task 留下当前指纹的定向
  验证。配置、计划、Workflow、Canonical 设计或嵌套仓状态变化仍按正常门禁返回相应阶段。
- Canonical task 在 Harness 本地验证完成后保持 `implemented`，仅在
  VERIFICATION → MEMORY 边界按显式确认或既有 `confirm` / `auto` 授权真正应用时写为
  `verified`；共享事件包含验收摘要，MEMORY → COMPLETE 仍负责写回 `completed`。
- `execution.jsonl` 新增 immutable acceptance 记录，短期记忆门禁会校验用户接受的授权来源、
  差异摘要、Review/验证策略、变更文件和完整 digest；状态 API 新增检查点、差异检查及精确
  确认参数，并补齐 Auto、定向验证、Canonical 边界与无重复 REVIEW 的回归测试。

## 0.10.0-beta.7

- Workflow floor 改为 Standard 居中的复合判定：单仓、单 Unit、非并行且最多 5 个文件的
  低风险局部修改优先 Fast；普通业务、多 Unit/文件、闭合的跨仓修改默认 Standard；只有
  明确高风险与真实复杂度/大影响面同时存在才进入 Strict。
- 仓库数量只统计 execution plan 中实际修改文件所属的 Git root。Canonical Spec 的未选
  task、依赖摘要、未使用 `repo_paths`，以及 supermodule 已登记但未修改的子项目不再抬高
  Workflow；风险描述、标题或文件路径中仅出现 `payment` / `schema` 等普通领域词也不再
  单独触发 Strict，并行执行本身也只作为 Standard 信号。
- ANALYSIS 新增渐进成本预算和 `Local Baseline`：只读取当前变更需要的最近邻同类代码、
  合同和测试，按证据继承命名、空值/异常处理、分层、方法粒度、常量与注释习惯，避免
  无关全仓扫描、投机性抽象和碎片化小方法。
- IMPLEMENT/REVIEW 与三平台子代理统一克制设计合同：允许符合局部惯例的直观魔法值，
  禁止为单个 getter return 创建常量；新增核心 Java 类的全部方法/字段、已有核心类中新增或
  实质修改的方法/字段必须有 Javadoc，核心或复杂逻辑补充必要意图/约束注释，且不批量改造
  未触碰历史代码。

## 0.10.0-beta.6

- Canonical Spec 首次路由新增 `inspect-dev-spec --manifest-only`：只通过 normalized remote
  识别当前 worktree、展示任务目录和共享 execution 状态，不再为未选仓库解析本地路径或
  为任何未选任务计算 baseline；`path_hint` 明确降级为提示信息。
- 用户选定 task 后，`inspect-dev-spec --spec-task ...` 只检查所选任务所属仓库及其
  change/test 范围；当前 worktree remote 唯一匹配时无需手工传 `--repo-path`，即使旧
  `path_hint` 指向仍存在的原 checkout，也优先绑定当前 worktree。
- `ec-workflow` 不再在路由阶段提前读取消费闭包；`ec-analysis` 负责唯一一次精确 selector
  调用，并对 `exact` / `scope-unchanged` 使用快速投影，对 `scope-drifted` 只分析所选任务
  的漂移文件和符号，派生 dev-spec 不再被解释为第二轮 Spec 创作。
- 共享 `EDS:EXECUTION` 固化为依赖事实来源：已完成 hard task 或已满足依赖边直接放行；
  禁止通过另一个本地 Harness task、Git 历史或 Agent 推断重复考古完成状态。
- 保持项目外原始 Spec absolute locator、身份校验 rebind、共享 writer/CAS 及旧版全量
  `inspect-dev-spec` 调用兼容；新增 worktree、未选仓库隔离和三平台安装产物回归测试。

## 0.10.0-beta.5

- 兼容新版 `easy-dev-spec/v1` 共享执行区：同步设计/整文双摘要与 execution 投影协议，新增
  单一共享 writer，将 Canonical Task、Step 和 dependency 的实施、验证、完成与取消结果
  写回原 Spec；本地 `execution.jsonl` 继续保存完整门禁证据。
- Canonical 绑定改为 `design_sha256 + document_sha256 + execution_revision`：执行进度更新不再
  误判为方案漂移；CAS 冲突只在设计未变时自动重试一次，稳定幂等键避免重复事件，pending
  写回可通过 `reconcile-spec-execution` 对账，revision 回退会被硬拦截。
- 支持用户显式选择项目外 Spec 绝对路径，并提供身份严格校验的 `rebind-spec-source`；静态
  设计调整必须 revision 恰好 +1、重新 READY 并调用 `sync-spec-design`，受影响任务及后继
  状态重置后回到 ANALYSIS，禁止手工编辑 `EDS:EXECUTION`。
- ANALYSIS→IMPLEMENT 只启动依赖已满足的来源任务；IMPLEMENT 按通过的本地测试证据回写
  Step/implemented，REVIEW 写回阻塞，VERIFICATION 写回 verified，MEMORY→COMPLETE 自动
  写回 completed，关闭任务写回 cancelled。共享写回与 Git 提交/推送保持相互独立。
- 共享事件统一记录为 `easy-coding / <Agent> with Easy Coding`；单槽 pending 禁止被不同动作
  覆盖，可重试 CAS 冲突保留现场，旧设计动作、幂等键载荷冲突和确定性状态错误会清槽解锁。
  result 只消费当前 `in_progress` 尝试之后的 dispatch/严格成功证据，repair 只重开 blocked
  来源任务；设计同步同时淘汰受影响依赖证据和旧实现指纹，本地 task.json 使用原子替换。

- 将日常任务记忆与架构维护解耦：每个代码任务只生成不可变短期记忆；仅当长期记忆触发
  `distill` 时才执行独立架构评估，并默认选择 `no-op`，避免为了更新而更新。
- MEMORY 状态 API 新增冻结式架构评估契约和 `memory-architecture-assessment` 命令，记录
  `action / trigger / reason / evidence / affected_sections`，并用 ABSTRACT 与架构 CHANGELOG
  指纹校验 `no-op / backfill / update` 的实际文件结果；评估失败时不得消费短期候选。
- 架构更新只接受模块边界、职责/依赖方向、核心流程、技术栈/运行基础设施或现有 ABSTRACT
  与稳定事实冲突等证据；普通 Bug 修复、字段/DTO 调整、局部重构、临时方案和例行依赖升级
  不触发更新。稳定编码约定只沉淀为 RULES 更新候选，不静默改写知识约束。
- 初创项目首个实质任务若缺失 ABSTRACT，可通过 `missing-abstract` 例外在未触发长期蒸馏时
  完成一次 `backfill`；0.10.0-beta.5 前已冻结的 MEMORY 指令及旧 MEMORY_LONG 恢复路径保持兼容。

## 0.10.0-beta.4

- ANALYSIS 完成后不再向会话回贴整份 `dev-spec.md`，改为展示核心方案、验收摘要、
  Workflow Mode 与主要风险，并在客户端支持时提供完整 Dev-Spec 的绝对 Markdown 文件链接，
  不支持本地链接时保留可复制的绝对路径。
- Dev-Spec 新增结构化“决策闭环”章节；技术路线、接口、模型、状态、范围或验收存在未决问题时，
  Agent 必须停留在 ANALYSIS 逐项问答并回填结论。状态 API 要求唯一的
  `decision_status: closed` 标记，未闭合方案不能进入 IMPLEMENT。
- `ec-implementing` 新增注释交付门禁：作者署名必须使用当前宿主 Agent 与 Easy Coding 的组合，
  例如 `Codex with Easy Coding`；新增数据模型字段、枚举成员和常量必须逐项说明语义及适用的
  单位、格式、取值、空值或兼容约束。

## 0.10.0-beta.3

- TDD 业务任务的 `VERIFICATION` 门禁收口为本地证据：每个仓库（Canonical 场景下每个
  source task）必须有通过的本地单测，以及达到冻结阈值的本地 JaCoCo changed-line
  coverage；不再要求远程 GitLab pipeline URL、job identity 或成功状态。
- `ec-tdd-init` 继续在 TDD 关闭态生成并校验参数化 GitLab TEST-stage job、构建配置、
  JaCoCo XML 与 readiness receipt，但远程 CI 只作为项目自动化能力，不再触发 Harness
  中间提交、推送或等待远程结果。
- beta.1/beta.2 任务中已有的 `coverage_scope=gitlab` 记录保持原样并从新验收集合中忽略，
  因此 pending/failed 远程记录不会阻塞升级后的本地门禁；本地 baseline、阈值、报告
  指纹及 TDD 生命周期/review 约束保持不变。

## 0.10.0-beta.2

- 新增 `ec-tdd-init`，在 TDD 关闭态初始化或刷新 Java 单测执行、JaCoCo XML、GitLab
  TEST job、报告 artifact 与 changed-line coverage gate；初始化只建设基础设施，不批量补
  存量业务单测，也不要求仓库全量覆盖率。
- 新增 `.easy-coding/tools/easy_coding_tdd_readiness.py` 与覆盖构建、GitLab CI、coverage
  工具的文件指纹 receipt；项目级 `easy-coding config`、session `set-tdd` 和 ANALYSIS →
  IMPLEMENT 均在开启/冻结 TDD 前机械校验 readiness，缺失或漂移时只允许先初始化或
  保持关闭。TDD 关闭的普通 hook 不扫描这些文件。
- `tdd-init` 作为专用代码任务始终冻结 `tdd_enabled=false`，即使遗留项目/session 或暂停
  任务请求开启 TDD，也可正常创建和修改 CI，消除“开启 TDD 后又依赖尚未创建 CI”的
  循环阻塞；初始化完成后仍需用户显式开启 TDD。
- 配置 schema 升至 5；升级时没有 readiness 的 beta.1 项目与 session TDD 请求迁移为
  关闭并保留阈值，已冻结活动任务合同不被静默改写。后续业务任务仍只验收相对冻结
  baseline 的新增/修改生产代码行，默认门槛 90%、测试设计目标接近 100%。

## 0.10.0-beta.1

- 新增默认关闭的 Java TDD 模式，支持项目级 CLI 配置与 session 覆盖；覆盖率阈值默认
  90、可配置 1..100，并在 ANALYSIS → IMPLEMENT 与任务一起冻结。
- 新增 `ec-config` 统一管理 Approval、Workflow、TDD 与阈值；`ec-task-management` 收口为
  纯任务生命周期面板。TDD 开启时状态栏在 Workflow 后显示独立 `TDD` 标识，关闭时格式
  与原有执行深度完全不变。
- TDD 开启后要求 Java RED/GREEN/REFACTOR（纯重构为 characterization GREEN → GREEN）、
  独立 TDD review，以及 JaCoCo 修改生产代码可执行行差异覆盖率；本地与 GitLab TEST
  stage 复用 `.easy-coding/tools/easy_coding_java_coverage.py` 门禁，验收必须同时保留本地
  结果与成功 GitLab pipeline/job 证据。
- 配置 schema 升至 4；旧项目、session 与在途 task 迁移后保持 TDD 关闭。TDD 关闭时不
  扫描 CI/JaCoCo、不生成 TDD artifact、不运行额外命令，也不提高 Fast/Standard/Strict
  的既有测试与验收深度。

## 0.10.0-beta.0

- 接入 `easy-dev-spec/v1` Canonical Spec：同步最终 producer 协议实现并新增只读
  `inspect-dev-spec`、确定性 `select-dev-spec-scope`、选择式 `create-task-from-spec` 与
  依赖证据 `satisfy-spec-dependency` 状态 API；用户选择多个 Spec task 后仍只创建一个
  Harness task，消费上下文按仓库形成闭包。
- Task、Unit 与执行证据新增来源 Spec SHA、仓库、source task/step、符号和测试命令追踪；
  ANALYSIS 使用最终 READY 语义机械校验全局、契约、仓库、任务和验收闭环，并继续校验
  仓库身份、基线、hard 依赖及 task/change/step/test 追踪。
- IMPLEMENT、REVIEW、VERIFICATION 与 Git 范围按 `repo_id` 隔离；pending integration
  依赖允许完成本地检查，但在证据闭合前禁止进入 MEMORY 或宣称全链路完成。
- 保持历史/legacy task、现有状态图、approval/workflow mode 与指纹证据兼容；Canonical
  Spec 始终只读，本地 dev-spec、execution plan 和 test strategy 作为带来源哈希的派生物。
- 补齐 Codex 根身份兼容：真实运行时写入的裸 `root`、既有 `/root` 及其协作子路径统一
  规范化为 `codex`，避免状态行、breadcrumb、任务列表与 claim 再次误报跨 Agent handoff。

## 0.9.1

- 正式发布 Codex Agent 身份归一化修复：协作路径 `/root`、`/root/...` 与平台身份
  `codex` 视为同一所有者，不再错误展示 `Handoff -> /root`。
- 状态写入统一保存规范化身份，同时兼容存量任务数据；Claude Code、Codex、Qoder
  之间的真实跨平台交接语义保持不变。
- 汇总 `0.9.1-beta.0` 的状态行、机器 breadcrumb、任务列表、claim 判定、回归测试与
  架构文档验证结果。

## 0.9.1-beta.0

- 修复 Codex 根代理把协作路径 `/root` 写入 `task.json.last_agent` 后，hook 运行时身份
  `codex` 因字符串不一致而错误展示 `Handoff -> /root` 的问题。
- 状态 API 统一规范化 Agent 身份，并在状态行、机器 breadcrumb、任务列表与 claim
  判定中兼容存量 `/root`、`/root/...` 所有者；真实 Claude Code、Codex、Qoder 跨平台
  交接语义保持不变，存量任务无需迁移或手工改写。
- 新增 Codex 根代理写入归一化、存量状态展示和真实跨平台 takeover 回归测试，同步架构
  说明与介绍页版本。

## 0.9.0

- 正式发布相互独立的 `approval_mode` 与 `workflow_mode`：审批等待不再与执行深度
  耦合，新增仅在 ANALYSIS → IMPLEMENT 确认一次的 `confirm` 审批模式，并默认使用
  `adaptive` 在分析结束时自动选择、展示和冻结工作流模式。
- 保留完整代码任务状态链，所有新代码任务均进入 REVIEW；通过 `fast`、`standard`、
  `strict` 调整各状态内部的上下文加载、审查独立性、验证范围与记忆深度，在减少
  Token、时间和重复返工的同时维持机械质量下限。
- 正式启用实现与配置指纹绑定的 REVIEW/VERIFICATION 证据、语义单元返工与连续失败
  重分析机制；配置 Schema 升至 3，并完整兼容旧 `lite`、approve、guard、auto 及
  0.9 之前在途任务的迁移语义。

## 0.9.0-beta.0

- 将单一 `behavior.confirm_mode` 拆分为 `behavior.approval_mode` 与
  `behavior.workflow_mode`：审批等待和执行深度不再耦合；工作流默认使用 `adaptive`，
  并在 ANALYSIS 结束时解析、展示并冻结为 `fast`、`standard` 或 `strict`。
- `approval_mode` 新增 `confirm`：仅在 ANALYSIS → IMPLEMENT 等待一次方案确认，确认后
  REVIEW、VERIFICATION、MEMORY、COMPLETE 在各自机械质量门禁通过后自动推进。
- 保留完整代码任务状态链，Fast 也必须进入 REVIEW；按模式调整每个状态内部的上下文
  加载、主 Agent/子 Agent 分工、审查独立性、验证范围和记忆深度，减少无效 Token、
  固定子 Agent 调度和重复全量检查。
- 新增工作流模式提案、机械风险下限、原子冻结和只升不降机制；REVIEW 证据绑定最终
  实现指纹，VERIFICATION 证据绑定实现与配置指纹，相关内容未变化时可复用、变化后
  自动失效。
- REVIEW 返工改为按语义单元合并，明确 error/warning/info 阻断语义；同类问题连续两轮
  未解决时停止盲目返工并回到重新分析。
- 配置 Schema 升至 3；旧 `lite` 自动迁移为 `approval_mode: guard` 与
  `workflow_mode: fast`，旧 approve/guard/auto 保留审批语义并默认使用 adaptive；
  在途任务通过 legacy 标记兼容已有提案与 REVIEW 证据，仅旧 lite 或已持久化直通边
  保留一次 IMPLEMENT → VERIFICATION；已处于 VERIFICATION 的旧任务仍需新鲜验证证据。

## 0.8.3

- 正式发布 Codex App thread 级 session 隔离：标准 hook `session_id` 缺失时使用 `CODEX_THREAD_ID`，避免同一 App 进程内多个逻辑会话共享 PPID session。
- 正式发布 Qoder CLI Agent 识别修复：共享 hook 优先按脚本平台目录判断，无法判断时优先使用 Qoder 专属环境变量，避免 Claude 兼容变量造成误识别。
- 汇总 `0.8.3-beta.0` 的 Codex thread fallback、Qoder/Claude 双环境变量、legacy PPID 回退、设计文档与安装后 hook 回归验证结果。

## 0.8.3-beta.0

- 修复 Codex App 未在 hook payload 中提供 `session_id` 时仍回退到 PPID、导致同一 App 进程内多个逻辑会话共享 Easy Coding session 的问题；Codex 现在会在标准 hook session ID 缺失时使用 `CODEX_THREAD_ID`，仅在两者都不可用时保留 PPID 兼容回退。
- 修复 Qoder CLI 同时暴露 Claude 兼容环境变量时被识别为 Claude Code 的问题；共享 hook 统一按脚本平台目录优先、Qoder 专属环境次之、Claude 环境最后的顺序解析 Agent，避免各入口判断逻辑漂移。
- 新增 Codex App thread fallback、标准 payload 优先级、legacy PPID 和 Qoder/Claude 双环境变量回归测试，并同步设计文档与安装后 hook 验证。

## 0.8.2

- 正式发布原生选择超时恢复：平台明确保证永久等待时禁用或省略 timeout / auto-resolution，无法保证时在调用原生选择前预先展示持久化文本编号。
- 原生选择超时、取消或返回无效结果后保留 `pending_transition` 且不重试；用户稍后可直接回复普通门 `1/2/3` 或特殊 IMPLEMENT 门 `1/2/3/4` 继续流程。
- 汇总 `0.8.2-beta.0` 的 workflow、analysis、Claude/Codex/Qoder 主约束、文档、安装回归和 npm 包内容验证结果。

## 0.8.2-beta.0

- 原生选择工具明确保证永久等待时，确认门禁用或省略 timeout / auto-resolution；有限超时不再视为“永久等待”。
- 无法确认永久等待时，Agent 会在调用原生选择前预先输出完整文本编号兜底，确保超时即使终止当前轮，用户仍可稍后直接回复编号；无效结果不再重试原生框。
- 恢复流程优先按现有 `pending_transition` 消费普通门 `1/2/3` 或特殊 IMPLEMENT 门 `1/2/3/4`，只有未匹配输入才重新展示门禁；workflow、analysis、主约束、文档和三平台安装测试同步固化该契约。

## 0.8.1

- 正式发布原生确认门完整展示：存在待确认迁移时，Claude Code、Codex、Qoder 必须提供确认目标阶段、交接和 free-form Other，并安全处理取消、超时或无效选择。
- 短期记忆采用 UUIDv7 通用 ID，session 按逻辑任务隔离并统一使用 agent 前缀；三平台 session 初始化、旧状态接管和 upgrade 迁移链路已完成并发与兼容加固。
- `ec-git` 将 `COMPLETE`、`CLOSED` 统一视为终态，并把 `easy-coding upgrade` 产生的受管 Harness 文件默认纳入提交候选；汇总 `0.8.1-beta.0` 至 `0.8.1-beta.2` 的验证结果。

## 0.8.1-beta.2

- `ec-git` 将 `COMPLETE` 与 `CLOSED` 统一识别为终态；提交涉及这两类任务时无需再询问是否提交中间态，任务产物直接按正常提交范围处理。
- git 提交范围改为基于完整工作区变更而非当前 Agent 的写入来源；`easy-coding upgrade` 生成的受管 Harness 文件默认纳入提交候选，同时继续排除 sessions、默认排除 `spec/dev/`，并分离真正无关的预存改动。
- Claude Code、Codex、Qoder 安装回归测试与设计文档同步固化终态任务和 CLI 升级产物的提交契约。

## 0.8.1-beta.1

- 短期记忆不再扫描目录生成 `001/002` 数字前缀，改由状态 API 生成 UUIDv7 通用 ID；文件名前缀与 schema v2 frontmatter `id` 完全一致，同时保留日期和可读摘要，避免多人或多 Agent 并发写入时重名。
- MEMORY 滑动窗口改按 frontmatter `date` 与 `id` 稳定排序；旧数字前缀和 `SM-YYYYMMDD-NNN` 记忆继续兼容读取，新检查点会拒绝 ID 与文件名前缀不一致的文件。
- 修复 Codex App 多个逻辑任务共享 Easy Coding session 的问题：session 文件不再以 PPID 为主键，统一使用 `<agent>-<session-id>.json`，避免 Claude Code、Codex、Qoder 的 ID 格式或取值冲突。
- hook session resolver 优先消费 payload `session_id`，对不安全 ID 使用稳定 hash；缺少逻辑 ID 时保留带 agent 前缀的 PPID 兼容回退，首次使用会接管旧 `<ppid>.json`，并按逻辑活跃时间清理无当前任务的过期 session。
- Codex `session-start.py` 改由 thread 级 `SessionStart` 触发；Claude Code 与 Qoder 也收敛为每个事件只有一个 session 写入 hook，避免初始化竞态。upgrade 按事件、命令和注册数量迁移旧 hook，并在 manifest 缺失时继续识别、清理 Qoder 旧 `session-start.py`；legacy `state.json` 通过原子迁移锁串行认领且仅在新 session 提交成功后删除。`ec-init` 优先沿用 hook 注入的逻辑 session，缺少 hook 上下文时先通过 snapshot 固定兼容 session，再执行 `project-init-complete`；CLI status 改为展示全部 agent session。

## 0.8.1-beta.0

- 修复分析阶段结束后的确认门可能退化为单一“回复确认执行”提示的问题：存在 `pending_transition` 时必须实际调用平台原生选择能力，完整提供确认目标阶段、交接给其他智能体和 free-form Other。
- 普通确认门与 Approve 模式代码 IMPLEMENT 特殊门分别保留各自完整分支，文本回退不会遗漏“跳过 REVIEW 进入 VERIFICATION”；原生选择返回空值、取消、超时或无法解析时继续保留待确认边，同一 assistant 轮最多重试一次，避免无限重复调用。
- workflow、analysis、Claude/Codex/Qoder 主约束、设计与使用文档及三平台安装回归测试同步固化上述展示契约。

## 0.8.0

- 正式发布 `lite` 确认模式：沿用 Guard 的关键确认门，代码任务完成 IMPLEMENT 后跳过 REVIEW，直接进入 VERIFICATION。
- Lite 模式在状态 API 和恢复流程中统一禁止 `IMPLEMENT → REVIEW`；切换模式时会取消遗留 REVIEW 待流转边并改走 VERIFICATION。
- 状态栏将品牌与模式独立加粗展示，例如 `**Easy Coding** · **Lite**`，任务名、工作流状态和 Handoff agent 保留行内代码背景。
- 汇总 `0.8.0-beta.0` 的验证结果，Claude、Codex、Qoder 主约束、阶段 skills、配置入口、文档和回归测试均已对齐。

## 0.8.0-beta.0

- 新增 `lite` 确认模式：确认门与 `guard` 相同，仍在 `ANALYSIS → IMPLEMENT` 和 `VERIFICATION → MEMORY` 等待用户确认，但代码任务跳过 REVIEW，直接从 IMPLEMENT 进入 VERIFICATION。
- Lite 模式在状态 API 层禁止 `IMPLEMENT → REVIEW`；切换模式时若存在遗留 REVIEW 待流转边，工作流会取消旧边并改走 VERIFICATION，避免旧状态绕过 Lite 语义。
- 状态栏将品牌与生效模式拆分显示，例如 `**Easy Coding** · **Lite**`；任务名、工作流状态和 Handoff agent 继续保留行内代码背景。
- Claude、Codex、Qoder 主约束、阶段 skills、配置入口、文档与回归测试同步支持四种确认模式。

## 0.7.1

- 正式发布确认模式可见性增强：状态栏品牌名统一展示当前生效模式，例如 `**Easy Coding [Auto]**`，覆盖 Ready、Waiting init、活动任务和 Handoff 场景；机器 breadcrumb 与 no-harness 行为保持不变。
- `ec-task-management` 默认面板始终展示项目模式、session 覆盖和最终生效模式，并支持通过对话设置或清除当前 session 覆盖。
- 汇总 `0.7.1-beta0` 与 `0.7.1-beta1` 的验证结果，Claude、Codex、Qoder 主约束、安装测试、状态 API 回归测试和使用示例均已对齐。

## 0.7.1-beta1

- 状态栏品牌名展示当前生效确认模式，例如 `**Easy Coding [Auto]**`；项目级 `behavior.confirm_mode` 与 session 覆盖仍沿用既有优先级，Ready、Waiting init、活动任务和 Handoff 使用同一格式。
- Claude/Codex/Qoder 主约束、安装测试、状态 API 回归测试和使用示例同步更新，机器 breadcrumb 与 no-harness 行为保持不变。

## 0.7.1-beta0

- 修复裸唤起 `ec-task-management` 时只显示任务列表、未暴露 session 确认模式的问题：默认面板现在始终读取 session snapshot，并展示项目模式、session 覆盖和最终生效模式，即使没有未完成任务也不会省略。
- 面板明确提供通过对话设置 `approve`、`guard`、`auto` 或恢复项目默认值的入口；裸唤起保持只读，不会自动修改 session。
- Ready 状态、Claude/Codex/Qoder 主约束、安装测试和使用文档同步将 `ec-task-management` 标明为任务与 session 设置面板。

## 0.7.0

- 新增 `behavior.confirm_mode`，提供 `approve`、`guard`（默认）和 `auto` 三种状态确认策略；session 中的覆盖值优先于项目配置。
- 新增交互式 `easy-coding config` 命令修改项目级确认模式；命令仅在项目 Harness 与 CLI 版本完全一致时写入。版本比较遵循 SemVer 预发布优先级，`upgrade` 可将 beta 收敛到同核心正式版，同时拒绝 beta CLI 降级正式版项目。`ec-task-management` 支持通过对话查看、设置或清除当前 session 覆盖，并在模式变化后保留已有待流转目标。
- `easy-coding upgrade` 将配置 schema 升级到 2，把 `auto_mode: true` 映射为 `auto`、`strict_confirm: true` 映射为 `approve`、其余映射为 `guard`，并删除两个旧字段；运行时不再消费旧配置。
- 状态 API 按生效确认模式决定 `request-transition` / `confirm-transition` / `auto-transition`，同时保留合法边、ANALYSIS 产物、只读交付、VERIFICATION 和 MEMORY 检查点。
- `guard` 仅确认 `ANALYSIS → IMPLEMENT` 与 `VERIFICATION → MEMORY`；其余工作流边自动执行，代码任务的自动主链默认进入 REVIEW。`approve` 除两条机械边外逐边确认，`auto` 自动执行全部合法工作流边；任何模式下关闭任务都必须显式执行。
- 新增 `ec-no-harness` skill：当前 session 可旁路 Easy Coding Harness，保留任务状态且不关闭 Hook 系统；非 Easy Coding skills、其他 hooks 与全局/项目约束继续生效，并支持同会话恢复。
- README、设计/介绍/使用文档、主约束、阶段 skills、生成安装测试和状态 API 回归测试同步升级到 0.7.0。

## 0.6.1

- 状态迁移按是否需要用户决策分层：`INIT → ANALYSIS` 在 INIT 工作完成后自动流转，`MEMORY → COMPLETE` 在记忆处理检查点完成后自动流转；这两条机械边不再创建 `pending_transition`，也不再展示确认或交接选项。
- 新增受限的 `auto-transition` 状态 API，只允许上述两条自动边；其他前进、修复和重规划边继续通过 `request-transition` / `confirm-transition` 显式确认，Hook 仍保持只读。
- IMPLEMENT 完成后允许用户选择进入 REVIEW，或明确跳过 REVIEW 直接进入 VERIFICATION；交接和 free-form Other 仍保留，跳过 REVIEW 不能绕过 VERIFICATION 硬门控。
- ANALYSIS 改为先原样落盘无阶段标签的 dev-spec 骨架，再在分析过程中即时询问并解决技术路线、接口、范围等决策问题，最后才填充完整方案；最终报告不再包含“待用户决策”章节。
- `ANALYSIS → IMPLEMENT` 在申请和确认迁移时都会校验完整 dev-spec 和最新有效 execution plan；代码任务还必须提供非空 test strategy，只读任务则禁止生成 `test-strategy.md`。必填章节正文、实施单元任务卡字段和并行分组均需完整，原始骨架、空章节、无界单元或缺失产物不能进入实施。
- dev-spec 骨架使用专用 `[[EC_TODO:...]]` 占位标记，既能可靠拦截未填字段，也不会把方案中合法的 `{title}`、`{type}` 等模板文本误判为残留占位符。
- execution plan 门禁校验依赖图无环及并行层级顺序；`doc` / `analysis` / `report` 显式无代码任务允许受限空文件范围并通过 `deliverable` 返回只读结果，代码任务仍禁止无界实施。
- 无代码 IMPLEMENT 单元必须返回非空 `deliverable` 且不得修改文件；主 Agent 在展示摘要或迁移选项前必须向用户原样输出完整 deliverable，避免结果只留在执行日志中。
- 无代码任务展示完整 deliverable 后直接通过受限 `IMPLEMENT → COMPLETE` 自动边结束；状态 API 会校验 single 空文件计划、匹配的 dispatch/result、零文件改动、非空 deliverable 和无遗留问题，不生成 `test-strategy.md`，不进入 REVIEW、VERIFICATION、MEMORY，也不写任务记忆。
- 介绍页展示版本与 `package.json` 保持一致，并由版本元数据测试防止后续发布再次漂移。
- 升级遗留的自动 `pending_transition` 在状态上下文中标记为 `auto-transition-ready`，不再错误注入用户确认提示。
- `single` / `sequential` / `parallel` 三种执行策略统一派发子代理，仅编排形态不同；技术方案骨架不再生成“主 Agent 直接执行”的冲突指令。
- 工作流 skills、主约束、README、设计/介绍/使用文档和状态 API 测试统一对齐新的自动边与可选 REVIEW 语义。

## 0.6.0

- 状态机移除无实际工作内容的 `WAITING_CONFIRM`；阶段完成后通过 `task.json.pending_transition` 记录待确认边，状态仍停留在当前阶段，直到用户明确确认。
- 所有合法阶段迁移默认统一提供“确认进入/返回目标阶段、交接给其他智能体、Other”三分支；优先使用智能体原生选项功能，纯文本编号仅作为无原生能力时的回退；handoff 会保留待确认边，下一智能体 claim 后可直接恢复该门禁。
- 合并 `MEMORY_SHORT` 与 `MEMORY_LONG` 为单一 `MEMORY`：先写并检查点化短期记忆，再由状态 API 计算长期记忆 `no-op/distill` 指令，原阈值门禁保持不变。
- MEMORY 短期记忆检查点校验 `memory_schema: 2`、`source_task` 当前任务归属和 SHA-256 内容指纹；长期记忆指令冻结 `candidate_files/kept_files`，只有明确候选允许被消费，保留项缺失或候选未清理均不能完成归档；旧 `MEMORY_LONG` 恢复通过显式兼容标记保留。
- MEMORY 配置强制满足 `0 <= short_term_keep <= short_term_max`；非法窗口直接阻断并提示修正 config.yaml，避免超过阈值后出现零候选、无法收敛的空蒸馏循环。
- 状态 API 新增 `request-transition`、`confirm-transition`、`cancel-transition` 以及 MEMORY 进度命令；hook 对用户输入完全只读，不再从原生选项、裸编号或自然语言自动写状态，所有确认均由智能体核对当前任务和目标状态后显式执行。
- `easy-coding upgrade` 幂等迁移 0.5.x 活跃任务和 session：`WAITING_CONFIRM → ANALYSIS`、`MEMORY_SHORT/MEMORY_LONG → MEMORY`，同步清洗阶段历史并保留记忆恢复进度。
- 工作流 skills、主约束、README、设计/介绍/使用文档及生成后 hook 测试全面对齐新状态模型。

## 0.5.3

- 根治 `task.json` 绝对路径泄漏：`.easy-coding/tasks/project-init/task.json` 不再写入本机仓库绝对路径。该 `project_path` 字段无任何消费方，直接移除，可提交产物彻底去本地化。
- `easy-coding upgrade` 会自动剥离存量项目中遗留的 `project_path` 字段，让老项目也随升级变干净。
- 根治 hook 编译产物：hook launcher 设置 `sys.dont_write_bytecode=True`，运行时不再在 `.claude/hooks/`、`.codex/hooks/`、`.qoder/hooks/` 旁生成 `__pycache__/*.pyc`；同时 `init` / `add-agent` / `upgrade` 会向项目 `.gitignore` 追加 `__pycache__/` 作为兜底防御。launcher 内容变化会触发 `upgrade` 刷新存量 hook 注册。
- 版本自 `0.5.2-beta.0` 升级为 `0.5.3`，合并 beta.0 的全部 portable hook 修复。跳过 `0.5.2` 正式版：升级检测的 `compareVersions` 会截断预发布后缀，若发 `0.5.2` 会把已安装 `0.5.2-beta.0` 的项目误判为已最新而不提示本次迁移；递增到 `0.5.3` 可让 beta 用户正确检测到升级。

## 0.5.2-beta.0

- 修复 Claude Code hook 命令使用直接相对路径导致在子目录 cwd 下找不到 `.claude/hooks/*.py` 的问题；Claude、Codex、Qoder 的 hook 配置现在使用可共享的 portable relative launcher，并绑定 `.easy-coding/config.yaml` 的 `project.id`，避免把本机仓库绝对路径写入可提交配置，同时防止 supermodule 父仓 hook 被子仓 cwd 错路由。
- `easy-coding upgrade` 可直接刷新存量 0.5.0 项目和已安装 0.5.1 beta 绝对路径配置；同版本也会修复缺失、重复、事件错位或 stale 的托管 hook 注册。
- `easy-coding clear` 和 `install-manifest.json` 兼容 portable launcher、旧直接相对命令和旧绝对 hook 命令，清理时仍按项目相对 hook 路径识别托管注册项。
- npm `0.5.1` 已发布不可覆盖，本版本作为 beta 修复包发布，用于替代原 `0.5.1` beta。

## 0.5.0

- 新增 supermodule 支持：`easy-coding init` 会识别 `.gitmodules`，父仓必装，已检出的一级子仓可按交互或参数选择分层安装。
- 新增 `--submodules <list>` / `--no-submodules` 参数，支持 `init`、`add-agent` 和 `clear` 精确控制子仓范围；`--yes` 在 init 中默认选择全部已检出子仓，clear 默认只处理父仓。
- `config.yaml` 新增 `supermodule.role`、`submodules` / `parent` 拓扑字段，父仓主约束会注入 supermodule 边界声明。
- `add-agent` 和 `upgrade` 支持父仓 + 已初始化子仓分层处理，普通仓库无 `.gitmodules` 时保持原单目录行为。
- `ec-git` 增加 submodule 两段提交纪律，`ec-memory` 增加父仓任务下子仓技术记忆分流规则。
- README 补充 supermodule 安装、运行、提交与记忆边界说明。

## 0.4.0

- 升级跨 agent 交接模型：交接记录只保存交接前 agent、阶段、摘要和时间，不再要求也不保存下一任 agent。
- 新增 `handoff-task` / `claim-task` 状态 API，交接方可写入 handoff 并释放当前 session，新 agent 可显式 claim 任务并读取最新交接摘要。
- `ec-task-management` 升级为任务面板：列出未完成任务并标注继续/接手，接手任务展示上一任 agent。
- `ec-workflow` 路由调整：有当前任务指针时优先继续；无指针时按提示词匹配未完成任务，未命中或无提示词时展示可继续/接手任务列表。

## 0.3.4

- 修复 Claude Code 中任务已进入 ANALYSIS 但回复没有状态栏的问题：Claude 的 `UserPromptSubmit` 现在会先运行幂等的 `session-start.py`，再运行 `inject-workflow-state.py`，确保每轮提示词都能拿到最新 `status_context`。
- 保留 Claude 原有 `SessionStart` 启动初始化，同时对齐 Codex/Qoder 的每轮状态注入方式，避免原生会话事件未进入模型上下文时状态栏缺失。
- 存量 Claude 项目需要执行 `easy-coding upgrade` 刷新 `.claude/settings.json` 后生效；Codex/Qoder 行为不变。

## 0.3.3

- 修复同一轮会话内状态栏仍显示旧状态的问题：`easy_coding_state.py` 的所有写状态命令现在都会在写入后立即回读 session/task，并返回最新 `status_line` 和 `status_context`。
- `create-task`、`set-current`、`clear-current`、`transition`、`close-current`、`project-init-complete`、`set-repo-path` 输出统一携带最新状态上下文，覆盖新建任务、切换任务、阶段迁移、关闭任务和初始化完成等所有状态写路径。
- 状态渲染逻辑收口到 state API，`easy_coding_status.py` 仅保留兼容导出，避免 hook 渲染和 state API 回读逻辑再次漂移。
- skill 模板强化规则：任何状态写入命令返回后，必须使用返回的 `status_context` 作为当前轮的权威状态来源，丢弃旧的 hook 注入状态。

## 0.3.2

- npm 包元数据切换到 GitHub：`repository`、`homepage` 和 `bugs.url` 均指向 `github.com/ysxiiun/easy-coding-harness`。

## 0.3.1

- 修复确认执行后首行状态栏仍显示上一阶段的问题：`UserPromptSubmit` hook 在明确确认输入下先执行合法状态迁移，再重新读取最新状态渲染状态栏。
- `WAITING_CONFIRM -> IMPLEMENT` 和 `VERIFICATION -> MEMORY_SHORT` 采用状态前置策略，避免真实动作已经开始但 `task.json.status` 仍停留在旧阶段。
- ec-workflow 强化统一规则：所有阶段推进必须先通过 state API 持久化下一阶段，再执行该阶段真实动作；hook 已完成前置迁移时不得重复写入。
- README 中 CHANGELOG 超链接改为 GitHub `master` 文件地址，便于 npm 页面和外部用户访问。

## 0.3.0

- 补充 `repository` / `homepage` / `bugs` 包元数据，并把 README 中的 CHANGELOG 链接改为 GitLab 绝对地址，修复 npm 页面相对链接跳转到 404 的问题。
- README 改为使用导向说明，主线调整为安装、两阶段初始化、日常 `/ec-workflow` 入口、命令表、平台差异和真实 skill 清单。
- MEMORY_LONG 门控改由 `easy_coding_state.py transition` 机械下发 `memory_long` 指令，避免短期记忆未超过阈值时被 prompt 误触发长期沉淀。
- ec-memory 补充短期记忆消费后的删除步骤：成功蒸馏更早条目并更新长期索引后，删除已消费短期文件，仅保留最近 `short_term_keep` 条。
- 实施 / 审查 / 验证三阶段统一强制子代理：IMPLEMENT 删除"主代理直接实现"分支，`single` / `sequential` / `parallel` 都派子代理（仅编排形态不同——单个串行执行也起子代理），保护主代理上下文不被实现细节污染；REVIEW / VERIFICATION 口径校齐，去掉"改动集大才派子代理"等矛盾表述。
- 新增 `easy-coding update` 命令：更新全局 CLI 到最新发布版；存量项目仍按需单独执行 `easy-coding upgrade`。
- 存量项目需要执行 `easy-coding upgrade` 才能拿到新的 hook 与 skill 模板。

## 0.2.1

- 新增 `easy_coding_state.py` 运行时状态 API，统一收口当前任务指针、任务状态、阶段流转、关闭/完成、`repo_paths` 等读写入口。
- 修复状态栏卡在 Ready 的根因：状态栏继续由 hook 脚本注入，skill 不再手写 session/task 状态；hook 注入 session 文件路径供状态 API 精确写入。
- 移除 tasks fallback / 最近任务猜测 / 自愈切换逻辑：session 为空时保持 Ready，任务进入 COMPLETE/CLOSED 后自动清空 `current_task`，不擅自切换到其他活跃任务。
- 清理 `state.json` 新流程引用，保留其作为 legacy 迁移输入；新状态模型改为 `sessions/{ppid}.json` + `tasks/*/task.json` + 状态 API。
- 修复 `easy-coding clear` 读取旧实验或损坏的 `install-manifest.json` 时，因 `agents` 字段缺失或损坏导致清理流程崩溃的问题；现在会安全降级并继续模板兜底清理。

## 0.2.0

- ec-analysis 新增防降级 HARD RULE：禁止把代码类任务（重构 / 修复 / 功能）擅自降级为"仅出报告 / 分析清单 / 留作后续子任务"。
- 改动范围净化：只允许列真实项目源码 / 配置文件，禁止把 `.easy-coding/` 下的 dev-spec、execution、test-strategy、记忆、报告等 harness 产物当作改动对象。
- 会话同步强化：dev-spec 完成后必须 Read 读回磁盘文件并原样回贴，禁止凭记忆缩略复述。
- ec-workflow 在 INIT 阶段锁定交付形态，并在 ANALYSIS gate 呼应防降级与改动范围净化要求。
- 澄清 `auto_mode` 语义：只免除 WAITING_CONFIRM 人工确认，不代表任何范围或交付形态决策。
- README 将完整版本历史迁出到 CHANGELOG.md，并在 package.json `files` 中纳入 CHANGELOG.md，保证 npm 包内 README 引用有效。

## 0.1.9

- 记忆模板全面升级：MEMORY.md 新增 `memory_schema: 2` frontmatter、快速导航表格、读取策略和迁移审计表；BUSINESS.md 和 TECHNICAL.md 各增加 5 个分类表格和已淘汰记录区。
- 新增 SHORT_MEMORY_TEMPLATE.md 短期记忆参考模板，包含完整 frontmatter schema（新增 `memory_schema`、`project_mode`、`commit`、`verification`、`memory_value` 字段）和 6 个结构化内容节。
- 新增记忆迁移流程：ec-init 初始化时自动检测旧格式记忆（无 schema-v2 frontmatter、缺少 BUSINESS/TECHNICAL 文件），经用户确认后执行一次性迁移。
- ec-memory 短期记忆格式强化：frontmatter 字段对齐原 Easy Coding 技能，新增文件命名规范和不可变约束。
- ANALYSIS 阶段骨架优先规则加固：ec-workflow 转换规则、hook 面包屑、主约束文件、ec-analysis 顶部提醒四层强化。
- 修复 .gitignore 误排 src/templates/、upgrade 缺少 sessions gitignore、主约束文件 marked-region 重复写入。
- 拆分 `.easy-coding/config.yaml` 与 `.easy-coding/project.yaml`：CLI 独占结构配置，`ec-init` 独占项目语义配置，物理隔离 schema 分叉风险。
- 新增 `easy-coding clear` 命令：移除已安装的 skills、hooks、agent 模板、CLI 配置和 sessions，保留 tasks、spec、memory、project.yaml 与项目知识文件。
- 修复 `upgrade` 在 config.yaml 缺少 `harness_version` 时崩溃（`Cannot read properties of undefined (reading 'split')`）：版本比较源头防御 undefined，缺少 `harness_version` / `agents` 时明确引导 `easy-coding clear` 后重新 `init`。

## 0.1.8

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

## 0.1.7

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

## 0.1.6

- ec-analysis 改为模板先行（template-first）工作流：分析阶段先创建 dev-spec.md 骨架，再逐步填充各章节。
- ec-analysis 模板从英文简写替换为完整中文结构化模板，12 个核心必填章节 + 3 个条件展开章节。
- 新增修订处理规则：用户修改意见必须重新输出完整方案，不允许只回差异摘要。
- 自检门禁新增"占位符是否全部替换"检查项。
- 测试策略补充人工验收和无法验证项。
- 将版本记录从 CHANGELOG.md 迁移到 README.md 统一维护。
- 新增项目级 CLAUDE.md 和 AGENTS.md 约束文件。

## 0.1.5

- ec-analysis 模板结构化改进：Change plan 改为五项一行式，Implementation units 输出完整 unit 表，Test strategy 内嵌 testability table + test points。

## 0.1.4

- 将宽终端 CLI banner 调整为 `ANSI Shadow` 厚重色块字形，恢复类似截图中的块状阴影质感。
- 中等宽度终端使用 `Small Shadow`，窄终端继续使用 `Small Slant`，避免标题溢出。
- 保留 0.1.3 的 cyan/blue 分层配色和副标题样式。
- 修复主约束模板中状态栏示例使用外层双反引号，可能导致 agent 复述 Ready 状态栏时在末尾多带一个反引号的问题。

## 0.1.3

- 修复 0.1.2 CLI banner 字体过于块状、左右压缩导致难以辨认的问题。
- 默认字体改为更舒展的 `Big`，中等宽度终端使用 `Doom`，窄终端继续使用 `Small Slant`。
- 保留 0.1.2 的 cyan/blue 分层配色和副标题样式。
- 将 hook 注入的 Easy Coding 状态提示收口为单行 Markdown 状态栏，展示 Ready、Waiting init、当前任务、任务状态和 handoff 来源。

## 0.1.2

- 改进 agent 平台选择提示，明确说明使用 Space 切换选择、Enter 进入确认。
- 平台选择后增加二次确认，避免误按回车直接按默认平台安装。
- 优化 CLI 启动标题，默认使用带阴影感的 `ANSI Shadow` 字体，并为窄终端提供 fallback。

## 0.1.1

- 修复 `easy-coding init` 将任意 `.easy-coding` 目录误判为已安装 harness 的问题。
- 新增旧版 `easy-coding` skill 产物识别，允许在保留旧数据的前提下接入新 harness。
- `project-init` 任务会记录旧资产清单，供 `ec-init` 校验、保留和补全旧数据产物。
- 将 CLI 版本源统一到 `package.json`，避免源码常量与包版本漂移。

## 0.1.0

- 首个内测基线版本。
- 提供 `easy-coding init`、`add-agent`、`upgrade`、`status` 基础命令。
- 支持 Claude Code、Codex、Qoder 三个平台的 skills、hooks、agents 和主约束安装。
