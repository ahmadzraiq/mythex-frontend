# Control Flow, Auth & backendLib

## Contents
- Control flow (branch, multiOptionBranch, tryCatch, passThroughCondition, parallelExecution)
- Loops (forEach, whileLoop, breakLoop, continueLoop)
- Variables (createWorkflowVariable, changeVariableValue, resetVariableValue, setRequestContext)
- Middleware & function terminators (middlewareNext, workflowResult)
- Auth / crypto (hashPassword, verifyPassword, generateToken, verifyToken, randomToken)
- HTTP / JS / formula / email / delay
- backendLib API

## Control flow

**`branch`** — if/else. Nested step arrays are siblings of `config`:
```json
{ "id": "s1", "type": "branch",
  "config": { "condition": { "js": "parameters?.['value'] > 0" } },
  "trueBranch":  [],
  "falseBranch": []
}
```

**`multiOptionBranch`** — switch/case on a string value:
```json
{ "id": "s1", "type": "multiOptionBranch",
  "config": { "value": { "js": "parameters?.['color']" } },
  "branches": [
    { "match": "red",   "steps": [] },
    { "match": "green", "steps": [] }
  ],
  "defaultBranch": []
}
```

**`tryCatch`** — inside `catchBody`, `context.workflow.error?.message` is the caught error string:
```json
{ "id": "s1", "type": "tryCatch",
  "config": { "catchEnabled": true, "finallyEnabled": true },
  "tryBody":     [],
  "catchBody":   [],
  "finallyBody": []
}
```

**`passThroughCondition`** — guard assertion; throws 400 if the condition is falsy:
```json
{ "id": "s1", "type": "passThroughCondition", "config": { "condition": { "js": "parameters?.['age'] >= 18" } } }
```

**`parallelExecution`** — run step arrays concurrently. Note the key is `parallelBranches`. Results are keyed `branch_0`, `branch_1`, ...:
```json
{ "id": "s1", "type": "parallelExecution", "config": {},
  "parallelBranches": [
    [ { "id": "s2", "type": "ormCount", "config": { "model": "Item" } } ],
    [ { "id": "s3", "type": "ormCount", "config": { "model": "Tag" } } ]
  ]
}
```
`context.workflow['s1'].result` = `{ branch_0: <count>, branch_1: <count> }`.

## Loops

**`forEach`** — inside `loopBody`, current element is `context.workflow['variables'].item`, index is `context.workflow['variables'].index`:
```json
{ "id": "s1", "type": "forEach",
  "config": { "items": { "js": "parameters?.['items']" } },
  "loopBody": []
}
```

**`whileLoop`**:
```json
{ "id": "s1", "type": "whileLoop",
  "config": { "condition": { "js": "variables['count'] < 5" }, "maxIterations": 1000 },
  "loopBody": []
}
```

**`breakLoop`** / **`continueLoop`** — used inside a `loopBody`:
```json
{ "id": "s1", "type": "breakLoop",    "config": {} }
{ "id": "s2", "type": "continueLoop", "config": {} }
```

## Variables

```json
{ "type": "createWorkflowVariable", "config": { "name": "total", "initialValue": 0 } }
{ "type": "changeVariableValue",    "config": { "variableName": "total", "value": { "js": "variables['total'] + 1" } } }
{ "type": "resetVariableValue",     "config": { "variableName": "total" } }
```
Read a variable: `variables['total']` or `context.workflow['variables'].total`.

**`setRequestContext`** — inject a value into `parameters` for downstream steps and the endpoint. Used by middleware to forward auth data:
```json
{ "type": "setRequestContext", "config": { "key": "__userId", "value": { "js": "context.workflow['mw_verify'].result.userId" } } }
```

## Terminators

**`middlewareNext`** — MIDDLEWARE graphs only; passes control to the next middleware or the endpoint:
```json
{ "type": "middlewareNext", "config": {} }
```

**`workflowResult`** — FUNCTION graphs only; sets the return value:
```json
{ "type": "workflowResult", "config": { "result": { "js": "context.workflow['s1'].result" } } }
```

## Auth / crypto

```json
{ "type": "hashPassword",  "config": { "password": { "js": "parameters?.['password']" } } }
```
output: `{ hash }`

```json
{ "type": "verifyPassword", "config": { "password": { "js": "..." }, "hash": { "js": "..." } } }
```
output: `{ match: boolean }`

```json
{ "type": "generateToken", "config": { "payload": { "js": "{ userId: context.workflow['s1'].result.id }" }, "expiresIn": "7d" } }
```
output: `{ token, ...payload }`

```json
{ "type": "verifyToken", "config": { "token": { "js": "parameters?.['__token']" } } }
```
output: `{ valid: true, ...payload }` or throws 401. The `Authorization: Bearer <token>` header is auto-injected as `parameters['__token']`.

```json
{ "type": "randomToken", "config": { "length": 32, "encoding": "hex" } }
```
output: `{ token }`

## HTTP / JS / formula / email / delay

```json
{ "type": "fetchData", "config": { "url": "https://...", "method": "POST", "headers": {}, "body": { "js": "{ key: 'val' }" } } }
```
output: `{ status, headers, body }`

```json
{ "type": "serverJavaScript", "config": { "code": "const r = await backendLib.db.Item.findMany({}); return r;" } }
{ "type": "runFormula",       "config": { "formula": { "js": "parameters?.['a'] * parameters?.['b']" } } }
{ "type": "sendEmailAction",  "config": { "to": "user@example.com", "subject": "Hello", "html": "<p>Hi</p>" } }
{ "type": "timeDelay",        "config": { "ms": 1000 } }
```

## backendLib API (inside serverJavaScript)

```js
// Prisma-style ORM
const rows = await backendLib.db.Item.findMany({ where: { status: 'active' } });
await backendLib.db.$transaction(async (tx) => { await tx.Item.create({ data: {} }); });

// Auth helpers
const { hash }  = await backendLib.hash('plaintext');
const { match } = await backendLib.verify('plaintext', hash);
const { token } = await backendLib.token({ userId: id }, { expiresIn: '7d' });
const decoded   = await backendLib.verifyToken(tokenString);

// Run any step type by name
const result = await backendLib.run('ormFindMany', { model: 'Item', where: {} });

// Call a FUNCTION workflow by slug
const out = await backendLib.workflow('audit-log', { modelName: 'Item', action: 'create' });

// Send response and STOP execution
await backendLib.sendResponse(200, { ok: true });

// Email + native fetch
await backendLib.sendEmail({ to: 'a@b.com', subject: 'Hi', html: '<p>Hi</p>' });
const res = await fetch('https://api.example.com');
```
