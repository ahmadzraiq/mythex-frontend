# Actions & Response Access

## Named Workflows (Required)

All actions must be named workflows in `config/actions/*.json`. Inline actions on nodes are NOT supported.

```json
"actions": [{ "action": "submitSignIn" }]
```

The `trigger` (click, submit, change, etc.) is defined in the workflow definition, not on the node.

## Step Result Access

Access action results within a workflow via `context.workflow[stepId]`:

```json
{
  "trigger": "submit",
  "steps": [
    { "id": "step-1", "type": "graphql", "config": { "query": "..." } },
    { "id": "step-2", "type": "changeVariableValue", "config": {
      "variableName": "UUID",
      "value": { "formula": "context?.workflow?.['step-1']?.result?.data?.login?.token" }
    }}
  ]
}
```

## Removed Properties

`storeIn`, `responsePath`, `errorMessagePath`, and `onSuccess` are removed from the action schema. Use `changeVariableValue` or `setVar` steps to persist results. Use `fetchCollection` to refresh datasource collections.

## Workflow Step Types

See `build-guide.mdc` for the complete list of supported step types. Only types listed in `ACTION_CATEGORIES` (`_workflow-types.tsx`) are supported.
