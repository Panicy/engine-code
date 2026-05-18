# backend-starter 基础数据库摘要

来源：

```text
.engine/source-templates/backend-starter/script/sql/ry_vue_5.X.sql
```

## 初始化链路

- 最小依赖：MySQL、Redis。
- 默认导入：`ry_vue_5.X.sql`。
- 项目扩展：业务表 SQL、菜单权限 SQL。
- 默认不导入：job、workflow。

## 核心系统表分组

### 组织与用户

- `sys_dept`
- `sys_user`
- `sys_post`
- `sys_role`
- `sys_user_role`
- `sys_role_dept`
- `sys_user_post`

### 菜单与权限

- `sys_menu`
- `sys_role_menu`

### 字典与配置

- `sys_dict_type`
- `sys_dict_data`
- `sys_config`

### 日志与监控

- `sys_oper_log`
- `sys_logininfor`

### 文件与客户端

- `sys_oss`
- `sys_oss_config`
- `sys_client`

### 代码生成

- `gen_table`
- `gen_table_column`

### 其他

- `sys_social`
- `sys_notice`
- `test_demo`
- `test_tree`

## 关键权限数据

`sys_menu` 同时承载目录、菜单和按钮：

- 一级目录示例：系统管理、系统监控、系统工具。
- 二级菜单示例：用户管理、角色管理、菜单管理、参数设置、代码生成。
- 按钮权限示例：查询、新增、修改、删除、导出。

新增业务管理页时，通常需要：

1. 一个 `C` 类型菜单。
2. 多个 `F` 类型按钮权限。
3. 后端 Controller 权限注解。
4. 中台按钮 `v-access:code`。

## 字典初始类型

基础 SQL 预置：

- `sys_user_sex`
- `sys_show_hide`
- `sys_normal_disable`
- `sys_yes_no`
- `sys_notice_type`
- `sys_notice_status`
- `sys_oper_type`
- `sys_common_status`
- `sys_grant_type`
- `sys_device_type`

新增业务枚举时，优先复用已有字典；无法复用时新增业务字典。
