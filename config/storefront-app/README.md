# Storefront App Config

JSON-driven storefront that replicates the **Vendure Next.js storefront** design and logic. Calls Vendure GraphQL **directly** from the client (no API routes).

## Overview

- **Backend:** Vendure GraphQL (ready)
- **Frontend:** JSON-based SDUI engine
- **Integration:** Direct fetch to Vendure shop API URL

## Key Differences from Default Config

| Aspect | Default Config | Storefront App |
|--------|---------------|----------------|
| Cart | Local state (`cart.items`) | Server-side (`activeOrder` from Vendure) |
| Products | Mock data / REST | Vendure GraphQL |
| Auth | Session/cookie | `vendure-auth-token` cookie |
| Collections | Nav categories | Vendure collections |
| Checkout | Single form | Multi-step accordion (contact → shipping → delivery → payment → review) |

## Environment Variables

```env
NEXT_PUBLIC_VENDURE_SHOP_API_URL=https://your-vendure.com/shop-api
NEXT_PUBLIC_VENDURE_CHANNEL_TOKEN=__default_channel__
```

Add `config.vendureUrl` to store initialData (from env) so fetch actions can use `{{config.vendureUrl}}`.

## Activation

To use this config instead of the default:

1. Set `config.vendureUrl` in store.json (from `NEXT_PUBLIC_VENDURE_SHOP_API_URL`)
2. Point `config/app.ts` to `storefront-app` screens, actions, layouts
3. Ensure fetch sends credentials for cookie-based auth

## Task List

See [TASKS.md](./TASKS.md) for the full implementation checklist.
