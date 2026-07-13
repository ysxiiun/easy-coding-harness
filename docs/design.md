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
- **约束严格度可配置**：固定状态机、读写分离和 VERIFICATION 硬门始终保留；`approve / guard / lite / auto` 调整状态边确认范围，lite 额外跳过 REVIEW，但不改变验证证据要求。
- **项目模式检测保留**：自动区分初创/迭代项目并调整行为策略，这是 easy-coding 独有的能力。

从 Skill 升级到 Harness，用户的项目知识文件、记忆数据、编码规范零迁移成本。

### 三、六工作阶段 + 分层确认模式约束编码流程

三个对标项目（easy-coding、Trellis、superpowers）中**最严格的**控制系统。

**状态机**：INIT → ANALYSIS → IMPLEMENT → REVIEW → VERIFICATION → MEMORY → COMPLETE。代码任务可明确跳过 REVIEW，但不可跳过 VERIFICATION；显式只读任务在 IMPLEMENT 展示完整报告后直接结束，不进入后续工作阶段。

**确认模式 + 专项硬门控**：

1. **状态边确认**——INIT → ANALYSIS、MEMORY → COMPLETE 始终自动；approve 其余工作流边逐一确认，guard 与 lite 只确认 ANALYSIS → IMPLEMENT 与 VERIFICATION → MEMORY，auto 自动执行所有合法工作流边。guard/auto 的代码主链默认进入 REVIEW，lite 从 IMPLEMENT 直接进入 VERIFICATION；CLOSED 始终由显式关闭操作进入。
2. **VERIFICATION 门控**——代码任务的 lint + typecheck + test 必须全部通过且是本轮新鲜证据。只读任务不进入该阶段。
3. **MEMORY 长期门控**——MEMORY 先写短期记忆，再由状态 API 按阈值决定长期沉淀或 no-op；提示词不能绕过机械指令。

**修复循环有范围守卫**：验收阶段的修改请求会对照 dev-spec 判断范围——范围内修复按生效模式回到 IMPLEMENT，approve 可重新选择 REVIEW 或 VERIFICATION，guard/auto 默认回到 REVIEW，lite 直接回到 VERIFICATION；范围外建议创建新任务。

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
- `execution.jsonl` 的 `handoff` 记录提供高密度的上下文摘要（方案形态、关键决策、用户强调点）
- 每个需要确认的边界都提供显式交接入口，handoff 保留当前 `pending_transition`；自动边直接由状态 API 推进
- ec-workflow 统一承接所有恢复场景——跨会话中断和跨 Agent 交接走同一条路径

**不做过度设计**：不做阶段-Agent 亲和性绑定（每次任务的 Agent 选择可能不同），不做 Agent 间实时通信（Dead Drop 模式够用且简单可靠），不做并发控制（个人开发工具，不是分布式系统）。

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
| `easy-coding add-agent` | 追加 Agent 平台支持（复用 configurator，跳过运行时初始化） |
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
INIT ─自动→ ANALYSIS → IMPLEMENT → REVIEW → VERIFICATION → MEMORY ─自动→ COMPLETE
                                  └────────────→ VERIFICATION
                                  └─只读按模式──────────────────→ COMPLETE
          ↑            ↑          │
          +--- 重规划 --+          +--- 修复 ----+
                       ↑                         │
                       +------- 验收修复 --------+
状态边 ──[approve / guard / lite / auto]──→ 目标阶段

