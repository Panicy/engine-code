# AI 开发引擎 JSON 契约 v0.1

本文档定义 AI 开发引擎第一版正式 JSON 契约。这里的 JSON 不只是存储格式，而是引擎各环节之间的协议：谁生成、谁确认、谁消费、下游如何根据它做决策。

相关执行设计见：`docs/validator-and-run-loop.md`。
总体建设清单见：`docs/engine-roadmap.md`。

## 总体原则

- PRD 和任务拆分必须人工确认。
- 执行循环尽量自动完成，不在循环中等待人工阻塞。
- 遇到异常只标记状态，循环结束后统一输出异常清单。
- 任务按用户故事组织，但每个 task 只归属一个项目内子项目。
- 每个 task 只能绑定一个 primary skill；需要多个 skill 时优先拆任务。
- 新发现的范围变化、新任务、新依赖只允许标记为 `needs_human`，不能自动写入已批准计划并继续执行。
- 引擎核心不硬编码具体 starter 的目录、命令、检查规则；这些知识放在 template。

## 四层模型

为了避免具体基座污染引擎，契约分成四层：

| 层级 | 职责 |
| --- | --- |
| Engine | 通用流程、状态机、JSON 校验、调度循环、review gate、日志产物 |
| Template | 子项目模板，承载具体技术栈知识，如命令、路径、checks、skills |
| Project | 业务项目，实例化多个子项目并引用模板 |
| Feature | 某次功能开发，包含 PRD、任务计划、运行状态和审查结果 |

当前可注册三套默认模板：

| templateId | 类型 | 模板仓库 |
| --- | --- | --- |
| `backend-starter` | 后端 | `https://gitee.com/Panicy/backend-starter` |
| `middle-starter` | 中台 | `https://gitee.com/Panicy/middle-starter` |
| `uniapp-template` | 客户端 | `https://gitee.com/Panicy/uniapp-template` |

注意：task 里的 `targetBaseId` 引用的是项目内子项目，例如 `backend`、`middle`、`client`，不是模板 ID。模板 ID 通过 `project.json` 的 `bases[].templateId` 间接解析。

## 文件关系

通用 JSON 模块放在 `.engine/json/`，用于保存 schema 索引和可复制的最小示例。真实项目运行文件仍按下面结构放在 `.engine/projects/<projectId>/features/<featureId>/`。

```text
workspace.json
  -> templates/*/template.json
  -> templates/*/skills.json
  -> projects/*/project.json
    -> features/*/prd.json
    -> features/*/task-plan.json
      -> run-state.json
        -> task-run.json
        -> review.json
        -> loop-summary.json
```

建议目录：

```text
.engine/
  workspace.json
  templates/
    backend-starter/
      template.json
      skills.json
    middle-starter/
      template.json
      skills.json
    uniapp-template/
      template.json
      skills.json
  projects/
    crm-system/
      project.json
      features/
        user-tags/
          prd.json
          task-plan.json
          run-state.json
          loop-summary.json
          runs/
            TASK-001/
              task-run.json
              review.json
schemas/
  workspace.schema.json
  template.schema.json
  project.schema.json
  prd.schema.json
  task-plan.schema.json
  skills.schema.json
  run-state.schema.json
  task-run.schema.json
  review.schema.json
  loop-summary.schema.json
  backend-api.schema.json
  permission-manifest.schema.json
  database-changes.schema.json
```

## 人工确认点

只有两个文件是强人工确认点：

- `prd.json`：确认需求、边界、用户故事、验收标准。
- `task-plan.json`：确认任务拆分、依赖顺序、目标子项目、skill、允许改动路径、测试策略。

执行期文件由引擎维护：

- `run-state.json`
- `task-run.json`
- `review.json`
- `loop-summary.json`

## PRD 与任务拆分方式

PRD 按用户故事表达业务价值：

```text
Feature
  -> User Story 1
  -> User Story 2
```

Task Plan 仍然保留用户故事分组，但每个故事下面按项目内子项目拆成小任务：

```text
US-001
  -> TASK-001 targetBaseId=backend
  -> TASK-002 targetBaseId=middle
  -> TASK-003 targetBaseId=client
  -> acceptanceChecks
```

不要把任务拆成“后端大任务 / 中台大任务 / 客户端大任务”。那样会丢失用户故事维度，后续 review 很难判断某个用户故事是否真的完成。

## 状态模型

### Task 状态

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

中文含义：

| 状态 | 含义 | 是否可自动执行 |
| --- | --- | --- |
| `draft` | 任务已生成，但 task-plan 尚未人工确认 | 否 |
| `pending` | 依赖未满足，本轮不执行 | 否 |
| `ready` | 依赖满足，本轮可执行 | 是 |
| `running` | agent 正在执行 | 否 |
| `checks_failed` | 构建、测试、lint 等检查失败，下轮可继续自动修复 | 是 |
| `review_failed` | reviewer 不通过，下轮可根据反馈继续自动修复 | 是 |
| `needs_human` | 需要人工判断，但不阻塞其他任务 | 否 |
| `done` | review 通过，任务完成 | 否 |
| `cancelled` | 人工取消，不再执行 | 否 |

