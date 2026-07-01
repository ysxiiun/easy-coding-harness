# 项目架构摘要

> 初始化时间：2026-06-30
> 数据来源：`package.json`、`README.md`、`docs/design.md`、`AGENTS.md`、`src/`、`test/`
> 说明：`.easy-coding/spec/dev/` 中存在 Dev-Spec 候选，但初始化按规则未读取正文。

## 项目定位

`easy-coding-harness` 是一个 TypeScript CLI 脚手架，用来把 Easy Coding harness 安装到 agent 原生目录中。它面向 Claude Code、Codex、Qoder / Qoder 中国版，负责部署 skills、hooks、sub-agents、主约束文件和 `.easy-coding/` runtime scaffold。

核心边界：CLI 只做确定性的文件部署、升级、状态查看和清理，不做项目业务分析；项目理解由安装后的 agent skill 在目标项目内完成。

## 技术栈

- Runtime：Node.js ESM，要求 `node >= 18`
- 语言：TypeScript strict mode
- CLI：Commander、Clack、Chalk、Figlet
- 构建：tsup，构建后执行 `scripts/copy-templates.mjs`
- 测试：Vitest
- Lint / Format：Biome
- 包管理：npm，发布产物由 `package.json files` 控制

## 目录结构

| 路径 | 职责 |
|---|---|
| `src/cli.ts` | CLI 入口和 commander setup |
| `src/commands/` | `init`、`add-agent`、`upgrade`、`update`、`status`、`clear` 等命令 |
| `src/configurators/` | Claude、Codex、Qoder、shared 平台安装逻辑 |
| `src/templates/` | skills、hooks、agents、主约束和 runtime scaffold 的源模板 |
| `src/utils/` | 文件写入、模板路径、install manifest、project detector、marked region、gitignore 等工具 |
| `src/types/` | 平台类型、任务与执行记录类型 |
| `test/` | 命令、configurator、utils、hook 的 Vitest 测试 |
| `docs/` | 设计文档、版本方案与使用说明 |

## 核心流程

### CLI 安装流程

1. 用户在目标项目执行 `easy-coding init` 或 `easy-coding init --agent=...`。
2. CLI 按平台 configurator 写入 agent 原生目录，例如 `.claude/`、`.agents/`、`.codex/`、`.qoder/`、`.qodercn/`。
3. CLI 写入共享 runtime scaffold，例如 `.easy-coding/` 目录、模板、配置和 project-init 任务。
4. 目标 agent 后续通过对应 skill 完成项目知识初始化、工作流执行、验证和记忆沉淀。

### 升级与清理

- `upgrade` 刷新生成区内容，保留用户资产。
- `clear` 移除 harness 安装物，但必须保留 tasks、spec、memory、project.yaml 等用户数据。
- 主约束文件通过 marked region 区分生成内容和用户自定义内容，升级只替换生成区。

### Agent 工作流

安装后的 workflow 以 `.easy-coding/` 作为跨 agent dead-drop 状态目录，核心产物包括 `task.json`、`execution.jsonl`、dev-spec、memory 与配置文件。流程强调阶段流转、确认门控、验证门控和用户验收后记忆归档。

## 平台适配模型

- 平台无关层：skill 模板、shared hooks、runtime 数据结构。
- 平台适配层：目录路径、配置文件格式、hook 配置、agent 定义格式、主约束文件。
- 模板变量：`{{placeholder}}` 在安装时按平台替换，例如触发符、agent 名称、路径和配置差异。

## 关键约束

- 不将 Dev-Spec 候选自动视为固定背景；每个需求单独选择是否加载。
- 不把模板输出和用户资产混在同一覆盖区。
- 不在 CLI 中引入需要 AI 推理的项目分析。
- 不以构建成功替代测试、lint、typecheck 或发布状态验证。

## 常用验证命令

```bash
npm run build
npm run typecheck
npm run lint
npm test
```

发布或包内容相关任务还应执行 npm package dry-run 和 registry 查询，并在需要时使用：

```bash
npm_config_cache=/private/tmp/codex-npm-cache
```

## 当前已发现的运行时输入

| 类型 | 路径 | 状态 |
|---|---|---|
| Dev-Spec 候选 | `.easy-coding/spec/dev/easy-coding-harness-supermodule-support-dev-spec.md` | 已发现，未读取正文 |
| 固定 Product / Architect / UI Spec | `.easy-coding/spec/` | 未发现 |
| Prototype | `.easy-coding/prototype/` | 未发现 |
