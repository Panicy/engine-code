# Validator 与 Run Loop 设计

本文档定义 AI 开发引擎中 Validator 和 Run Loop 两个核心模块。二者共同负责把 JSON 契约从“可读文档”推进为“可执行流程”。

## 模块定位

### Validator

Validator 负责判断当前 JSON 世界是否可信。

它只做校验，不执行任务，不生成代码，不自动修复状态。

核心职责：

- 校验 JSON 文件是否符合 schema。
- 校验跨文件引用是否有效。
- 校验 PRD、任务拆分和任务状态是否满足执行前提。
- 输出中文、结构化、可定位的错误报告。

### Run Loop

Run Loop 负责推进任务状态。

它读取已确认的 PRD 和 task-plan，找到可执行任务，调用 agent 执行，运行 checks，执行 review，并写入运行产物。

核心职责：

- 根据依赖关系推进 `pending -> ready`。
- 执行 `ready`、`checks_failed`、`review_failed` 任务。
- 不因单个 task 失败阻塞整轮循环。
- 写入 `task-run.json`、`review.json`、`loop-summary.json`。
- 汇总异常状态，交给下一轮或人工处理。

## 总体关系

```text
Validator
  -> 校验输入是否可信
Run Loop
  -> 编排 Skill Context、Agent Adapter、Checks Runner、Review Runner
Validator
  -> 校验执行后状态是否一致
```

可以理解为：

- Validator 是守门员。
- Run Loop 是编排器和状态推进器。

## Validator 设计

### 输入

Validator 的输入来自项目当前 JSON 文件：

```text
.engine/workspace.json
.engine/projects/<projectId>/project.json
.engine/projects/<projectId>/features/<featureId>/prd.json
.engine/projects/<projectId>/features/<featureId>/task-plan.json
.engine/projects/<projectId>/features/<featureId>/run-state.json
.engine/templates/<templateId>/template.json
.engine/templates/<templateId>/skills.json
schemas/*.schema.json
```

按需读取：

```text
contracts/backend-api.json
contracts/permission-manifest.json
database-changes.json
runs/<taskId>/task-run.json
runs/<taskId>/review.json
loop-summary.json
```

### 输出

Validator 输出结构化报告：

```json
{
  "valid": false,
  "errors": [
    {
      "level": "error",
      "code": "TASK_BASE_NOT_FOUND",
      "file": "task-plan.json",
      "path": "storyGroups[0].tasks[1].targetBaseId",
      "message": "targetBaseId=admin 不存在。",
      "suggestion": "请改为当前 project.bases 中存在的 baseId。"
    }
  ],
  "warnings": [
    {
      "level": "warning",
      "code": "TASK_CAN_BECOME_READY",
      "file": "task-plan.json",
      "path": "storyGroups[1].tasks[0].status",
      "message": "该任务依赖已完成，Run Loop 可将其转为 ready。"
    }
  ],
  "infos": []
}
```

### 严重级别

| 级别 | 含义 | 是否阻止 Run Loop |
| --- | --- | --- |
| `error` | 当前 JSON 不可信，继续执行可能破坏状态 | 是 |
| `warning` | 当前状态可运行，但存在需要关注的问题 | 否 |
| `info` | 普通提示 | 否 |

### Schema 校验

Schema 校验负责检查单个 JSON 文件的结构。

覆盖文件：

- `workspace.json`
- `template.json`
- `project.json`
- `prd.json`
- `task-plan.json`
- `skills.json`
- `run-state.json`
- `task-run.json`
- `review.json`
- `loop-summary.json`
- `backend-api.json`
- `permission-manifest.json`
- `database-changes.json`

典型错误：

- JSON 格式错误。
- 必填字段缺失。
- 字段类型错误。
- enum 值非法。
- 不允许的额外字段。

### 引用校验

引用校验负责检查 JSON 文件之间是否能串起来。

必须校验：

