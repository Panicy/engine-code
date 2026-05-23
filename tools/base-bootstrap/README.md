# Base Bootstrap

Base Bootstrap 负责在功能开发前校验项目子基座是否可用。它不是功能任务执行器，不新增业务表，不修改业务代码。

## 后台基座

```bash
MYSQL_PWD='romantic.' node tools/base-bootstrap/bootstrap-backend.mjs \
  --project-id aitest-project \
  --base-id backend \
  --workspace /path/to/backend \
  --database aitest \
  --out /path/to/project/.engine/bootstrap-state/backend.json \
  --mysql-command /usr/local/mysql/bin/mysql \
  --mysql-user root \
  --mysql-password-env MYSQL_PWD \
  --redis-url redis://default:root123@127.0.0.1:6379 \
  --allow-import
```

## 状态策略

- 空库：默认返回 `needs_human`，只有显式 `--allow-import` 才导入 `script/sql/ry_vue_5.X.sql`。
- 完整库：核心系统表存在，输出 `state=ready`。
- 残缺库：存在部分核心表但不完整，输出 `state=needs_human`，不自动导入基础 SQL。

## 输出

输出文件符合 `schemas/bootstrap-state.schema.json`，可作为后续 Run Loop 的前置材料。

核心检查包括：

- MySQL 连接和目标数据库。
- Redis PING。
- `script/sql/ry_vue_5.X.sql` 是否存在。
- `sys_user`、`sys_menu`、`sys_role`、`sys_config`、`sys_dict_type` 等核心表。
