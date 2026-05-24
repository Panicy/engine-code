# Engine CLI

这是引擎的薄 CLI 层，只负责把常用动作串起来，不承载核心业务逻辑。核心能力仍然由 JSON 契约、PRD Builder、Task Planner、Runtime Runner、Run Loop、Recovery 等模块提供。

## 设计边界

- CLI 不绑定具体 Agent，`run` 命令通过 `--agent-adapter` 选择 `mock`、`shell`、`codex`、`external-agent` 等执行器。
- CLI 不直接复制或改造基座项目，只把本地真实基座 workspace 写入 `project.json`。
- CLI 不绕过人工确认，`init-feature --approve --by human` 只是调用既有确认入口写入确认记录。
- CLI 不新增单独任务 JSON，任务仍然来自 `task-plan.json`，并按任务绑定的 skill 执行。

## 常用命令

```bash
node tools/cli/engine.mjs init-project \
  --project-id demo \
  --name 示例项目 \
  --backend /path/to/backend \
  --middle /path/to/middle \
  --client /path/to/client
```

```bash
node tools/cli/engine.mjs init-feature \
  --project .engine/projects/demo/project.json \
  --feature-id app-management \
  --name 应用管理 \
  --summary 应用新增、编辑、上下架和列表查询 \
  --bases backend,middle \
  --approve \
  --by human
```

```bash
node tools/cli/engine.mjs runtime \
  --project .engine/projects/demo/project.json \
  --feature .engine/projects/demo/features/app-management \
  --mode check
```

```bash
node tools/cli/engine.mjs run \
  --project .engine/projects/demo/project.json \
  --feature .engine/projects/demo/features/app-management \
  --agent-adapter shell \
  --shell-command "your-agent-command" \
  --runtime-mode check \
  --checks-mode real
```

```bash
node tools/cli/engine.mjs status \
  --feature .engine/projects/demo/features/app-management
```

## 真实项目测试

`real-test` 会调用固定三端基座真实项目测试流程：拉取 backend / middle / client 固定基座，创建 `project.json`，执行后端 bootstrap，并跑真实需求 smoke 场景。

```bash
MYSQL_PWD='romantic.' node tools/cli/engine.mjs real-test \
  --mysql-command /usr/local/mysql/bin/mysql \
  --mysql-user root \
  --mysql-password-env MYSQL_PWD \
  --database aitest \
  --redis-url redis://default:root123@127.0.0.1:6379 \
  --scenario-ids backend-sql-migration-smoke,middle-notice-page-smoke,client-announcement-tags \
  --keep-tmp
```

调试引擎本体时可以使用本地 source template，避免网络 clone 和数据库依赖：

```bash
node tools/cli/engine.mjs real-test \
  --clone-mode source-template \
  --skip-bootstrap
```

`real-test` 会同时输出 `real-project-report.json` 和 `real-project-report.md`，Markdown 报告更适合人工审阅和转交给测试/开发智能体。

## 任务恢复

```bash
node tools/cli/engine.mjs show-task \
  --feature .engine/projects/demo/features/app-management \
  --task-id TASK-001
```

```bash
node tools/cli/engine.mjs retry \
  --feature .engine/projects/demo/features/app-management \
  --task-id TASK-001 \
  --by human \
  --reason "已修复接口 404"
```

```bash
node tools/cli/engine.mjs cancel \
  --feature .engine/projects/demo/features/app-management \
  --task-id TASK-001 \
  --by human \
  --reason "需求范围调整"
```
