# Review Runner

Review Runner 在 task 执行和 checks 之后运行，用于生成标准 `review.json`。

## 当前能力

- 校验必需 checks 是否都有结果且状态为 `passed`。
- 基于 Run Loop 从 git diff 采集的可信 `changedFiles` 校验 `allowedPaths`。
- 根据确定性 finding 生成 `criteriaResults`、`scopeFindings`、`testFindings` 和 `requiredFixes`。
- review 失败时，Run Loop 会把 task 标记为 `review_failed`，下一轮可自动重跑。

## 暂不做

- 不接受 Agent Adapter 自报的 `changedFiles` 作为 allowedPaths 审查依据；只使用 Run Loop 从 git diff 采集的可信 `changedFiles`。

## 边界

- 当前不做模型语义审查。
- 当前不解析代码 AST。
- 当前不判断业务逻辑是否完整实现。

后续可以在这个模块后面接入模型审查，重点补充 scope、架构、测试充分性、权限/菜单/SQL/API 契约一致性等判断。
