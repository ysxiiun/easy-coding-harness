# Easy Coding Harness 设计文档

## 项目定位

Easy Coding Harness 是一个 **AI 编码工作流脚手架**，为 AI Agent 驱动的软件开发提供完整的行为约束、任务持久化和记忆管理体系。

与其他 AI 编码工具不同，easy-coding-harness 不依赖特定的 Agent 平台，而是通过标准的 Skills / Hooks 机制安装到各平台的原生目录中，让 Agent 像识别自身内置功能一样识别 easy-coding 的工作流。

目前支持三个 Agent 平台：**Claude Code**、**Codex**、**Qoder**。

---

## 设计亮点

### 一、严格的 Harness 工程化

easy-coding-harness 不是一个松散的提示词集合，而是一个**工程化的脚手架系统**。

"Harness"意味着所有行为都被工程结构约束，而非依赖 AI 的"自觉"：

- **CLI 安装 → Agent 初始化**的两阶段设计：CLI 只做文件搬运（确定性的、可复现的），项目知识生成交给 Agent（需要智能的）。两者职责不混淆。
- **Skills 安装到平台原生目录**：不是让 AI "读一个 prompt 文件"，而是写入 `.claude/skills/`、`.qoder/skills/` 等平台标准目录，Agent 将其视为自身能力的一部分。
- **Hooks 做状态注入**：工作流状态通过 Python 脚本在每次用户输入时自动注入到 Agent 上下文——不靠 AI 记忆上一轮的状态，而是每一轮都从文件系统重建真相。
- **`execution.jsonl` 贯穿全生命周期**：从分析阶段的 `plan` 记录到实现阶段的 `dispatch`/`result`，再到审查的 `review` 和验证的 `verify`，一个 append-only 文件承载了完整的计划与执行追溯。不靠上下文窗口存状态，不怕会话中断。
- **upgrade 命令做分区保护**：主约束文件（CLAUDE.md / AGENTS.md）用标记区域隔离生成内容和用户自定义内容，升级时只替换标记内的部分。功能文件全量覆盖，用户资产绝不触碰。

### 二、兼容 Easy Coding Skill 原始产物

easy-coding-harness 是从 Easy Coding Skill（v4.3.2）升级而来，而非另起炉灶。原 Skill 的核心资产被完整保留并增强：

- **项目知识四层体系不变**：SOUL.md（身份层）→ RULES.md（约束层）→ ABSTRACT.md（认知层）→ memory/（记忆层），文件格式、读取顺序、作用域定义完全兼容。
- **记忆系统 schema v2 不变**：短期记忆的 frontmatter 格式、滑动窗口机制（max 10 / keep 5）、长期记忆的三文件结构（MEMORY.md + BUSINESS.md + TECHNICAL.md）——已有项目的记忆文件可以直接复用。
- **审批与执行深度正交**：固定状态机、读写分离、QUALITY 双门始终保留；`approval_mode` 调整等待范围，`workflow_mode` 调整每个状态内部的执行深度。
- **项目模式检测保留**：自动区分初创/迭代项目并调整行为策略，这是 easy-coding 独有的能力。

从 Skill 升级到 Harness，用户的项目知识文件、记忆数据、编码规范零迁移成本。

### 三、五工作阶段 + 审批/工作流双模式约束编码流程

三个对标项目（easy-coding、Trellis、superpowers）中**最严格的**控制系统。

**状态机**：INIT → ANALYSIS → IMPLEMENT → QUALITY → MEMORY → COMPLETE。所有仓库修改任务不可跳过 QUALITY；纯只读对话保持 Ready，不创建任务。

**双模式 + 专项硬门控**：

1. **状态边审批**——INIT → ANALYSIS、MEMORY → COMPLETE 始终自动；approve 逐边确认，
   guard 确认 ANALYSIS → IMPLEMENT 与 QUALITY → MEMORY，confirm 只确认
   ANALYSIS → IMPLEMENT，之后在机械门禁通过后自动执行，auto 从开始即自动执行。
   CLOSED 始终由显式关闭操作进入。
2. **状态内深度**——Adaptive 在 ANALYSIS 结束时根据机械风险下限解析并冻结 Fast、Standard 或 Strict；旧模式不构成下限，局部纠正按本轮范围重新计算。三个模式都运行完整代码状态链。
3. **QUALITY 双门**——同一候选下并行执行只读 Review Gate 与 Verification Gate；Fast 使用主 Agent 自审和最小定向验证，Standard 使用一个独立 reviewer 与受影响检查，Strict 使用至少两个独立维度并只对实际修改仓库执行完整适用检查。
4. **MEMORY 长期门控**——MEMORY 先写短期记忆，再由状态 API 按阈值决定长期沉淀或 no-op；提示词不能绕过机械指令。

**修复循环有范围守卫**：用户提出新的修复要求时会对照 dev-spec 判断范围——范围内修复回到
IMPLEMENT 并重新进入 QUALITY，范围外建议创建新任务。若只是 QUALITY 绿色检查点后
检测到用户或外部工具已经保存的代码差异，则先展示精确 diff；用户接受当前 digest 后沿用原
Review Gate 结论，只按差异性质沿用验证、补定向验证或记录风险豁免，不因保存动作本身重走流程。

**CLOSED 是独立终态**：从任何阶段都可由用户中断到 CLOSED，且不执行记忆流程——未完成任务的记忆是脏数据。

### 四、Agent 平台解耦

easy-coding-harness 的核心设计原则是**不绑定任何特定 Agent 平台**。

**分层解耦**：
- **平台无关层**：Skill 内容（SKILL.md）、运行时数据（`.easy-coding/`）、Hook 脚本逻辑——所有平台共用同一份
- **平台适配层**：配置文件格式（settings.json vs hooks.json vs config.toml）、目录路径（`.claude/` vs `.qoder/` vs `.codex/`）、子代理定义格式（.md vs .toml）——由 configurator 在安装时处理

