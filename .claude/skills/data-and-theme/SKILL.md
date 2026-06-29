---
name: data-and-theme
description: Wire up client data and visual theme — datasource entities (REST collections), formula/utility functions, and the design theme overrides (light/dark color tokens). Use when adding a data source, creating a reusable formula, or changing theme colors.
---

# Data & Theme

## Datasource entity — `data/<id>.json`

**External API** (third-party):
```json
{
  "id": "items",
  "name": "Items",
  "type": "rest",
  "url": "https://api.example.com/items",
  "method": "GET",
  "trigger": "mount"
}
```

**Internal backend endpoint** — use the API_ENDPOINT's `path` value starting with `/`:
```json
{
  "id": "items-ds",
  "name": "Items",
  "type": "rest",
  "url": "/items",
  "method": "GET",
  "trigger": "mount"
}
```
The engine automatically prepends the backend run URL and project ID to any `url` that starts with `/`. The `/items` here matches the `"path": "/items"` field in the corresponding `server/apis/list-items.json`.

- `folder`: optional grouping label; omit if no folder
- Read the fetched data in bindings via `collections['<id>']` (the `id` matches the file's `id` / `data/<id>.json`). The fetcher stores the array directly — there is no `.data` wrapper.

## Formula entity — `utils/<name>.json`

```json
{
  "name": "formatDate",
  "description": "Format a date value for display",
  "formula": "new Date(parameters?.['value']).toLocaleDateString()",
  "params": [
    { "name": "value", "type": "String", "testValue": "2024-01-15" }
  ]
}
```

## Design theme — `design/theme.json`

```json
{
  "overrides": {
    "--primary": "#6366f1",
    "--background": "#0f0f0f"
  },
  "darkOverrides": {
    "--primary": "#818cf8"
  }
}
```

- `overrides`: CSS variable token overrides applied in light mode (and as the base).
- `darkOverrides`: token overrides applied in dark mode.
- Read a resolved token in bindings via `theme?.['colors']?.['primary']`.

**CSS variable naming**: each token (e.g. `"--primary": "#6366f1"`) generates two CSS variables at runtime:
- `--primary` — an RGB triplet used internally by Tailwind for opacity utilities (e.g. `bg-primary/50`)
- `--theme-primary` — the original hex value for direct CSS references

Always use the `--theme-` prefixed variable in SxProps or CSS:
```json
"bg": "var(--theme-primary)",
"textColor": "var(--theme-foreground)"
```
`var(--primary)` will not render a valid color.
