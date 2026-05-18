# Checks Runner

Checks Runner 负责把 task-plan 中的 `checks` 转成标准化检查结果，并交给 Run Loop 写入 `task-run.json`。

## 当前能力

- `mock` 模式：默认模式，HTTP 检查按配置生成通过结果，command 检查跳过。
- `command` 模式：执行 `command/build/lint/typecheck/unit/e2e/health/api` 等带 `command` 字段的检查。
- `manual` 检查不会自动通过；必需的 manual 检查会让任务进入 `checks_failed`。
- 支持 `--mock-fail-check <checkId>` 定点模拟检查失败。

## 边界

- Checks Runner 不修改 `run-state.json`。
- Checks Runner 不写 `task-run.json`。
- Checks Runner 不负责代码开发，只判断检查是否通过。

后续增强重点是 HTTP 真实请求、鉴权边界测试、`auth_disabled` setup/teardown 的安全执行，以及各基座的默认命令封装。