**模板变量机制**：Skill 模板中用 `{{placeholder}}` 标记平台差异点，配置器在写入时替换。例如 `{{skill_trigger}}` 在 Claude Code 中是 `/`、Codex 中是 `$`；`{{sub_agent_dispatch}}` 在 Claude Code 中是 "Agent tool"、Codex 中是 "Codex sub-agent dispatch"。

**新平台适配成本极低**：以 Qoder 为例——扩展体系与 Claude Code 高度同构，适配工作量约为 Claude Code 配置器的 20-30%。核心差异仅在配置路径和 JSON wrapper 格式。Hook 脚本完全复用，AGENTS.md 模板与 Codex 共用。新增一个平台只需写一个 configurator + 子代理定义模板。

### 五、跨 Agent 协作能力

不同 Agent 平台各有优势——Claude Code 擅长交互式分析和方案讨论，Codex 擅长后台批量编码，Qoder 擅长全仓库上下文理解。easy-coding-harness 让你在同一个任务中混合使用多个 Agent。

**Dead Drop 协调模型**：`.easy-coding/` 目录是所有平台共享的"死信箱"——Agent A 完成工作、写入结果后离开，Agent B 启动后读取结果、接手继续。所有关键产物（dev-spec.md、execution.jsonl、task.json）都是平台无关的纯文件，切换 Agent 的信息损失为零。

这也是 dev-spec.md 和 execution.jsonl 独立存储（而非放在 Agent 上下文里）的核心收益——如果方案存在 Agent 的上下文窗口中，换 Agent 就全丢了。

**交接机制**：
- `task.json.last_agent` 记录最后处理者，接手 Agent 能区分"交接过来的任务"和"自己上次中断的任务"
- `last_agent` 使用平台 Agent 身份；Codex 根身份 `root`、`/root` 及其协作子路径会规范化为 `codex`，避免同一 Codex 会话被误判为跨 Agent 交接
- `execution.jsonl` 的 `handoff` 记录提供高密度的上下文摘要（方案形态、关键决策、用户强调点）
- 每个需要确认的边界都提供显式交接入口，handoff 保留当前 `pending_transition`；自动边直接由状态 API 推进
- ec-workflow 统一承接所有恢复场景——跨会话中断和跨 Agent 交接走同一条路径

**不做过度设计**：不做阶段-Agent 亲和性绑定（每次任务的 Agent 选择可能不同），不做 Agent 间实时通信或分布式锁（Dead Drop 模式够用且简单可靠）；只对共享 session/task 状态使用有界本地原子锁，防止同机命令竞争覆盖。

---

## 核心架构

```
                    ┌────── easy-coding init ──────┐
                    │              │               │
                    ▼              ▼               ▼
             claude-code        codex           qoder
             ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
             │ .claude/    │ │ .agents/    │ │ .qoder/     │
             │  ├ skills/  │ │  └ skills/  │ │  ├ skills/  │  ← Agent 原生识别
             │  ├ hooks/   │ │ .codex/     │ │  ├ hooks/   │
             │  └ agents/  │ │  ├ hooks/   │ │  └ agents/  │  ← Agent 原生触发
             │ CLAUDE.md   │ │  └ agents/  │ │ AGENTS.md   │
             └──────┬──────┘ │ AGENTS.md   │ └──────┬──────┘
                    │        └──────┬──────┘        │
                    └───────────────┼───────────────┘
                                    ▼
                           .easy-coding/              ← 运行时数据
                           ├── config.yaml
                           ├── sessions/
                           ├── SOUL.md / RULES.md / ABSTRACT.md
                           ├── tasks/
                           ├── memory/
                           └── spec/
```

**关键分层**：
- **平台标准目录**（`.claude/`、`.codex/`、`.qoder/`）：放 Skills、Hooks、子代理定义——Agent 原生发现和触发
- **运行时目录**（`.easy-coding/`）：放配置、状态、任务、记忆——所有平台共享读写，是跨 Agent 协调的"死信箱"

---

## 模块设计

### 1. CLI 脚手架（`src/`）

CLI 是纯粹的文件搬运工——不做任何智能判断，所有需要 AI 能力的事情全交给 Agent 内的 Skills。

#### 1.1 命令体系

| 命令 | 职责 |
|------|------|
| `easy-coding init` | 首次初始化：选择 Agent 平台，安装 Skills/Hooks/主约束文件，创建运行时目录和 project-init 任务 |
| `easy-coding add-agent` | 为同版本 Harness 追加 Agent；版本不一致时要求先整体 upgrade |
| `easy-coding upgrade` | 升级功能文件到最新版本（覆盖 Skills/Hooks，保留用户资产） |
| `easy-coding config` | 交互修改当前项目的确认模式 |
| `easy-coding status` | 查看项目安装状态、已安装平台、版本信息 |

#### 1.2 平台配置器（`src/configurators/`）

每个平台有独立的配置器，但核心逻辑高度复用：

```
configurator 执行流程：
  1. 读取 common/skills/ 下的共享 Skill 模板
  2. 解析 {{placeholder}} 模板变量（平台差异点）
  3. 写入各平台标准 skills 目录
  4. 复制 shared-hooks/ → 平台 hooks 目录
  5. 写入平台配置文件（settings.json / hooks.json）
  6. 写入子代理定义
  7. 生成主约束文件（CLAUDE.md / AGENTS.md）
```

**设计亮点**：

- **Skill 内容平台无关**：同一份 SKILL.md 模板通过 `{{placeholder}}` 处理平台差异。例如 `{{skill_trigger}}` 在 Claude Code 中解析为 `/`，在 Codex 中解析为 `$`。
- **去重机制**：当 Qoder 与 Claude Code 共存时，Qoder 运行时会同时扫描 `.claude/skills/` 和 `.qoder/skills/`。配置器自动检测已有的 Claude Code Skills，避免重复安装。
- **Qoder 中国版支持**：自动检测 `.qodercn` 目录或环境变量，切换到 `.qodercn/` 路径。

