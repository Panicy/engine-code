# JSON 示例与中文注释

本文件使用 JSONC 风格展示示例，因此包含 `//` 注释。实际落盘给引擎读取的 `.json` 文件不要包含注释，中文说明应放在文档或 schema 的 `description` 字段中。

## `workspace.json`

```jsonc
{
  "schemaVersion": "0.1.0",
  "workspaceId": "senke-engine-workspace",
  "name": "森可 AI 开发引擎工作区",
  "templates": [
    {
      // 模板只登记路径，具体技术栈知识在 template.json 和 skills.json
      "templateId": "backend-starter",
      "templatePath": ".engine/templates/backend-starter/template.json",
      "status": "active"
    },
    {
      "templateId": "middle-starter",
      "templatePath": ".engine/templates/middle-starter/template.json",
      "status": "active"
    },
    {
      "templateId": "uniapp-template",
      "templatePath": ".engine/templates/uniapp-template/template.json",
      "status": "active"
    }
  ],
  "projects": [
    {
      // 一个 workspace 可以管理多个业务项目
      "projectId": "crm-system",
      "projectPath": ".engine/projects/crm-system/project.json",
      "status": "active"
    }
  ],
  "defaults": {
    "maxTaskAttempts": 3
  }
}
```

## `templates/backend-starter/template.json`

```jsonc
{
  "schemaVersion": "0.1.0",
  "templateId": "backend-starter",
  "name": "RuoYi 后端基座模板",
  "type": "backend",
  "sourceRepo": "https://gitee.com/Panicy/backend-starter",
  "defaultBranch": "master",
  "workspaceDefaults": {
    "installCommands": [],
    "devCommands": [
      "mvn -pl ruoyi-admin spring-boot:run -Dspring-boot.run.profiles=dev"
    ],
    "healthChecks": [
      {
        "id": "backend-health",
        "type": "http",
        "target": "http://127.0.0.1:8088/actuator/health"
      }
    ]
  },
  "pathPolicy": {
    // 目录规则属于模板，不属于引擎
    "defaultAllowedPaths": [
      "ruoyi-admin/**",
      "ruoyi-modules/**",
      "ruoyi-common/**",
      "script/sql/**"
    ]
  },
  "defaultChecks": [
    {
      "id": "backend-build",
      "name": "后端编译",
      "type": "build",
      "command": "mvn -pl ruoyi-admin -am test -DskipTests",
      "required": true
    }
  ]
}
```

## `projects/crm-system/project.json`

```jsonc
{
  "schemaVersion": "0.1.0",
  "projectId": "crm-system",
  "name": "CRM 系统",
  "description": "示例业务项目",
  "status": "active",
  "bases": [
    {
      // baseId 是项目内子项目 ID，task.targetBaseId 引用它
      "baseId": "backend",
      // templateId 指向模板，模板承载具体技术栈知识
      "templateId": "backend-starter",
      "repo": "https://gitee.com/company/crm-backend",
      "workspace": "projects/crm-system/backend",
      "branch": "main",
      "overrides": {
        "allowedPaths": [],
        "devCommands": [],
        "checks": []
      }
    },
    {
      "baseId": "middle",
      "templateId": "middle-starter",
      "repo": "https://gitee.com/company/crm-middle",
      "workspace": "projects/crm-system/middle",
      "branch": "main",
      "overrides": {
        "allowedPaths": [],
        "devCommands": [],
        "checks": []
      }
    },
    {
      "baseId": "client",
      "templateId": "uniapp-template",
      "repo": "https://gitee.com/company/crm-client",
      "workspace": "projects/crm-system/client",
      "branch": "main",
      "overrides": {
        "allowedPaths": [],
        "devCommands": [],
        "checks": []
      }
    }
  ]
}
```

## `features/user-tags/task-plan.json`

