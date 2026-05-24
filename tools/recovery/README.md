# Recovery

Recovery tools inspect and resolve task-level exceptions in `run-state.json`.

## List Issues

```bash
node tools/recovery/list-issues.mjs --run-state path/to/run-state.json
```

`issues` lists only `checks_failed`, `review_failed`, and `needs_human` tasks.

The command also returns run diagnostics:

- `status`
- `currentTaskId`
- `activeRunLock`
- `runningTasks`

`runningTasks` is diagnostic data, not a retryable issue. It is used to expose a Run Loop that was interrupted after marking a task `running` but before writing `task-run.json`.

## Show Task

```bash
node tools/recovery/show-task.mjs \
  --feature-dir path/to/feature \
  --run-state path/to/run-state.json \
  --task-id TASK-001
```

Shows task state, `lastIssue`, task-run attempt summaries, and review summary. Missing review is returned as `null`.

The output includes `diagnostics` with the active lock, whether `task-context.json`, `task-run.json`, and `review.json` exist for the task, and any process-agent stdout/stderr log paths already created under the task run directory.

## Resolve Task

```bash
node tools/recovery/resolve-task.mjs \
  --run-state path/to/run-state.json \
  --task-id TASK-001 \
  --action retry \
  --by alice \
  --reason "fixed failing check"
```

Rules:

- `checks_failed`, `review_failed`, `needs_human` + `retry` -> `ready`
- `running` + `retry --allow-running` -> `ready`，用于人工确认没有活跃执行进程后恢复悬挂任务；同时清理 `activeRunLock` 和 `currentTaskId`
- `done` + `retry --allow-done` -> `ready`，用于恢复被误标完成的任务
- `needs_human` + `cancel` -> `cancelled`
- `cancel` is rejected for non-`needs_human` tasks
- `ready`, `running` without `--allow-running`, `done` without `--allow-done`, and `cancelled` reject `retry`

Every successful resolution appends a structured decision to `run-state.decisions`.
Successful resolutions also recalculate `run-state.status`. Validation or argument failures happen before the atomic write, so a failed resolution does not modify `run-state.json`.