#### 1.3 主约束文件的分区保护

CLAUDE.md / AGENTS.md 使用标记区域隔离生成内容和用户自定义内容：

```markdown
<!-- ═══ easy-coding-harness generated (DO NOT EDIT BETWEEN MARKERS) ═══ -->
... harness 生成的内容 ...
<!-- ═══ end easy-coding-harness generated ═══ -->

## 项目自定义指令
（用户在此追加，upgrade 时保留）
```

`upgrade` 命令只替换标记内的内容，用户追加的指令永远不被覆盖。

#### 1.4 版本管理

`config.yaml` 中的 `harness_version` 字段追踪安装版本。`upgrade` 命令比较该字段与 CLI 自身版本：

- 项目版本 < CLI 版本 → 需要升级
- 项目版本 = CLI 版本 → 已是最新
- 项目版本 > CLI 版本 → 提示用户更新 CLI

---

### 2. 工作流状态机（ec-workflow）

ec-workflow 是整个系统的指挥官——拥有阶段流转和任务生命周期的完全控制权。

#### 2.1 状态流转

```
INIT ─自动→ ANALYSIS → IMPLEMENT → QUALITY → MEMORY ─自动→ COMPLETE
          ↑                       ↺ 普通修复
          +--- 需求/契约重规划 ----+
审批模式 ──[approve / guard / confirm / auto]──→ 状态边等待策略
工作流模式 ──[adaptive => fast / standard / strict]──→ 状态内执行深度

任何阶段 ──[用户主动中断]──→ CLOSED
```

**5 个工作阶段 + 2 个终态**，每个阶段由对应的 Stage Skill 负责具体执行，ec-workflow 只决定"什么时候"执行"谁"。

#### 2.2 硬门控设计

- **审批模式**：按字段使用 session > 本地 `~/.easy-coding/config.yaml` > 项目 > 默认值；`approval_mode` 默认为 `guard`。
  `approve` 逐边确认，`guard` 确认两个关键边，`confirm` 只确认 ANALYSIS → IMPLEMENT，
  `auto` 自动执行全部合法边。所有自动边仍需满足机械质量门禁，CLOSED 始终要求显式
  关闭。
- **工作流模式**：直接采用机械最低模式；历史 session/project workflow_mode 可读取，但不构成执行下限。
  ANALYSIS 保存 configured/selected/minimum/source/reasons 提案，进入 IMPLEMENT 时原子冻结。
  机械最低模式优先 Fast：Fast 允许单个实际修改仓库、最多三个内聚 Unit、
  最多 8 个文件且没有明确高风险/宽契约；Strict 则必须同时命中明确高风险与真实复杂度。
  Canonical/supermodule 的未修改仓库元数据不参与定级。
- **Java 单测策略**：`unit_test_mode` 为 `none | ut | tdd`，默认 `none`，同样遵循会话 > 本地 > 项目。
  UT/TDD 共用 `ut_coverage_threshold`（默认 90，1..100）、JaCoCo 改动行门禁和现有
  `ec-tdd-init` readiness。两者在 IMPLEMENT 入口冻结策略、baseline 与阈值，QUALITY 要求
  本地单测通过和改动行覆盖率达标。UT 不要求测试先行、额外过程文档或独立 TDD 审查；TDD
  保留生命周期与审查维度。一次测试同时提供测试和覆盖率证据，不提高最低执行深度。
  schema 6 原位迁移旧开关与阈值，保留任务进度；字段改名不改变原有证据序列化语义。
  GitLab TEST stage 复用同一脚本，远程 pipeline 不作为任务验收依赖。
- **UT/TDD 就绪与配置保护**：readiness 的 SHA-256 是初始化历史，不要求当前 POM、CI 或工具
  与快照一致。缺少凭据为 `needs_init`，必要本地入口或参数损坏为 `needs_repair`；初始化
  另检查完整 CI 契约。当前构建和工具内容同时绑定实施、验收契约及各仓库指纹，变化后
  必须重新验证，不能继承旧测试/覆盖率。升级保留项目/session 开关、阈值和任务冻结基线，
  升级清理也保留带有显式单测策略或阈值配置的 session。
- **共享 Canonical 执行投影**：Canonical Spec 的静态设计和机器执行区分层管理。Harness
  用 design revision + `design_sha256` 绑定本地计划，只把跨应用必须消费的 Task、Step、
  dependency 状态投影到 `EDS:EXECUTION`；详细 result/review/verify 仍保留在本地
  `execution.jsonl`。写回采用 `execution_revision` CAS、稳定幂等键、相邻锁与原子替换，
  冲突时仅在设计未变的前提下刷新并重试一次。项目外显式路径使用 absolute locator，
  迁移后必须按 schema/spec_id/design revision/design digest 精确 rebind。确认静态方案变化后
  先通过 `begin-spec-change` 持久化说明、受影响任务和原设计版本，再 revision +1、重新 READY
  并 `sync-spec-design`。对应同步完成前阻止实施和验收，旧幂等事件不能清除新的变更。
  同步恢复沿用原事件作者，保留当前接手负责人；执行区禁止人工修改。共享回写与 Git
  提交/推送是两个独立事实。
- **Canonical 两段式分析**：路由阶段使用 manifest-only 目录，只以 normalized remote
  确认当前 worktree，`path_hint` 仅报告生成路径是否不同；用户选定 task 后才解析所选
  仓库和 change/test baseline。创建/接手返回选中的消费闭包，恢复会话与设计同步后使用
  复用当前 session 未变化的消费凭据；上下文丢失或设计变化时才用 `resume-spec-context` 重载原稿。ANALYSIS 复用这些内容，exact/scope-unchanged
  直接投影运行时产物，scope-drifted 只分析所选任务漂移。未选仓库路径、旧本地 Harness
  task 和 Git 提交考古都不能成为当前分析门禁。
