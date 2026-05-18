# 后端接口连通性测试规范

## 目标

新增或修改后端接口后，除了编译通过，还需要验证接口路径、鉴权边界、菜单权限和错误路径。该测试规范服务于后端 skill、中台联调 skill 和 reviewer。

## 测试层级

### 1. 健康检查

确认服务可达：

```bash
curl -I http://127.0.0.1:8088/actuator/health
bash script/bin/backend-health-check.sh
```

`/actuator/health` 返回 `200/401/403` 都可以作为“服务可达”的证据，具体业务接口仍需单独测试。

### 2. 接口路径检查

对新增接口至少验证：

- 正确路径不是 `404`。
- 错误路径应返回 `404` 或框架约定错误，不应误命中其他接口。
- HTTP 方法正确，例如列表 `GET`、新增 `POST`、修改 `PUT`、删除 `DELETE`。

示例：

```bash
curl -i http://127.0.0.1:8088/system/config/list
curl -i http://127.0.0.1:8088/system/config/not-exists
```

### 3. 鉴权边界检查

受保护接口在未携带 token 时，应返回 `401`、`403` 或框架约定的未登录/无权限响应。不能因为联调方便而永久放开鉴权。

示例：

```bash
curl -i http://127.0.0.1:8088/system/config/list
```

如果为了验证业务逻辑需要临时关闭鉴权，必须满足：

1. 只在本地测试 profile 或临时 diff 中关闭。
2. 测试结束必须恢复。
3. `task-run.json` 记录关闭方式、恢复方式和恢复后的检查结果。
4. reviewer 必须确认最终提交没有留下绕过鉴权的配置或代码。

不要在正式代码中新增永久 `@SaIgnore`、扩大 `security.excludes` 或移除 `@SaCheckPermission` 来通过测试。

### 4. 菜单权限检查

新增后台管理功能时，应检查：

- `sys_menu` 是否存在菜单记录。
- `sys_menu` 是否存在按钮权限记录。
- `sys_menu.perms` 与 Controller `@SaCheckPermission` 一致。
- 中台按钮 `v-access:code` 与 `sys_menu.perms` 一致。

常见权限：

```text
<domain>:<resource>:list
<domain>:<resource>:query
<domain>:<resource>:add
<domain>:<resource>:edit
<domain>:<resource>:remove
<domain>:<resource>:export
```

### 5. 文档接口检查

`application.yml` 默认开启 `springdoc.api-docs.enabled`，并在 `security.excludes` 中放行 `/*/api-docs`。

可用时，优先通过接口文档确认新增接口是否被扫描：

```bash
curl -i http://127.0.0.1:8088/v3/api-docs
```

如果项目关闭 springdoc，应以 Controller 映射和 curl 结果作为证据。

## 推荐产物

后端任务完成后，建议在 feature 目录产出：

```text
contracts/backend-api.json
contracts/permission-manifest.json
reports/api-connectivity.md
```

`api-connectivity.md` 至少记录：

- 测试时间。
- 服务地址。
- 测试接口列表。
- 未登录状态结果。
- 临时关闭鉴权的方式和恢复证据。
- 404 错误路径测试结果。
- 菜单权限检查结果。

## Review Checklist

- 新增接口路径能访问且不返回 404。
- 错误路径不会误命中。
- 未登录访问受保护接口会返回未授权/无权限结果。
- 若临时关闭鉴权，最终 diff 已恢复。
- 菜单、按钮、Controller、中台权限码一致。
- 业务接口返回结构符合 `R<T>` 或 `TableDataInfo<T>`。
