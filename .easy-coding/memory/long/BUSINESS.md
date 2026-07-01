---
memory_schema: 2
memory_file: BUSINESS
last_updated: 2026-06-30
---

# 业务记忆

> 保存“业务是什么、为什么这样、上下游如何协作”的长期事实。

## 核心概念与字段语义

| 概念 / 字段 | 含义 | 适用场景 | 来源 | 状态 |
|---|---|---|---|---|
| supermodule 父仓 | 存在 `.gitmodules` 的 git 父仓；Easy Coding 在其中管理跨仓任务和子仓拓扑 | 多仓库协同安装、清理、提交和记忆分层 | supermodule-support | active |
| submodule child | `.gitmodules` 中声明且已检出的一级子仓；可独立拥有完整 `.easy-coding` 运行时 | 单仓任务、父仓跨仓任务中的子仓改动 | supermodule-support | active |

## 业务流程与状态流转

| 流程 / 状态 | 触发条件 | 关键步骤 | 异常分支 | 来源 | 状态 |
|---|---|---|---|---|---|
| supermodule init | 父仓执行 `easy-coding init` | 父仓必装；已检出的一级子仓可通过 TUI 或 `--submodules` 选择安装；未检出子仓只提示跳过 | `--no-submodules` 只安装父仓；重入时可追加新子仓 | supermodule-support | active |
| supermodule clear | 父仓执行 `easy-coding clear` | 无参数 TUI 列出父仓和已初始化子仓；`--yes` 默认只清父仓；子仓需勾选或用 `--submodules` 指定 | `--no-submodules` 只清父仓；指定子仓只在已初始化子仓范围内解析 | supermodule-support | active |

## 业务规则与兼容背景

| 规则 | 适用场景 | 决策依据 | 影响范围 | 来源 | 状态 |
|---|---|---|---|---|---|
| CLI 只处理一级 submodule | supermodule 安装、追加 agent、升级、清理 | 当前需求明确先支持一级子仓，避免递归二级子仓带来不透明副作用 | `init`、`add-agent`、`upgrade`、`clear` | supermodule-support | active |
| 清理默认保守 | supermodule 父仓清理 | `clear` 属于删除类命令，无参数交互和 `--yes` 默认只选父仓，避免误删子仓 harness 数据 | `clear` | supermodule-support | active |

## 上下游契约

| 契约 | 生产方 | 消费方 | 字段 / 接口 | 注意事项 | 来源 |
|---|---|---|---|---|---|
| 暂无 | 暂无 | 暂无 | 暂无 | 暂无 | 暂无 |

## 业务排障经验

| 问题 | 常见误判 | 优先检查 | 修复 / 处理方式 | 来源 |
|---|---|---|---|---|
| 暂无 | 暂无 | 暂无 | 暂无 | 暂无 |

## 已淘汰记录

> 审计区，只保存短摘要；默认不进入 ANALYSIS 读取上下文。

| 淘汰日期 | 原内容摘要 | 淘汰原因 | 替代内容 / 来源 |
|---|---|---|---|
| 暂无 | 暂无 | 暂无 | 暂无 |
