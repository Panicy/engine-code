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
| Project 初始化模块 | in_progress | `tools/project-init/` | 已支持 project.json 生成和 feature 目录骨架初始化，待增强 workspace 注册和模板版本管理 |
| PRD 生成与确认模块 | in_progress | `tools/prd-builder/` | 已支持规则化生成 PRD 草稿、项目校验、多故事输入和人工确认工具 |
| Task Plan 生成与确认模块 | in_progress | `tools/task-planner/` | 已支持规则化生成 task-plan 草稿和人工确认工具 |
| Run Loop 执行器 | in_progress | `tools/run-loop/run-feature.mjs` | 已模块化调度 Skill Context、Agent Adapter、Checks Runner、Review Runner，并写入运行产物 |
| Skill Context | done | `tools/skill-context/` | 已能为单个 task 装配 project/base/template/PRD/task/skill 上下文 |
| Agent Adapter | in_progress | `tools/agent-adapters/` | 已支持 `mock` 和 `shell`，待接入真实 Codex adapter |
| Checks Runner | in_progress | `tools/checks-runner/` | 默认真实执行 command/http checks，支持 mock 回归模式 |
| Review Runner | in_progress | `tools/review-runner/` | 已支持必需 checks 和基于可信 changedFiles 的 allowedPaths 审查，待增强语义审查 |
| 运行产物写入器 | in_progress | `tools/run-loop/run-feature.mjs` | 已原子写入 task-context/task-run/review/run-state/loop-summary，待抽成独立模块 |
| 异常恢复工具 | in_progress | `tools/recovery/` | 已支持异常任务查看、task 详情查看、retry/cancel 恢复和人工决策记录 |
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

状态：`in_progress`

目标：让引擎能跑一轮串行自动循环。

任务：

- [x] 实现 feature 级运行锁。
- [x] 实现 pending -> ready 推进。
- [x] 选择 `ready`、`checks_failed`、`review_failed` 任务。
- [x] 按 task-plan 顺序串行执行。
- [x] 接入 mock Agent Adapter。
- [x] 接入 shell Agent Adapter。
- [x] 解析 base、template、skill 到完整 task execution context。
- [x] 执行后写入 task-run。
- [x] 接入 Checks Runner 并更新 run-state。
- [x] 接入 Review Runner 并更新 run-state。
- [x] 达到 maxAttempts 后转 needs_human。
- [x] 写入 loop-summary。
- [x] 每轮前后调用 Validator。
- [ ] 实现 stale running 恢复策略。
- [ ] 接入真实 Codex Agent Adapter。
- [x] 自动采集 git diff changedFiles。

完成标准：

- 一个 demo feature 能从 draft 初始化到 ready。
- 可以执行一轮任务并写出运行产物。
- 单个 task 失败不会阻塞其他可运行任务。
- loop-summary 能列出异常任务和下一轮可跑任务。

### M3：Checks Runner MVP

状态：`in_progress`

目标：让任务执行后有可靠检查结果。

任务：

- [x] 实现 command check。
- [x] 实现 http check。
- [x] 实现 manual check 输出。
- [x] 结构化记录 check command/status/summary。
- [x] 支持 expectedStatus。
- [x] 支持 setupCommands/teardownCommands。
- [ ] 支持 anonymous/authenticated/auth_disabled 的令牌和环境策略。
- [ ] auth_disabled 强制 dev/test 环境。
- [x] auth_disabled schema 层强制 teardown。
- [ ] teardown 失败时标记 needs_human。
- [ ] 支持响应 body 断言。

完成标准：

- 后端任务可以检查编译、401、404、关闭鉴权后的接口连通性。
- check 失败能进入 checks_failed。
- check 达到 maxAttempts 能进入 needs_human。

### M4：Reviewer MVP

状态：`in_progress`

目标：让 checks 通过后的任务进入质量审查。

任务：

- [x] 检查 git diff changedFiles 是否匹配 allowedPaths。
- [ ] 检查 expectedChangedFiles 是否合理。
- [x] 生成 task acceptanceCriteria 级 review 结果。
- [ ] 检查 skill qualityGates。
- [x] 基于 git diff 识别越界改动。
- [ ] 识别高风险改动并返回 needs_human。
- [x] 写入 review.json。
- [x] 自动读取 git diff，避免依赖 adapter 自报 changedFiles。
- [ ] 增加后端/中台/客户端专项 review 规则。

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
- [x] 支持 project.json 校验 base 并推导 techStack。
- [x] 支持多用户故事输入。
- [x] 默认禁止覆盖已有 PRD，使用 `--force` 显式覆盖。
- [x] 支持人工确认辅助命令。
- [x] 扩展 businessRules、dataEntities、permissions、openQuestions、assumptions。
- [ ] 支持从 Markdown 需求草稿生成。

完成标准：

- 能生成符合 `schemas/prd.schema.json` 的 PRD 草稿。
- 生成后可进入人工审查。
- 未人工确认时 Validator 会阻止进入 Run Loop。

