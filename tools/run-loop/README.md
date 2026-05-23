# Run Loop

Run Loop 是 AI 开发引擎的执行循环 MVP。当前版本通过 Agent Adapter 执行 task，并通过 Checks Runner 统一检查 task 结果。默认 checks 使用真实模式执行。

## 当前能力

- 调用 Validator 做前置校验。
- 获取 feature 级运行锁。
- 推进 `pending -> ready`。
- 按 task-plan 顺序执行 `ready`、`checks_failed`、`review_failed`。
- 通过 `--agent-adapter` 选择 task 执行器。
- 通过 `--checks-mode` 选择检查模式。
- 默认 `mock` adapter 会模拟 agent 和 review；`shell` adapter 可真实执行一条 shell 命令。
- `external` adapter 可接任意兼容外部 agent 命令，不绑定具体 AI 工具。
- `codex` adapter 是内置 Codex CLI 兼容实现，保留用于便捷调用。
- 默认 `real` checks 会真实执行 command 和 HTTP 检查。
- 写入：
  - `runs/<taskId>/task-run.json`
  - `runs/<taskId>/review.json`
  - `run-state.json`
  - `loop-summary.json`
- 支持失败 mock，用于验证异常状态和复跑入口。
- 同一轮内每个 task 最多执行一次，失败任务留到下一轮重跑。
- `task-run.json` 会追加 attempts，不覆盖历史。
- `task-run.json` 的 `changedFiles` 由目标基座 git diff 自动采集，不接受 adapter 自报。
- Run Loop 在调用 adapter 前必须生成 `runs/<taskId>/task-context.json`，并把实际 skill 文档路径和 SHA-256 写入 `task-run.json` 的 `skillContext`。如果 skill 文档缺失，任务会进入 `needs_human`，不会绕过 skill 执行。
- `--runtime-mode mock|check` 会在开发任务前按模板 `runtimeProfile` 生成 `runs/runtime/<baseId>-runtime.json`。`skip` 为默认值，避免旧流程被本地环境阻断。
- 调用 Validator 做后置校验。

## 使用方式

```bash
node tools/run-loop/run-feature.mjs \
  --project .engine/projects/demo-project/project.json \
  --prd .engine/projects/demo-project/features/user-tags/prd.json \
  --task-plan .engine/projects/demo-project/features/user-tags/task-plan.json \
  --run-state .engine/projects/demo-project/features/user-tags/run-state.json
```

可选参数：

```bash
--templates-dir .engine/templates
--agent-adapter mock
--checks-mode real
--runtime-mode skip
--max-tasks 1
--mock-fail-task TASK-001
--mock-fail-stage check
--mock-fail-check backend-compile
--shell-command "node -e \"console.log('ok')\""
--shell-timeout-ms 300000
--codex-command codex
--codex-model gpt-5
--codex-timeout-ms 300000
--codex-extra-arg exec
--external-agent-command /path/to/your-agent
--external-agent-timeout-ms 300000
--external-agent-extra-arg run
--owner run-loop
```

`--max-tasks 0` 表示本轮尽量跑完所有可运行任务。

## Runtime Profile

项目启动能力属于模板运行层，不属于业务开发 skill。模板可在 `template.json` 中声明：

- `runtimeProfile.preflightCommands`：启动前检查，例如 JDK、Maven、Node、pnpm、环境文件。
- `runtimeProfile.startCommands`：推荐启动命令，当前用于记录和提示，避免 Run Loop 直接阻塞在长驻进程。
- `runtimeProfile.healthChecks`：HTTP 或脚本健康检查。
- `runtimeProfile.browserChecks`：浏览器打开页面并捕获 console error/pageerror。

单独运行：

```bash
node tools/runtime-runner/run-runtime.mjs \
  --project features/demo/project.json \
  --out-dir features/demo/runs/runtime \
  --base-ids backend,middle \
  --mode check
```

## Agent Adapter

当前可用 adapter：

- `mock`：默认执行器，用于验证状态机和异常复跑。
- `shell`：真实执行 `--shell-command`，工作目录为 `project.bases[].workspace` 对应目录。
- `external`：真实执行 `--external-agent-command`，工作目录为 `project.bases[].workspace` 对应目录。
- `codex`：Codex CLI 兼容实现，底层也是外部进程执行器。

Adapter 只返回单个 task 的执行 outcome，不直接修改 `run-state.json`，也不直接写 `task-run.json` 或 `review.json`。状态流转、重试耗尽、运行锁释放和产物写入仍由 Run Loop 统一处理。