```jsonc
{
  "schemaVersion": "0.1.0",
  "planId": "PLAN-DEMO",
  "prdId": "PRD-DEMO",
  "status": "approved",
  "createdAt": "2026-05-18T10:00:00+08:00",
  "updatedAt": "2026-05-18T10:00:00+08:00",
  "storyGroups": [
    {
      // 任务按用户故事分组，而不是按整体功能粗拆
      "storyId": "US-001",
      "title": "管理员可以维护用户标签",
      "tasks": [
        {
          "id": "TASK-001",
          "title": "新增用户标签后端接口",
          "type": "backend",
          "status": "ready",
          "sourceStoryIds": ["US-001"],
          // 引用 project.json 的 bases[].baseId，不直接引用模板 ID
          "targetBaseId": "backend",
          "dependsOn": [],
          // 执行器会先通过 backend 找到 templateId=backend-starter，再加载模板 skill
          "requiredSkillId": "ruoyi-module-crud",
          "scope": {
            "summary": "新增用户标签表、实体、Mapper、Service、Controller 和基础 CRUD 接口。",
            "inScope": ["用户标签 CRUD", "权限标识", "基础校验"],
            "outOfScope": ["中台页面", "客户端页面", "复杂标签推荐算法"]
          },
          "allowedPaths": [
            "ruoyi-modules/system/**",
            "script/sql/**"
          ],
          "expectedChangedFiles": [],
          "acceptanceCriteria": [
            {
              "id": "AC-001",
              "text": "管理员可以通过后端接口创建、查询、更新、删除用户标签。",
              "verification": "运行接口测试或手动调用 API 验证 CRUD 流程。"
            }
          ],
          "checks": [
            {
              "id": "backend-build",
              "name": "后端编译",
              "type": "build",
              "baseId": "backend",
              "command": "mvn -pl ruoyi-admin -am test -DskipTests",
              "required": true
            }
          ],
          "contextBudget": {
            "size": "m",
            "maxFiles": 12,
            "maxEstimatedMinutes": 45
          },
          "retryPolicy": {
            "maxAttempts": 3
          },
          "humanNotes": ""
        },
        {
          "id": "TASK-002",
          "title": "新增用户标签中台页面",
          "type": "middle",
          "status": "pending",
          "sourceStoryIds": ["US-001"],
          "targetBaseId": "middle",
          // 依赖后端接口完成；依赖未满足时保持 pending，不算异常
          "dependsOn": ["TASK-001"],
          "requiredSkillId": "vben-admin-page",
          "scope": {
            "summary": "新增用户标签管理页面和 API 封装。",
            "inScope": ["列表", "新增", "编辑", "删除", "权限接入"],
            "outOfScope": ["客户端页面"]
          },
          "allowedPaths": [
            "apps/web-antd/src/api/**",
            "apps/web-antd/src/views/**"
          ],
          "expectedChangedFiles": [],
          "acceptanceCriteria": [
            {
              "id": "AC-001",
              "text": "管理员可以在中台完成用户标签维护。",
              "verification": "启动中台并完成页面操作验证。"
            }
          ],
          "checks": [
            {
              "id": "middle-typecheck",
              "name": "中台类型检查",
              "type": "typecheck",
              "baseId": "middle",
              "command": "pnpm typecheck",
              "required": true
            }
          ],
          "contextBudget": {
            "size": "m",
            "maxFiles": 10,
            "maxEstimatedMinutes": 45
          },
          "retryPolicy": {
            "maxAttempts": 3
          },
          "humanNotes": ""
        }
      ],
      // 用户故事级验收，通常在该 story 下任务都 done 后执行
      "acceptanceChecks": [
        {
          "id": "us001-acceptance",
          "name": "用户标签故事验收",
          "type": "e2e",
          "baseId": null,
          "command": "pnpm test:e2e -- user-tags",
          "required": true
        }
      ]
    }
  ],
  // 功能级回归，通常在所有用户故事完成后执行
  "regressionChecks": [],
  "humanApproval": {
    "approved": true,
    "approvedBy": "xilanli",
    "approvedAt": "2026-05-18T10:00:00+08:00",
    "notes": "任务拆分已确认。"
  }
}
```

## `loop-summary.json`

```jsonc
{
  "schemaVersion": "0.1.0",
  "runId": "RUN-DEMO",
  "planId": "PLAN-DEMO",
  "startedAt": "2026-05-18T11:00:00+08:00",
  "finishedAt": "2026-05-18T11:30:00+08:00",
  // complete 表示没有异常；has_exceptions 表示本轮完成了一部分，但仍有异常任务
  "status": "has_exceptions",
  "taskSummary": {
    "done": ["TASK-001"],
    "pending": ["TASK-002"],
    "checksFailed": [],
    "reviewFailed": [],
    "needsHuman": ["TASK-003"],
    "cancelled": []
  },
  "issues": [
    {
      "taskId": "TASK-003",
      "status": "needs_human",
      "summary": "当前需求需要新增短信服务供应商配置，但 PRD 未确认供应商。",
      "requiredDecision": "确认使用阿里云短信还是腾讯云短信。",
      "artifactPath": ".engine/projects/crm-system/features/user-tags/runs/TASK-003/review.json"
    }
  ],
  // 下一轮可以自动继续执行的任务
  "nextRunnableTaskIds": []
}
```
