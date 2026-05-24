# Skill: vben-table-form-page

## 任务边界

用于新增标准后台管理页：查询表单、表格、分页、新增、编辑、删除、导出和权限按钮。

适合：

- 中台 CRUD 管理页面。
- 标准列表、查询、弹窗表单。
- 与 RuoYi 后端菜单权限联动的页面。

不适合：

- 后端接口实现。
- 客户端页面实现。
- 路由来源不明确时直接硬编码菜单。

## 开始前先看

1. `apps/web-antd/src/views/system/config/index.vue`：列表页、工具栏、操作列模式。
2. `apps/web-antd/src/views/system/config/data.ts`：查询 schema、表格 columns、表单 schema。
3. `apps/web-antd/src/views/system/config/config-modal.vue`：弹窗新增/编辑模式。
4. `apps/web-antd/src/api/system/config/index.ts`：页面如何调用 API。
5. 权限清单或后端菜单 SQL：确认按钮权限码。

## 本地实现惯例

- 页面放在 `apps/web-antd/src/views/<domain>/<module>/`。
- 列表页使用 `Page`、`useVbenVxeGrid`。
- 弹窗使用 `useVbenModal`。
- 查询表单和表格 columns 放在 `data.ts`。
- 操作按钮使用 `v-access:code`。
- 删除操作使用确认弹窗。
- 导出使用 `useBlobExport`。

## 实现步骤

1. 确认 API client 已存在并能提供列表、详情、新增、修改、删除、导出等函数。
2. 确认页面所需权限码。
3. 新增页面目录，通常包含 `index.vue`、`data.ts`、`<module>-modal.vue`。
4. 在 `data.ts` 维护查询表单、表格 columns、弹窗表单。
5. 在 `index.vue` 实现列表、分页、工具栏、操作列。
6. 弹窗保存后 reload 表格。
7. 记录页面自查结果；如项目基线已确认干净，可选运行局部或全量类型检查。

## 不要做

- 不要新增一套表格或弹窗抽象。
- 不要把业务页面放进 `_core`。
- 不要绕过 `v-access:code`。
- 不要在页面里直接请求后端 URL。
- 不要在无后端 API 依据时自造字段。

## 跨端对齐

- 页面字段和后端 Vo/Bo、中台 API 类型一致。
- 按钮权限码和后端 `@SaCheckPermission`、`sys_menu.perms` 一致。
- 列表分页参数和后端 `PageQuery` 一致。
- 后端 401/403/404 不应被页面静默吞掉。

## 自查清单

- 页面结构参考现有系统页面模式。
- 表格 keyField 使用稳定主键。
- 查询、分页、重载、删除、批量删除、导出行为完整。
- 按钮权限码一致。
- 弹窗保存后能刷新列表。
- 页面结构、API 调用、权限码和交互自查通过；类型检查仅在项目基线已确认干净时作为补充检查。

## 何时停止猜测

- 菜单位置、按钮权限码、字段含义不明确。
- API client 缺失或后端接口尚未明确。
- 项目路由来源不明确，可能导致重复菜单。
