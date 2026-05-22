# Project Init

Project Init 提供项目和功能运行目录的最小初始化入口。

## create-project

```bash
node tools/project-init/create-project.mjs \
  --project-id demo-project \
  --name 示例项目 \
  --base backend:backend-starter:https://example.com/backend.git:/abs/workspace/backend \
  --out .engine/projects/demo-project/project.json
```

`--base` 可重复传入多个，格式为 `baseId:templateId:repo:workspace`。`repo` 必须是合法 URI，`workspace` 必须已存在，`templateId` 必须存在于 `.engine/templates`。

默认拒绝覆盖已存在的 `--out`，使用 `--force` 覆盖。

## create-feature

```bash
node tools/project-init/create-feature.mjs \
  --feature-id user-tags \
  --name 用户标签 \
  --summary 管理用户标签 \
  --project .engine/projects/demo-project/project.json \
  --bases backend,middle \
  --out-dir .engine/projects/demo-project/features/user-tags
```

默认只生成 draft `prd.json`，不自动 approve，也不会生成 `task-plan.json` 和 `run-state.json`。

为了避免覆盖人工调整过的产物，feature 目录内任一标准产物（`prd.json`、`task-plan.json`、`run-state.json`）已存在时默认拒绝继续写入；确认重建时使用 `--force`。

显式 approve PRD 后会继续生成 task-plan 和 run-state：

```bash
node tools/project-init/create-feature.mjs \
  --feature-id user-tags \
  --name 用户标签 \
  --summary 管理用户标签 \
  --project .engine/projects/demo-project/project.json \
  --bases backend,middle \
  --out-dir .engine/projects/demo-project/features/user-tags \
  --approve-prd-by alice
```

同时显式 approve task-plan：

```bash
node tools/project-init/create-feature.mjs \
  --feature-id user-tags \
  --name 用户标签 \
  --summary 管理用户标签 \
  --project .engine/projects/demo-project/project.json \
  --bases backend,middle \
  --out-dir .engine/projects/demo-project/features/user-tags \
  --approve-prd-by alice \
  --approve-task-plan-by alice
```
