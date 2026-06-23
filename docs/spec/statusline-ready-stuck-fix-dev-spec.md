# 技术方案 — 状态 API 统一收口并修复状态栏 Ready 卡住

## 技术方案

### 项目模式
迭代项目。easy-coding-harness 已有 hook、skill、configurator、runtime template 体系，本次是运行时状态边界修复。

### 任务类型
Bug 修复 + 架构收口。核心问题不是简单状态栏文案，而是状态读写入口分散：hook 读 session/task，skill 文案指导 agent 直接写状态文件，导致 `task.json.status` 已变更但 `sessions/{ppid}.json.current_task` 为空时状态栏仍显示 Ready。

### 需求解析
- **目标**：状态栏继续由 hook 脚本强一致注入；所有当前任务指针、任务状态、阶段流转、关闭/完成、`repo_paths` 等状态操作统一通过运行时状态脚本执行。
- **输入**：当前 hook 使用 `.easy-coding/sessions/{ppid}.json.current_task` 定位任务；阶段权威数据在 `.easy-coding/tasks/{task-id}/task.json.status`。
- **输出**：新增 `easy_coding_state.py` 状态 API；hook 和 skill 均改为使用该 API；取消 tasks fallback / 最近任务猜测 / 自动自愈切换。
- **边界**：不改变状态机阶段集合；不让 skill 自行构造状态栏；不把终态任务自动切换到其他活跃任务。

### 现状
- `easy_coding_status.py` 直接读取 session 和 task 来渲染状态栏。
- `session-start.py` 只创建/刷新 session；没有把 agent 手写的任务状态同步为当前任务。
- 多个 skill 仍含旧 `state.json` 写法，和当前 `sessions/{ppid}.json` + `task.json` 架构冲突。
- agent 通过普通工具调用脚本时的 `os.getppid()` 不一定等于 hook 的 `os.getppid()`；因此必须由 hook 注入 canonical session 文件路径。

### 冲突摘要
- 旧 fallback 方案会扫描 tasks 并按最近更新时间自动选择任务，这会擅自改变用户当前上下文，违反任务切换必须由用户/工作流确认的原则。
- 正确方向是“状态操作收口”，不是“状态栏猜测”。

### 待用户决策
无。当前决策已锁定：
- `session.current_task` 指向活跃任务：显示任务和状态。
- 当前任务进入 `COMPLETE/CLOSED`：状态 API 自动清空 `session.current_task`，会话回到 Ready。
- `session.current_task` 为空：显示 Ready，不扫描 tasks，不额外提示。
- 状态栏由 hook 注入，skill 只消费注入结果。

### 影响面分析
- **Hook**：新增状态 API，状态栏、workflow breadcrumbs、sub-agent context 都改为通过统一 API 读取状态。
- **Skill**：`ec-workflow`、`ec-task-management`、`ec-task-close`、`ec-verification`、`ec-analysis`、`ec-git`、`ec-init` 等文案不再要求直接写 `state.json` / session / task 状态字段。
- **部署**：`writeSharedHooks` 会把新增脚本复制到各平台 hook 目录；存量项目需 `easy-coding upgrade`。
- **版本**：作为 bugfix 发布 `0.2.1`，同步 `CHANGELOG.md`。

### 改动范围
| 改动文件 | 改动类型 | 文件编码 | 改动核心内容 |
|---|---|---|---|
| `src/templates/shared-hooks/easy_coding_state.py` | 新增 | UTF-8 | 状态 API：snapshot/list/create/set-current/transition/close/project-init/set-repo-path |
| `src/templates/shared-hooks/*.py` | 修改 | UTF-8 | hook 统一通过状态 API 读取/记录状态 |
| `src/templates/common/skills/**/SKILL.md` | 修改 | UTF-8 | skill 不再手写状态文件，改为调用状态 API |
| `src/templates/main-constraint/*.tpl` | 修改 | UTF-8 | 明确状态栏由 hook 注入、状态变更只能走状态 API |
| `test/configurators/*.test.ts` | 修改 | UTF-8 | 覆盖无 fallback、终态清空 current_task、状态 API 基本流 |
| `package.json` / `package-lock.json` / `CHANGELOG.md` | 修改 | UTF-8 | 版本升级到 0.2.1 并记录修复 |

### 修改方案
- 新增 `easy_coding_state.py`，作为运行时状态单一入口。
- hook 注入 `[easy-coding:session-file:P]`，skill 调用状态 API 时必须传 `--session-file <P>`。
- `easy_coding_status.py` 只渲染状态栏，不再承担分散状态读写职责。
- 终态自动清空 `current_task`，让状态栏回到 Ready；启动新任务或切换任务时再由状态 API 改指针。
- 不实现任何 tasks fallback / tie-break / 自愈切换。

### 实施拆解
| 单元 | 说明 | 类型 | 涉及文件 | 依赖 |
|---|---|---|---|---|
| U1 | 新增状态 API 脚本 | runtime | `easy_coding_state.py` | 无 |
| U2 | hook 改为使用状态 API | runtime | shared hooks | U1 |
| U3 | skill / 主约束文案收口 | prompt/docs | templates | U1 |
| U4 | 测试与版本记录 | test/release | tests, package, changelog | U1-U3 |

**执行策略**：sequential。先建状态 API，再接入 hook，再改 skill/文档，最后测试。

### 测试策略
| 测试点 | 级别 | 归属单元 | 方式 | 验证命令 |
|---|---|---|---|---|
| session 为空且存在活跃任务仍显示 Ready | 必测 | U2 | 集成测试 | `npm test` |
| 任务进入 COMPLETE/CLOSED 后 session.current_task 被清空并回到 Ready | 必测 | U1/U2 | 集成测试 | `npm test` |
| missing current_task 显示 MISSING 而不自愈 | 必测 | U2 | 集成测试 | `npm test` |
| 状态 API create-task + transition 更新 task.json | 必测 | U1 | 集成测试 | `npm test` |
| 三平台安装新增状态脚本 | 必测 | U1/U2 | 集成测试 | `npm test` |

### 风险与注意事项
- 状态 API 是新的运行时入口，skill 文案必须明确传入 hook 注入的 session 文件路径，不能让 agent 依赖自身工具进程的 ppid。
- 旧 `state.json` 只作为 legacy 迁移输入存在；新流程不得写入。
- 已安装项目必须执行 `easy-coding upgrade` 才能拿到新 hook 和 skill。
