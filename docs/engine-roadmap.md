# AI 开发引擎建设清单

本文档记录当前引擎的总体任务规划和完成情况。状态只描述引擎自身建设进度，不代表业务项目执行状态。

## 状态说明

| 状态 | 含义 |
| --- | --- |
| `done` | 已完成第一版，可继续迭代 |
| `in_progress` | 已开始，但仍有明显缺口 |
| `todo` | 尚未开始 |
| `later` | 暂不进入 MVP |

## 总览

| 模块 | 状态 | 当前产物 | 说明 |
| --- | --- | --- | --- |
| 引擎总体分层 | done | `docs/json-contracts.md` | 已确定 Engine / Template / Project / Feature 四层模型 |
| JSON 契约模块 | done | `.engine/json/`, `schemas/` | 已有 schema 索引、示例和核心 JSON schema |
| 多项目模型 | done | `schemas/workspace.schema.json`, `schemas/project.schema.json` | 已支持 workspace 管理多个 project，project 管理多个 base |
| 模板隔离 | done | `.engine/templates/` | 后端、中台、客户端模板已独立于引擎核心 |
| Skill 文档 | done | `.engine/templates/*/skills/` | 已创建三端基础 skill，强调实现知识而不是执行契约 |
| 后端数据库设计文档 | done | `.engine/templates/backend-starter/docs/` | 已补数据库基线、命名规范、新功能建表指导 |
| 后端接口连通性测试文档 | done | `.engine/templates/backend-starter/docs/api-connectivity-testing.md` | 已覆盖 401、404、关闭鉴权后验证等思路 |
| Validator 设计 | done | `docs/validator-and-run-loop.md` | 已定义 schema 校验、引用校验、状态校验、人工确认校验 |
| Run Loop 设计 | done | `docs/validator-and-run-loop.md` | 已定义运行锁、状态流转、异常不阻塞、原子写入和 summary |
| task-plan 静态化 | done | `schemas/task-plan.schema.json`, `schemas/run-state.schema.json` | task-plan 不再承载运行态，运行态迁入 run-state |
| 结构化 checks | done | `schemas/task-plan.schema.json` | 已支持 command/http/manual，HTTP check 可表达接口状态码和鉴权模式 |
| 异常任务复跑入口 | done | `schemas/loop-summary.schema.json` | 已增加 `abnormalTasks[]` |
| GitHub 初始化提交 | done | `https://github.com/Panicy/engine-code` | 已初始化并推送第一版 |
| JSON Schema 严格校验工具 | in_progress | `tools/validator/validate-feature.mjs` | 已有轻量 schema 子集校验；后续可替换为 Ajv |
| 跨文件引用校验器 | in_progress | `tools/validator/validate-feature.mjs` | 已校验 project/template/skill/task/story/check 等主要引用 |
| 状态一致性校验器 | in_progress | `tools/validator/validate-feature.mjs` | 已校验 run-state 与 task-plan 的 task 覆盖、依赖和状态合法性 |
| Project 初始化模块 | todo | - | 创建 workspace/project/feature 初始结构 |
| PRD 生成与确认模块 | in_progress | `tools/prd-builder/create-prd.mjs` | 已支持规则化生成 PRD 草稿，人工确认流程待补 |
| Task Plan 生成与确认模块 | todo | - | 根据 PRD 生成 task-plan，支持人工确认 |
| Run Loop 执行器 | todo | - | 实现串行循环、运行锁、任务选择、状态推进 |
| Agent Adapter | todo | - | 根据 task + skill 拼装 agent 输入并调用执行 |
| Checks Runner | todo | - | 执行 command/http/manual checks，并结构化输出结果 |
| Reviewer Adapter | todo | - | 检查 allowedPaths、quality gates、acceptance criteria |
| 运行产物写入器 | todo | - | 原子写入 task-run/review/run-state/loop-summary |
| 数据库变更执行辅助 | todo | - | 从 database-changes 到 SQL 检查、菜单权限 SQL 检查 |
| 跨端契约生成与消费 | todo | - | backend-api、permission-manifest 的生成、校验和消费 |
| 简版 CLI | later | - | 当前阶段暂不考虑 CLI，后续围绕 validator/run-loop 暴露命令 |
| Web UI | later | - | 暂不进入 MVP |
| 并发调度 | later | - | MVP 先串行，后续再做 DAG 和跨 base 并发 |
| 自动部署 | later | - | 暂不进入 MVP |

## MVP 阶段拆分

### M0：契约与知识基座

状态：`done`

目标：先把引擎使用的 JSON、模板、skill 和执行规则定义清楚。

已完成：

- [x] 定义四层模型：Engine / Template / Project / Feature。
- [x] 定义 JSON 契约文档。
- [x] 创建核心 schema。
- [x] 创建 `.engine/json` 模块。
- [x] 创建三端模板目录。
- [x] 创建后端、中台、客户端基础 skill。
- [x] 补充后端数据库和接口连通性测试文档。
- [x] 定义 Validator 与 Run Loop 设计。
- [x] 初始化 GitHub 仓库并推送。

### M1：Validator MVP

状态：`in_progress`

目标：让引擎能判断当前 JSON 世界是否可信。

