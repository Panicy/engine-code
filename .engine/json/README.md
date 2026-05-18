# JSON 模块

这个目录是 AI 开发引擎的 JSON 契约模块。它不保存真实项目运行状态，只提供：

- schema 索引
- JSON 文件职责说明
- 可复制的最小示例

真实项目文件建议放在：

```text
.engine/projects/<projectId>/features/<featureId>/
```

## 核心关系

```text
workspace.json
  -> project.json
    -> feature/prd.json
    -> feature/task-plan.json
      -> run-state.json
      -> runs/<taskId>/task-run.json
      -> runs/<taskId>/review.json
      -> loop-summary.json
```

模板和 skill：

```text
.engine/templates/<templateId>/template.json
.engine/templates/<templateId>/skills.json
```

跨任务产物：

```text
contracts/backend-api.json
contracts/permission-manifest.json
database-changes.json
```

## 文件说明

- `schema-index.json`：schema 文件索引。
- `examples/`：最小示例 JSON，可用于创建新项目或测试 schema。

## 使用原则

- PRD 和 task-plan 必须人工确认。
- task 按用户故事组织，但每个 task 只归属一个项目内子项目。
- skill 只提供实现知识，不承载执行契约。
- 测试意识写入开发 skill 的自查清单。
- `needs_human` 表示停止猜测，不阻塞其他任务。
