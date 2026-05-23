# 模板与 Skill 编写规范

## 目标

模板和 skill 的目标是把具体技术栈知识从引擎核心中隔离出来。skill 的本质作用是：当 agent 拿到一个已经拆好的 task 时，把它拉回到“这个代码基座里正确的实现方式”。

Skill 不是流程控制器、状态机或执行契约。执行调度、状态迁移、强制产物校验属于 task-plan、orchestrator 或运行期产物，不属于 skill。

基座初始化也不是普通功能开发。后台数据库、Redis、基础系统表、默认用户角色菜单等前置条件应由 `setup` 类型 skill 或后续 Base Bootstrap 工具处理；功能 skill 只负责用户故事里的业务增量。

## 目录约定

```text
.engine/templates/<templateId>/
  template.json
  README.md
  skills.json
  skills/
    <skill-id>.md
```

## 文件职责

### `template.json`

机器可读配置，包含：

- 模板 ID、类型、源仓库。
- 默认安装命令、启动命令、健康检查。
- 默认允许修改路径。
- 默认 checks。

### `README.md`

模板说明，给人和 agent 阅读，包含：

- 模板定位。
- 技术栈和运行方式。
- 关键目录。
- 默认开发约束。
- 允许改动和谨慎改动范围。
- 当前模板提供的 skill。

### `skills.json`

skill 注册表，包含：

- skill ID。
- 适用模板。
- 适用 task 类型和路径。
- 输入材料。
- 简要 workflow。
- quality gates。
- 详细手册路径说明。

### `skills/*.md`

具体执行手册，包含：

- 任务边界。
- 开始前先看。
- 本地实现惯例。
- 实现步骤。
- 不要做。
- 跨端对齐。
- 自查清单。
- 何时停止猜测。

推荐结构：

```text
# Skill: <skill-id>

## 任务边界
## 开始前先看
## 本地实现惯例
## 实现步骤
## 不要做
## 跨端对齐
## 自查清单
## 何时停止猜测
```

不建议在 skill 手册中使用强执行协议式标题，例如：

```text
Consumes
Produces
Failure Mapping
Planner Split Rules
```

这些概念可以在 task-plan 或执行器设计中出现，但 skill 中应保持为实现建议和边界提醒。

## Skill 加载顺序

执行器建议按以下顺序解析 skill：

1. 从 task 的 `targetBaseId` 找到 `project.json` 里的 `bases[].baseId`。
2. 读取该 base 的 `templateId`。
3. 加载 `.engine/templates/<templateId>/skills.json`。
4. 如果项目存在项目级 skill 注册表，再加载项目级 skill。
5. 项目级 skill 优先；如果声明 `extends`，则继承模板级 skill 的约束并追加项目规则。
6. 根据 `task.requiredSkillId` 找到最终执行手册。

## 异常状态规则

模板和 skill 不使用 `blocked`。skill 可以提醒 agent “何时停止猜测”，但不要承担状态迁移职责。执行时由引擎或人工根据情况标记：

- `checks_failed`：命令、构建、测试、类型检查失败。
- `review_failed`：实现不满足验收标准或模板规范。
- `needs_human`：范围变化、新依赖、权限归属、菜单归属、接口契约不清楚等需要人判断。

## 测试写法

测试意识应内置在开发 skill 的“自查清单”中，而不是一开始把每个测试点都拆成独立 skill。

推荐：

- 后端 skill 写清楚接口路径、401/403、404、菜单权限、SQL 与代码一致性。
- 中台 skill 写清楚 typecheck、页面请求、权限按钮、错误态。
- 客户端 skill 写清楚统一 request、登录态过期、权限态清理、平台兼容。

可以单独成 skill 的测试场景：

- 用户故事级验收。
- 跨端回归审查。
- 专门的测试证据 audit。
- 后台接口连通性、菜单权限、401/403/404 和鉴权恢复。

不建议：

- 为每个普通开发 task 都拆一个测试 task。
- 把测试 skill 写成执行器状态机。
- 用测试 skill 替代开发 skill 的自查意识。

## 当前第一批 Skill

后端：

- `ruoyi-base-bootstrap`
- `ruoyi-module-crud`
- `ruoyi-api-change`
- `ruoyi-database-migration`
- `ruoyi-api-connectivity-test`

中台：

- `vben-api-client`
- `vben-table-form-page`
- `vben-permission-route`

客户端：

- `uniapp-api-client`
- `uniapp-page-flow`
- `uniapp-store-module`

## 参考来源

- 后端模板代码：`https://gitee.com/Panicy/backend-starter`
- 中台模板代码：`https://gitee.com/Panicy/middle-starter`
- 客户端模板代码：`https://gitee.com/Panicy/uniapp-template`
- RuoYi-Vue-Plus 初始化文档：`https://plus-doc.top/#/ruoyi-vue-plus/quickstart/init`
- Vben Admin 文档：`https://doc.vben.pro/guide/introduction/vben.html`
- Vben 本地开发：`https://doc.vben.pro/guide/essentials/development.html`
- Vben 路由和菜单：`https://doc.vben.pro/guide/essentials/route.html`
- Vben 目录说明：`https://doc.vben.pro/guide/project/dir.html`
