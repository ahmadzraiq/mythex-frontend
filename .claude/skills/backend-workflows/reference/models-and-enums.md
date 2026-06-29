# Models, Enums, inputSchema & Examples

## Contents
- Model JSON shape
- Field types and relations
- Computed, validations, hooks, events, access
- Enum JSON shape
- inputSchema format
- Full graph examples (register, login, auth middleware, paginated list)

## Model JSON — `server/models/<Name>.json`

Writing a model file runs a migration automatically (create/alter table). `server/models/<Name>.json` is the single source of truth for schema.

```json
{
  "id": "uuid",
  "name": "Item",
  "table": "items",
  "timestamps": true,
  "softDelete": true,
  "actorTracking": false,
  "fields": [
    { "id": "f1", "name": "name",        "type": "text",     "required": true, "searchable": true },
    { "id": "f2", "name": "code",        "type": "text",     "unique": true },
    { "id": "f3", "name": "score",       "type": "decimal",  "required": true },
    { "id": "f4", "name": "count",       "type": "int",      "default": "0" },
    { "id": "f5", "name": "isActive",    "type": "bool",     "default": "true" },
    { "id": "f6", "name": "metadata",    "type": "json" },
    { "id": "f7", "name": "status",      "type": "enum",     "enum": "Status", "default": "draft" },
    { "id": "f8", "name": "coverImage",  "type": "file" },
    { "id": "f9", "name": "author",      "type": "relation", "relation": { "to": "User", "kind": "manyToOne", "onDelete": "setNull" } },
    { "id": "f10","name": "tags",        "type": "relation", "relation": { "to": "Tag", "kind": "manyToMany" } },
    { "id": "f11","name": "displayName", "type": "text",     "computed": { "expr": "row.name", "persisted": false } }
  ],
  "search": ["name", "description"],
  "indexes": [{ "fields": ["code"], "unique": true }, { "fields": ["name", "status"], "unique": false }],
  "validations": { "score": "row.score >= 0" },
  "hooks":  { "beforeCreate": "validate-item" },
  "events": { "onCreate": "audit-log" },
  "access": { "create": ["require-auth"], "*": ["require-auth"] }
}
```

- `timestamps` (default true) → `createdAt` / `updatedAt`
- `softDelete` → `deletedAt` column + auto-filter; deletes set `deletedAt` unless `hardDelete`
- `actorTracking` → `createdBy` / `updatedBy` from identity
- Each field has a stable `id` (UUID) — keep it on rename; auto-generated when omitted on first write.

## Field types and relations

Field `type`: `text` | `int` | `bigint` | `decimal` | `float` | `money` | `bool` | `json` | `uuid` | `date` | `datetime` | `timestamp` | `enum` | `file` | `relation`.

- `enum` fields set `"enum": "<EnumName>"` referencing a `server/enums/<EnumName>.json`.
- `relation.kind`: `manyToOne` | `oneToOne` | `oneToMany` | `manyToMany`. `relation.to` is the target model name. `relation.onDelete`: `cascade` | `setNull` | `restrict`.
- `decimal` serializes to a **string** in JSON responses.

## Computed, validations, hooks, events, access

- `computed`: `{ "expr": "row.<field> ...", "persisted": false }`. `persisted: false` = virtual (not stored); `true` = stored on write. Expressions reference fields as `row.<field>`.
- `validations`: map of field → boolean expression (refs `row.*`), enforced on write.
- `hooks`: map a lifecycle (`beforeCreate`, `beforeUpdate`, ...) to a FUNCTION workflow **slug**; runs inside the write transaction.
- `events`: map a lifecycle (`onCreate`, `onUpdate`, ...) to a FUNCTION workflow **slug**; runs async after commit.
- `access`: map a CRUD op (`list`/`read`/`create`/`update`/`delete`/`*`) to MIDDLEWARE workflow **slug** array. Authorization is never policy logic inside the model — compose it from middleware + functions.

## Enum JSON — `server/enums/<Name>.json`

```json
{ "name": "Status", "values": ["draft", "active", "archived"] }
```

## inputSchema format

Each item declares one request input. All inputs are accessible as `parameters?.['name']`.

```json
[
  { "id": "p1", "in": "body",   "name": "email",    "type": "Text",   "required": true, "validation": { "format": "email" } },
  { "id": "p2", "in": "body",   "name": "password", "type": "Text",   "required": true, "validation": { "minLength": 6 } },
  { "id": "p3", "in": "query",  "name": "page",     "type": "Number",  "required": false },
  { "id": "p4", "in": "path",   "name": "id",       "type": "Text",   "required": true },
  { "id": "p5", "in": "header", "name": "x-api-key","type": "Text",   "required": true }
]
```
- `in`: `body` | `query` | `path` | `header`
- `type`: `Text` | `Number` | `Boolean` | `Array` | `Object`
- `validation` keys: `minLength`, `maxLength`, `min`, `max`, `pattern`, `format` (`email`|`url`|`uuid`), `enum` (array), `minItems`, `maxItems`

