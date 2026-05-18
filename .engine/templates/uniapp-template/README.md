# uniapp-template 模板说明

## 定位

`uniapp-template` 是客户端基座模板，用于 H5、小程序或 App 的轻量业务客户端。

## 当前基座能力

- 请求：`utils/request.js`
- 配置：`config/app-config.js`、`config/endpoints.js`
- 状态：Pinia，入口在 `store/pinia.js`
- 业务状态：`store/auth.js`、`store/workspace.js`、`store/app.js`
- 页面：`pages/`、`pages-sub/`、`pages-workspace/`
- API：`api/`
- 类型：`types/`
- 路由与守卫：`config/routes.js`、`utils/route-guard.js`、`utils/router.js`

## 默认开发约束

- 页面层禁止直接写 `uni.request`。
- 页面层禁止直接拼接后端 URL。
- API 路径统一放在 `config/endpoints.js`。
- 请求统一走 `utils/request.js`。
- 跨页面共享状态放在 Pinia store。
- 登录态、权限态、工作区态不要散落在页面组件里。

## 默认检查

```bash
npm test
```

## Skill

- `uniapp-api-client`：新增或调整客户端 API。
- `uniapp-page-flow`：新增页面和页面交互流程。
- `uniapp-store-module`：新增或调整 Pinia 状态模块。
