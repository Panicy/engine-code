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

## 真实需求 E2E

`run-real-demand-e2e.mjs` 是真实需求场景库 runner。它会复制 `.engine/source-templates/<template>` 到 `/private/tmp`，初始化临时 git baseline，然后通过 Project Init、PRD、task-plan、Run Loop、真实文件修改、真实 checks、Review Runner 和产物断言验证一条可重复的需求执行链路。默认使用 shell adapter 做确定性修改，不污染源模板。

安全边界：

- 真实需求 E2E 只能使用 `.engine/source-templates/<template>` 作为源基座。
- workspace 必须由 runner 创建在 `/private/tmp/engine-real-demand-e2e-*` 下。
- 场景不允许指定外部 `sourceWorkspace`、`sourcePath` 或 `workspace`，避免误把业务项目当成测试基座。
- 需要验证 Gitee 固定基座时，应先 clone `backend-starter`、`middle-starter`、`uniapp-template` 到受控临时目录，再接入专门的基座验收脚本；不要直接指向业务项目目录。

场景定义放在 `tools/e2e/real-demand-scenarios/`。新增场景时优先复用现有字段结构：目标模板、目标 base、skill、allowedPaths、expectedChangedFiles、checks 和确定性 modifier。

查看可用场景：

```bash
node tools/e2e/run-real-demand-e2e.mjs --list-scenarios
```

运行全部轻量正向场景：

```bash
node tools/e2e/run-real-demand-e2e.mjs --all
```

`--all` 当前会运行客户端、后端、中台的正向 smoke 场景；越界类负向场景需显式指定。

默认场景：

```bash
node tools/e2e/run-real-demand-e2e.mjs
```

等价于：

```bash
node tools/e2e/run-real-demand-e2e.mjs \
  --scenario client-announcement-tags \
  --adapter shell
```

`client-announcement-tags` 会复制 `uniapp-template`，修改 `/private/tmp` 中的基座副本，并运行真实 `npm test`。该场景断言：

- `project.json`、`prd.json`、`task-plan.json`、`run-state.json` 可初始化并确认。
- Run Loop 执行真实 shell 修改。
- `npm test` 作为真实 checks 通过。
- `changedFiles` 只来自 git diff collector。
- `changedFiles` 仅包含 `pages-workspace/home/index.vue` 和 `tests/foundation.test.js`。
- Review Runner allowedPaths 审查通过。
- `run-state` 中 `TASK-001` 为 `done`，`loop-summary` 为 `complete`。

轻量后端场景：

```bash
node tools/e2e/run-real-demand-e2e.mjs --scenario backend-sql-migration-smoke
```

该场景复制 `backend-starter`，新增 `script/sql/engine_e2e_notice_tag.sql`，使用 `node -e` 静态断言 SQL 文件包含业务表和权限码。默认不运行 Maven、不启动后端、不连接数据库。

轻量中台场景：

```bash
node tools/e2e/run-real-demand-e2e.mjs --scenario middle-notice-page-smoke
```

该场景复制 `middle-starter`，新增公告标签 API 封装和页面文件，使用 `node -e` 静态断言 API 路径和权限码。默认不运行 pnpm install/build，不启动前端服务。

负向 review 场景：

```bash
node tools/e2e/run-real-demand-e2e.mjs --scenario client-review-violation
```

该场景会额外修改 allowedPaths 外的 `config/app-config.js`，预期 Review Runner 返回 `fail`，Run Loop 将任务标记为 `review_failed`。

保留临时目录便于排查：

```bash
node tools/e2e/run-real-demand-e2e.mjs --keep-tmp
```

真实 Codex CLI 不会被默认调用。如需人工 smoke，可显式传入：

```bash
node tools/e2e/run-real-demand-e2e.mjs \
  --adapter codex \
  --codex-command codex \
  --keep-tmp
```

Codex 模式依赖本机 Codex CLI 和模型实际执行结果，本轮默认稳定验收仍以 shell adapter 为准。

## 定位

这是一层轻量的引擎级冒烟和回归测试。它不替代后端、中台、客户端各自的实现测试；各端任务执行时仍应由对应 skill 内置接口连通性、权限、菜单、页面、类型检查等验证。
