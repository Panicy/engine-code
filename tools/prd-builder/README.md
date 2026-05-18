# PRD Builder

PRD Builder 用于生成 `prd.json` 草稿。它只负责把需求输入整理成符合契约的 PRD 初稿，不负责人工确认，也不直接生成任务拆分。

## 当前能力

- 生成符合 `schemas/prd.schema.json` 的 PRD 草稿。
- 默认状态为 `draft`。
- 默认 `humanApproval.approved = false`。
- 支持指定 feature、名称、摘要、影响子项目。
- 生成一个基础用户故事和验收标准。

## 使用方式

```bash
node tools/prd-builder/create-prd.mjs \
  --feature-id user-tags \
  --name 用户标签 \
  --summary "支持管理员维护用户标签" \
  --bases backend,middle,client \
  --out .engine/projects/demo-project/features/user-tags/prd.json
```

可选参数：

```bash
--prd-id PRD-USER-TAGS
--story-title 管理员维护用户标签
--story "作为管理员，我希望新增、编辑、删除和查询用户标签，以便对用户进行分类管理。"
--goal "管理员可以维护用户标签。"
--non-goal "不实现自动标签推荐算法。"
--priority must
```

## 输出原则

- PRD Builder 只生成草稿。
- 人工确认必须显式修改 `status` 和 `humanApproval`。
- PRD 未确认时，Validator 会阻止进入 Run Loop。

## 后续增强

- 支持从需求草稿 Markdown 生成 PRD。
- 支持多用户故事输入。
- 支持基于模板的约束补全。
- 支持接入 LLM 生成更完整的 goals、nonGoals、risks。