- `workspace.templates[].templateId` 不重复。
- `workspace.projects[].projectId` 不重复。
- `project.bases[].baseId` 不重复。
- `project.bases[].templateId` 必须存在于 `workspace.templates[]`。
- `task.targetBaseId` 必须存在于 `project.bases[].baseId`。
- `task.requiredSkillId` 必须存在于目标 base 对应模板的 `skills.json`。
- `task.dependsOn[]` 必须引用真实 task。
- `task.storyId` 必须引用 PRD 中真实用户故事。
- `storyGroups[].storyId` 必须引用 PRD 中真实用户故事。
- `checks[].id` 在同一 task 内不能重复。
- `acceptanceChecks[].id` 在同一 story 内不能重复。

后续增强：

- `backend-api.json` endpoint 是否被中台或客户端任务正确引用。
- `permission-manifest.json` 权限标识是否与后端菜单、Controller 注解一致。
- `database-changes.json` 是否与后端 SQL 文件一致。

### 人工确认校验

PRD 和任务拆分是强人工确认点。

必须校验：

- `prd.humanApproval.approved = true` 后才能生成或执行 task-plan。
- `task-plan.humanApproval.approved = true` 后才能进入 Run Loop。
- 未确认的 task-plan 中，任务状态只能是 `draft`、`pending` 或 `cancelled`。
- 已确认后，Run Loop 可以初始化任务状态。

### 状态校验

任务状态必须符合固定状态机。

合法状态：

```text
draft
pending
ready
running
checks_failed
review_failed
needs_human
done
cancelled
```

必须校验：

- `ready` 任务的依赖必须全部 `done`。
- `run-state.taskStates` 必须覆盖 task-plan 中的所有 task。
- `pending` 任务如果依赖全部 `done`，输出 warning，提示 Run Loop 可推进。
- `done` 任务必须存在通过的 review。
- `needs_human` 任务不能被自动执行。
- `cancelled` 任务不能继续作为未完成依赖被静默忽略。
- `running` 任务如果没有活跃执行记录，应输出 warning，提示可能是 stale running。
- `checks_failed` 和 `review_failed` 必须有 `lastIssue` 或最近一次失败记录。
- `checks_failed` 和 `review_failed` 如果尝试次数已经达到 `maxAttempts`，Run Loop 应转为 `needs_human`。

### Validator 原则

- 只校验，不修复。
- 错误信息必须中文可读。
- 错误必须能定位到文件和字段路径。
- `error` 阻止 Run Loop。
- `warning` 和 `info` 不阻止 Run Loop。
- 每轮 Run Loop 前后都应该执行 Validator。

## Run Loop 设计

### 输入

Run Loop 的输入是已经通过 Validator 的 JSON 文件：

```text
workspace.json
project.json
prd.json
task-plan.json
run-state.json
template.json
skills.json
```

执行 task 时按需读取：

```text
contracts/backend-api.json
contracts/permission-manifest.json
database-changes.json
runs/<taskId>/task-run.json
runs/<taskId>/review.json
```

### 输出

Run Loop 会写入：

```text
run-state.json
runs/<taskId>/task-context.json
runs/<taskId>/task-run.json
runs/<taskId>/review.json
loop-summary.json
```

注意：`task-plan.json` 是人工确认后的静态计划，Run Loop 不直接写入 task-plan。任务状态、尝试次数、最近异常和运行锁统一写入 `run-state.json`。

### 可运行状态

Run Loop 只执行以下状态：

```text
ready
checks_failed
review_failed
```

其他状态不自动执行：

```text
draft
pending
running
needs_human
done
cancelled
```

### 整轮停止条件

以下情况会停止整轮 Run Loop：

- Validator 存在 `error`。
- PRD 未人工确认。
- task-plan 未人工确认。
- `workspace.json`、`project.json`、`template.json` 或 `skills.json` 缺失。
- schema 版本不兼容。
- 目标项目或模板无法解析。

以下情况不会停止整轮：

