# Skill: ruoyi-module-crud

## 任务边界

用于在 RuoYi 后端基座中实现一个标准管理对象：数据库表、Entity、Bo、Vo、Mapper、Service、Controller、菜单权限和基础接口。

适合：

- 基础 CRUD 管理对象。
- 列表查询、详情、新增、修改、删除、导出。
- 需要中台管理页面配套的后端接口。

不适合：

- 工作流、任务调度、复杂审批。
- 跨多个聚合根的大型业务流程。
- 中台页面或客户端页面实现。
- 只有 SQL 或菜单权限变更的任务，这类优先使用 `ruoyi-database-migration`。

## 开始前先看

1. `backend-starter/README.md`：确认模块边界、启动方式和默认裁剪范围。
2. `backend-starter/docs/database-conventions.md`：确认审计字段、菜单权限、字典和 SQL 约定。
3. `backend-starter/docs/api-connectivity-testing.md`：确认新增接口后的连通性测试方式。
4. `SysConfigController.java`：Controller、权限、日志、返回结构模式。
5. `SysConfigServiceImpl.java`：分页查询、唯一性校验、缓存和业务逻辑放置方式。
6. `SysConfigMapper.xml`：字段映射和自定义 SQL 写法。

参考路径：

```text
ruoyi-modules/ruoyi-system/src/main/java/org/dromara/system/controller/system/SysConfigController.java
ruoyi-modules/ruoyi-system/src/main/java/org/dromara/system/domain/SysConfig.java
ruoyi-modules/ruoyi-system/src/main/java/org/dromara/system/domain/bo/SysConfigBo.java
ruoyi-modules/ruoyi-system/src/main/java/org/dromara/system/domain/vo/SysConfigVo.java
ruoyi-modules/ruoyi-system/src/main/java/org/dromara/system/mapper/SysConfigMapper.java
ruoyi-modules/ruoyi-system/src/main/resources/mapper/system/SysConfigMapper.xml
ruoyi-modules/ruoyi-system/src/main/java/org/dromara/system/service/ISysConfigService.java
ruoyi-modules/ruoyi-system/src/main/java/org/dromara/system/service/impl/SysConfigServiceImpl.java
```

## 本地实现惯例

- Controller 使用 `R<T>`、`TableDataInfo<T>`、`PageQuery`。
- 列表查询优先使用 Bo 承载查询条件，Vo 承载返回字段。
- ServiceImpl 承载业务逻辑，Controller 只做参数接收、权限、日志和调用。
- 分页查询优先使用 `baseMapper.selectVoPage(pageQuery.build(), wrapper)`。
- Entity/Bo/Vo 字段要和 SQL、Mapper XML 保持一致。
- 写操作按场景添加 `@Log`、`@RepeatSubmit`。
- 受保护接口使用 `@SaCheckPermission`，权限码与菜单 SQL、中台按钮保持一致。

## 实现步骤

1. 确认实体名、表名、模块包名、接口前缀、权限标识、菜单归属。
2. 检查基础 SQL 或项目数据库快照，确认表和字段不冲突。
3. 新增或修改 `domain`、`domain/bo`、`domain/vo`。
4. 新增或修改 `mapper` 接口和 `resources/mapper/**/*.xml`。
5. 新增或修改 `service` 接口和 `service/impl` 实现。
6. 新增 Controller，列表、详情、新增、修改、删除、导出按本地惯例实现。
7. 补充业务表 SQL、菜单 SQL、按钮权限 SQL，必要时补充字典。
8. 建议同步记录 API 契约、权限清单和接口连通性测试结果，方便中台/客户端继续接入。

## 不要做

- 不要修改 starter 基础 SQL 来塞业务表。
- 不要依赖 `test_demo` 或 `test_tree` 作为正式业务模型。
- 不要为了测试永久添加 `@SaIgnore`、扩大 `security.excludes` 或移除 `@SaCheckPermission`。
- 不要把数据库、Redis、OSS 密码写入模板或通用 SQL。
- 不要在未确认情况下引入 job/workflow。
- 不要绕过 `R<T>`、`TableDataInfo<T>`、`PageQuery` 等框架约定。

## 跨端对齐

- 后端接口路径要能被中台 `api/<domain>/<module>` 直接封装。
- `@SaCheckPermission` 权限码要和 `sys_menu.perms`、中台 `v-access:code` 一致。
- 后端返回字段要和中台 TypeScript 类型、客户端展示字段对齐。
- 分页接口要和中台 `pageNum/pageSize` 查询参数对齐。

## 自查清单

- SQL、Entity、Bo、Vo、Mapper、XML 字段一致。
- Controller 权限完整，权限码符合 `<domain>:<resource>:<action>`。
- 列表接口分页参数和返回结构正确。
- 正确接口路径不返回 404，错误路径返回 404 或框架约定错误。
- 未登录访问受保护接口返回 401/403 或框架未授权响应。
- 若测试时临时关闭鉴权，最终 diff 已恢复。
- 后端编译通过。

## 何时停止猜测

- 菜单父级、按钮权限、租户策略、数据权限不明确。
- 需要引入新依赖、新中间件或 job/workflow。
- 需要破坏性修改已有接口。
- 需要临时关闭鉴权但项目没有明确测试方式。
