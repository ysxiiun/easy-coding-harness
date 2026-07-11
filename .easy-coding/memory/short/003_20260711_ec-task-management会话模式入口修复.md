---
memory_schema: 2
id: SM-20260711-003
source_task: 07-11-ec-task-management-session-mode-panel
date: 2026-07-11
task_type: bugfix
project_mode: iteration
domain:
  - "Easy Coding Harness 任务与 session 面板"
tags:
  - "ec-task-management"
  - "confirm-mode"
  - "session-override"
  - "0.7.1-beta0"
related_files:
  - "src/templates/common/skills/ec-task-management/SKILL.md"
  - "src/templates/shared-hooks/easy_coding_state.py"
  - "src/templates/main-constraint/AGENTS.md.tpl"
  - "src/templates/main-constraint/CLAUDE.md.tpl"
  - "test/configurators/claude.test.ts"
  - "test/configurators/codex-qoder.test.ts"
commit: included-in-release-commit
verification: passed
memory_value: technical
target_long: TECHNICAL
---

# ec-task-management 会话确认模式入口修复

## Task Summary

- Goal: 修复裸唤起 `ec-task-management` 时只显示任务列表、没有展示或引导修改当前 session 确认模式的问题。
- Scope: task-management skill 协议、Ready 帮助、Claude/Codex/Qoder 主约束、安装测试、使用文档与 `0.7.1-beta0` 版本元数据。
- Result: completed；默认面板现在始终读取任务列表和 session snapshot，空任务场景也展示项目模式、session 覆盖和最终生效模式，并提供对话修改入口。
- Key Constraints: 裸唤起保持只读；复用现有 `snapshot`、`set-confirm-mode`、`clear-confirm-mode`；不修改确认模式的状态流转语义；不处理此前已撤回的状态栏渲染需求。

## Execution Evidence

| Type | Content |
|---|---|
| Key Files | `ec-task-management/SKILL.md`、`easy_coding_state.py`、两套主约束模板、Claude/Codex/Qoder 安装测试、README、usage/design、版本文件 |
| Verification Commands | `npm run typecheck`、`npm run lint`、`npm test`（24 files / 188 tests passed）、`npm run build`、`git diff --check`、`npm pack --dry-run --json` |
| Manual Acceptance | reviewer 未发现功能性问题；任务与 session 面板说明、版本元数据、文档及安装测试保持一致 |
| Commit Info | included in the release commit for `0.7.1-beta0` |

## Business Memory Candidates

- Concepts / Field Semantics: none
- Workflows / State Transitions: none
- Business Rules / Compatibility: none
- Upstream/Downstream Contracts: none
- Business Troubleshooting: none

## Technical Memory Candidates

- Architecture / Interface Decisions: `ec-task-management` 是任务与 session 的组合面板；裸唤起必须同时执行 `list-tasks` 与 `snapshot`，而不是把 confirm mode 隐藏在用户预先明确询问之后。
- Engineering Rules / Workflows: 面板无任务时仍展示 `project_confirm_mode`、`session_confirm_mode`、`effective_confirm_mode`；只有用户明确要求后才调用 `set-confirm-mode` 或 `clear-confirm-mode`。
- Implementation Patterns / Reusable Approaches: 共享 skill 模板修改后，通过 Claude、Codex、Qoder 三个平台安装产物断言防止占位符或协议漂移；Ready 状态和主约束同步暴露能力入口。
- Pitfalls / Fix Strategies: 版本相关测试不能把后缀直接追加到可能已含 prerelease 的 `VERSION`，否则会生成 `0.7.1-beta0-beta.1`；同核心旧预发布夹具应从 core version 构造合法的 `${core}-0`。
- Verification Experience: beta 发布前先查询 npm versions/dist-tags，确认目标版本未占用；本机 npm 操作继续使用 `/private/tmp/codex-npm-cache` 避免默认缓存权限问题。

## Non-Distillation Content

- 一次性的 npm 包大小、临时 snapshot commit id、测试耗时和 registry 查询时间不进入长期记忆。

## Related Memories

- Predecessor: `SM-20260711-002`（0.6.1 状态与分析流程升级）。
- Successor: none
