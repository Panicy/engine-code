# Skill: vben-permission-route

## 任务边界

用于新增中台业务路由、菜单展示和按钮权限接入，并与后端 `sys_menu` 和 `@SaCheckPermission` 保持一致。

适合：

- 新增业务页面路由。
- 接入后端菜单权限。
- 调整按钮权限显示。

不适合：

- 页面主体实现。
- 后端菜单 SQL 未明确时自行决定菜单父级。

## 开始前先看

1. 项目路由策略：静态路由、动态后端菜单或混合模式。
2. `apps/web-antd/src/router/routes/modules`：静态业务路由模式。
3. 后端 `sys_menu` SQL：菜单 path、component、perms。
4. 页面组件路径：确认组件真实存在。
5. 现有页面按钮：确认 `v-access:code` 使用方式。

## 本地实现惯例

- 业务路由放在 `apps/web-antd/src/router/routes/modules`。
- 业务页面放在 `apps/web-antd/src/views/<domain>/<module>/`。
- 后端菜单驱动路由时，中台不要重复硬编码同一菜单。
- 静态路由驱动时，路由 meta 至少包含 `title`，按项目约定补充 `icon`、`order`、`authority`。
- 页面按钮权限使用 `v-access:code`。

## 实现步骤

1. 先确认项目路由来源。
2. 如果后端菜单驱动路由，重点检查组件路径和权限按钮。
3. 如果静态路由驱动，在 `router/routes/modules` 新增或扩展业务路由。
4. 配置标题、图标、排序和权限。
5. 同步页面按钮的 `v-access:code`。
6. 和后端菜单 SQL、Controller 权限码核对。

## 不要做

- 不要把业务路由放进 `_core`。
- 不要在后端动态菜单模式下重复硬编码造成双菜单。
- 不要使用与后端不一致的权限码。
- 不要凭空决定菜单父级、排序和图标。

## 跨端对齐

- `sys_menu.component` 要能对应中台页面组件路径。
- `sys_menu.perms` 要和页面 `v-access:code` 一致。
- 路由 path 要和菜单 path、中台页面路径形成清晰映射。

## 自查清单

- 路由来源判断清楚。
- 路由路径、组件路径、菜单标题一致。
- 菜单不会重复显示。
- 权限码跨后端和中台一致。

## 何时停止猜测

- 菜单父级、排序、图标、路由来源或权限策略未确认。
- 后端菜单 SQL 和中台路由模式冲突。