- **pending_transition**：仅审批模式要求人工确认时记录；自动边走受限 `auto-transition`。所有修改任务从 IMPLEMENT 进入 QUALITY。
- **确认门展示**：存在人工确认边时，Agent 完整展示“确认进入/返回目标阶段”“交接给其他智能体”和 free-form Other。模式选择已包含在 ANALYSIS 方案中，用户可在风险下限之上修改。取消、超时或无法解析时保留 `pending_transition`。
- **QUALITY**：Review 与 Verification 绑定同一候选指纹并可并行；全部结果汇总成一次 Repair Bundle。环境失败留在 QUALITY 重试，不触发重复 Review。
- **MEMORY**：进入方式服从确认模式；进入后先写短期记忆，再执行长期记忆阈值门禁，完成后自动进入 COMPLETE。

#### 2.3 启动序列

ec-workflow 每次激活都执行统一的启动序列：

1. 初始化守卫：检查 project-init 任务状态
2. 状态快照：读取当前 session、Lite Direct 和任务指针
3. 意图匹配：只恢复与当前请求匹配的任务；意图不明确时保持 Ready 对话
4. 阶段加载：仅加载当前阶段需要的规则和任务资产，记忆由 ANALYSIS 按相关性渐进读取
5. 任务创建：仅在仓库修改意图与路由范围明确后创建

这使得 ec-workflow 成为用户日常使用的**唯一入口**——无论是新任务、中断恢复还是跨 Agent 交接，都走同一条路径。

---

### 3. 需求分析（ec-analysis）

ec-analysis 是从需求到可执行方案的翻译器。

#### 3.1 分析模板

生成完整的中文技术方案文档并保存到任务目录；会话只展示核心摘要和完整文件入口。文档包含：

**核心必填章节**：项目模式、任务类型、需求解析、现状（必须引用真实代码）、冲突摘要、
决策闭环、影响面分析、改动范围（含文件编码列）、修改方案、实施拆解表 + 执行策略、
测试策略表、风险与注意事项。最终 Dev-Spec 不包含阶段标签或“待用户决策”章节，且必须
只有一个 `decision_status: closed`。

**条件展开章节**：背景数据应用（引用记忆命中内容）、核心改动明细、前端实现映射。

**设计亮点**：

- **决策前置**：前两个工具调用先原样落盘骨架；随后只读分析并即时询问技术路线、接口、
  模型、状态、范围和验收等决策问题，把答案与证据回填到“决策闭环”。全部决策关闭前，
  不输出最终摘要、不提议进入 IMPLEMENT。
- **双重门控**：分析完成后先自检每个“现状”声明和具体修改方案；状态 API 在申请及确认
  `ANALYSIS → IMPLEMENT` 时再次校验完整 Dev-Spec、唯一的 `decision_status: closed` 和
  最新有效 execution plan。Compact Fast 把必要验证直接放入 plan，不额外要求 test-strategy.md；其他深度使用对应策略文档，纯只读请求不创建任务。
- **持久方案回执**：ANALYSIS 结束时只展示核心方案、验收摘要、Workflow Mode 与主要风险；
  完整 `dev-spec.md` 通过绝对 Markdown 本地链接或绝对路径按需查看。后续仍有工具调用时，
  该文本只算可能被宿主归组或折叠的过程展示；原生选择或迁移调用返回后，最后一条消息必须
  重新包含紧凑回执和完整 Dev-Spec 入口。待确认时同时重现完整选项，确认后注明接受的分支
  与目标阶段，不能因为前文曾经可见而省略。
- **Auto 不停顿**：自动边不会为了生成回执增加人工确认；完整 Dev-Spec 入口随任务继续执行，
  并进入同轮下一条持久最终消息。该规则只改变展示协议，不改变状态机和审批语义。
- **文件编码保护**：改动范围表强制包含文件编码列，防止 AI 在修改文件时擅自转换编码（如 GBK → UTF-8）。
- **方案修订格式**：用户修改方案时必须输出完整修订版，不允许只给 diff——避免修订过程中丢失上下文。

#### 3.2 实施拆解与 execution.jsonl

分析阶段将工作分解为实施单元，写入 `execution.jsonl`：

```json
{"type":"plan","strategy":"parallel","units":[
  {"id":"U1","title":"...","type":"backend","files":["..."],"depends_on":[],"rules_sections":["..."],"abstract_modules":["..."],"local_baseline":["..."]},
  {"id":"U2","title":"...","type":"test","files":["..."],"depends_on":["U1"],"rules_sections":["..."],"abstract_modules":["..."],"local_baseline":["..."]}
],"parallel_groups":[{"level":0,"units":["U1"]},{"level":1,"units":["U2"]}]}
```

状态 API 会校验 unit 必填字段、非空文件范围、依赖引用、依赖图无环，以及
`parallel_groups` 的层级必须晚于其依赖。纯只读请求保持 Ready，不创建 Unit；文档、配置
或报告一旦需要写入仓库，就作为普通修改任务声明实际文件范围。

三种执行策略：
- `single`：一个单元；由冻结的 Workflow Mode 和独立性要求决定主 Agent 内联或派发
- `sequential`：多个单元，有强依赖链，按依赖顺序执行；只有上下文隔离有实际价值时派发
- `parallel`：存在独立单元，按依赖层级执行；并行确实节省成本时才派发多个子代理

#### 3.3 记忆集成

分析阶段先检索长期记忆索引和短期记忆元数据，只读取与当前领域、文件、前置任务直接命中的
内容；不默认加载最近若干条记忆或完整记忆库。Fast 候选只补充最近邻同类代码、直接合同和
目标测试，Standard 读取受影响闭包，只有 Strict 的复合证据出现后才扩展跨模块上下文。

