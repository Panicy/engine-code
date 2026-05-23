# Real Project Runner

Real Project Runner 把真实项目验收流程固化成一个工具，避免每次依赖临时手工串联。

## 默认流程

```text
clone fixed bases
  -> create project.json
  -> backend base bootstrap
  -> run real demand smoke scenarios
  -> write real-project-report.json
```

固定基座：

- backend: `https://gitee.com/Panicy/backend-starter`
- middle: `https://gitee.com/Panicy/middle-starter`
- client: `https://gitee.com/Panicy/uniapp-template`

## 使用

```bash
MYSQL_PWD='romantic.' node tools/real-project-runner/run-real-project.mjs \
  --mysql-command /usr/local/mysql/bin/mysql \
  --mysql-user root \
  --mysql-password-env MYSQL_PWD \
  --database aitest \
  --redis-url redis://default:root123@127.0.0.1:6379
```

调试引擎本体时可以使用 source-template 模式，避免网络 clone：

```bash
node tools/real-project-runner/run-real-project.mjs \
  --clone-mode source-template \
  --skip-bootstrap
```

## 输出

runner 会在 `/private/tmp/engine-real-project-runner-*` 下生成：

- `project.json`
- `.engine/bootstrap-state/backend.json`
- `real-project-report.json`
- 三个固定基座 workspace

报告包含：

- 固定基座 remote。
- bootstrap 状态和检查。
- 每个真实需求 smoke 场景的 feature 目录、loop summary 和断言结果。

默认保留临时目录，便于审计和排查。
