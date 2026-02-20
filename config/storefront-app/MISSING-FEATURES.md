# Storefront App – Missing Features & Components

Features or components that the JSON-based system may need to support for full Vendure storefront parity. **No API routes** – calls Vendure GraphQL directly.

---

## 1. Engine / Runtime

| Feature | Status | Notes |
|---------|--------|-------|
| **Fetch with credentials** | ⚠️ Verify | Cart/auth APIs need cookies. Ensure `fetch(..., { credentials: 'include' })` in engine |
| **Accordion controlled value** | ⚠️ Verify | Checkout steps use Accordion with `value` and `onValueChange` – need `checkout.currentStep` binding |
| **Dynamic route params** | ✅ | `route.slug`, `route.code` – ensure page passes these from URL |
| **URL search params** | ⚠️ Verify | `route.q`, `route.sort`, `route.page`, `route.facets` for search/collection – ensure route state includes these |
| **Conditional initActions** | ⚠️ | Guest checkout needs contact step; logged-in skips it – may need conditional initActions or screen variants |

---

## 2. Action Types

| Action | Status | Notes |
|--------|--------|-------|
| **append** (local) | ✅ | Used for wishlist |
| **removeAt** | ✅ | Remove from cart/wishlist |
| **increment/decrement** | ✅ | Quantity |
| **fetch** | ✅ | All Vendure calls |
| **set** | ✅ | State updates |
| **navigate** | ✅ | With routeConfig + slug/code |
| **runMultiple** | ✅ | Chain actions |
| **appendToPath** | ✅ | Reviews, etc. |
| **validate** | ✅ | Form validation |

**Potential gap:** No dedicated `graphql` action type – use `fetch` with GraphQL body (query + variables) to Vendure URL.

---

## 3. Components

| Component | In Registry | Storefront Use |
|-----------|-------------|----------------|
| Accordion | ✅ | Checkout steps |
| RadioGroup | ✅ | Payment method selection |
| Carousel | ⚠️ Check | Featured products on home |
| CountrySelect | ✅ | Address forms |
| OrderStatusBadge | ❌ | Map order state to badge – can use Badge + expr |
| ProductCarousel | ❌ | Custom – use Carousel or horizontal ScrollView |
| ThemeSwitcher | ❌ | If not in header – add to navbar fragment |

---

## 4. Data Shape Adaptations

Vendure returns different shapes. API proxy must normalize:

| Vendure | Normalized for JSON |
|---------|---------------------|
| `priceWithTax` (PriceRange \| SinglePrice) | `price` (number), `priceMin`, `priceMax` (if range) |
| `productAsset.preview` | `image` |
| `productName` | `name` |
| `productVariant.id` | `variantId` for addToCart |
| `lines[].productVariant` | `cart.items[].product`, `cart.items[].quantity`, `cart.items[].lineId` |
| `facetValues[].facetValue` | `facets[].id`, `facets[].name`, `facets[].count` |

---

## 5. Auth Flow

| Step | Storefront | JSON Config |
|------|------------|-------------|
| Login | LoginMutation → token in Set-Cookie | POST /api/storefront/auth/login → proxy sets cookie |
| Logout | LogoutMutation | POST /api/storefront/auth/logout |
| Register | RegisterCustomerAccountMutation | POST /api/storefront/auth/register |
| Verify | VerifyCustomerAccountMutation (token in URL) | POST /api/storefront/auth/verify |
| Forgot | RequestPasswordResetMutation | POST /api/storefront/auth/forgot-password |
| Reset | ResetPasswordMutation (token in URL) | POST /api/storefront/auth/reset-password |

**Gap:** Vendure returns auth token in `Set-Cookie` header. Direct client fetch receives it; ensure `credentials: 'include'` so cookies are sent on subsequent requests. CORS must allow credentials if Vendure is on a different origin.

---

## 6. Checkout Flow Logic

| Step | Guest | Logged-in |
|------|-------|-----------|
| Contact | ✅ First | ❌ Skip |
| Shipping | ✅ Second | ✅ First |
| Delivery | ✅ Third | ✅ Second |
| Payment | ✅ Fourth | ✅ Third |
| Review | ✅ Fifth | ✅ Fourth |

**Implementation:** Use `condition` on Contact AccordionItem: `{ "!": [{ "var": "auth.user" }] }` (show when not logged in).

---

## 7. Summary Checklist

- [ ] Direct fetch to Vendure GraphQL URL (no API routes)
- [ ] Fetch credentials for cookie-based auth
- [ ] Cart from server (activeOrder), not local append
- [ ] Variant selection → variantId for addToCart
- [ ] Facet filters → facetValueIds in search params
- [ ] Checkout accordion with guest vs logged-in steps
- [ ] Payment methods from API (eligiblePaymentMethods)
- [ ] Shipping methods from API (eligibleShippingMethods)
- [ ] Countries from API (availableCountries)
- [ ] Promo code apply/remove via API
- [ ] Order confirmation by code (`/order-confirmation/[code]`)
- [ ] Product carousel for featured products (if Carousel exists)