---

### 4. 编码实现（ec-implementing）

#### 4.1 核心约束

- **范围即法律**：只能修改 dev-spec 改动范围表中列出的文件。需要额外文件？必须回退 ANALYSIS 修改方案。
- **RULES 合规**：每次写入前检查对应的 RULES 段落。
- **编码保护**：修改已有文件保持原编码，新文件遵循 dev-spec 声明的编码。
- **局部基线**：优先遵循同模块同职责代码的命名、控制流、空值/异常处理、分层、对象建模、
  方法粒度、常量和注释习惯；正确性、安全、明确需求与项目硬规则优先。
- **克制设计**：不预建抽象、wrapper、factory、层级或扩展点，不按行数把连贯逻辑拆成大量
  单次调用方法；只提取清晰语义边界、真实复用、独立测试点或能显著降复杂度的逻辑。
- **字面量策略**：允许符合局部惯例、含义直观且局部的魔法值；常量用于复用、稳定领域/
  配置/协议语义或项目惯例，禁止只为单个 getter return 创建常量。
- **作者归属**：项目存在作者署名惯例时，新署名固定为当前宿主 Agent 名称加
  `with Easy Coding`，例如 `Codex with Easy Coding`。该值只是作者/Canonical 展示归属，
  不是工作流 owner；状态 API 只接受 `claude-code` / `codex` / `qoder`。
- **字段注释**：新增数据模型字段必须逐项解释语义，并按需记录单位、格式、取值、空值、
  默认值或兼容约束；类型级注释不能替代字段级注释。枚举成员和稳定领域常量仅在最近邻
  风格或非直观语义需要时补充说明，不为注释而提取常量。
- **核心 Java 注释**：新增核心 Java 类的每个方法和字段、已有核心类中新增或实质修改的
  方法和字段必须有 Javadoc。实现接口方法时，如果接口方法已有完整、准确且可访问的
  Javadoc，并且实现没有增加该接口方法文档未说明的契约、约束、副作用或其他实现特有行为，
  则无需重复编写，也不为普通门禁添加空洞的 `{@inheritDoc}`；实现存在特殊行为或项目硬规则
  明确要求时仍须说明差异。
  旧项目中泛化的“每个核心 Java 方法都写 Javadoc”不单独覆盖该例外，只有明确要求实现方法
  重复接口 Javadoc 的项目规则才覆盖。
  核心/复杂逻辑补充意图和约束注释，不批量改造未触碰的历史代码。
- **步进式报告**：只在 Unit 边界输出简短进度，不为每个琐碎编辑单独汇报。
- **自审门控**：实现完成后自检——是否所有改动都在确认范围内、有无未声明的依赖变更、
  有无遗留 TODO、作者署名和新增字段/成员/常量注释是否合规。

#### 4.2 子代理调度

执行主体按冻结模式和真实独立性选择：Fast 的单一低风险 Unit 由主 Agent 内联完成；Standard
只在并行能节省成本、存在独立技术上下文时派发；Strict 的多 Unit/高风险实现保持独立执行。
需要并行时使用以下调度机制：

1. 按 `parallel_groups` 的 level 排序
2. 为每个 unit 构造**任务卡**（Task Card）
3. 并行派发子代理
4. 收集结果，检查文件冲突
5. 推进到下一个 level

#### 4.3 任务卡——子代理的标准化契约

子代理不自行寻找上下文，而是接收由主 Agent 预消化的任务卡：

```markdown
# 任务卡
## 硬性约束
- 不调用任何 Skill 工具
- 不读取 Skills 或 .easy-coding 目录
- 只修改「可修改范围」内的文件
## 任务         {单元描述}
## 可修改范围    {unit.files}
## 编码规范     {RULES.md 相关段落}
## 架构上下文   {ABSTRACT.md 相关段落}
## 局部基线     {同模块同职责代码的可核验惯例与路径}
## 输出格式     changed_files, summary, checks, issues, needs_attention
```

**三层防逃逸约束**：
- **任务边界**：子代理只能修改分配的文件
- **阶段边界**：子代理不知道状态机的存在，无法触发阶段跳转
- **输出边界**：必须返回结构化结果

---

纯分析、解释、报告和只读 review 不进入 Harness 状态机，保持 Ready 直接对话。文档、配置
或报告一旦需要写入仓库，就作为普通修改任务使用完整状态机。

---

### 5. 统一质量阶段（ec-quality）

QUALITY 冻结一个候选实现指纹，同时编排两个互不越权的只读门：

- **Review Gate**：检查需求正确性、契约、安全、测试设计、最近邻代码风格、核心 Java
  Javadoc 和最小修改范围，不执行命令、不修改代码；接口已有完整文档且实现无额外语义时，
  不把实现方法省略重复 Javadoc 判为缺陷。
- **Verification Gate**：执行实际 lint/typecheck/test/build/coverage 命令并记录真实退出
  状态，不修改源码。非 TDD 的 IMPLEMENT 不提前运行这些命令；TDD 的当前指纹绿色证据
  可以直接复用。

Fast 使用主 Agent 聚焦自审和最小定向验证；Standard 使用一个独立 reviewer 与受影响
检查；Strict 使用至少两个独立维度，并只对实际修改仓库执行完整适用检查。两个 Gate 可以
并行，但必须完成或明确取消后才能形成结论。每条 review/verify 证据同时绑定候选指纹和
状态层分配的 `quality_attempt`，迟到的旧 attempt 结果不能进入新一轮聚合。

所有阻塞结果一次性分类为代码缺陷、测试缺陷、契约歧义、环境问题或非阻塞建议，并汇总成一个 Repair Bundle。普通代码/测试修复留在 QUALITY，严重程度和行数不决定退回阶段；只有需求、契约、范围或主要实施方案改变才回 ANALYSIS/IMPLEMENT。环境问题留在 QUALITY，复用仍有效的结论，不重复 Review。