可运行状态固定为：

```text
ready + checks_failed + review_failed
```

`pending` 不是异常，只表示依赖未满足。`needs_human` 是异常状态，但不会阻塞其他无依赖任务继续执行。

### Run 状态

```text
not_started
running
paused
complete
failed
```

`task-plan.json` 是人工确认后的静态计划，不承载每轮变化的任务状态。任务状态、尝试次数、最近异常和运行锁记录在 `run-state.json`。`run-state.json` 不记录 `blockedTasks`；异常任务统一通过 `loop-summary.json` 的 `abnormalTasks[]` 汇总。

### Review 结论

```text
pass
fail
needs_human
```

`needs_human` 表示 reviewer 发现当前任务需要人工决策，例如范围变化、需求冲突、新依赖、模板能力不足。

## 自动循环规则

每轮执行：

1. 读取 `workspace.json`、`project.json`、`prd.json`、`task-plan.json`、`run-state.json`。
2. 校验 `prd.json` 和 `task-plan.json` 都已人工批准。
3. 获取 feature 级运行锁，避免多个 loop 同时写入。
4. 将依赖全部 `done` 的 `pending` 任务在 `run-state.json` 中标记为 `ready`。
5. 选择 `ready`、`checks_failed`、`review_failed` 任务执行。
6. 根据 `targetBaseId` 在 `project.json` 找到项目内子项目。
7. 根据子项目的 `templateId` 加载对应 `template.json` 和 `skills.json`。
8. 根据 `requiredSkillId` 找到执行 skill。
9. 执行 task，并记录 `task-run.json`。
10. 运行 `task.checks`。
11. checks 失败则在 `run-state.json` 标记 `checks_failed`。
12. checks 通过则进入 reviewer。
13. review 失败则在 `run-state.json` 标记 `review_failed`。
14. review 需要人工则在 `run-state.json` 标记 `needs_human`。
15. review 通过则在 `run-state.json` 标记 `done`。
16. 达到 `maxAttempts` 的失败任务转为 `needs_human`。
17. 本轮结束后输出 `loop-summary.json`，列出异常状态和等待依赖的任务。

## 测试分层

测试统一抽象为 `checks`，但放在不同层级。

### Task Checks

位置：`tasks[].checks`

用途：验证单个 task 的局部正确性，例如后端编译、接口单测、中台类型检查、客户端页面构建。

### Story Acceptance Checks

位置：`storyGroups[].acceptanceChecks`

用途：验证用户故事是否完整闭环。通常跨后端、中台、客户端。

### Plan Regression Checks

位置：`task-plan.regressionChecks`

用途：整批功能完成后执行回归，确保没有破坏项目。

### Skill Quality Gates

位置：`skills[].qualityGates`

用途：review 时检查是否符合该模板或项目的开发规范，例如目录约束、接口风格、权限模型、组件规范。

## 核心文件说明

### `workspace.json`

工作区索引。用于登记模板和项目，不承载具体技术栈知识。

关键字段：

- `workspaceId`：工作区 ID。
- `templates[]`：模板索引，指向模板配置文件。
- `projects[]`：项目索引，指向项目配置文件。
- `defaults`：工作区默认策略。

Schema：`schemas/workspace.schema.json`

### `template.json`

子项目模板。用于承载具体技术栈知识，避免污染引擎核心。

关键字段：

- `templateId`：模板 ID。
- `type`：模板类型。
- `sourceRepo`：模板源仓库。
- `workspaceDefaults`：默认安装、启动、健康检查命令。
- `pathPolicy.defaultAllowedPaths`：默认允许改动路径。
- `defaultChecks`：默认检查命令。

Schema：`schemas/template.schema.json`

### `project.json`

描述业务项目和实际子项目。项目只引用模板，不承载模板内部目录规则。

关键字段：

- `projectId`：项目标识。
- `bases[].baseId`：项目内子项目 ID，被 task 的 `targetBaseId` 引用。
- `bases[].templateId`：引用的模板 ID。
- `bases[].repo`：实际业务仓库地址。
- `bases[].workspace`：实际本地工作目录。
- `bases[].overrides`：项目级路径、命令、checks 覆盖。

Schema：`schemas/project.schema.json`

### `prd.json`

描述要做什么、为什么做、什么不做。

关键字段：

