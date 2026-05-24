# Task Planner

Task Planner 用于从已确认的 `prd.json` 生成 `task-plan.json` 草稿。它只做规则化拆分，不调用 LLM，不执行任务。

## 当前能力

- 读取 `project.json` 和 `prd.json`。
- 按 `prd.userStories[]` 生成 `storyGroups[]`。
- 按 `prd.impactedBaseIds[]` 或 `--bases` 生成每个 story 下的多端任务。
- 根据 base 的 `templateId` 选择默认 skill。
- 中台和客户端任务默认依赖同 story 下的所有后端任务。
- 如果 PRD 存在 `dataEntities[]`，会先生成后端 schema/database task。
- 如果 PRD 存在多个 `dataEntities[]`，后端 CRUD 会按实体拆成多个小任务。
- PRD 的 businessRules/dataEntities/permissions 会进入 task scope。
- PRD 的 assumptions/openQuestions/risks 会进入 task humanNotes。
- `userStories[].dependencies` 会映射为跨 story task 依赖，并影响 run-state 的 pending/ready。
- `userStories[].dependencies` 必须引用排在当前故事之前的有效 storyId，避免依赖被静默忽略。
- 所有 base 会按 backend -> middle -> client 稳定排序，不受 `--bases` 输入顺序影响。
- 从模板 defaultChecks 生成 task checks。
- 同步生成初始 `run-state.json`。
- 默认状态为 `draft`。
- 默认 `humanApproval.approved = false`。
- 默认拒绝覆盖已有 task-plan，避免误覆盖人工确认产物。

## 使用方式

```bash
node tools/task-planner/create-task-plan.mjs \
  --project .engine/projects/demo-project/project.json \
  --prd .engine/projects/demo-project/features/user-tags/prd.json \
  --out .engine/projects/demo-project/features/user-tags/task-plan.json
```

可选参数：

```bash
--plan-id PLAN-USER-TAGS
--run-state-out .engine/projects/demo-project/features/user-tags/run-state.json
--templates-dir .engine/templates
--bases backend,middle,client
--allow-draft-prd
--force
```

默认要求 PRD 已人工确认。开发验证时可以使用 `--allow-draft-prd`，但正式流程不应绕过 PRD 确认。

## 默认拆分规则

```text
backend-starter -> backend task -> ruoyi-module-crud
middle-starter  -> middle task  -> vben-table-form-page
uniapp-template -> client task  -> uniapp-page-flow
```

如果 PRD 存在 `dataEntities[]`，会先生成数据库 schema task：

```text
backend-starter -> schema task -> ruoyi-database-migration
backend task dependsOn schema task
```

如果 PRD 存在多个 `dataEntities[]`，后端 CRUD 不再合并成一个大任务，而是按实体拆分：

```text
schema task
  -> backend task: 微信应用
  -> backend task: 相册分类
  -> backend task: 相册素材

middle/client task dependsOn 所有实体 backend task
```

实体后端任务只携带当前实体相关的 `dataEntities`、`permissions` 和较小的 `contextBudget`，避免真实 Agent 一次性修改过多文件导致超时、越界或审查失败。

依赖规则：

```text
middle/client task dependsOn 同 story 下的所有 backend task
后置 story 的入口 task dependsOn 前置 story 的终止 task
```

例如 `US-002.dependencies=["US-001"]` 时，`US-002` 的首个可执行 task 会依赖 `US-001` 的最后一个 task，因此初始 `run-state` 中该 task 会是 `pending`。如果依赖了不存在或排在后面的故事，Task Planner 会直接失败，要求先修正 PRD。

## 人工确认

```bash
node tools/task-planner/approve-task-plan.mjs \
  --project .engine/projects/demo-project/project.json \
  --prd .engine/projects/demo-project/features/user-tags/prd.json \
  --task-plan .engine/projects/demo-project/features/user-tags/task-plan.json \
  --run-state .engine/projects/demo-project/features/user-tags/run-state.json \
  --by xilanli \
  --notes "任务拆分已确认"
```

确认后会设置：

- `status = approved`
- `humanApproval.approved = true`
- `approvedBy`
- `approvedAt`
- `updatedAt`

如果传入 `--project`、`--prd`、`--run-state`，确认前会先调用 Validator。存在 error 时拒绝确认。

## 后续增强

- 根据 `permissions` 生成 permission-manifest 相关任务。
- 支持 LLM 辅助拆分。