修复先通过 `begin-correction` 登记现有 Unit 内的文件和目标，`start-quality-repair` 接受执行人及授权，完成后调用 `complete-quality-repair`。Review/Verification 本身保持只读，修复在检查之间执行。修复结束只审查增量、运行受影响检查；未变输入的成功证据引用原记录。指纹格式和历史证据保持不变，升级不触发全量重算。一次 API 操作共享日志、计划和输入快照；批量 prepare/record 检查减少重复读取；检查展示名称或普通 argv 的等价格式变化不使证据失效。

Canonical 修复的 blocked 写回绑定本轮 Harness task、source task、候选和失败证据。开始修复仅重开所选修复 Unit 的 source task，稳定幂等键使用 repair_id；不制造 IMPLEMENT 阶段记录、不递增设计 revision。完成后更新相应 Step/task 执行事实，主 Agent 继续 QUALITY。

QUALITY 通过后冻结验收快照并按 `approval_mode` 处理 MEMORY 边界。若用户或外部工具随后
保存代码，Harness 展示精确 diff 和 `diff_sha256`；用户接受后遵从其 carry-forward、targeted
或 waived 决策，不自动重跑 Review。配置、方案、契约或 Canonical 设计变化不能走该例外。

### 6. Lite Direct（ec-lite）

`ec-lite` 完全由用户显式启停，不是 Fast 的别名。它只保留“紧凑方案 → 用户确认 → 最小
实现”，不创建任务、Dev-Spec、执行日志、QUALITY 或 MEMORY，且默认不运行测试。存在活动
任务时，用户选择取消启动、关闭任务后启动，或只清除当前 session 任务指针后启动；系统
不得代选，并通过 session 命令锁与展示时的 task ID 原子防止确认期间换目标。方案要求
1..50 个安全项目相对文件；每次提案生成不可重放 nonce，并把当时的 Git 基线纳入待确认
digest；确认只能执行一次且不能改写基线，若当前 Git 状态已偏离提案基线则要求重提方案；
完成时机械拒绝范围外改动、无实际
目标改动或 HEAD 漂移。Harness 自身
`.easy-coding/sessions/` 账本不参与业务范围校验，也不能作为 Lite 目标。Lite 会持续到用户
再次调用退出；`ec-no-harness` 只临时取得路由优先级，不删除 Lite 或已确认方案。

---

### 7. 记忆系统（ec-memory）

三项目（easy-coding、Trellis、superpowers）中**最成熟的**记忆系统。

#### 7.1 短期记忆

- 每条任务完成后生成一条结构化记忆（schema v2 frontmatter）
- 文件名使用 `{memory_id}_{YYYYMMDD}_{smart_name}.md`；`memory_id` 为状态 API 生成的 UUIDv7，且必须与 frontmatter `id` 完全一致，日期和可读摘要继续保留
- 旧 `{NNN}_{YYYYMMDD}_{smart_name}.md` 文件保持可读，不做破坏性重命名
- 滑动窗口：最多 10 条，超出时保留最新 5 条
- 记录：做了什么、为什么这么做、关键决策
- 窗口外的旧记忆成为长期沉淀候选

#### 7.2 长期记忆

三文件系统：
- `MEMORY.md`：索引（active / deprecated / superseded / deleted）
- `BUSINESS.md`：业务规则、领域知识、产品决策
- `TECHNICAL.md`：架构决策、实现模式、踩坑记录

**沉淀流程**：
1. 按 domain/tags/related_files 渐进式加载已有记忆（不做无边界全仓扫描）
2. 冲突检测：当前代码 > 用户最新确认 > 本轮沉淀 > 旧长期记忆
3. 淘汰检查：delete（无价值）/ merge（语义重复）/ deprecate（曾有效但已被替代）

#### 7.3 架构认知评估与 ABSTRACT 条件更新

日常任务只生成不可变短期记忆，不承担架构维护。只有长期记忆触发 `distill` 时，MEMORY 才在
业务/技术事实沉淀之后执行独立的架构评估；默认结论为 `no-op`，不能为了更新而更新。

评估动作固定为：

- `no-op`：候选事实未形成稳定架构变化，ABSTRACT 与架构 CHANGELOG 必须保持不变；
- `backfill`：ABSTRACT 原本缺失，首个实质性初创任务可在长期记忆未触发时例外回补；
- `update`：冻结候选证明模块边界、职责/依赖方向、核心流程、技术栈或运行基础设施已经变化。

`backfill/update` 只读取候选关联的模块与入口，定向修改受影响的 ABSTRACT 章节，并创建或追加
`.easy-coding/CHANGELOG.md`。普通 Bug 修复、局部字段或 DTO 变化、临时方案、局部重构和例行依赖
升级不构成更新理由。稳定编码约定只进入 TECHNICAL 作为 RULES 更新候选，MEMORY 不静默修改
SOUL、RULES 或 TEST_STRATEGY。

状态 API 冻结架构资产指纹并记录 `action / trigger / reason / evidence / affected_sections`；架构
评估未完成或文件变化与动作不一致时，候选短期记忆不得删除，MEMORY 不能完成。0.10.0-beta.5
之前已经冻结的 MEMORY 指令保持旧契约兼容。

**设计亮点**：记忆系统不仅"写"，还在分析阶段被强制"读"——ec-analysis 必须读取相关记忆并在分析输出中引用，确保过往经验真正被应用。

---

### 8. 头脑风暴（ec-brainstorming）

改编自 Superpowers 方法论的设计前置流程。

#### 8.1 核心流程

1. 探索项目上下文（SOUL + RULES + ABSTRACT + 记忆）
2. 范围检查（多子系统先拆分）
3. 一次一个问题的澄清对话（多选项优先）
4. 提出 2-3 个方案及其取舍
5. 呈现设计文档
6. 设计自审（占位符扫描 + 一致性 + 范围 + YAGNI）
7. 用户确认；任务创建进入 INIT，INIT 工作完成后自动进入 ANALYSIS

