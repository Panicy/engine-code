# Runtime Runner

Runtime Runner 负责按模板 `runtimeProfile` 检查子项目运行状态。它不替代业务 task skill；它只回答“后台/中台基座现在能不能跑、能不能被访问、浏览器有没有运行时错误”。

## 使用

```bash
node tools/runtime-runner/run-runtime.mjs \
  --project /path/to/project.json \
  --out-dir /path/to/feature/runs/runtime \
  --base-ids backend,middle \
  --mode check
```

模式：

- `mock`：不真实执行命令和 HTTP，用于引擎回归。
- `check`：真实执行 preflight、health 和 browser checks。

Run Loop 集成：

```bash
node tools/run-loop/run-feature.mjs \
  --project /path/to/project.json \
  --prd /path/to/prd.json \
  --task-plan /path/to/task-plan.json \
  --run-state /path/to/run-state.json \
  --runtime-mode check
```

## 产物

```text
runs/runtime/<baseId>-runtime.json
```

产物记录：

- `status`：`passed` 或 `failed`。
- `startCommands`：模板推荐启动命令，仅记录，不在 check 模式直接执行长驻进程。
- `checks[]`：preflight、health、browser 检查结果。
