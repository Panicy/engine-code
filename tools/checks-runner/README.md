# Checks Runner

Checks Runner 负责把 task-plan 中的 `checks` 转成标准化检查结果，并交给 Run Loop 写入 `task-run.json`。

## 当前能力

- `real` 模式：默认模式，真实执行 command 检查和 HTTP 检查。
- `command` 模式：`real` 的兼容别名，真实执行 command 检查和 HTTP 检查。
- `mock` 模式：只用于开发回归，HTTP 和 command 检查按配置生成通过结果。
- `manual` 检查不会自动通过；必需的 manual 检查会让任务进入 `checks_failed`。
- 支持 `--mock-fail-check <checkId>` 定点模拟检查失败。
- HTTP 检查会按 `expectedStatus` 判断结果。
- HTTP 检查支持 `authMode=anonymous|authenticated|auth_disabled`。
- `authenticated` 可通过 `tokenEnv` 从环境读取 token，并注入 `authHeader`，默认 `Authorization: Bearer <token>`。
- HTTP 检查支持 `expectedBody.contains`、`expectedBody.notContains` 和简单点路径 `expectedBody.jsonFields` 断言。
- HTTP 检查支持 `setupCommands` 和 `teardownCommands`；`teardownCommands` 会尽量在请求后执行，用于恢复 `auth_disabled` 等临时状态。
- `auth_disabled` 只允许 `environment=dev|test`；`production` 或缺省 `unknown` 会直接失败。
- `teardownCommands` 失败会让 check failed，并在 summary 中提示 `requires human`。

## 边界

- Checks Runner 不修改 `run-state.json`。
- Checks Runner 不写 `task-run.json`。
- Checks Runner 不负责代码开发，只判断检查是否通过。

后续增强重点是各基座默认命令封装、更丰富的响应体断言，以及 teardown 失败后的 Run Loop `needs_human` 直达策略。
