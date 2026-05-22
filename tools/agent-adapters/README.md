# Agent Adapter

Agent Adapter 是 Run Loop 和具体执行器之间的适配层。它的职责是围绕单个 task 做执行，并返回标准 outcome；Run Loop 继续负责状态流转、重试、运行锁、产物写入和汇总，Checks Runner 负责统一检查 task 结果。

## 当前实现

- `mock`：默认 adapter。用于验证状态机、异常复跑、review/check/needs_human 分支。
- `shell`：真实执行一条 `--shell-command`，用于打通真实执行器插槽。
- `codex`：通过 `--codex-command` 启动 Codex CLI 或兼容命令，用于真实执行单个 task。

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

真实执行器仍应保持这个边界。

## Shell Adapter

```bash
node tools/run-loop/run-feature.mjs \
  --agent-adapter shell \
  --shell-command "node -e \"console.log('ok')\""
```

- 工作目录使用 `taskContext.base.workspaceAbs`。
- 命令退出码为 0 时，任务进入后续 checks/review。
- 命令失败或 workspace 不存在时，任务进入 `needs_human`。

## Codex Adapter

```bash
node tools/run-loop/run-feature.mjs \
  --agent-adapter codex \
  --codex-command codex \
  --codex-model gpt-5 \
  --codex-extra-arg exec \
  --codex-timeout-ms 300000
```

- 工作目录使用 `taskContext.base.workspaceAbs`。
- Adapter 会把 task-context 文件路径写进最后一个 prompt 参数，不把完整 JSON 塞进命令行。
- `--codex-extra-arg` 可重复传入，按出现顺序追加到 Codex 命令参数中。
- 未传 `--codex-extra-arg` 时默认使用 `exec`，即默认调用形态接近 `codex exec "<prompt>"`。
- 命令退出码为 0 时，任务进入后续 checks/review。
- 命令不存在、超时、非 0、workspace 不存在或 `--codex-timeout-ms` 非法时，任务进入 `needs_human`。
- `changedFiles` 固定返回空数组；可信变更列表仍由 Run Loop 的 git diff collector 采集。
