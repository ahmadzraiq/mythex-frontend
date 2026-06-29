# ORM Steps

## Contents
- Common rules
- Read steps (findMany, findOne, findUnique, findFirstOrThrow, findUniqueOrThrow)
- Write steps (create, createMany, createManyAndReturn, update, updateMany, upsert)
- Delete steps (delete, deleteMany)
- Aggregation (count, aggregate, groupBy)
- Transactions (ormTransaction)
- Relations, soft delete, atomic updates

## Common rules

- `model` is always the PascalCase model name string (e.g. `"Item"`).
- All argument values accept `{ "js": "..." }` expressions, including nested objects (e.g. a `where` built from `parameters`).
- Args mirror Prisma: `where`, `data`, `select`, `include`, `omit`, `orderBy`, `take`, `skip`, `distinct`, `cursor`, `create`, `update`, `search`, `by`, `having`, plus flags `hardDelete`, `includeTrashed`, `skipDuplicates`, and aggregation keys `_count` `_avg` `_sum` `_min` `_max`.

## Read steps

| type | key config fields |
|---|---|
| `ormFindMany` | `model`, `where`, `include`, `select`, `omit`, `orderBy`, `take`, `skip`, `search`, `distinct`, `cursor`, `includeTrashed` |
| `ormFindOne` | `model`, `where`, `include`, `select` (Prisma findFirst) |
| `ormFindUnique` | `model`, `where`, `include`, `select` |
| `ormFindFirstOrThrow` | `model`, `where`, `include` |
| `ormFindUniqueOrThrow` | `model`, `where`, `include` |

```json
{ "id": "s1", "type": "ormFindMany", "config": {
  "model": "Item",
  "where": { "js": "{ status: 'active' }" },
  "include": { "tags": true },
  "orderBy": { "js": "{ createdAt: 'desc' }" },
  "take": { "js": "Number(parameters?.['pageSize'] ?? 25)" },
  "skip": { "js": "(Number(parameters?.['page'] ?? 1) - 1) * Number(parameters?.['pageSize'] ?? 25)" }
}}
```

## Write steps

| type | key config fields |
|---|---|
| `ormCreate` | `model`, `data`, `include`, `select` |
| `ormCreateMany` | `model`, `data` (array), `skipDuplicates` |
| `ormCreateManyAndReturn` | `model`, `data` (array), `select` |
| `ormUpdate` | `model`, `where`, `data`, `include`, `select` |
| `ormUpdateMany` | `model`, `where`, `data` |
| `ormUpsert` | `model`, `where`, `create`, `update`, `include` |

```json
{ "id": "s1", "type": "ormCreate", "config": {
  "model": "Item",
  "data": { "js": "{ name: parameters?.['name'], code: parameters?.['code'], score: parameters?.['score'] }" },
  "include": { "tags": true }
}}
```

## Delete steps

| type | key config fields |
|---|---|
| `ormDelete` | `model`, `where`, `hardDelete` |
| `ormDeleteMany` | `model`, `where`, `hardDelete` |

For soft-delete models, delete sets `deletedAt`. Pass `"hardDelete": true` to permanently remove the row.

## Aggregation

| type | key config fields |
|---|---|
| `ormCount` | `model`, `where` |
| `ormAggregate` | `model`, `where`, `_avg`, `_sum`, `_min`, `_max`, `_count` |
| `ormGroupBy` | `model`, `by` (array), `where`, `_avg`, `_count`, `_sum`, `_min`, `_max`, `orderBy`, `having` |

```json
{ "id": "s1", "type": "ormAggregate", "config": {
  "model": "Item",
  "_avg": { "score": true },
  "_max": { "score": true },
  "_count": true
}}
```
Aggregate result shape: `{ "_avg": { "score": 4.5 }, "_max": { "score": 10 }, "_count": 75 }`.

```json
{ "id": "s1", "type": "ormGroupBy", "config": {
  "model": "Item",
  "by": ["status"],
  "_count": true,
  "_avg": { "score": true }
}}
```
GroupBy result: array of `{ "status": "active", "_count": 43, "_avg": { "score": 7.6 } }`.

## Transactions

`ormTransaction` runs all steps in `transactionBody` inside one atomic DB transaction. If any step throws, the whole transaction rolls back.

```json
{ "id": "s1", "type": "ormTransaction", "config": {}, "transactionBody": [
  { "id": "s2", "type": "ormCreate", "config": { "model": "Tag", "data": { "js": "{ name: 'a' }" } } },
  { "id": "s3", "type": "ormCreate", "config": { "model": "Tag", "data": { "js": "{ name: 'b' }" } } }
] }
```

## Relations, atomic updates

- Nested relation include: `"include": { "author": true, "tags": true }`
- Nested where on relation: `"where": { "js": "{ group: { is: { name: 'Fiction' } } }" }`
- many-to-many set: `"data": { "js": "{ tags: { set: parameters?.['tagIds'].map(id => ({ id })) } }" }`
- Atomic numeric update: `"data": { "js": "{ count: { increment: 1 } }" }` (also `decrement`, `multiply`, `divide`)
- Prisma operators in `where` (`gt`, `lt`, `gte`, `lte`, `contains`, `startsWith`, `endsWith`, `in`, `not`) are written inside the `{ js }` object, e.g. `"where": { "js": "{ score: { gt: 5, lt: 10 } }" }`.
