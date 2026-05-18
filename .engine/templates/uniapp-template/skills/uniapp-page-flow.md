# Skill: uniapp-page-flow

## 任务边界

用于新增客户端页面、分包页面、列表/详情/表单/状态流转页面，并接入统一 API、状态和路由守卫。

适合：

- 主包页面。
- 分包页面。
- 工作区业务页面。
- 列表、详情、表单、操作流。

不适合：

- 后端接口实现。
- 长期共享状态建模，这类优先使用 `uniapp-store-module`。
- API 封装缺失时直接在页面里请求后端。

## 开始前先看

1. `pages.json`：页面注册和分包配置。
2. `config/routes.js`：项目路由配置。
3. `utils/router.js`：导航封装。
4. `utils/route-guard.js`：登录态和权限守卫。
5. `pages-workspace/item-list/index.vue`：工作区页面示例。
6. `api/workspace.js` 和 `store/workspace.js`：页面如何接 API 和状态。

## 本地实现惯例

- 主包页面放 `pages/`。
- 通用分包页面放 `pages-sub/`。
- 工作区业务页面放 `pages-workspace/`。
- 初始化参数优先在 `onLoad` 处理。
- 可见态刷新优先在 `onShow` 处理。
- 页面数据通过 `api` 和 `store` 获取。
- 跨页面状态进入 Pinia store。
- 导航和权限走统一 router/guard。
- 样式使用 rpx 等 UniApp 兼容写法。

## 实现步骤

1. 确认页面归属和目标平台。
2. 新增页面目录和 `index.vue`。
3. 在 `pages.json` 或项目路由配置中登记页面。
4. 接入 API 和 store。
5. 补齐 loading、空态、错误态、权限态。
6. 处理登录过期、无权限和接口错误。
7. 运行 `npm test`。

## 不要做

- 不要直接拼接 URL。
- 不要直接 `uni.request`。
- 不要在页面局部变量中维护全局登录态、权限态或工作区态。
- 不要绕过 `utils/router.js` 和 `utils/route-guard.js` 做权限导航。
- 不要把 H5 特有 API 当作小程序/App 通用能力。

## 跨端对齐

- 页面接口路径和后端 Controller、中台 API 语义一致。
- 401/403 要触发正确登录态或权限态处理。
- 状态字段和后端返回字段一致。

## 自查清单

- 页面归属和分包策略合理。
- 页面没有直接请求后端。
- 跨页面状态进入 Pinia store。
- loading、空态、错误态、权限态齐全。
- 生命周期使用不过载。
- 样式兼容 UniApp 目标平台。

## 何时停止猜测

- 页面分包归属、目标平台、权限边界或登录态策略不明确。
- 后端接口或 API 封装缺失。
- 页面需要新的跨页面状态但 store 设计未确认。
