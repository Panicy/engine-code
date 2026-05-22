# Cross-End Contracts

跨端契约模块用于校验后端 task 产出的接口契约和权限链路清单，供中台、客户端 task 稳定消费。

## 文件

- `backend-api.json`：后端接口契约，记录 operation id、method、path、权限码、请求和响应。
- `permission-manifest.json`：权限链路清单，记录权限码、后端注解、菜单 SQL、中台按钮，以及可选的目标接口。

## 校验

```bash
node tools/contracts/validate-contracts.mjs \
  --backend-api .engine/json/examples/backend-api.json \
  --permissions .engine/json/examples/permission-manifest.json
```

校验内容：

- `backend-api.json` 符合 `schemas/backend-api.schema.json`。
- `permission-manifest.json` 符合 `schemas/permission-manifest.schema.json`。
- API `permissionCode` 存在于权限清单。
- permission code 不重复。
- API operation/id 不重复。
- API `method + path` 不重复。
- 如果 permission 使用 `targetEndpointIds`，目标 API 必须存在，且目标 API 的 `permissionCode` 必须与 permission code 一致。

退出码：

- `0`：契约有效。
- `1`：契约可读取，但 schema 或一致性校验失败。
- `2`：参数错误、文件读取失败或 JSON 解析失败。

## 约定

- public API 可以将 `permissionCode` 设为空字符串。
- 受保护 API 推荐填写明确权限码，并在 permission manifest 中登记。
- `targetEndpointIds` 是可选字段，用于把权限项显式绑定到一个或多个 API operation。
