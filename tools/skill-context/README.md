# Skill Context

Skill Context 负责把单个 task 执行所需材料装配成稳定上下文包，供 Agent Adapter 使用。

## 输入

- `project.json`
- `prd.json`
- `task-plan.json`
- `taskId`
- `.engine/templates/<templateId>/template.json`
- `.engine/templates/<templateId>/skills.json`
- 对应 `skills/*.md` 文档

## 输出内容

- 项目与目标 base 信息。
- 模板信息、默认 allowed paths 和默认 checks。
- 与 task 相关的 PRD 切片。
- task 全量定义。
- skill 注册信息和 markdown 文档全文。
- allowedPaths、checks、retryPolicy、contextBudget 等执行提示。

## 使用方式

```bash
node tools/skill-context/build-task-context.mjs \
  --project .engine/json/examples/project.json \
  --prd /tmp/feature/prd.json \
  --task-plan /tmp/feature/task-plan.json \
  --task-id TASK-001 \
  --out /tmp/feature/runs/TASK-001/task-context.json
```

## 边界

- 不执行任务。
- 不修改业务代码。
- 不替代 PRD 和 task-plan 的人工确认。
- 不做模型 prompt 风格优化，只负责材料完整、路径明确、引用可追踪。
