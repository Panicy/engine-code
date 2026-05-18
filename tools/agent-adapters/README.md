# Agent Adapter

Agent Adapter 是 Run Loop 和具体执行器之间的适配层。它的职责是围绕单个 task 做执行，并返回标准 outcome；Run Loop 继续负责状态流转、重试、运行锁、产物写入和汇总，Checks Runner 负责统一检查 task 结果。

## 当前实现

- `mock`：默认 adapter。用于验证状态机、异常复跑、review/check/needs_human 分支。

## Outcome 约定

Adapter 的 `execute(context)` 返回：

```js
{
  requestedStatus: 'done' | 'checks_failed' | 'review_failed' | 'needs_human',
  taskRunStatus: 'passed' | 'checks_failed' | 'review_failed' | 'needs_human',
  reviewVerdict: 'pass' | 'fail' | 'needs_human' | null,
  source: 'executor' | 'check' | 'reviewer' | 'orchestrator',
  agent: { tool: 'mock-agent', model: 'mock' },
  changedFiles: [],
  summary: '',
  errors: [],
  nextActions: []
}
```

## 边界

- Adapter 不直接修改 `run-state.json`。
- Adapter 不直接写 `task-run.json` 或 `review.json`。
- Adapter 不负责执行 task-plan checks。
- Adapter 不决定最终是否达到最大重试次数，重试耗尽由 Run Loop 转成 `needs_human`。
- Adapter 不绕过 PRD 和 task-plan 的人工确认门禁。
- Run Loop 会校验 outcome；非法 outcome 会被视为 orchestrator/adapter 异常，当前 task 会转为 `needs_human`。

后续真实执行器可以新增为 `codex` 或 `shell` adapter，但仍应保持这个边界。
