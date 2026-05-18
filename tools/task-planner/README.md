# Task Planner

Task Planner 用于从已确认的 `prd.json` 生成 `task-plan.json` 草稿。它只做规则化拆分，不调用 LLM，不执行任务。

## 当前能力

- 读取 `project.json` 和 `prd.json`。
- 按 `prd.userStories[]` 生成 `storyGroups[]`。
- 按 `prd.impactedBaseIds[]` 或 `--bases` 生成每个 story 下的多端任务。
- 根据 base 的 `templateId` 选择默认 skill。
- 中台和客户端任务默认依赖同 story 下的后端任务。
- 从模板 defaultChecks 生成 task checks。
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

依赖规则：

```text
middle/client task dependsOn 同 story 下的 backend task
```

## 人工确认

```bash
node tools/task-planner/approve-task-plan.mjs \
  --task-plan .engine/projects/demo-project/features/user-tags/task-plan.json \
  --by xilanli \
  --notes "任务拆分已确认"
```

确认后会设置：

- `status = approved`
- `humanApproval.approved = true`
- `approvedBy`
- `approvedAt`
- `updatedAt`

## 后续增强

- 根据 `businessRules` 选择 schema/database task。
- 根据 `dataEntities` 生成更准确的后端 SQL 和字段 scope。
- 根据 `permissions` 生成 permission-manifest 相关任务。
- 支持 LLM 辅助拆分。
- 支持生成初始 `run-state.json`。