任何阶段 ──[用户主动中断]──→ CLOSED
```

**6 个工作阶段 + 2 个终态**，每个阶段由对应的 Stage Skill 负责具体执行，ec-workflow 只决定"什么时候"执行"谁"。

#### 2.2 硬门控设计

- **确认模式**：session 覆盖优先于项目 `behavior.confirm_mode`，缺失时为 `guard`。`approve` 除 INIT → ANALYSIS、MEMORY → COMPLETE 外逐边确认；`guard` 与 `lite` 只确认 ANALYSIS → IMPLEMENT、VERIFICATION → MEMORY；lite 禁止 IMPLEMENT → REVIEW；`auto` 自动执行全部合法工作流边。CLOSED 始终要求显式关闭操作。
- **pending_transition**：仅确认模式要求人工确认时记录；自动边走受限 `auto-transition`。guard/auto 的代码主链从 IMPLEMENT 默认进入 REVIEW，lite 直接进入 VERIFICATION，approve 可选择是否 REVIEW。
- **VERIFICATION**：lint + typecheck + test 必须全部通过，且必须是本轮新鲜执行的结果——上一轮的结果不算，"should pass" 不是证据。
- **MEMORY**：进入方式服从确认模式；进入后先写短期记忆，再执行长期记忆阈值门禁，完成后自动进入 COMPLETE。

#### 2.3 启动序列

ec-workflow 每次激活都执行统一的启动序列：

1. 初始化守卫：检查 project-init 任务状态
2. 必读文件：SOUL.md、RULES.md、最近 5 条短期记忆
3. 状态检查：有活跃任务则恢复，无则扫描未完成任务或准备接收新任务
4. 新任务创建

这使得 ec-workflow 成为用户日常使用的**唯一入口**——无论是新任务、中断恢复还是跨 Agent 交接，都走同一条路径。

---

### 3. 需求分析（ec-analysis）

ec-analysis 是从需求到可执行方案的翻译器。

#### 3.1 分析模板

输出完整的中文技术方案文档，包含：

**核心必填章节**：项目模式、任务类型、需求解析、现状（必须引用真实代码）、冲突摘要、影响面分析、改动范围（含文件编码列）、修改方案、实施拆解表 + 执行策略、测试策略表、风险与注意事项。最终报告不包含阶段标签或“待用户决策”章节。

**条件展开章节**：背景数据应用（引用记忆命中内容）、核心改动明细、前端实现映射。

**设计亮点**：

- **决策前置**：前两个工具调用先原样落盘骨架；随后只读分析并即时询问技术路线、接口、范围等决策问题。全部决策解决前不填充方案，解决后才一次性形成完整报告。
- **双重门控**：分析完成后先自检每个"现状"声明和具体修改方案；状态 API 在申请及确认 `ANALYSIS → IMPLEMENT` 时再次校验完整 dev-spec 和最新有效 execution plan。代码任务还要求非空 test strategy；只读任务禁止生成该文件。
- **文件编码保护**：改动范围表强制包含文件编码列，防止 AI 在修改文件时擅自转换编码（如 GBK → UTF-8）。
- **方案修订格式**：用户修改方案时必须输出完整修订版，不允许只给 diff——避免修订过程中丢失上下文。

#### 3.2 实施拆解与 execution.jsonl

分析阶段将工作分解为实施单元，写入 `execution.jsonl`：

```json
{"type":"plan","strategy":"parallel","units":[
  {"id":"U1","title":"...","type":"backend","files":["..."],"depends_on":[],"rules_sections":["..."],"abstract_modules":["..."]},
  {"id":"U2","title":"...","type":"test","files":["..."],"depends_on":["U1"],"rules_sections":["..."],"abstract_modules":["..."]}
],"parallel_groups":[{"level":0,"units":["U1"]},{"level":1,"units":["U2"]}]}
```

状态 API 会校验 unit 必填字段、依赖引用、依赖图无环，以及 `parallel_groups` 的层级必须晚于其依赖。显式 `doc` / `analysis` / `report` 无代码任务可使用 `single` + `files:[]`，子代理只返回 `deliverable` 且不得修改项目文件；代码任务不允许空文件范围。

三种执行策略：
- `single`：一个单元，派发 1 个子代理执行
- `sequential`：多个单元，有强依赖链，按依赖顺序逐个派发子代理
- `parallel`：存在独立单元，按依赖层级并行派发子代理

#### 3.3 记忆集成

分析阶段强制读取项目记忆（长期 + 短期），并在"背景数据应用"章节中显式引用命中的业务记忆和技术记忆。这确保了过往的决策和教训能在新任务中被参考。

---

### 4. 编码实现（ec-implementing）

#### 4.1 核心约束

- **范围即法律**：只能修改 dev-spec 改动范围表中列出的文件。需要额外文件？必须回退 ANALYSIS 修改方案。
- **RULES 合规**：每次写入前检查对应的 RULES 段落。
- **编码保护**：修改已有文件保持原编码，新文件遵循 dev-spec 声明的编码。
- **步进式报告**：每完成一个文件/模块输出简短进度，不堆到最后汇报。
- **自审门控**：实现完成后自检——是否所有改动都在确认范围内、有无未声明的依赖变更、有无遗留 TODO。

#### 4.2 子代理调度

所有执行策略都必须派发子代理：`single` 派发一个，`sequential` 按依赖顺序逐个派发，`parallel` 按层级并发派发。并行调度机制：

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
## 交付模式     {code | no-code read-only}
## 可修改范围    {unit.files | NONE — read-only deliverable}
## 编码规范     {RULES.md 相关段落}
## 架构上下文   {ABSTRACT.md 相关段落}
## 输出格式     changed_files, summary, deliverable, issues, needs_attention
```

