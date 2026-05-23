# Skill: uniapp-api-client

## 任务边界

用于新增或调整客户端 API 封装，保证接口路径集中、请求统一、鉴权边界与后端契约一致。

适合：

- 客户端业务接口。
- 登录态相关接口。
- 列表、详情、提交、状态变更等页面调用。

不适合：

- 页面 UI 实现。
- Store 状态建模。
- 后端接口尚未明确时凭空造接口。

## 开始前先看

1. `config/endpoints.js`：接口路径集中管理方式。
2. `utils/request.js`：统一请求、响应解包、鉴权头、错误处理。
3. `api/workspace.js`：业务 API 封装示例。
4. `store/auth.js`：登录态处理。
5. 后端 API 路径和 401/403/404 行为说明。
6. `backend-api.json`：接口路径、方法、参数和响应结构。
7. `permission-manifest.json`：客户端涉及的权限或角色边界。

## 本地实现惯例

- API 路径统一放在 `config/endpoints.js`。
- API 函数放在 `api/<domain>.js`。
- 请求统一使用 `utils/request.js` 暴露的 `get/post` 等方法。
- 页面和 store 调用 API 函数，不直接请求后端。
- 鉴权头、baseUrl、响应解包由统一配置处理。
- 如果存在 `backend-api.json`，接口路径必须从契约核对后再写入 `config/endpoints.js`。
- 客户端不应出现后端管理端按钮权限码，除非 PRD 明确要求客户端展示权限态。

## 实现步骤

1. 确认接口路径、方法、参数和响应数据。
2. 对照 `backend-api.json`，确认正确路径不应返回 404。
3. 对照后端 401/403 测试记录，确认登录态和权限态处理。
4. 在 `config/endpoints.js` 添加路径常量。
5. 在 `api/<domain>.js` 封装请求函数。
6. 如果接口返回会影响全局状态，由调用方或 API 函数同步 store。
7. 检查未登录、无权限、错误路径的处理方式。
8. 运行 `npm test`。

## 不要做

- 不要在页面中直接调用 `uni.request`。
- 不要在页面或 store 中散落接口路径。
- 不要写死 baseUrl。
- 不要在已有后端契约时自造路径或 mock 路径。
- 不要忽略 401/403 鉴权结果。

## 跨端对齐

- API path 和后端 Controller 保持一致。
- API path 能追溯到 `backend-api.json`。
- 401/403 要触发客户端登录态或权限态处理。
- 后端返回字段要和页面展示、store 状态一致。

## 自查清单

- 接口路径全部来自 `config/endpoints.js`。
- 路径已和 `backend-api.json` 对齐。
- 请求走 `utils/request.js`。
- 页面只调用 API 函数。
- 401/403 处理符合登录态约定。
- API 返回影响状态时有 store 更新或调用方处理。

## 何时停止猜测

- 后端接口路径、鉴权规则、响应包结构不明确。
- 登录态过期后的跳转或清理策略不明确。
- 接口需要新增后端能力。
