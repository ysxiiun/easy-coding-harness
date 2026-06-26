# 更新日志

版本号严格使用 `x.y.z`：

- `x`：大的功能迭代；`0.x.x` 表示内测版本
- `y`：常规功能升级
- `z`：日常 bug 修复

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