**三层防逃逸约束**：
- **任务边界**：子代理只能修改分配的文件
- **阶段边界**：子代理不知道状态机的存在，无法触发阶段跳转
- **输出边界**：必须返回结构化结果

---

显式 `doc` / `analysis` / `report` 无代码任务使用 `single` 空文件范围且不生成 `test-strategy.md`。子代理不得修改文件，必须在 `deliverable` 返回完整结果；主 Agent 原样展示后，通过受限的 IMPLEMENT → COMPLETE 自动边直接结束。状态 API 会校验匹配的 dispatch/result、零文件改动、非空 deliverable 和无遗留问题；此类任务不进入 REVIEW、VERIFICATION、MEMORY，也不写任务记忆。

---

### 5. 代码审查（ec-reviewing）

#### 5.1 多维度审查

| 维度 | 检查内容 |
|------|---------|
| 正确性 | 修改是否符合 dev-spec 的需求描述 |
| 规范性 | 是否符合 RULES.md |
| 完整性 | 改动范围表中的文件是否都已处理 |
| 测试 | 必测/应测条目是否有对应测试 |
| 安全 | 硬编码密钥、SQL 拼接等明显风险 |

#### 5.2 分级判定

- `accept`：全部通过，推进到 VERIFICATION
- `fix`：发现问题但可修，在 REVIEW 内派发修复并重新审查（最多 3 轮）
- `replan`：方案本身有缺陷，回退 ANALYSIS
- `blocked`：外部阻塞，暂停报告

每个发现必须引用具体文件和行号——"looks good" 不是合格的审查意见。

#### 5.3 强制双 reviewer

无论变更规模，REVIEW 都并行派发正确性与规范性两个子代理，主 Agent 汇总后做判定。只读任务在 IMPLEMENT 展示报告后已直接结束，不进入 REVIEW。

---

### 6. 验证闸门（ec-verification）

#### 6.1 并行门禁

lint、typecheck、test 三项检查**必须同时启动**，全部通过才放行。

#### 6.2 测试覆盖校验

对照 `test-strategy.md`：
- [必测] 条目 → 必须有对应测试用例
- [应测] 条目 → 必须有对应测试用例
- Bug 修复 → 必须有回归测试
- 未覆盖 → 阻塞，回退 IMPLEMENT 补测试

#### 6.3 验收修复循环

验证通过后进入用户验收窗口：
- 用户满意 → 触发归档流程
- 小修复（在 dev-spec 范围内）→ 回退 IMPLEMENT，完成后重新选择 REVIEW 或直接 VERIFICATION
- 超出 dev-spec 范围 → 建议创建新任务
- 取消 → ec-task-close

---

