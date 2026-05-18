# middle-starter 模板说明

## 定位

`middle-starter` 是基于 Vben Admin 5 的中台基座模板。当前主开发入口是 `apps/web-antd`，用于业务项目的管理后台。

## 技术与运行

- Vue 3、Vite、TypeScript。
- Pnpm Monorepo、Turborepo。
- 主应用：`apps/web-antd`。
- HTTP：`apps/web-antd/src/utils/http` 和 `alovaInstance`。
- 表格：`useVbenVxeGrid`。
- 弹窗表单：`useVbenModal`。
- 权限按钮：`v-access:code`。

推荐环境：

- Node `^20.19.0 || ^22.18.0 || ^24.0.0`
- pnpm `>=10.0.0`

推荐启动：

```bash
pnpm install
pnpm dev:antd
```

推荐检查：

```bash
pnpm -F @vben/web-antd run typecheck
pnpm lint
```

## 关键目录

```text
apps/web-antd/src/api/
apps/web-antd/src/views/
apps/web-antd/src/router/routes/modules/
apps/web-antd/src/components/
apps/web-antd/src/locales/
packages/
```

## 默认开发约束

- API 按业务域放在 `apps/web-antd/src/api/<domain>/<module>/`。
- API 调用使用 `alovaInstance`，导出下载使用 `commonExport`。
- 页面优先参考系统配置页模式：`index.vue`、`data.ts`、`*-modal.vue`。
- 表格页优先使用 `Page`、`useVbenVxeGrid`、`VbenFormProps`、`VxeGridProps`。
- 写操作按钮使用 `v-access:code` 绑定后端权限标识。
- 路由和菜单遵循 Vben 路由文件约定，业务路由放在 `src/router/routes/modules`。
- 不把业务页面放到 `_core`。

## Skill

- `vben-api-client`：新增或调整中台 API 封装。
- `vben-table-form-page`：新增列表、查询、弹窗表单、CRUD 页面。
- `vben-permission-route`：新增路由、菜单、按钮权限接入。
