# 新功能数据库设计指南

本指南用于新功能建表或数据库变更。它不是数据库规范全集，而是帮助 agent 在拿到用户故事 task 后，先把数据库设计问题想清楚。

## 设计前先回答

1. 这是主表、关联表、明细表、日志表还是配置表？
2. 是否已有基础表可以复用，避免重复建模？
3. 是否需要唯一约束？
4. 是否需要状态字段？
5. 是否需要排序字段？
6. 是否需要逻辑删除？
7. 是否需要部门字段或数据权限？
8. 是否需要租户字段？
9. 是否需要初始化数据？
10. 是否需要菜单和按钮权限？
11. 是否需要字典或系统配置？
12. 是否涉及存量数据迁移？

任何一项无法从 PRD 或 task 判断，先停止猜测，要求补充。

## 表类型建议

### 主表

用于承载核心业务对象，例如客户、标签、活动、配置项。

常见字段：

```text
<resource>_id
name/title
status
create_dept
create_by
create_time
update_by
update_time
remark
```

是否加入 `del_flag` 取决于业务是否需要软删除。

### 关联表

用于多对多关系，例如用户与标签、角色与资源。

常见字段：

```text
left_id
right_id
create_time
```

通常需要联合唯一索引，避免重复关联。

### 明细表

用于主从结构，例如订单明细、规则项、流程节点。

常见字段：

```text
detail_id
main_id
sort
...
```

通常需要 `main_id` 索引。

### 日志表

用于记录操作轨迹或状态流转。

常见字段：

```text
log_id
biz_id
action
operator_id
operator_name
operate_time
remark
```

日志表通常不需要逻辑删除，但要考虑按时间查询索引。

### 配置表

优先判断是否可使用 `sys_config`。如果配置是强业务结构或需要复杂查询，才考虑独立业务表。

## 字段命名建议

- 主键使用业务资源名加 `_id`，例如 `tag_id`、`customer_id`。
- 状态字段常用 `status`，值通常对齐 `sys_normal_disable` 或业务字典。
- 排序字段常用 `sort`、`order_num`。
- 备注字段使用 `remark`。
- 删除标志使用 `del_flag`，通常 `0` 存在、`1` 删除。
- 时间字段使用 `datetime`。
- 用户/部门 ID 使用 `bigint(20)`。

## 索引建议

必须明确索引意图，不要机械加索引。

常见索引：

- 主键索引。
- 唯一业务键，例如编码、名称、第三方 openId。
- 列表高频查询条件。
- 外键式关联字段，例如 `customer_id`、`tag_id`。
- 时间范围查询字段。

联合索引要按查询条件顺序设计。关联表通常需要：

```sql
unique key uk_xxx_left_right (left_id, right_id)
key idx_xxx_right (right_id)
```

## 审计、逻辑删除、数据权限

不要默认把所有字段都塞进每张表。先按业务判断：

- 需要按创建部门过滤，考虑 `create_dept`。
- 需要记录创建/更新人，考虑 `create_by/update_by`。
- 需要软删除，考虑 `del_flag`。
- 需要数据权限，确认是否跟部门、创建者或租户相关。
- 需要租户隔离时，必须先确认项目租户策略。

如果 task 未说明数据权限或租户策略，不要自己决定。

## 菜单和按钮权限

后台管理功能通常需要：

1. `C` 类型菜单。
2. `F` 类型按钮权限。
3. 后端 `@SaCheckPermission`。
4. 中台 `v-access:code`。

权限码建议：

```text
<domain>:<resource>:list
<domain>:<resource>:query
<domain>:<resource>:add
<domain>:<resource>:edit
<domain>:<resource>:remove
<domain>:<resource>:export
```

菜单 SQL 必须明确父级菜单、排序、路由 path、组件 component。父级不明确时不要猜。

## 字典和系统配置

适合进入字典：

- 状态、类型、来源、等级等枚举值。
- 需要中台/客户端统一展示的枚举。

适合进入 `sys_config`：

- 运行时开关。
- 可由后台维护的项目配置。

不适合写入通用 SQL：

- 密钥。
- 第三方服务真实账号。
- 环境相关地址。

## SQL 文件建议

按功能拆分，避免污染基础 SQL：

```text
script/sql/<feature>-tables.sql
script/sql/<feature>-menu.sql
script/sql/<feature>-dict.sql
```

如果项目已有统一命名方式，跟随项目。

## 建表示例

```sql
create table biz_user_tag (
    tag_id       bigint(20)   not null                  comment '标签ID',
    tag_name     varchar(64)  not null                  comment '标签名称',
    tag_color    varchar(32)  default null              comment '标签颜色',
    status       char(1)      default '0'               comment '状态（0正常 1停用）',
    create_dept  bigint(20)   default null              comment '创建部门',
    create_by    bigint(20)   default null              comment '创建者',
    create_time  datetime                               comment '创建时间',
    update_by    bigint(20)   default null              comment '更新者',
    update_time  datetime                               comment '更新时间',
    remark       varchar(500) default null              comment '备注',
    primary key (tag_id),
    unique key uk_biz_user_tag_name (tag_name)
) engine=innodb comment = '用户标签表';
```

## 数据库自查

- 表名是否符合项目命名。
- 字段是否都有注释。
- 主键和唯一约束是否明确。
- 高频查询是否有必要索引。
- 审计、逻辑删除、数据权限字段是否有业务依据。
- 菜单权限 SQL 是否和后端/中台一致。
- 字典和配置是否放在正确位置。
- 是否避免了密钥、环境地址和测试表依赖。

## 测试建议

数据库变更后至少建议验证：

- SQL 可执行。
- 应用启动不因 Mapper 字段不一致失败。
- 新增接口正确路径不返回 404。
- 未登录访问受保护接口返回 401/403 或框架未授权响应。
- 新增菜单和按钮权限能被查询到。
- 中台页面使用的字典/权限码与 SQL 一致。