#### 8.2 硬门控

设计未经用户确认，不得进入实现。**没有例外**——"This Is Too Simple To Need A Design" 是明确的反模式。

#### 8.3 自动衔接任务

用户确认设计后，通过状态 API 自动创建任务目录和 task.json、更新当前任务指针并进入 INIT；INIT 工作完成后通过受限 `auto-transition` 自动进入 ANALYSIS。

---

### 9. 项目知识资产（ec-init）

#### 9.1 两阶段初始化

| 阶段 | 执行者 | 职责 |
|------|--------|------|
| 第一阶段 | CLI 脚本 | 纯文件搬运：安装 Skills/Hooks/配置，创建 project-init 任务 |
| 第二阶段 | Agent (ec-init) | 项目知识生成：分析代码，生成 SOUL/RULES/ABSTRACT/TEST_STRATEGY |

脚本不做任何智能判断——不判断项目类型、不检测语言、不生成知识文件。所有需要智能的事情全交给 Agent。

#### 9.2 四层知识体系

| 层级 | 文件 | 作用域 | 更新频率 |
|------|------|--------|---------|
| 身份层 | SOUL.md | 项目人格、对话标准 | 极少 |
| 约束层 | RULES.md | 语言编码规范 | 稳定 |
| 认知层 | ABSTRACT.md | 项目架构、模块、技术栈 | 长期沉淀后的证据评估判定需要时 |
| 记忆层 | memory/ | 历史经验和事实 | 短期每次任务；长期超过窗口时 |

#### 9.3 项目模式自动检测

Agent 自动判断已有项目（iterative）还是初创项目（startup），走不同的初始化流程——不在脚本阶段问用户。

---

### 10. Hook 系统

#### 10.1 状态注入（inject-workflow-state.py）

每次用户输入时自动执行，注入两种信息到 Agent 上下文：

**人类可读状态行**：
```
> **Easy Coding** · **Guard** · `add-search` · `IMPLEMENT`
```

**机器面包屑**：
```
[workflow-state:IMPLEMENT]
[current-task:add-search]
```

#### 10.2 会话启动（session-start.py）

幂等设计——hook 使用 `<agent>-<session-id>` 解析逻辑会话，例如
`codex-019f....json`；agent 前缀避免 Claude Code、Codex、Qoder 的 ID 冲突。标准 hook
payload 的 `session_id` 优先级最高；Codex App 未提供该字段时，使用进程环境中的
`CODEX_THREAD_ID` 保持 thread 级隔离。只有平台逻辑 ID 全部不可用时，才降级为
`<agent>-ppid-<ppid>.json`。session 同时记录原始 ID、来源、创建时间和最后活跃时间；
只有解析到一个尚不存在的新逻辑 session 时才在创建前触发全局 GC，已存在 session 的
日常 turn 不扫描。GC 不依赖平台前缀、PPID 或旧文件名：无任务绑定的 session 保留 7 天，
仍绑定任务的 session 保留 30 天，之后再按最后活动时间把根目录 JSON 控制在 100 个以内，
并为即将创建的 session 预留一个名额。时间字段缺失或损坏时回退到文件 mtime；删除前
重新读取并比对内容，已被并发刷新则跳过。

`sessions/acceptance/` 独立清理确定性孤儿：对应任务不存在、已经 COMPLETE/CLOSED，或
当前 `quality_checkpoint.snapshot_file` 不再引用该快照时才删除。升级前的
`verification_checkpoint` 仅作为 GC 兼容读取。活动任务仍引用的
验收证据始终保留，GC 不修改 tasks、memory、spec、project.yaml 或项目知识。实际执行
`easy-coding upgrade` 时对每个待升级目标额外运行一次同样的存量 GC；`--dry-run` 只展示
影响，不执行删除。

Agent 识别以 hook 脚本所在的 `.claude/`、`.codex/`、`.qoder/` 或 `.qodercn/` 平台目录
为第一优先级；无法从路径判断时，Qoder 专属环境变量优先于 Claude 兼容环境变量，避免
Qoder CLI 因同时暴露 `CLAUDE_PROJECT_DIR` 而被归入 `claude-code` session 命名空间。

Codex 的 `session-start.py` 运行于 thread 级 `SessionStart`，`inject-workflow-state.py`
运行于 turn 级 `UserPromptSubmit` 并幂等确保 session 存在，避免同一事件的并发 hook 在
初始化与读取之间产生竞态。

Claude Code 同样将 session 初始化限定在 `SessionStart`；Qoder 没有独立启动事件，因此由
`inject-workflow-state.py` 在 `UserPromptSubmit` 中同时完成幂等初始化和状态注入。每个平台
的同一事件只保留一个 session 写入方。首次解析新逻辑键时，会先接管旧 `<ppid>.json`，
并通过原子迁移锁确保 legacy `state.json` 只会被一个并发会话认领；新 session 成功写入后
才删除旧状态并释放迁移锁。

#### 10.3 子代理上下文注入（inject-subagent-context.py）

在子代理派发时注入工作流上下文，确保子代理知道当前任务状态。

---

### 11. 多 Agent 交互

#### 11.1 Dead Drop 协调

`.easy-coding/` 目录是天然的跨 Agent 协调层——Agent A 完成工作、写入结果后离开，Agent B 启动后读取结果、接手继续。所有关键产物（dev-spec.md、execution.jsonl、task.json）都是平台无关的纯文件。

#### 11.2 交接机制

- `task.json.last_agent` 只保存 `claude-code` / `codex` / `qoder` 规范 owner；安装后的
  状态脚本会固化所属平台身份，该身份、`--agent` 与 session 命名空间三方不一致时拒绝
  落盘。Codex 的 `root`、
  `/root` 及其协作子路径
  仅作为历史兼容输入，upgrade 会将可变状态幂等迁移为 `codex`。
