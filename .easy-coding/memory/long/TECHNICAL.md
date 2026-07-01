---
memory_schema: 2
memory_file: TECHNICAL
last_updated: 2026-06-30
---

# 技术记忆

> 保存“代码怎么组织、工程怎么做、以后怎么避免踩坑”的长期事实。

## 架构与接口决策

| 决策 | 原因 | 影响范围 | 来源 | 状态 |
|---|---|---|---|---|
| supermodule 拓扑写入 `config.yaml.supermodule` | 让父仓、子仓和普通仓可被后续命令稳定识别 | `runtime-scaffold`、`config-yaml`、主约束模板、命令目标解析 | supermodule-support | active |
| supermodule 目标解析集中在 command target 层 | `init`、`add-agent`、`upgrade`、`clear` 都需要父仓/子仓范围判断 | `src/commands/supermodule-targets.ts`、`src/commands/platforms.ts` | supermodule-support | active |
| `init` 支持重入追加子仓 | 父仓已安装后仍要允许新增 AB 等后续检出的子仓 | `init` 读取父仓已安装 agents，安装新子仓后刷新父仓 topology 和主约束 | supermodule-support | active |

## 工程规则与工作流

| 规则 | 适用场景 | 执行方式 | 来源 | 状态 |
|---|---|---|---|---|
| 无参数 TUI 也必须覆盖 supermodule 范围 | `init`、`clear` 等常用命令 | `init` 默认勾选未安装但已检出的子仓；`clear` 默认只勾选父仓 | supermodule-support | active |
| 删除类命令默认值必须保守 | `clear --yes` 和无参数 TUI | 默认只处理父仓，子仓清理必须交互勾选或显式 `--submodules` | supermodule-support | active |

## 实现模式与复用写法

| 模式 | 适用场景 | 推荐做法 | 反例 / 注意事项 | 来源 |
|---|---|---|---|---|
| `resolveSubmodules(opts, available, defaultSelection)` | 需要同一套 `--submodules` / `--no-submodules` / TUI 解析，但不同命令默认勾选不同 | 显式参数走 path/name 解析；`--yes` 走命令传入的 defaultSelection；TUI 使用 initialValues | 不要把所有命令都默认全选，`clear` 不能沿用 `init` 的默认值 | supermodule-support |
| `refreshSupermoduleParent` | 子仓安装或清理后刷新父仓拓扑 | 更新父仓 `config.yaml.supermodule.submodules`，并重写各平台主约束生成区的 Supermodule Boundary | 只刷新父仓生成区，不重装父仓全部文件 | supermodule-support |

## 易错点与修复策略

| 问题 | 成因 | 修复方式 | 验证方式 | 来源 |
|---|---|---|---|---|
| `init` 重入时重复执行被误判为已安装即退出 | 原单仓逻辑看到父仓 `.easy-coding/config.yaml` 后直接拒绝/退出 | supermodule 分支先解析目标，父仓已安装时仍允许选中新子仓安装；没有新目标时只刷新父仓拓扑 | `test/commands/init.test.ts` 覆盖追加子仓 | supermodule-support |
| `clear` 父仓误清所有子仓 | 删除类命令如果默认继承 init 全选会扩大破坏面 | `resolveClearTargets` 对 `--yes` 和 TUI 默认只选父仓，子仓需显式选择 | `test/commands/supermodule-targets-interactive.test.ts` 覆盖默认勾选 | supermodule-support |

## 验证、发布与安装经验

| 场景 | 推荐命令 / 路径 | 注意事项 | 来源 |
|---|---|---|---|
| supermodule CLI 改动验收 | `npm run lint`; `npm run typecheck`; `npm test`; `npm run build`; `git diff --check`; `npm_config_cache=/private/tmp/codex-npm-cache npm pack --dry-run --json` | 包内容 dry-run 应确认 README、CHANGELOG、dist、templates 都进入 package | supermodule-support |

## 已淘汰记录

> 审计区，只保存短摘要；默认不进入 ANALYSIS 读取上下文。

| 淘汰日期 | 原内容摘要 | 淘汰原因 | 替代内容 / 来源 |
|---|---|---|---|
| 暂无 | 暂无 | 暂无 | 暂无 |
