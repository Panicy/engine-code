# backend-starter 模板说明

## 定位

`backend-starter` 是基于 `RuoYi-Vue-Plus-Single` 收敛出的后端基座模板。它用于业务项目的后端子项目，不是引擎本体的一部分。

## 技术与运行

- Java / Spring Boot / Maven 多模块。
- 主应用：`ruoyi-admin`。
- 默认业务模块：`ruoyi-modules/ruoyi-system`。
- 默认保留公共模块：`ruoyi-common/*`。
- 默认保留代码生成：`ruoyi-modules/ruoyi-generator`。
- 默认不把 `job`、`workflow`、`demo` 作为 starter 能力。

推荐启动：

```bash
mvn -pl ruoyi-admin spring-boot:run -Dspring-boot.run.profiles=dev
```

推荐健康检查：

```bash
curl http://127.0.0.1:8088/actuator/health
bash script/bin/backend-health-check.sh
```

## 关键目录

```text
ruoyi-admin/
  src/main/resources/application-dev.yml
  src/main/resources/application-dev.template.yml
ruoyi-modules/
  ruoyi-system/
    src/main/java/org/dromara/system/controller/
    src/main/java/org/dromara/system/domain/
    src/main/java/org/dromara/system/domain/bo/
    src/main/java/org/dromara/system/domain/vo/
    src/main/java/org/dromara/system/mapper/
    src/main/java/org/dromara/system/service/
    src/main/java/org/dromara/system/service/impl/
    src/main/resources/mapper/
script/sql/
```

## 默认开发约束

- Controller 使用 `R<T>`、`TableDataInfo<T>`、`PageQuery` 等框架返回结构。
- 需要权限控制的接口使用 `@SaCheckPermission`。
- 写操作优先配合 `@Log` 和 `@RepeatSubmit`。
- 查询条件优先使用 `Bo`，返回对象优先使用 `Vo`。
- 分页查询优先使用 `baseMapper.selectVoPage(pageQuery.build(), wrapper)`。
- 实体转换优先使用 `MapstructUtils.convert`。
- SQL 初始化顺序优先保持为基础 SQL、业务表 SQL、菜单权限 SQL。
- 不把其他项目的数据库、Redis、OSS 密码写回模板。

## 默认允许改动

- `ruoyi-modules/**`
- `ruoyi-admin/**`
- `ruoyi-common/**`
- `script/sql/**`

## 谨慎改动

- 根 `pom.xml` 和公共 BOM。
- `ruoyi-common` 内的跨项目公共能力。
- 登录、鉴权、租户、数据权限等横切逻辑。

## Skill

- `ruoyi-module-crud`：新增或扩展基础 CRUD 模块。
- `ruoyi-api-change`：调整已有接口或服务逻辑。
- `ruoyi-database-migration`：新增业务表、字段、菜单权限 SQL。
- `ruoyi-permission-menu`：补齐权限标识和菜单数据。

## 数据库文档

- `docs/database-conventions.md`：数据库、菜单权限、字典、SQL 与代码一致性约定。
- `docs/database-baseline.md`：从 `script/sql/ry_vue_5.X.sql` 抽取的基础库摘要。
- `docs/new-feature-database-design.md`：新功能建表决策清单和示例。
