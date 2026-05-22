# Recovery

Recovery tools inspect and resolve task-level exceptions in `run-state.json`.

## List Issues

```bash
node tools/recovery/list-issues.mjs --run-state path/to/run-state.json
```

Lists only `checks_failed`, `review_failed`, and `needs_human` tasks.

## Show Task

```bash
node tools/recovery/show-task.mjs \
  --feature-dir path/to/feature \
  --run-state path/to/run-state.json \
  --task-id TASK-001
```

Shows task state, `lastIssue`, task-run attempt summaries, and review summary. Missing review is returned as `null`.

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
- `needs_human` + `cancel` -> `cancelled`
- `cancel` is rejected for non-`needs_human` tasks
- `ready`, `running`, `done`, and `cancelled` reject `retry`

Every successful resolution appends a structured decision to `run-state.decisions`.
Successful resolutions also recalculate `run-state.status`. Validation or argument failures happen before the atomic write, so a failed resolution does not modify `run-state.json`.
