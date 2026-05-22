# PRD Builder

PRD Builder 用于生成 `prd.json` 草稿。它只负责把需求输入整理成符合契约的 PRD 初稿，不负责人工确认，也不直接生成任务拆分。

## 当前能力

- 生成符合 `schemas/prd.schema.json` 的 PRD 草稿。
- 默认状态为 `draft`。
- 默认 `humanApproval.approved = false`。
- 支持指定 feature、名称、摘要、影响子项目。
- 支持读取 `project.json` 校验 base 并推导技术栈。
- 支持从 `stories.json` 输入多个用户故事。
- 支持从 `requirements.json` 输入更完整需求，填充 PRD schema 现有字段。
- 生成一个基础用户故事和验收标准。
- 默认拒绝覆盖已有 PRD，避免误覆盖人工确认产物。

## 使用方式

```bash
node tools/prd-builder/create-prd.mjs \
  --feature-id user-tags \
  --name 用户标签 \
  --summary "支持管理员维护用户标签" \
  --project .engine/projects/demo-project/project.json \
  --bases backend,middle,client \
  --out .engine/projects/demo-project/features/user-tags/prd.json
```

可选参数：

```bash
--prd-id PRD-USER-TAGS
--requirements-file requirements.json
--stories-file stories.json
--story-title 管理员维护用户标签
--story "作为管理员，我希望新增、编辑、删除和查询用户标签，以便对用户进行分类管理。"
--goal "管理员可以维护用户标签。"
--non-goal "不实现自动标签推荐算法。"
--priority must
--force
```

`stories.json` 示例：

```json
[
  {
    "id": "US-001",
    "title": "管理员维护用户标签",
    "story": "作为管理员，我希望新增、编辑、删除和查询用户标签，以便对用户进行分类管理。",
    "priority": "must",
    "acceptanceCriteria": [
      {
        "id": "AC-001",
        "text": "管理员可以新增用户标签。",
        "verification": "通过中台页面提交新增表单，并确认后端返回成功。"
      }
    ],
    "dependencies": []
  }
]
```

`requirements.json` 可填充：

- `impactedBaseIds`
- `goals` / `nonGoals`
- `personas`
- `userStories` 或 `stories`
- `businessRules`
- `dataEntities`
- `permissions`
- `assumptions`
- `openQuestions`
- `risks`
- `constraints.security` / `ux` / `performance` / `quality`

缺少 ID 时会自动补齐稳定 ID，例如 `US-001`、`AC-001`、`BR-001`、`DE-001`、`PERM-001`、`ASM-001`、`Q-001`、`RISK-001`。`requirements.json` 中的必填文本字段会在生成前校验，例如 `userStories[].story`、`dataEntities[].fields[].type`、`permissions[].code`、`openQuestions[].question` 缺失时会直接失败并提示字段位置。`permissions[].targetBaseId` 必须存在于 `project.bases` 或 PRD 的 `impactedBaseIds` 中，否则生成失败。

最小示例：

```json
{
  "impactedBaseIds": ["backend", "middle", "client"],
  "goals": ["管理员可以维护用户标签。"],
  "userStories": [
    {
      "title": "管理员维护用户标签",
      "story": "作为管理员，我希望新增、编辑、删除和查询用户标签，以便对用户进行分类管理。",
      "priority": "must",
      "acceptanceCriteria": [
        {
          "text": "管理员可以新增用户标签。",
          "verification": "通过后端接口和中台页面验证新增成功。"
        }
      ]
    }
  ],
  "businessRules": ["同一租户下标签名称不可重复。"],
  "dataEntities": [
    {
      "name": "用户标签",
      "description": "用于给用户分组。",
      "fields": [
        { "name": "tagName", "type": "string", "required": true, "description": "标签名称" }
      ]
    }
  ],
  "permissions": [
    { "code": "system:userTag:list", "name": "用户标签查询", "targetBaseId": "backend" }
  ],
  "assumptions": ["一期只支持后台维护标签。"],
  "openQuestions": [{ "question": "是否需要批量导入标签？", "status": "open" }],
  "risks": [{ "description": "历史用户没有标签。", "mitigation": "上线前提供默认标签兜底。" }],
  "constraints": {
    "security": ["接口必须保留权限码。"],
    "ux": ["中台页面沿用现有表格表单模式。"],
    "performance": ["列表查询必须分页。"],
    "quality": ["必须验证 401/403/404。"]
  }
}
```

## 输出原则

- PRD Builder 只生成草稿。
- 人工确认必须显式修改 `status` 和 `humanApproval`。
- 推荐使用 `approve-prd.mjs` 标准化人工确认动作。
- PRD 未确认时，Validator 会阻止进入 Run Loop。

## 人工确认

```bash
node tools/prd-builder/approve-prd.mjs \
  --prd .engine/projects/demo-project/features/user-tags/prd.json \
  --by xilanli \
  --notes "PRD 已确认"
```

如果 PRD 存在 `openQuestions[].status = open`，默认拒绝确认。确实允许带问题确认时，显式增加：

```bash
--allow-open-questions
```

## 后续增强

- 支持从需求草稿 Markdown 生成 PRD。
- 支持基于模板的约束补全。
- 支持接入 LLM 辅助整理 requirements 草稿。