- 单个 task 执行失败。
- 单个 task checks 失败。
- 单个 task review 失败。
- 单个 task 进入 `needs_human`。
- 某些 task 仍然是 `pending`。

### 状态转换

```text
draft
  -> pending
  -> ready

pending
  -> ready

ready
  -> running

running
  -> checks_failed
  -> review_failed
  -> needs_human
  -> done

checks_failed
  -> running
  -> needs_human

review_failed
  -> running
  -> needs_human

needs_human
  -> ready
  -> cancelled

cancelled
  -> cancelled

done
  -> done
```

说明：

- `pending -> ready` 由 Run Loop 根据依赖自动推进。
- `checks_failed -> running` 表示下一轮自动修复。
- `review_failed -> running` 表示下一轮按 review 反馈修复。
- `checks_failed/review_failed -> needs_human` 表示自动尝试次数已达到 `maxAttempts`，或失败原因需要人工判断。
- `needs_human` 必须由人工处理后才能恢复为 `ready` 或改为 `cancelled`。

### 单轮流程

```text
1. 加载 workspace、project、prd、task-plan、run-state。
2. 执行 Validator。
3. 如果存在 error，停止本轮。
4. 检查 PRD 和 task-plan 是否已人工确认。
5. 获取 feature 级运行锁，失败则停止本轮。
6. 将依赖全部 done 的 pending 任务在 run-state 中标记为 ready。
7. 找出 ready、checks_failed、review_failed 任务。
8. 按 task-plan 顺序执行任务。
9. 每个 task 执行前通过 Skill Context Builder 解析 base、template、skill。
10. 写入 `runs/<taskId>/task-context.json`。
11. 调用 Agent Adapter 执行任务。
12. Agent Adapter 返回 outcome，包括 summary、errors 等。
13. Checks Runner 运行 task checks。
14. checks 失败，标记 checks_failed；如达到 maxAttempts，标记 needs_human。
15. checks 通过，进入 Review Runner。
16. review fail，标记 review_failed；如达到 maxAttempts，标记 needs_human。
17. review needs_human，标记 needs_human。
18. review pass，标记 done。
19. 原子写入 task-run.json、review.json、run-state.json。
20. 本轮结束写入 loop-summary.json。
21. 释放运行锁。
22. 再执行一次 Validator，确认执行后状态一致。
```

### 单个 Task 执行上下文

Run Loop 调用 Agent Adapter 前，需要构造稳定上下文。当前实现已将该职责独立为 Skill Context Builder。

当前上下文产物写入：

```text
runs/<taskId>/task-context.json
```

建议字段：

```json
{
  "project": {},
  "feature": {},
  "story": {},
  "task": {},
  "base": {},
  "template": {},
  "skill": {},
  "skillDocument": "",
  "allowedPaths": [],
  "contracts": {
    "backendApi": null,
    "permissionManifest": null,
    "databaseChanges": null
  },
  "lastRun": null,
  "lastReview": null,
  "checks": []
}
```

上下文必须包含：

- 当前用户故事。
- 当前 task。
- 目标子项目。
- 目标模板。
- 必须使用的 skill。
- 允许修改路径。
- 上一次失败原因。
- 本次必须通过的 checks。

Skill Context Builder 不执行任务、不修改业务代码，只负责材料完整、路径明确、引用可追踪。

### Agent Adapter

Agent Adapter 是 Run Loop 和真实执行器之间的边界。

当前已支持：

- `mock`：用于状态机和异常回归。
- `shell`：真实执行一条 shell 命令，用于验证真实执行器插槽。

后续需要接入：

- `codex`：读取 task-context，调用真实 Codex 执行开发任务，并输出 summary、errors。真实 changedFiles 应由 git diff 自动采集。

Adapter 只返回执行 outcome，不直接修改 run-state，不直接写 task-run/review，不绕过 checks 和 review。

### Checks Runner

Checks Runner 由 Run Loop 调用，但建议作为独立模块。

