# SDUI – JSON-Driven UI Engine

A Server-Driven UI (SDUI) framework built on Next.js. All screens, layouts, fragments, and actions are defined in JSON — no hardcoded UI logic in React.

## Stack

- **Next.js 15** + React 19
- **Zustand** – global state
- **Formula evaluator** – plain JS expressions with `{{path}}` interpolation for computed values and conditions
- **Gluestack UI** + NativeWind – components
- Config-driven `validate` action – form validation (no react-hook-form/Yup)

## Architecture

```
config/
├── app.ts          # Merges all config ($ref/$slot resolved here)
├── routes.json     # All routes (static + dynamic)
├── store.json      # Initial state, engineConventions, computed
├── theme.json      # Brand colors and section themes
├── screens/        # One .json per screen
├── layouts/        # Layout structures (header + content slot + drawer)
├── fragments/      # Reusable UI (header, drawer, modals/*)
└── actions/        # All actions (fetch, graphql, set, validate, etc.)

lib/sdui/
├── sdui-engine.tsx     # Engine: actions, state, workflow
├── renderer.tsx        # Fine-grained reactive renderer
├── computed-runner.ts  # Formula-driven computed values
├── config-resolver.ts  # $ref/$slot resolution
├── variable-store.ts   # Reactive path-based state
└── component-registry.tsx  # JSON type → React component
```

## Data Fetching

This project calls external APIs directly — **no Next.js API routes**.

- **REST**: `type: "fetch"` action
- **GraphQL**: `type: "graphql"` action (configures global endpoint + headers in `store.json` `engineConventions`)

## Docs

- [`docs/SCHEMA.md`](docs/SCHEMA.md) – Full JSON schema reference
- [`docs/NEW-APP-CHECKLIST.md`](docs/NEW-APP-CHECKLIST.md) – Setup checklist for new apps
- [`docs/ACTIONS-AND-RESPONSE-ACCESS.md`](docs/ACTIONS-AND-RESPONSE-ACCESS.md) – Action patterns and data access

## Getting Started

```bash
npm install
npm run dev
```