- `execution.jsonl` 的 `handoff` 记录提供交接上下文，`claim` 记录表示已被接手；
  交接状态以最新协调事件为准，不从 owner 字符串差异推测。
- `cooperate_mode: default` 保持阶段节点交接；`dispatch` 额外支持实施与 QUALITY 内普通修复的人工派发。
- 派发前一次选择修复范围及执行人：当前 Agent、其他 Agent、暂缓/修改。Approve 的审批合并到该选择；Guard/Confirm/Auto 也保留这个手动换 Agent 的节点。接手方不重复确认，Harness 不自动启动其他 Agent。
- handoff 携带 next_action、原 Unit ID、已有证据索引和 stop_after；B 完成指定工作后交回，A 继续验证。角色不绑定平台，用户可以让 A 直接处理小改动。
- claim 对同一活动会话幂等；Spec 消费凭据按 session 保存，A→B→A 不覆盖 A 的上下文。已批准接力不会因默认配置改变而失效。
- 每个存在 `pending_transition` 的阶段边界都提供显式交接入口
- ec-workflow 统一承接所有恢复场景

#### 11.3 状态行中的交接提示

只有最新协调事件为未消费 `handoff`，且当前 Agent 不是交出方时才显示：

```
> **Easy Coding** · **Guard** · `add-search` · `IMPLEMENT` · Handoff -> `claude-code`
```

---

### 12. Git 纪律（ec-git）

- **提交范围保护**：`.easy-coding/` 变更默认纳入提交（sessions/ 始终排除）
- **终态任务直提**：`COMPLETE`、`CLOSED` 均为终态并直接纳入提交；仅非终态任务需要中间态确认
- **升级产物纳入**：`easy-coding upgrade` 写入的受管 Harness 变更默认属于提交范围，不因其并非当前 Agent 直接写入而忽略
- **冲突处理**：`.easy-coding/` 内冲突必须先说明明细，确认后做归纳式合并
- **跨仓库提交**：读取当前任务的 repo_paths，逐个仓库检查和提交

---

### 13. 任务与模式管理（ec-task-management + ec-config + ec-tdd-init + ec-lite + ec-task-close）

职责清晰分离：

| Skill | 管什么 |
|-------|--------|
| ec-workflow | 阶段流转 + 任务发现/恢复 |
| ec-task-management | 任务查看、创建、选择、恢复与交接 |
| ec-config | 只读配置面板 + 会话/本地/项目审批、协作、单测策略及阈值配置 |
| ec-tdd-init | 为 UT/TDD 初始化/刷新 Java changed-line coverage 基础设施 |
| ec-lite | 显式切换 Lite Direct；只执行方案确认与最小实现，不创建 Harness 任务 |
| ec-task-close | 任务中断与关闭（确认意图 → 记录原因 → 清理状态） |
| ec-no-harness | 当前 session 旁路 Easy Coding；保留任务、Lite 状态与其他 skills/hooks |

`ec-task-management` 只拥有任务生命周期；`ec-config` 裸唤起只读，显示各层值、最终来源及任务冻结值。行为配置按字段遵循会话 > 本地 > 项目 > 默认值，未来行为字段共用此规则。会话通过状态 API 设置/清除；本地使用 `easy-coding config --scope local`；项目使用 `--scope project`。本地文件为 `~/.easy-coding/config.yaml`，读取、init、upgrade 不创建，首次明确保存才创建；`--reset <field>` 删除该覆盖项，恢复继承。

本地可在项目外保存 UT/TDD 偏好，不做项目 readiness 扫描；任务实际启用时验证 readiness。任务已冻结的单测策略、baseline、阈值和已授权接力不被默认配置覆盖。机械执行深度仍自动选择最低模式。`ec-tdd-init` 用单测策略 none 的专用任务初始化基础设施。

ec-task-close 的关键设计：CLOSED 是终态，**不执行记忆流程**——未完成任务的记忆是脏数据。

---

### 14. execution.jsonl——全生命周期追溯

JSONL 格式天然 append-only，同时承担**计划**和**执行日志**两个角色：

```jsonl
{"type":"plan",...}                    // ANALYSIS 阶段
{"type":"dispatch","unit_id":"U1",...} // IMPLEMENT 阶段
{"type":"result","unit_id":"U1",...}   // IMPLEMENT 阶段
{"type":"review","dimension":"...","quality_attempt":1,...} // QUALITY Review Gate
{"type":"verify","check":"test","quality_attempt":1,...}   // QUALITY Verification Gate
{"type":"quality","attempt":1,"started_at":"...","completed_at":"...","duration_ms":1,"outcome":"passed","review_gate":"passed","verification_gate":"passed","summary":"...",...} // 状态 API 追加的 QUALITY 完结记录
{"type":"handoff","from":"...",...}    // 跨 Agent 交接
```

各阶段只管往后 append，后续阶段能读前序结果——review 读 result 知道改了哪些文件，
ec-memory 直接读此文件生成记忆。QUALITY 起始上下文暂存在 task.json；两个 Gate 完结后由
状态 API 原子追加一条带候选/配置指纹、双 Gate 终态、结构化分类、摘要、证据窗口和连续
attempt 的完整终态记录；结果可以是 passed、repair、replan 或 cancelled。Canonical 修复后
对未变化仓库的复用另写 `quality-carry-forward`，保存来源 attempt、证据索引和仓库指纹。
已登记的普通修复在 QUALITY 内完成后开始新 attempt，未登记的候选漂移先取消旧 attempt，再明确修复范围；配置变化可取消后原地重启。记录不回写已有行，也不允许缺失、重复或残缺记录进入 MEMORY。完整的生命周期
记录，一个文件跑完全过程。
