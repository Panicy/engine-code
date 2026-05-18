# Run Loop

Run Loop 是 AI 开发引擎的执行循环 MVP。当前版本使用 mock agent、mock checks、mock review 跑通状态流转和运行产物写入，不执行真实代码开发。

## 当前能力

- 调用 Validator 做前置校验。
- 获取 feature 级运行锁。
- 推进 `pending -> ready`。
- 按 task-plan 顺序执行 `ready`、`checks_failed`、`review_failed`。
- mock agent 执行任务。
- mock checks 和 review。
- 写入：
  - `runs/<taskId>/task-run.json`
  - `runs/<taskId>/review.json`
  - `run-state.json`
  - `loop-summary.json`
- 支持失败 mock，用于验证异常状态和复跑入口。
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
--max-tasks 1
--mock-fail-task TASK-001
--mock-fail-stage check
--owner run-loop
```

`--max-tasks 0` 表示本轮尽量跑完所有可运行任务。

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

## 后续增强

- 接入真实 Agent Adapter。
- 接入真实 Checks Runner。
- 接入真实 Reviewer。
- 完善 task-run 追加历史 attempts，而不是每次覆盖单文件。
- 增加更细粒度的运行锁恢复策略。
