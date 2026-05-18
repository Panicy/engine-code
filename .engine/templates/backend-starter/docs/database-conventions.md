# backend-starter 数据库约定

## 初始化顺序

根据 starter 的 `docs/LOCAL_SETUP.md`，默认初始化顺序为：

1. 导入 `script/sql/ry_vue_5.X.sql`
2. 导入项目业务表 SQL
3. 导入项目菜单权限 SQL

默认不导入：

- `ry_job.sql`
- `ry_workflow.sql`

默认不启用：

- `ruoyi-job`
- `ruoyi-workflow`
- `ruoyi-snailjob-server`

## 基础 SQL 文件

MySQL 基础 SQL：

```text
script/sql/ry_vue_5.X.sql
```

其他数据库方言存在于：

```text
script/sql/oracle/
script/sql/postgres/
script/sql/sqlserver/
```

第一版 skill 默认以 MySQL SQL 为准；如果项目选择 Oracle/Postgres/SQLServer，应在 task 或 project overrides 中明确。

## 基础表

`ry_vue_5.X.sql` 当前包含：

| 表名 | 说明 |
| --- | --- |
| `sys_social` | 第三方平台授权关系 |
| `sys_dept` | 部门 |
| `sys_user` | 用户 |
| `sys_post` | 岗位 |
| `sys_role` | 角色 |
| `sys_menu` | 菜单与按钮权限 |
| `sys_user_role` | 用户角色关联 |
| `sys_role_menu` | 角色菜单关联 |
| `sys_role_dept` | 角色部门关联 |
| `sys_user_post` | 用户岗位关联 |
| `sys_oper_log` | 操作日志 |
| `sys_dict_type` | 字典类型 |
| `sys_dict_data` | 字典数据 |
| `sys_config` | 参数配置 |
| `sys_logininfor` | 登录日志 |
| `sys_notice` | 通知公告 |
| `gen_table` | 代码生成业务表 |
| `gen_table_column` | 代码生成业务字段 |
| `sys_oss` | OSS 文件 |
| `sys_oss_config` | OSS 配置 |
| `sys_client` | OAuth 客户端 |
| `test_demo` | 上游测试单表，不作为新业务依赖 |
| `test_tree` | 上游测试树表，不作为新业务依赖 |

## 通用字段约定

常见业务表优先沿用以下字段：

| 字段 | 含义 |
| --- | --- |
| `create_dept` | 创建部门 |
| `create_by` | 创建者 |
| `create_time` | 创建时间 |
| `update_by` | 更新者 |
| `update_time` | 更新时间 |
| `del_flag` | 删除标志，通常 `0` 存在、`1` 删除 |
| `remark` | 备注 |

是否需要这些字段由业务对象决定。若 task 未说明是否需要租户、部门、数据权限或逻辑删除，应标记 `needs_human` 或在 task-plan 中补充。

## 菜单权限约定

`sys_menu.menu_type`：

- `M`：目录
- `C`：菜单
- `F`：按钮

权限标识放在 `sys_menu.perms`，后端接口使用 `@SaCheckPermission`，中台按钮使用 `v-access:code`。三处必须一致。

常见权限命名：

```text
<domain>:<resource>:list
<domain>:<resource>:query
<domain>:<resource>:add
<domain>:<resource>:edit
<domain>:<resource>:remove
<domain>:<resource>:export
```

示例：

```text
system:config:list
system:config:query
system:config:add
system:config:edit
system:config:remove
system:config:export
```

新增菜单 SQL 时应明确：

- 父级菜单 ID
- 菜单标题
- 路由 path
- 组件 component
- 按钮权限
- 角色授权策略

若父级菜单、排序或角色授权策略不明确，标记 `needs_human`。

## 字典约定

字典由两张表组成：

- `sys_dict_type`
- `sys_dict_data`

新增枚举字段时优先判断是否应进入字典。若进入字典，需要同步：

- 后端字段和校验
- SQL 初始化
- 中台字典引用
- 客户端枚举展示

## 参数配置约定

系统配置放在 `sys_config`。内置配置 `config_type = 'Y'`，普通项目配置通常为 `N`。

涉及运行时开关、项目级策略、第三方服务参数时，优先判断是否使用 `sys_config`。如果涉及密钥或敏感值，不应写入通用初始化 SQL。

## SQL 与代码一致性

后端 CRUD 或数据库迁移必须保持一致：

```text
SQL table/columns
  -> Entity
  -> Bo
  -> Vo
  -> Mapper interface
  -> Mapper XML
  -> Service
  -> Controller
  -> 中台 API 类型
```

review 时至少检查：

- SQL 字段是否和实体字段一致。
- 查询条件是否和 Bo/Mapper wrapper 一致。
- 返回字段是否和 Vo/中台类型一致。
- 权限 SQL、`@SaCheckPermission`、`v-access:code` 是否一致。

## 测试表说明

基础 SQL 中仍包含上游 `test_demo`、`test_tree`。它们只作为上游测试参考，不作为新项目业务功能依赖。新增业务功能不得把测试表作为正式模型。