当前支持：

- `real`：默认模式，真实执行 command 和 HTTP 检查。
- `command`：`real` 的兼容别名。
- `mock`：开发回归模式，生成通过结果或定点失败。
- `manual`：只生成待人工验证项，不自动执行。

后端重点检查：

- 编译是否通过。
- 新增接口是否返回 401。
- 不存在接口是否返回 404。
- 关闭鉴权后业务接口是否可访问。
- 菜单和权限初始化 SQL 是否存在。
- 权限标识和 Controller 注解是否一致。

关闭鉴权测试必须满足：

- 只允许在 dev/test 环境执行。
- 必须先记录原始配置。
- 必须配置 teardown 恢复鉴权。
- teardown 恢复失败时，当前 task 直接标记 `needs_human`。
- 不允许在 production 环境执行 `auth_disabled` 检查。

当前缺口：

- token 注入尚未实现。
- 响应体断言尚未实现。
- auth_disabled 的环境白名单和恢复校验还需要增强。

### Reviewer

Reviewer 由 Run Loop 调用，当前已独立为 Review Runner。

输入：

- task 描述。
- task-run 记录。
- changed files。
- checks 结果。
- skill quality gates。
- story acceptance criteria。

输出：

```text
pass
fail
needs_human
```

Reviewer 必须检查：

- `changedFiles` 是否全部匹配 task 的 `allowedPaths`。
- 修改是否满足 skill quality gates。
- checks 结果是否真实覆盖 acceptance criteria。
- 是否引入了 task-plan 未声明的新范围。

当前已实现：

- 检查 changedFiles 是否全部匹配 task.allowedPaths。
- 检查必需 checks 是否都有结果且为 passed。
- 写入标准 review.json。
- review 失败时让 task 进入 review_failed，下一轮可重跑。

当前缺口：

- 不接受 adapter 自报 changedFiles 作为审查依据，尚未从 git diff 自动采集。
- 未读取真实文件内容。
- 未检查 skill qualityGates。
- 未做后端/中台/客户端专项规则。
- 未做模型语义审查。

越界修改处理规则：

- 普通越界修改返回 `review_failed`。
- 涉及配置、鉴权、数据删除、依赖升级、部署脚本等高风险文件时返回 `needs_human`。

Reviewer 发现以下情况应返回 `needs_human`：

- 需求边界不清。
- task-plan 中没有覆盖新发现的任务。
- 数据库结构存在业务含义冲突。
- 需要新增外部依赖。
- 当前 skill 不足以指导实现。
- 需要用户确认安全、权限、计费、数据删除等高风险决策。

### Loop Summary

每轮必须生成 `loop-summary.json`。

它是 CLI、UI 和人工复盘最重要的入口。

建议包含：

```json
{
  "schemaVersion": "0.1.0",
  "runId": "RUN-001",
  "featureId": "FEAT-user-profile",
  "startedAt": "2026-05-18T10:00:00+08:00",
  "finishedAt": "2026-05-18T10:30:00+08:00",
  "executedTaskIds": ["TASK-BE-001", "TASK-CLIENT-001"],
  "doneTaskIds": ["TASK-CLIENT-001"],
  "failedTaskIds": ["TASK-BE-001"],
  "needsHumanTaskIds": [],
  "pendingTaskIds": ["TASK-MID-001"],
  "abnormalTasks": [
    {
      "taskId": "TASK-BE-001",
      "status": "checks_failed",
      "source": "check",
      "summary": "GET /system/user-profile 返回 404。",
      "attempts": 1,
      "maxAttempts": 3,
      "retryExhausted": false,
      "requiredDecision": "",
      "nextAction": "下一轮自动重跑该任务。",
      "artifactPath": "runs/TASK-BE-001/task-run.json"
    }
  ],
  "nextRunnableTaskIds": ["TASK-BE-001"],
  "summary": "本轮完成 1 个任务，1 个任务 checks_failed，1 个任务等待依赖。"
}
```

