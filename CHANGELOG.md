# 更新日志

版本号严格使用 `x.y.z`：

- `x`：大的功能迭代；`0.x.x` 表示内测版本
- `y`：常规功能升级
- `z`：日常 bug 修复

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
