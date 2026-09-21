# 测试策略

## 验证入口

- `npm run lint`：Biome 检查 TypeScript 源文件。
- `npm run typecheck`：TypeScript 严格类型检查。
- `npm test`：Vitest 执行 CLI、安装器、配置迁移和 Python runtime 集成用例。
- `npm run build`：tsup 构建 CLI，并复制 `src/templates/` 到发布模板目录。

## 变更与测试范围

CLI 配置、部署、升级和清理变更使用临时项目测试，核对用户文件和配置是否保留。
状态机与 Canonical Spec 变更使用临时 Git 仓库和 READY fixture，执行真实 Python API，
验证设计摘要、任务选择、跨 Agent 接手、幂等恢复和阶段门禁。

UT/TDD 共用 readiness 覆盖 CLI、工具和 hooks 的一致行为；构建版本变化不触发重新初始化，
必要入口损坏须报告修复。真实测试失败、覆盖率报告缺失、阈值不足和证据指纹变化仍阻断
验收。三种策略覆盖 session > 本地 > 项目继承与任务冻结；旧字段迁移保留进度，UT 无 TDD 过程审查。测试不依赖远程 CI，不以旧初始化摘要代替当前测试结果。

模板变更同时检查安装后三平台的占位符解析与调用路径。QUALITY 的独立审查和确定性
验证针对同一候选；发现范围内缺陷后修复并重新冻结候选。

协作回归覆盖 default/dispatch、审批与派发一次确认、QUALITY 原地修复及 A→B→A 接力。
本地配置使用临时 HOME，验证按需创建、逐字段覆盖和删除继承；日志/计划单操作复用、批量检查、
按 session 的 Spec 消费凭据及无关 Unit 证据复用均使用实际运行时 API 验证。