`abnormalTasks[]` 是重新跑异常任务的主要入口。CLI 和 UI 应优先展示该字段，而不是让用户自己去翻 `task-run.json`。

### 运行锁与 stale running

Run Loop 启动时必须获取 feature 级运行锁，运行锁写在 `run-state.activeRunLock`。

运行锁至少包含：

- `lockId`
- `owner`
- `acquiredAt`
- `heartbeatAt`
- `expiresAt`

规则：

- 同一 feature 同一时间只能有一个 active run。
- Run Loop 执行期间必须更新 heartbeat。
- 如果 `running` 任务没有有效 heartbeat，Validator 输出 stale running warning。
- stale running 可由人工或恢复流程转回 `checks_failed` 或 `needs_human`。

### 写入原子性

Run Loop 会写多个运行产物，必须避免半写入。

建议策略：

- 每个 JSON 先写入同目录临时文件。
- 临时文件校验通过后再 rename 覆盖正式文件。
- 写入顺序优先保证 task-run/review 证据先落盘，再更新 run-state。
- loop-summary 最后写入。
- 任一写入失败时，不继续更新后续状态，并在下一轮 Validator 中报告不一致。

### 调度策略

MVP 采用串行调度：

```text
按 task-plan 中的顺序执行可运行任务。
```

暂不做并发。

原因：

- 跨端任务存在接口、权限、数据库依赖。
- 同时修改契约容易产生冲突。
- 串行更容易复盘和恢复。

后续可扩展：

- 同一 base 串行，不同 base 并行。
- 按用户故事优先闭环。
- 按 DAG 执行。
- 按失败次数和风险排序。

## MVP 范围

### Validator MVP

必须实现：

- JSON schema 校验。
- project/template/skill 引用校验。
- task `dependsOn` 校验。
- PRD 和 task-plan 人工确认校验。
- run-state 中 task 状态合法性校验。
- 运行锁和 stale running warning。
- 中文错误报告。

暂不实现：

- 深度 SQL 语义分析。
- 全量接口自动发现。
- 前端页面级视觉检查。
- 多项目跨仓库一致性扫描。

### Run Loop MVP

必须实现：

- 串行执行。
- 自动推进 `pending -> ready`。
- 执行 `ready`、`checks_failed`、`review_failed`。
- 单 task 失败不阻塞整轮。
- 达到 `maxAttempts` 后转 `needs_human`。
- 使用 feature 级运行锁。
- 写入 `task-run.json`。
- 写入 `review.json`。
- 写入 `loop-summary.json`。
- 每轮前后调用 Validator。

暂不实现：

- 并发调度。
- Web UI。
- 自动部署。
- 自动创建 PR。
- 分布式任务队列。
- 多机执行。

## 推荐实现顺序

1. 实现 JSON 文件加载器。
2. 实现 schema validator。
3. 实现引用 validator。
4. 实现状态 validator。
5. 实现 loop-summary 写入器。
6. 实现 pending 任务推进。
7. 实现串行 task 选择器。
8. 实现 agent adapter 接口。
9. 实现 checks runner。
10. 实现 reviewer adapter。
11. 打通第一轮完整 Run Loop。

## 设计边界

Validator 不应该：

- 自动修改 JSON。
- 自动补全 task。
- 自动切换状态。
- 调用 agent。
- 运行测试。

Run Loop 不应该：

- 绕过 Validator。
- 自动修改 PRD 业务边界。
- 自动修改已确认 task-plan 的任务范围。
- 自动执行 `needs_human` 任务。
- 因单个 task 失败阻塞其他可运行任务。

Skill 不应该：

- 承担调度状态机。
- 承担执行契约。
- 决定是否阻塞。
- 替代 Validator 或 Run Loop。

Skill 应该：

- 提供实现该类任务所需的技术知识。
- 提供本地代码惯例。
- 提供自查清单。
- 提醒何时停止猜测并标记 `needs_human`。