- `feature`：功能基本信息。
- `impactedBaseIds`：涉及的项目内子项目。
- `goals`：目标。
- `nonGoals`：非目标，用于限制 agent 过度发挥。
- `userStories`：用户故事及验收标准。
- `businessRules`：业务规则，会影响后端校验、数据库约束、前端提示和测试用例。
- `dataEntities`：数据对象，会影响建表、接口、表单和列表字段。
- `permissions`：权限要求，会影响权限码、菜单权限 SQL 和前端按钮权限。
- `openQuestions`：待人工确认问题，存在 open 项时不建议批准 PRD。
- `assumptions`：默认假设，用于减少后续任务拆分和执行时的自由发挥。
- `constraints`：技术、架构、安全、质量约束。
- `humanApproval`：人工确认信息。

Schema：`schemas/prd.schema.json`

### `task-plan.json`

描述如何把 PRD 拆成可执行任务。

关键字段：

- `storyGroups[]`：按用户故事组织任务。
- `storyGroups[].tasks[]`：任务列表。
- `tasks[].targetBaseId`：目标项目内子项目。
- `tasks[].requiredSkillId`：任务使用的 primary skill。
- `tasks[].dependsOn`：任务依赖。
- `tasks[].allowedPaths`：允许修改路径。
- `tasks[].checks`：任务级检查。
- `storyGroups[].acceptanceChecks`：用户故事级验收检查。
- `regressionChecks`：功能级回归检查。

Schema：`schemas/task-plan.schema.json`

### `skills.json`

描述模板或项目里的 agent skill。

关键字段：

- `skills[].id`：skill ID。
- `skills[].templateId`：适用模板。
- `skills[].projectId`：项目级 skill 可填写。
- `skills[].baseId`：项目级 skill 可填写。
- `skills[].taskTypes`：适用任务类型。
- `skills[].workflow`：执行步骤。
- `skills[].qualityGates`：review 规范。

Schema：`schemas/skills.schema.json`

### `run-state.json`

描述当前 feature run 的整体执行状态。

关键字段：

- `runId`
- `prdId`
- `planId`
- `status`
- `currentTaskId`
- `activeRunLock`
- `taskStates`
- `completedTasks`
- `artifacts`
- `decisions`：人工恢复和取消等决策记录。每条决策包含 `taskId`、`action`、`fromStatus`、`toStatus`、`by`、`reason`、`decidedAt`，用于追溯异常恢复操作。

Schema：`schemas/run-state.schema.json`

### `task-run.json`

记录某个 task 的执行尝试。

关键字段：

- `attempts[].status`
- `attempts[].agent`
- `attempts[].promptInputs`
- `attempts[].changedFiles`：由 Run Loop 在目标基座 git workspace 中前后采集 git diff 后写入，路径相对该 base workspace；不接受 adapter 自报作为审查依据。
- `attempts[].checks`
- `attempts[].lastIssue`
- `attempts[].summary`

Schema：`schemas/task-run.schema.json`

### `review.json`

记录 reviewer gate 的结果。

关键字段：

- `verdict`
- `criteriaResults`
- `scopeFindings`
- `architectureFindings`
- `testFindings`
- `requiredFixes`
- `suggestedFollowUpTasks`

Schema：`schemas/review.schema.json`

### `loop-summary.json`

记录一轮自动循环结束后的结果汇总。它不参与人工确认，只用于告诉人哪些任务已经完成，哪些任务下一轮可继续自动重跑，哪些任务需要人工判断。

关键字段：

- `status`：`complete`、`has_exceptions`、`failed`。
- `taskSummary`：按状态汇总任务 ID。
- `issues`：异常任务详情，只列出 `checks_failed`、`review_failed`、`needs_human`。
- `nextRunnableTaskIds`：下一轮可自动继续执行的任务。

Schema：`schemas/loop-summary.schema.json`

### `contracts/backend-api.json`

后端接口契约。由后端 task 产出，供中台和客户端 task 消费。

关键字段：

- `endpoints[].method`
- `endpoints[].path`
- `endpoints[].permissionCode`
- `endpoints[].authRequired`
- `endpoints[].request`
- `endpoints[].response`

Schema：`schemas/backend-api.schema.json`

### `contracts/permission-manifest.json`

权限链路清单。用于检查后端菜单 SQL、Controller 注解和前端按钮权限是否一致。

关键字段：

- `permissions[].code`
- `permissions[].backendAnnotation`
- `permissions[].menuSql`
- `permissions[].middleButton`

Schema：`schemas/permission-manifest.schema.json`

### `database-changes.json`

功能级数据库变更清单。用于记录新增表、字段、索引、字典、菜单和回滚说明。

Schema：`schemas/database-changes.schema.json`

## 待确认问题

- `allowedPaths` 是否严格限制执行器写入，还是只作为 reviewer 检查依据。
- `needs_human` 被人工处理后，是人工改回 `ready`，还是填写 `humanResolution` 后由 orchestrator 自动恢复。
- `checks_failed` 和 `review_failed` 的最大自动重试次数默认值。
- `story_acceptance` 是否作为独立 task，还是只作为 `storyGroups[].acceptanceChecks` 执行。
