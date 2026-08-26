# 编码规范

> 本文件由 Easy Coding 初始化生成。若项目约定变化，以用户最新确认和现有代码为准更新。

## 项目语言检测

- 主要语言：TypeScript
- 运行环境：Node.js ESM，`engines.node >= 18`
- 构建工具：tsup
- 测试框架：Vitest
- 代码检查：Biome

## 通用编码原则

### 强制

- 命名必须表达业务或工程含义，禁止拼音、无意义缩写和 `temp` / `data` 等泛名滥用。
- 函数保持清晰职责，但不为形式上的单一职责过度拆分；只有存在明确语义边界、真实复用、
  独立可测试性或能显著降低复杂度时才提取 helper。
- 修改既有代码时遵循最小修改原则：不顺手调整无关注释、格式、导入、命名或结构；格式化工具
  产生的范围外 diff 必须撤回，发现的旁支问题只报告、不擅自修复。
- 新代码优先贴合最近邻同类实现的控制流、校验习惯、分层、对象建模和方法粒度；除正确性、
  安全性或明确规则外，不以通用最佳实践覆盖已证实的本地风格。
- 禁止在 CLI 命令中引入项目业务分析逻辑；CLI 只负责确定性的文件部署、升级、状态读取和清理。
- 禁止硬编码版本号；版本必须从 `package.json` 读取。
- 禁止吞掉异常；面向用户的 CLI 错误必须给出可执行的失败原因或下一步。
- 修改旧文件前必须识别并保持原文件编码；新建文件默认使用 UTF-8，除非同目录同类文件或用户要求另有约束。
- 涉及非直观兼容逻辑、manifest fallback、用户资产保护、跨平台路径差异、hook 状态注入或发布验证时，必须补充必要注释。
- 新增或修改注释时，默认使用简体中文；若项目既有同类代码强制英文注释，可沿用同类风格。
- 核心 Java 新类的每个方法和字段，以及既有核心 Java 类中新增或实质修改的方法和字段，必须
  使用有意义的多行 Javadoc。实现接口方法时，如果接口方法已有完整、准确且可访问的
  Javadoc，并且实现没有增加该接口方法文档未说明的契约、约束、副作用或其他实现特有行为，
  则无需重复编写；实现存在特殊行为或项目
  硬规则明确要求时仍须补充。普通单行说明使用 `//`，不得写成单行 `/** ... */`。
- 不同逻辑段之间使用一个空行分隔，既不堆叠空行，也不把无关步骤压成连续代码块。

### 推荐

- 优先保持现有目录边界：`commands` 处理命令入口，`configurators` 处理平台写入，`utils` 承载可复用文件与配置逻辑，`types` 放共享类型。
- 新增 CLI 行为应配套 Vitest 覆盖正常路径、兼容路径和失败路径。
- 对用户资产相关逻辑优先写保护性测试，避免 upgrade / clear 误覆盖或误删除。
- 涉及 npm 发布或 package 内容变化时，使用 dry-run 或 registry 查询验证真实产物。

## TypeScript 专属规范

### 命名规范

- 类型、接口、类：`UpperCamelCase`。
- 函数、变量、文件内 helper：`lowerCamelCase`。
- 常量：对复用值、稳定领域/配置/协议语义或项目惯例使用 `UPPER_SNAKE_CASE`；局部、直观、
  单次使用的字面量可以保留，禁止仅为 getter 的单个 return 值提取常量。
- 文件名沿用现有 kebab-case 风格，例如 `install-manifest.ts`、`compare-versions.ts`。

### 模块与导出

- 禁止默认导出，统一使用 named exports。
- 优先使用项目已有 helper：文件写入、模板路径、marked region、gitignore、manifest、session 等逻辑不得重复实现。
- 新增类型优先放入 `src/types/` 或靠近唯一使用点；跨模块契约再提升为共享类型。

### 错误处理

- CLI 用户可见错误应保留上下文：目标平台、目标路径、操作类型和失败原因。
- 兼容旧 manifest、旧运行时目录或缺失字段时，必须明确 fallback 规则，不能静默产生破坏性结果。

### 测试与验证

- 常规代码变更优先执行：`npm run typecheck`、`npm run lint`、`npm test`。
- 构建或模板输出变化必须执行：`npm run build`。
- 发布前必须核对 package 内容和 dist-tags；npm 相关命令如遇缓存权限问题，使用 `npm_config_cache=/private/tmp/codex-npm-cache`。

## 文档与版本规范

- `CHANGELOG.md` 是版本历史唯一事实源；版本变更后必须在顶部新增条目。
- `README.md` 只摘要版本策略并链接 `CHANGELOG.md`，不要重新塞入完整 release notes。
- `package.json` 的 `files` 必须包含 `CHANGELOG.md`、`dist/`、`templates/`。
- README 的 skill 表和平台表必须随新增或移除 skills / 平台同步维护。

## Git 与交付规范

- `.easy-coding/spec/dev/` 是当前需求候选输入，默认不纳入提交范围，除非用户明确要求。
- 提交或推送前必须先核对 `git status` 和相关 diff，避免混入无关文件。
- 发布完成不能只看命令成功，必须再验证 npm registry dist-tags / version 和远端 git ref。
