# Redux Store

## Structure

- **config** – Single slice storing all app state from JSON-configured actions
  - `data` – Fetched data, auth, ecommerce, etc. (paths: `auth.user`, `ecommerce.products`, `ecommerce.cart`)
  - `loading` – Loading flags per path
  - `error` – Error messages per path

## Architecture

All state and logic is driven by `config/app.json`. No hardcoded slices or thunks.

- **Auth** – `auth.user`, `auth.error` from fetch/set actions in app.json
- **Ecommerce** – `ecommerce.products`, `ecommerce.cart` from fetch/append actions in app.json

## Usage

```ts
import { useAppSelector } from '@/store/hooks';

// Auth check (from config.data)
const user = useAppSelector((state) => state.config?.data?.['auth.user']);

// All actions are triggered via JSON config (login, signup, logout, fetchProducts, addToCart)
```

## API Routes (Mock)

- `POST /api/auth/login` – { email, password }
- `POST /api/auth/signup` – { email, password, name }

Replace with real backend/database. URLs and payloads are configured in app.json.
