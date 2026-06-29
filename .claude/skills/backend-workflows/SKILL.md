---
name: backend-workflows
description: Build backend server entities under server/* — data models, enums, API endpoints, middleware, and reusable functions. Use for any server/ file, database schema or migration, auth (register/login/protected routes), CRUD or search endpoints, and workflow step graphs.
---

# Backend Workflows

Backend entities live under `server/*` in the VFS. A model write triggers a migration automatically. Endpoints, middleware, and functions are workflows: a flat `graph` array of step objects executed in order.

Supported workflow kinds: `API_ENDPOINT`, `MIDDLEWARE`, `FUNCTION`. (No CRON/jobs or views — those are not implemented.)

## When to read the references

- ORM step config (find/create/update/delete/aggregate/groupBy/transaction): read [reference/orm-steps.md](reference/orm-steps.md)
- Control flow, loops, auth/crypto steps, and the `backendLib` JS API: read [reference/flow-and-auth.md](reference/flow-and-auth.md)
- Model JSON, enum JSON, inputSchema, and full end-to-end graph examples (register/login/middleware/list): read [reference/models-and-enums.md](reference/models-and-enums.md)

## Entity file shapes

**`server/apis/<slug>.json`** — HTTP endpoint:
```json
{
  "id": "uuid",
  "name": "Create Item",
  "slug": "create-item",
  "kind": "API_ENDPOINT",
  "method": "POST",
  "path": "/items",
  "inputSchema": [],
  "middlewareIds": ["<middleware-workflow-id>"],
  "graph": []
}
```
- `method`: `GET` | `POST` | `PUT` | `PATCH` | `DELETE`
- `middlewareIds`: array of middleware workflow **UUID `id` fields** (not slugs), run in order before the endpoint
- `graph`: flat array of step objects
- Forbidden fields: `outputSchema` and `security` must NOT be added — they do not exist in this system.

**`server/middleware/<name>.json`** — auth guard / pre-processor. Graph MUST end with `middlewareNext`:
```json
{ "id": "uuid", "name": "Require Auth", "slug": "require-auth", "kind": "MIDDLEWARE", "graph": [] }
```

**`server/functions/<name>.json`** — reusable function. Graph ends with `workflowResult` (not `sendResponse`). Called from `serverJavaScript` via `backendLib.workflow('slug', input)`, or referenced by a model `hooks`/`events`:
```json
{ "id": "uuid", "name": "Audit Log", "slug": "audit-log", "kind": "FUNCTION", "graph": [] }
```

**`server/models/<Name>.json`** and **`server/enums/<Name>.json`** — see [reference/models-and-enums.md](reference/models-and-enums.md).

To expose model data over HTTP, always write an explicit `server/apis/<slug>.json` with the needed ORM steps. Every model that the frontend needs to read or write must have a corresponding `server/apis/` file.

## Step type index

Read the linked reference for the exact config of each.

| Group | Step types |
|---|---|
| ORM | `ormFindMany` `ormFindOne` `ormFindUnique` `ormFindFirstOrThrow` `ormFindUniqueOrThrow` `ormCreate` `ormCreateMany` `ormCreateManyAndReturn` `ormUpdate` `ormUpdateMany` `ormDelete` `ormDeleteMany` `ormUpsert` `ormCount` `ormAggregate` `ormGroupBy` `ormTransaction` |
| Response | `sendResponse` `throwError` |
| Control flow | `branch` `multiOptionBranch` `tryCatch` `passThroughCondition` `parallelExecution` `forEach` `whileLoop` `breakLoop` `continueLoop` |
| Variables | `createWorkflowVariable` `changeVariableValue` `resetVariableValue` `setRequestContext` |
| Middleware/function | `middlewareNext` `workflowResult` |
| Auth/crypto | `hashPassword` `verifyPassword` `generateToken` `verifyToken` `randomToken` |
| Other | `fetchData` `serverJavaScript` `runFormula` `sendEmailAction` `timeDelay` |
| Storage | `uploadFile` `getFileUrl` `deleteFile` |

## Expressions

All dynamic values use `{ "js": "expression" }`. Available in every step config:

```
parameters?.['fieldName']            request inputs (body/query/path/header) + middleware-injected values
context.workflow['stepId'].result    output of a previous step (its "id" field)
context.workflow['variables'].name   a workflow variable created with createWorkflowVariable
context.workflow.error?.message      caught error (inside tryCatch catchBody only)
variables['varName']                 shorthand for workflow variables
```

## sendResponse

```json
{ "id": "s1", "type": "sendResponse", "config": {
  "status": "201",
  "bodyType": "JSON",
  "body": { "js": "context.workflow['stepId'].result" }
}}
```
- `status`: string code (`"200"`, `"201"`, `"400"`, `"401"`, `"404"`, ...)
- `responseSchema` is auto-generated from the `body` expression — do NOT write it manually.
