# Validator 工具

这是 AI 开发引擎的内部 Validator MVP。它用于校验一个 feature 的 JSON 世界是否可信。

当前能力：

- JSON schema 子集校验。
- PRD 和 task-plan 人工确认校验。
- project、template、skill、story、task、dependsOn 引用校验。
- run-state 与 task-plan 的任务状态一致性校验。
- checks 配置校验，包括 `command`、`http`、`manual`。
- 输出中文结构化报告。

## 使用方式

```bash
node tools/validator/validate-feature.mjs \
  --project .engine/json/examples/project.json \
  --prd .engine/json/examples/prd.json \
  --task-plan .engine/json/examples/task-plan.json \
  --run-state .engine/json/examples/run-state.json \
  --templates-dir .engine/templates
```

可选参数：

```bash
--workspace <workspace.json>
```

## 返回结果

成功时退出码为 `0`，失败时退出码为 `1`。

输出格式：

```json
{
  "valid": false,
  "errors": [],
  "warnings": [],
  "infos": []
}
```

`error` 会阻止 Run Loop 启动，`warning` 和 `info` 不阻止。

## 当前边界

- 这是内部模块，不是正式 CLI。
- Schema 校验是轻量实现，覆盖当前仓库 schema 需要的关键 JSON Schema 子集。
- 后续如果需要完整 JSON Schema 兼容，可以替换为 Ajv 等标准实现。