Run Loop 会在 adapter 执行前后读取当前 task 对应 base workspace 的 git 状态，自动计算本次 attempt 的 `changedFiles`。base workspace 必须是 git 仓库；否则任务会进入 `needs_human`，避免产出误导性的空变更列表。

Shell 示例：

```bash
node tools/run-loop/run-feature.mjs \
  --project project.json \
  --prd prd.json \
  --task-plan task-plan.json \
  --run-state run-state.json \
  --agent-adapter shell \
  --shell-command "node -e \"console.log('shell-ok')\""
```

Codex 示例：

```bash
node tools/run-loop/run-feature.mjs \
  --project project.json \
  --prd prd.json \
  --task-plan task-plan.json \
  --run-state run-state.json \
  --agent-adapter codex \
  --codex-command codex \
  --codex-extra-arg exec \
  --codex-model gpt-5
```

Codex Adapter 只执行当前 task。Run Loop 会先写入 `runs/<taskId>/task-context.json`，Codex Adapter 再把该文件路径写入最后一个 prompt 参数，并要求执行器读取其中的 skill 文档。Adapter 不写 run-state/task-run/review，不执行 checks，不做 allowedPaths 审查，也不提供可信 `changedFiles`；可信变更列表仍由 Run Loop 的 git diff collector 采集。未传 `--codex-extra-arg` 时默认使用 `exec`，即默认调用形态接近 `codex exec "<prompt>"`。

External Agent 示例：

```bash
node tools/run-loop/run-feature.mjs \
  --project project.json \
  --prd prd.json \
  --task-plan task-plan.json \
  --run-state run-state.json \
  --agent-adapter external \
  --external-agent-command /path/to/your-agent \
  --external-agent-extra-arg run
```

External Agent Adapter 只要求外部命令能读取最后一个 prompt 参数中的 `task-context.json` 路径，并在当前 workspace 内完成单个 task。它可以是 Codex、Claude Code、自研 worker、HTTP 包装脚本或任何本地可执行代理。Run Loop 仍统一负责 git diff、checks、review 和状态流转。

Shell Adapter 会把以下环境变量传给命令，便于自研 worker 或测试脚本强制读取 skill：

- `ENGINE_TASK_CONTEXT_PATH`
- `ENGINE_REQUIRED_SKILL_ID`
- `ENGINE_SKILL_DOCUMENT_PATH`
- `ENGINE_SKILL_DOCUMENT_SHA256`

## Checks Runner

当前支持：

- `real`：默认模式，真实执行 command 和 HTTP 检查。
- `command`：`real` 的兼容别名。
- `mock`：开发回归模式，生成标准化检查结果；可用 `--mock-fail-check <checkId>` 定点模拟失败。
- `manual` 检查不会自动通过；必需 manual 检查会让任务进入 `checks_failed`。

检查失败时，Run Loop 会将任务标记为 `checks_failed`，并把每个 check 的结果写入 `task-run.json`。

## Review Runner

Run Loop 会在 adapter 成功且 checks 通过后运行 Review Runner。当前 review 会校验：

- 必需 checks 是否都有结果且为 `passed`。
- `changedFiles` 是否全部落在 task 的 `allowedPaths` 内。

Review 失败时，任务进入 `review_failed`，并写入 `runs/<taskId>/review.json`。

注意：Review Runner 只使用 Run Loop 从 git diff 采集的可信 `changedFiles`，不接受 adapter 自报的 `changedFiles`。

## Mock 失败

```bash
node tools/run-loop/run-feature.mjs \
  --project project.json \
  --prd prd.json \
  --task-plan task-plan.json \
  --run-state run-state.json \
  --mock-fail-task TASK-002 \
  --mock-fail-stage review
```

支持阶段：

- `check`：任务进入 `checks_failed`
- `review`：任务进入 `review_failed`
- `human`：任务进入 `needs_human`

也可以只模拟某个检查失败：

```bash
node tools/run-loop/run-feature.mjs \
  --project project.json \
  --prd prd.json \
  --task-plan task-plan.json \
  --run-state run-state.json \
  --mock-fail-check backend-compile
```

## 后续增强

- 增强 Checks Runner 的鉴权令牌注入和响应体断言。
- 增强 Review Runner 的语义审查、权限/菜单/SQL/API 契约一致性检查。
- 增加更细粒度的运行锁恢复策略。
