# Skill: vben-api-client

## 任务边界

用于在中台基座中新增或调整 API 封装，让页面通过统一请求层访问后端。

适合：

- 新增 API 模块。
- 调整已有 API 参数或返回类型。
- 为中台页面接入后端 CRUD 接口。

不适合：

- 页面 UI 实现，这类使用 `vben-table-form-page`。
- 路由和菜单接入，这类使用 `vben-permission-route`。
- 后端接口尚未明确时凭空造接口。

## 开始前先看

1. 后端 API 契约或 Controller：确认路径、方法、参数和返回结构。
2. 后端接口连通性记录：确认正确路径不是 404，受保护接口有 401/403 边界。
3. `apps/web-antd/src/api/system/config/index.ts`：API 函数组织方式。
4. `apps/web-antd/src/api/system/config/model.d.ts`：类型定义方式。
5. `apps/web-antd/src/utils/http`：统一请求层。

## 本地实现惯例

- API 按业务域放在 `apps/web-antd/src/api/<domain>/<module>/`。
- `index.ts` 放请求函数，`model.d.ts` 放类型。
- 使用 `alovaInstance.get/postWithMsg/putWithMsg/deleteWithMsg`。
- 导出下载使用 `commonExport`。
- 页面只 import API 函数，不直接写 URL。
- 分页接口参数与后端 `PageQuery` 对齐。

## 实现步骤

1. 确认后端路径、HTTP 方法、请求参数和响应类型。
2. 新建或更新 API 目录。
3. 编写 `model.d.ts`，优先和后端 Vo/Bo 字段保持一致。
4. 编写 `index.ts` 请求函数。
5. 如有导出，使用 `commonExport`。
6. 同步页面调用方。
7. 运行 typecheck。

## 不要做

- 不要在页面里直接拼接接口 URL。
- 不要绕过 `alovaInstance`。
- 不要在没有后端接口依据时自造接口。
- 不要忽略后端 401/403/404 测试结果。

## 跨端对齐

- API 路径、方法和后端 Controller 保持一致。
- TypeScript 类型和后端 Vo/Bo 对齐。
- 权限相关接口要和后端权限码、中台按钮权限一致。
- 401/403 不应被页面吞掉，应按项目统一错误处理策略走。

## 自查清单

- API 路径集中在 API 模块内。
- 页面没有直接写 URL。
- 请求方法和后端一致。
- 分页参数、详情参数、删除参数类型明确。
- 类型检查通过。

## 何时停止猜测

- 后端接口路径、返回结构、鉴权规则不明确。
- 接口连通性没有验证，且 task 要求联调。
- 需要改后端接口才能满足页面需求。