### M7：Task Planner MVP

状态：`in_progress`

目标：从已确认 PRD 生成可审查的 `task-plan.json` 草稿。

任务：

- [x] 实现 task-plan 草稿生成器。
- [x] 默认要求 PRD 已人工确认。
- [x] 支持开发验证时 `--allow-draft-prd`。
- [x] 按用户故事生成 storyGroups。
- [x] 按 impactedBaseIds 生成多端任务。
- [x] 根据 templateId 绑定默认 skill。
- [x] 固定 backend -> middle -> client 排序，避免输入顺序影响依赖。
- [x] 自动生成 schema -> backend -> middle/client 依赖。
- [x] 从模板 defaultChecks 生成 task checks。
- [x] 默认禁止覆盖已有 task-plan，使用 `--force` 显式覆盖。
- [x] 支持人工确认辅助命令。
- [x] 根据 dataEntities 生成后端 schema/database task。
- [x] 生成初始 run-state.json。
- [x] 确认 task-plan 前可接入 Validator。
- [ ] 根据 permissions 生成 permission-manifest 相关任务。
- [ ] 根据 businessRules 生成更精细 checks。
- [ ] 支持 LLM 辅助拆分。

完成标准：

- 能生成符合 `schemas/task-plan.schema.json` 的 task-plan 草稿。
- 生成的 task-plan 能通过 Validator 的引用校验。
- 未人工确认时 Validator 会阻止进入 Run Loop。

## 当前优先级

近期建议按以下顺序推进：

1. Codex Agent Adapter，把 task-context 交给真实开发执行器。
2. Checks Runner 鉴权增强，覆盖 token、401/403、404、auth_disabled 安全策略。
3. Review Runner 语义增强，覆盖 skill qualityGates、权限/菜单/SQL/API 契约一致性。
4. 真实需求 E2E 套件，将临时真实需求测试沉淀为可重复脚本。
5. Project Init 增强，补 workspace 注册、模板版本管理和可选 clone 策略。
6. Recovery 增强，补批量恢复、stale running 处理和 cancelled reopen 策略。

## 当前整体架构

当前引擎已经从早期的 Run Loop 内部 mock，演进为模块化编排架构：

```text
JSON Contracts
  -> PRD Builder
  -> Task Planner
  -> Validator
  -> Run Loop Orchestrator
      -> Skill Context Builder
      -> Agent Adapter
      -> Checks Runner
      -> Review Runner
      -> Artifact/State Writer
  -> Loop Summary / Recovery
```

这个方向符合最初目标：PRD 和 task-plan 人工确认，Run Loop 不阻塞，异常只标状态，固定代码基座通过 template/skill 隔离，引擎通过 JSON 契约驱动多项目执行。

## 当前架构缺陷

1. **Project/Workspace 管理仍然缺位**

   多项目 schema 已有，但缺初始化、注册、路径校验、模板版本校验和 git 状态检查工具。真实项目接入时容易靠人工拼 JSON，出错成本高。

2. **异常恢复能力仍偏弱**

   Run Loop 已能把 `checks_failed`、`review_failed`、`needs_human` 标出来，但缺少面向操作者的恢复命令、异常列表、attempts 查看和人工恢复记录。

3. **Agent Adapter 还没有真正的 Codex 执行器**

   `shell` adapter 证明了执行器插槽可用，但它不是面向开发任务的真实 agent。后续需要 `codex` adapter 读取 task-context，执行受控开发，并输出 summary/errors；changedFiles 继续由 Run Loop 的 git diff collector 统一采集。

4. **Checks Runner 的鉴权能力还不完整**

   HTTP 已能真实请求和校验状态码，但 token 注入、401/403 专项断言、404 专项断言、响应体断言、auth_disabled 环境白名单仍未完善。

5. **Review Runner 还偏确定性规则**

   当前能拦 allowedPaths 和 checks 证据，但还不能判断业务实现是否满足 PRD，也没有结合 skill qualityGates 做 RuoYi/Vben/UniApp 专项审查。

6. **运行产物写入仍在 Run Loop 内部**

   原子写入已经实现，但 task-context/task-run/review/run-state/summary 的写入逻辑仍耦合在 Run Loop。后续可抽成 Artifact Writer，降低 Run Loop 复杂度。

7. **异常恢复还没有独立入口**

   summary 已能列异常，但缺命令式恢复工具：查看 attempts、重置 checks_failed/review_failed、人工恢复 needs_human、继续下一轮。

8. **PRD/Task Planner 仍是规则 MVP**

   生成器能跑通，但复杂需求下还缺 openQuestions 关闭、权限/数据对象驱动的细粒度任务、手工编辑后的补全和 LLM 辅助拆分。

## 暂缓事项

以下能力先不做，避免过早复杂化：

- 并发调度。
- Web UI。
- 自动 PR。
- 自动部署。
- 多机执行。
- 分布式队列。
- 插件市场。
