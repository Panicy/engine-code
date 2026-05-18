# Engine E2E 测试

这个目录用于验证 AI 开发引擎的主链路是否跑通。当前测试不依赖业务代码基座，也不引入额外测试框架，只围绕引擎 JSON 契约和现有工具脚本做端到端回归。

## 覆盖范围

- JSON 契约文件和示例文件可解析。
- PRD 未人工确认时，任务拆分会被阻止。
- `create-prd -> approve-prd -> create-task-plan -> approve-task-plan -> run-feature` 完整链路可完成。
- `--max-tasks` 只跑部分任务时，Run Loop 不误报完成。
- `checks_failed` 和 `review_failed` 只标状态，可在下一轮重跑。
- `task-run.json` 会保留多次 attempts。
- `needs_human` 不自动重跑，但会释放运行锁并进入异常汇总。

## 使用方式

```bash
node tools/e2e/run-engine-e2e.mjs
```

调试失败产物时保留临时目录：

```bash
node tools/e2e/run-engine-e2e.mjs --keep-tmp
```

## 定位

这是一层轻量的引擎级冒烟和回归测试。它不替代后端、中台、客户端各自的实现测试；各端任务执行时仍应由对应 skill 内置接口连通性、权限、菜单、页面、类型检查等验证。
