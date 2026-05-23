# Skill: ruoyi-base-bootstrap

## 任务边界

用于初始化或校验 RuoYi 后台基座的本地运行前置条件：MySQL、Redis、基础系统表、默认菜单角色用户、字典、客户端配置和本地 profile。

适合：

- 新项目第一次接入后台基座。
- 检查后台基座数据库是否已经导入。
- 修复缺失的基础系统表或默认数据。
- 生成项目级 `bootstrap-state.json`。

不适合：

- 新增业务功能表，这类使用 `ruoyi-database-migration`。
- 实现 Controller、Service、Mapper，这类使用 `ruoyi-module-crud`。
- 导入 job、workflow 或监控扩展 SQL，除非项目明确启用。
- 在通用模板里写入本地数据库或 Redis 密码。

## 开始前先看

1. `backend-starter/docs/database-baseline.md`：确认基础表和默认数据范围。
2. `backend-starter/docs/database-conventions.md`：确认菜单、权限、字典和审计字段约定。
3. `script/sql/ry_vue_5.X.sql`：默认基础 SQL。
4. `ruoyi-admin/src/main/resources/application-dev.yml`：本地 datasource 和 Redis 配置方式。
5. `starter.yaml`：模板裁剪和启动约束。

## 本地实现惯例

- 基座初始化只处理“能让后台基座跑起来”的系统数据。
- 默认导入 `script/sql/ry_vue_5.X.sql`，默认不导入 `ry_job.sql`、`ry_workflow.sql`。
- 初始化前先检查数据库是否已有核心系统表，避免重复导入污染已有项目。
- 本地数据库、Redis、账号密码来自 project overrides、环境变量、临时运行参数或本机配置。
- 初始化结果记录到项目运行目录的 `bootstrap-state.json`，不要写回模板默认配置。
- 如果基础表存在但字段残缺，优先标记 `needs_human`，不要猜测修复生产结构。

## 基础检查清单

至少检查这些表是否存在并可查询：

- `sys_user`
- `sys_role`
- `sys_user_role`
- `sys_menu`
- `sys_role_menu`
- `sys_dept`
- `sys_config`
- `sys_dict_type`
- `sys_dict_data`
- `sys_client`

至少检查这些基础数据：

- 默认超级管理员用户存在。
- 默认角色和用户角色关系存在。
- 系统管理、系统监控、系统工具等基础菜单存在。
- `sys_user_sex`、`sys_normal_disable`、`sys_yes_no`、`sys_common_status` 等基础字典存在。
- `sys_client` 中存在后台或密码登录所需客户端配置。

## 实现步骤

1. 确认目标数据库名、连接方式、Redis 连接方式和运行 profile。
2. 检查 MySQL 可连接；数据库不存在时创建数据库。
3. 检查 Redis 可连接；失败时记录为初始化失败。
4. 查询核心系统表；全部存在时进入数据校验。
5. 核心系统表缺失时，只有在人工确认或项目初始化场景下导入 `ry_vue_5.X.sql`。
6. 校验基础用户、角色、菜单、字典、客户端配置。
7. 记录导入脚本、连接目标、检查结果、异常项和人工确认信息。
8. 输出 `bootstrap-state.json`，供后续 Run Loop 预检查。

## 不要做

- 不要在基座初始化中创建业务功能表。
- 不要把业务菜单、按钮权限和基座菜单混在一起初始化。
- 不要重复导入基础 SQL 覆盖已有数据。
- 不要默认清空数据库。
- 不要把本地密码提交到仓库。
- 不要为了测试修改通用 `application-dev.yml` 并留下真实凭据。
- 不要在基础表字段不匹配时自行猜测升级脚本。

## 和功能任务的关系

- 基座初始化先于 PRD、任务拆分和 Run Loop。
- 功能任务只处理业务增量 SQL 和功能代码。
- 如果 Run Loop 发现基座未初始化，应把任务标记为 `needs_human` 或运行前置失败，而不是让功能 skill 自行导入基础库。
- `ruoyi-database-migration` 可以依赖 `bootstrap-state.json` 判断基础表是否可用，但不负责生成基座状态。

## 自查清单

- MySQL 连接成功。
- Redis 连接成功。
- 目标数据库存在。
- 核心系统表存在并可查询。
- 基础用户、角色、菜单、字典、客户端配置存在。
- 没有导入 job/workflow SQL，除非项目明确要求。
- 没有新增业务表。
- 没有提交真实密码。
- `bootstrap-state.json` 能说明初始化是否完成，以及失败原因。

## 何时停止猜测

- 目标数据库已有数据，但基础表版本和当前基座 SQL 不一致。
- 用户没有确认是否允许导入基础 SQL。
- Redis、MySQL 连接参数缺失或权限不足。
- 需要清空数据库或覆盖已有系统数据。
- 登录方式、客户端配置或默认账号策略不明确。
