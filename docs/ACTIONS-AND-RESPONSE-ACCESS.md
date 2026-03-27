# Actions & Response Access

The `storeIn`, `responsePath`, `errorMessagePath`, and `onSuccess` action properties are removed. Access action results via `context.workflow[stepId]` in a workflow's steps. Use `changeVariableValue` or `setVar` to persist results. Use `refetchDataSource` to refresh a datasource collection.