### 7. 记忆系统（ec-memory）

三项目（easy-coding、Trellis、superpowers）中**最成熟的**记忆系统。

#### 7.1 短期记忆

- 每条任务完成后生成一条结构化记忆（schema v2 frontmatter）
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

#### 7.3 ABSTRACT 自动更新

记忆沉淀过程中如果发现架构变更（新增/删除模块、核心流程变化、技术栈变更），自动更新 ABSTRACT.md 并追加 CHANGELOG.md。

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
| 认知层 | ABSTRACT.md | 项目架构、模块、技术栈 | 架构变更时 |
| 记忆层 | memory/ | 历史经验和事实 | 每次任务 |

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

幂等设计——确保当前 `sessions/{ppid}.json` 存在并刷新活跃时间；多次调用与单次调用效果一致。

#### 10.3 子代理上下文注入（inject-subagent-context.py）

在子代理派发时注入工作流上下文，确保子代理知道当前任务状态。

---

### 11. 多 Agent 交互

#### 11.1 Dead Drop 协调

`.easy-coding/` 目录是天然的跨 Agent 协调层——Agent A 完成工作、写入结果后离开，Agent B 启动后读取结果、接手继续。所有关键产物（dev-spec.md、execution.jsonl、task.json）都是平台无关的纯文件。

#### 11.2 交接机制

- `task.json.last_agent` 记录最后处理者，接手 Agent 能识别"这是交接过来的任务"
- execution.jsonl 的 `handoff` 记录提供快速上下文摘要
- 每个存在 `pending_transition` 的阶段边界都提供显式交接入口
- ec-workflow 统一承接所有恢复场景

#### 11.3 状态行中的交接提示

```
> **Easy Coding** · **Guard** · `add-search` · `IMPLEMENT` · Handoff -> `claude-code`
```

---

### 12. Git 纪律（ec-git）

- **提交范围保护**：`.easy-coding/` 变更默认纳入提交（sessions/ 始终排除）
- **进行中任务提醒**：提交涉及未完成任务时警告
- **冲突处理**：`.easy-coding/` 内冲突必须先说明明细，确认后做归纳式合并
- **跨仓库提交**：读取当前任务的 repo_paths，逐个仓库检查和提交

---

### 13. 任务管理（ec-task-management + ec-task-close）

职责清晰分离：

| Skill | 管什么 |
|-------|--------|
| ec-workflow | 阶段流转 + 任务发现/恢复 |
| ec-task-management | 任务查看（创建/列表）+ session 确认模式覆盖 |
| ec-task-close | 任务中断与关闭（确认意图 → 记录原因 → 清理状态） |
| ec-no-harness | 当前 session 旁路 Easy Coding；保留任务状态与其他 skills/hooks |

`ec-task-management` 的默认面板同时读取任务列表和 session snapshot。即使没有未完成任务，仍展示项目确认模式、session 覆盖和最终生效模式，并给出设置 `approve/guard/lite/auto` 或恢复项目默认值的对话入口；裸唤起只读，不自动写入覆盖值。

ec-task-close 的关键设计：CLOSED 是终态，**不执行记忆流程**——未完成任务的记忆是脏数据。

---

### 14. execution.jsonl——全生命周期追溯

JSONL 格式天然 append-only，同时承担**计划**和**执行日志**两个角色：

```jsonl
{"type":"plan",...}                    // ANALYSIS 阶段
{"type":"dispatch","unit_id":"U1",...} // IMPLEMENT 阶段
{"type":"result","unit_id":"U1",...}   // IMPLEMENT 阶段
{"type":"review","dimension":"...",...} // REVIEW 阶段
{"type":"verify","check":"test",...}   // VERIFICATION 阶段
{"type":"handoff","from":"...",...}    // 跨 Agent 交接
```

各阶段只管往后 append，后续阶段能读前序结果——review 读 result 知道改了哪些文件，ec-memory 直接读此文件生成记忆。完整的生命周期记录，一个文件跑完全过程。