任务：

- [x] 实现 JSON 文件加载器。
- [x] 实现 schema 子集校验。
- [x] 实现中文错误报告。
- [x] 校验 workspace/project/template/skill 引用。
- [x] 校验 PRD 与 task-plan 人工确认状态。
- [x] 校验 task-plan 中 task ID、storyId、dependsOn。
- [x] 校验 run-state.taskStates 覆盖所有 task。
- [x] 校验 ready/pending/done/needs_human 等状态一致性。
- [x] 校验 checks 类型和必填配置。
- [x] 输出 error/warning/info 分级报告。
- [ ] 增加标准 JSON Schema 引擎或补齐更多 JSON Schema 特性。
- [ ] 增加 validator fixtures 和自动化测试。

完成标准：

- 给定一个 feature 目录，能输出结构化 validator report。
- 有 error 时 Run Loop 不应启动。
- 能定位到具体文件和字段路径。

### M2：Run Loop MVP

状态：`todo`

目标：让引擎能跑一轮串行自动循环。

任务：

- [ ] 实现 feature 级运行锁。
- [ ] 实现 stale running 检测。
- [ ] 实现 pending -> ready 推进。
- [ ] 选择 `ready`、`checks_failed`、`review_failed` 任务。
- [ ] 按 task-plan 顺序串行执行。
- [ ] 解析 base、template、skill。
- [ ] 构造 task execution context。
- [ ] 接入 Agent Adapter 占位实现。
- [ ] 执行后写入 task-run。
- [ ] 根据 checks/review 更新 run-state。
- [ ] 达到 maxAttempts 后转 needs_human。
- [ ] 写入 loop-summary。
- [ ] 每轮前后调用 Validator。

完成标准：

- 一个 demo feature 能从 draft 初始化到 ready。
- 可以执行一轮任务并写出运行产物。
- 单个 task 失败不会阻塞其他可运行任务。
- loop-summary 能列出异常任务和下一轮可跑任务。

### M3：Checks Runner MVP

状态：`todo`

目标：让任务执行后有可靠检查结果。

任务：

- [ ] 实现 command check。
- [ ] 实现 http check。
- [ ] 实现 manual check 输出。
- [ ] 结构化记录 check stdout/stderr/status。
- [ ] 支持 expectedStatus。
- [ ] 支持 anonymous/authenticated/auth_disabled。
- [ ] auth_disabled 强制 dev/test 环境。
- [ ] auth_disabled 强制 teardown。
- [ ] teardown 失败时标记 needs_human。

完成标准：

- 后端任务可以检查编译、401、404、关闭鉴权后的接口连通性。
- check 失败能进入 checks_failed。
- check 达到 maxAttempts 能进入 needs_human。

### M4：Reviewer MVP

状态：`todo`

目标：让 checks 通过后的任务进入质量审查。

任务：

- [ ] 检查 changedFiles 是否匹配 allowedPaths。
- [ ] 检查 expectedChangedFiles 是否合理。
- [ ] 检查 task acceptanceCriteria。
- [ ] 检查 skill qualityGates。
- [ ] 识别越界改动。
- [ ] 识别高风险改动并返回 needs_human。
- [ ] 写入 review.json。

完成标准：

- review 能输出 pass/fail/needs_human。
- 越界改动不会静默通过。
- 高风险文件改动会进入 needs_human。

### M5：Project 与 Feature 初始化

状态：`todo`

目标：降低新业务项目接入成本。

任务：

- [ ] 创建 workspace.json。
- [ ] 创建 project.json。
- [ ] 注册 backend/middle/client base。
- [ ] 创建 feature 目录。
- [ ] 复制 PRD/task-plan/run-state 初始模板。
- [ ] 检查模板路径和项目路径。

完成标准：

- 能快速初始化一个多 base 项目。
- 初始化后的项目能通过 Validator。

### M6：PRD Builder MVP

状态：`in_progress`

目标：从用户输入生成可审查的 `prd.json` 草稿。

任务：

- [x] 实现 PRD 草稿生成器。
- [x] 默认输出 `draft` 状态。
- [x] 默认 `humanApproval.approved = false`。
- [x] 支持 feature 基础信息。
- [x] 支持 impactedBaseIds。
- [x] 生成基础 goals、nonGoals、userStories、constraints。
- [ ] 支持从 Markdown 需求草稿生成。
- [ ] 支持多用户故事输入。
- [ ] 支持人工确认辅助命令。

完成标准：

- 能生成符合 `schemas/prd.schema.json` 的 PRD 草稿。
- 生成后可进入人工审查。
- 未人工确认时 Validator 会阻止进入 Run Loop。

## 当前优先级

近期建议按以下顺序推进：

1. M6 PRD Builder MVP。
2. Task Planner MVP。
3. M2 Run Loop MVP。
4. M3 Checks Runner MVP。
5. M4 Reviewer MVP。
6. M5 Project 与 Feature 初始化。

## 暂缓事项

以下能力先不做，避免过早复杂化：

- 并发调度。
- Web UI。
- 自动 PR。
- 自动部署。
- 多机执行。
- 分布式队列。
- 插件市场。
