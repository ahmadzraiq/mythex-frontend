# SDUI Store (Zustand)

## Structure

- **sdui-store** – Zustand store for app state from JSON-configured actions
  - `data` – Fetched data, auth, ecommerce, etc. (paths: `auth.user`, `ecommerce.products`, `ecommerce.cart`)
  - `loading` – Loading flags per path
  - `error` – Error messages per path

## Architecture

All state and logic is driven by `config/app.ts` (which merges `config/store.json`, `config/routes.json`, screens, and actions). No hardcoded slices.

- **Auth** – `auth.user`, `auth.error` from fetch/set actions in app.json
- **Ecommerce** – `ecommerce.products`, `ecommerce.cart` from fetch/append actions in app.json

## Usage

```ts
import { useSduiStore } from '@/store/sdui-store';

// Auth check (from store data)
const isAuthenticated = !!useSduiStore((s) => s.data['auth.user']);

// Update state
const setData = useSduiStore((s) => s.setData);
setData('route.path', '/dashboard');

// All actions are triggered via JSON config (login, signup, logout, fetchProducts, addToCart)
```

## API Routes (Mock)

- `POST /api/auth/login` – { email, password }
- `POST /api/auth/signup` – { email, password, name }

Replace with real backend/database. URLs and payloads are configured in app.json.