## Full graph examples

### Auth middleware (protect an endpoint)

`server/middleware/require-auth.json` graph:
```json
[
  { "id": "mw1", "type": "tryCatch", "config": { "catchEnabled": true, "finallyEnabled": false },
    "tryBody": [
      { "id": "mw2", "type": "verifyToken",      "config": { "token": { "js": "parameters?.['__token']" } } },
      { "id": "mw3", "type": "setRequestContext","config": { "key": "__userId", "value": { "js": "context.workflow['mw2'].result.userId" } } }
    ],
    "catchBody": [
      { "id": "mw4", "type": "throwError", "config": { "message": "Unauthorized", "statusCode": 401 } }
    ]
  },
  { "id": "mw5", "type": "middlewareNext", "config": {} }
]
```
Wire it to an endpoint by putting the middleware workflow's `id` in the endpoint's `middlewareIds`.

### Register endpoint (POST /auth/register)

```json
[
  { "id": "s1", "type": "ormFindMany",    "config": { "model": "User", "where": { "js": "{ email: parameters?.['email'] }" }, "take": 1 } },
  { "id": "s2", "type": "branch",         "config": { "condition": { "js": "context.workflow['s1'].result.length > 0" } },
    "trueBranch":  [ { "id": "s3", "type": "throwError", "config": { "message": "Email already exists", "statusCode": 409 } } ],
    "falseBranch": [
      { "id": "s4", "type": "hashPassword",  "config": { "password": { "js": "parameters?.['password']" } } },
      { "id": "s5", "type": "ormCreate",     "config": { "model": "User", "data": { "js": "{ email: parameters?.['email'], passwordHash: context.workflow['s4'].result.hash }" } } },
      { "id": "s6", "type": "generateToken", "config": { "payload": { "js": "{ userId: context.workflow['s5'].result.id }" }, "expiresIn": "7d" } },
      { "id": "s7", "type": "sendResponse",  "config": { "status": "201", "bodyType": "JSON", "body": { "js": "{ token: context.workflow['s6'].result.token, userId: context.workflow['s5'].result.id }" } } }
    ]
  }
]
```

### Login endpoint (POST /auth/login)

```json
[
  { "id": "s1", "type": "ormFindMany", "config": { "model": "User", "where": { "js": "{ email: parameters?.['email'] }" }, "take": 1 } },
  { "id": "s2", "type": "branch", "config": { "condition": { "js": "context.workflow['s1'].result.length > 0" } },
    "trueBranch": [
      { "id": "s3", "type": "verifyPassword", "config": { "hash": { "js": "context.workflow['s1'].result[0].passwordHash" }, "password": { "js": "parameters?.['password']" } } },
      { "id": "s4", "type": "branch", "config": { "condition": { "js": "context.workflow['s3'].result.match" } },
        "trueBranch": [
          { "id": "s5", "type": "generateToken", "config": { "payload": { "js": "{ userId: context.workflow['s1'].result[0].id }" }, "expiresIn": "7d" } },
          { "id": "s6", "type": "sendResponse",  "config": { "status": "200", "bodyType": "JSON", "body": { "js": "{ token: context.workflow['s5'].result.token, userId: context.workflow['s1'].result[0].id }" } } }
        ],
        "falseBranch": [ { "id": "s7", "type": "throwError", "config": { "message": "Invalid email or password", "statusCode": 401 } } ]
      }
    ],
    "falseBranch": [ { "id": "s8", "type": "throwError", "config": { "message": "Invalid email or password", "statusCode": 401 } } ]
  }
]
```

### Paginated list (GET /items)

```json
[
  { "id": "s1", "type": "ormFindMany", "config": { "model": "Item", "where": { "js": "{ status: 'active' }" }, "take": { "js": "Number(parameters?.['pageSize'] ?? 25)" }, "skip": { "js": "(Number(parameters?.['page'] ?? 1) - 1) * Number(parameters?.['pageSize'] ?? 25)" }, "orderBy": { "js": "{ createdAt: 'desc' }" } } },
  { "id": "s2", "type": "ormCount",    "config": { "model": "Item", "where": { "js": "{ status: 'active' }" } } },
  { "id": "s3", "type": "sendResponse","config": { "status": "200", "bodyType": "JSON", "body": { "js": "{ data: context.workflow['s1'].result, total: context.workflow['s2'].result, page: Number(parameters?.['page'] ?? 1), pageSize: Number(parameters?.['pageSize'] ?? 25) }" } } }
]
```
