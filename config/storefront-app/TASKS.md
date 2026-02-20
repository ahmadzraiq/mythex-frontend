# Storefront App – Migration Tasks

This document outlines the tasks to replicate the **Vendure storefront** (`/Users/ahmadzraiq/Desktop/my-store/apps/storefront`) in the JSON-based SDUI system. The backend (Vendure GraphQL) is ready; the frontend calls Vendure GraphQL directly (no API routes).

---

## Phase 1: Direct Vendure GraphQL Integration

Call Vendure GraphQL **directly** from the client. No Next.js API proxy.

### 1.1 GraphQL via Fetch

Use `type: "fetch"` (or a `type: "graphql"` action if added) to call the Vendure shop API:

- **URL:** `NEXT_PUBLIC_VENDURE_SHOP_API_URL` (e.g. `https://your-vendure.com/shop-api`)
- **Method:** POST
- **Headers:** `Content-Type: application/json`, `Authorization: Bearer {token}`, `vendure-token: {channel}`
- **Body:** `{ "query": "...", "variables": { ... } }`

### 1.2 Environment Variables

```env
NEXT_PUBLIC_VENDURE_SHOP_API_URL=https://your-vendure.com/shop-api
NEXT_PUBLIC_VENDURE_CHANNEL_TOKEN=__default_channel__
```

Auth token: stored in cookie `vendure-auth-token`; fetch must include credentials (e.g. `credentials: 'include'`) so cookies are sent.

### 1.3 Vendure Operations (Direct GraphQL)

| Operation | Query/Mutation | Variables |
|-----------|----------------|-----------|
| Collections | GetTopCollectionsQuery | — |
| Search | SearchProductsQuery | input |
| Product detail | GetProductDetailQuery | slug |
| Collection products | GetCollectionProductsQuery | slug, input |
| Active order (cart) | GetActiveOrderQuery | — |
| Active order (checkout) | GetActiveOrderForCheckoutQuery | — |
| Add to cart | AddToCartMutation | variantId, quantity |
| Remove from cart | RemoveFromCartMutation | lineId |
| Adjust quantity | AdjustCartItemMutation | lineId, quantity |
| Apply coupon | ApplyPromotionCodeMutation | couponCode |
| Remove coupon | RemovePromotionCodeMutation | couponCode |
| Countries | GetAvailableCountriesQuery | — |
| Shipping methods | GetEligibleShippingMethodsQuery | — |
| Payment methods | GetEligiblePaymentMethodsQuery | — |
| Set shipping address | SetOrderShippingAddressMutation | input |
| Set billing address | SetOrderBillingAddressMutation | input |
| Set shipping method | SetOrderShippingMethodMutation | shippingMethodId |
| Add payment | AddPaymentToOrderMutation | input |
| Set customer (guest) | SetCustomerForOrderMutation | input |
| Customer addresses | GetCustomerAddressesQuery | — |
| Customer orders | GetCustomerOrdersQuery | options |
| Order by code | GetOrderDetailQuery | code |
| Login | LoginMutation | username, password |
| Register | RegisterCustomerAccountMutation | input |
| Logout | LogoutMutation | — |
| Forgot password | RequestPasswordResetMutation | emailAddress |
| Reset password | ResetPasswordMutation | token, password |
| Verify account | VerifyCustomerAccountMutation | token, password |
| Update customer | UpdateCustomerMutation | input |
| Update password | UpdateCustomerPasswordMutation | currentPassword, newPassword |
| Create address | CreateCustomerAddressMutation | input |
| Update address | UpdateCustomerAddressMutation | input |
| Delete address | DeleteCustomerAddressMutation | id |

---

## Phase 2: Storefront Config Structure

### 2.1 Directory Layout

```
config/storefront-app/
├── README.md
├── TASKS.md (this file)
├── store.json
├── theme.json
├── routes.json
├── app.ts
├── actions/
│   ├── auth.json
│   ├── ecommerce.json
│   ├── layout.json
│   └── products.json
├── layouts/
│   ├── store.json
│   ├── account.json
│   ├── checkout-minimal.json
│   └── index.ts
├── fragments/
│   ├── header.json
│   ├── footer.json
│   ├── cart-drawer.json
│   ├── search-drawer.json
│   ├── facet-filters.json
│   ├── product-card.json
│   ├── product-card-list.json
│   ├── order-summary.json
│   ├── checkout-steps/
│   │   ├── contact-step.json
│   │   ├── shipping-step.json
│   │   ├── delivery-step.json
│   │   ├── payment-step.json
│   │   └── review-step.json
│   └── modals/
│       └── ...
├── screens/
│   ├── home.json
│   ├── search.json
│   ├── collection.json (dynamic: /collection/[slug])
│   ├── product.json (dynamic: /product/[slug])
│   ├── cart.json
│   ├── checkout.json
│   ├── order-confirmation.json (dynamic: /order-confirmation/[code])
│   ├── sign-in.json
│   ├── register.json
│   ├── forgot-password.json
│   ├── reset-password.json
│   ├── verify.json
│   ├── verify-pending.json
│   ├── account.json
│   ├── account-profile.json
│   ├── account-orders.json
│   ├── account-order-details.json (dynamic)
│   ├── account-addresses.json
│   ├── account-verify-email.json
│   └── not-found.json
└── index.ts (export entry)
```

### 2.2 Data Model Mapping (Vendure → JSON)

| Vendure | JSON Store Path |
|---------|-----------------|
| `activeOrder` | `cart` (fetched from API, not local state) |
| `activeCustomer` | `auth.user` |
| `search.items` | `search.results` or `collection.products` |
| `search.facetValues` | `search.facets` |
| `product` variants | `product.variants`, `product.selectedVariantId` |
| `orderByCode` | `order.detail` |

**Important:** Cart is **server-side** in Vendure. We must:
- Fetch `activeOrder` on cart/checkout screens
- Use `addToCart`, `removeFromCart`, `adjustCart` mutations via API
- No local `cart.items` append – use fetch actions

---

## Phase 3: Screens to Migrate

| Screen | Storefront Route | JSON Config | Key Features |
|--------|------------------|-------------|--------------|
| Home | `/` | home.json | Hero, Featured Products carousel, Value props (3 cards) |
| Search | `/search` | search.json | Search term, facets, sort, pagination, product grid |
| Collection | `/collection/[slug]` | collection.json | Facet filters sidebar, product grid, sort |
| Product | `/product/[slug]` | product.json | Image gallery, variants, add to cart |
| Cart | `/cart` | cart.json | Line items, promo code, order summary |
| Checkout | `/checkout` | checkout.json | Accordion steps (contact, shipping, delivery, payment, review) |
| Order Confirmation | `/order-confirmation/[code]` | order-confirmation.json | Order detail |
| Sign In | `/sign-in` | sign-in.json | Login form |
| Register | `/register` | register.json | Registration form |
| Forgot Password | `/forgot-password` | forgot-password.json | Email form |
| Reset Password | `/reset-password` | reset-password.json | Token + password |

---

## Phase 4: Components & Features to Support

### 4.1 Components Already Present (✅)

| Component | Status |
|-----------|--------|
| Accordion | ✅ |
| RadioGroup | ✅ |
| ProductCard | ✅ (via fragment) |
| ProductGrid | ✅ (Box + map + contents) |
| FacetFilters | ✅ (filter-sidebar, filter-chips) |
| SortDropdown | ✅ |
| Pagination | ✅ |
| CartDrawer | ✅ |
| SearchDrawer | ✅ |
| CountrySelect | ✅ (shared) |
| Skeleton | ✅ |

### 4.2 Components to Add or Verify

| Component | Storefront | Action |
|-----------|------------|--------|
| **ProductCarousel** | Featured products carousel | Add Carousel or horizontal ScrollView with product cards |
| **OrderStatusBadge** | Order state display | Add Badge with state mapping |
| **Price** (money formatting) | `formatCurrency` | Verify `formatCurrency` in computed-runner supports Vendure price format |
| **ThemeSwitcher** | Dark/light mode | Add if not in header |
| **OrderSummary** | Checkout sidebar | Create fragment for subtotal, shipping, discounts, total |

### 4.3 Feature Gaps

| Feature | Storefront | JSON-Based | Gap |
|---------|------------|------------|-----|
| **Cart source** | Server (activeOrder) | Local (cart.items) | **CRITICAL** – Must fetch cart from API, not append locally |
| **Auth token** | Cookie `vendure-auth-token` | Likely session/cookie | Ensure fetch actions send credentials/cookies |
| **Guest checkout** | SetCustomerForOrderMutation | placeOrder with email | Map to SetCustomerForOrder |
| **Variant selection** | product.variants[].id | product.selectedSize, selectedColor | Map to variantId for addToCart |
| **Facet filters** | facetValueIds in search | FacetValueFilters in SearchInput | Map facet IDs to search params |
| **Promo codes** | Add/remove coupon | applyCoupon (local) | Use API mutations |
| **Checkout steps** | Accordion, guest vs logged-in | Single form? | Implement accordion with conditional contact step |
| **Payment methods** | eligiblePaymentMethods from API | Hardcoded (card, tabby, cod) | Fetch from API |

---

## Phase 5: Action Definitions (storefront-app)

### 5.1 Auth Actions (Vendure – Direct GraphQL)

```json
{
  "login": {
    "type": "fetch",
    "url": "{{config.vendureUrl}}",
    "method": "POST",
    "body": {
      "query": "mutation Login($username: String!, $password: String!) { login(username: $username, password: $password) { __typename ... on CurrentUser { id identifier } ... on ErrorResult { errorCode message } } }",
      "variables": {
        "username": { "var": "form.email" },
        "password": { "var": "form.password" }
      }
    },
    "storeIn": "auth.loginResult",
    "responsePath": "data.login",
    "onSuccess": { "action": "navigate", "payload": { "path": "/" } }
  }
}
```

### 5.2 Cart Actions (Vendure – Direct GraphQL)

```json
{
  "addToCart": {
    "type": "fetch",
    "url": "{{config.vendureUrl}}",
    "method": "POST",
    "body": {
      "query": "mutation AddToCart($variantId: ID!, $quantity: Int!) { addItemToOrder(productVariantId: $variantId, quantity: $quantity) { __typename ... on Order { id code totalQuantity } ... on ErrorResult { errorCode message } } }",
      "variables": {
        "variantId": { "var": "product.selectedVariantId" },
        "quantity": { "var": "productQuantity" }
      }
    },
    "storeIn": "cart.addResult",
    "onSuccess": { "action": "refreshCart" }
  },
  "refreshCart": {
    "type": "fetch",
    "url": "{{config.vendureUrl}}",
    "method": "POST",
    "body": {
      "query": "query GetActiveOrder { activeOrder { id code state totalQuantity subTotal totalWithTax lines { id quantity productVariant { id name product { name slug featuredAsset { preview } } } unitPriceWithTax linePriceWithTax } } }",
      "variables": {}
    },
    "storeIn": "cart",
    "responsePath": "data.activeOrder"
  }
}
```

### 5.3 Checkout Flow

- **Guest:** Contact step → Shipping → Delivery → Payment → Review
- **Logged-in:** Shipping → Delivery → Payment → Review
- Use Accordion with `value` bound to `checkout.currentStep`
- Each step has `onComplete` that sets `checkout.completedSteps` and advances

---

## Phase 6: Missing Engine Features

| Feature | Description |
|---------|-------------|
| **Fetch with credentials** | Ensure `fetch` in engine sends `credentials: 'include'` for cookie-based auth |
| **Accordion value binding** | Accordion `value` and `onValueChange` – need setState for `checkout.currentStep` |
| **Dynamic route params** | `route.slug` for collection/product; `route.code` for order confirmation |
| **URL search params** | `route.q`, `route.sort`, `route.page`, `route.facets` for search/collection filtering |

---

## Phase 7: Implementation Order

1. **P0** – Add GraphQL support (fetch to Vendure URL with query/variables body) and credentials
2. **P0** – Create storefront-app config structure (store, routes, theme)
3. **P0** – Auth: login, register, logout, forgot-password, reset-password
4. **P0** – Home: hero, featured products (fetch from collection)
5. **P0** – Search: search API, facets, sort, pagination
6. **P0** – Collection: collection products, facets
7. **P0** – Product: detail, variants, add to cart (API)
8. **P0** – Cart: fetch active order, display lines, remove, adjust
9. **P0** – Checkout: accordion steps, set shipping/billing, set delivery, payment, place order
10. **P1** – Order confirmation
11. **P1** – Account: profile, orders, order details, addresses
12. **P1** – Verify email, verify-pending
13. **P2** – Promo codes, theme switcher, polish

---

## Summary: Critical Differences

| Aspect | Current JSON-Based | Storefront (Vendure) |
|--------|-------------------|----------------------|
| Cart | Local `cart.items` | Server `activeOrder` |
| API | REST mock | GraphQL Vendure |
| Auth | Login API → session? | Cookie `vendure-auth-token` |
| Product variants | selectedSize, selectedColor | variantId (productVariant.id) |
| Checkout | Single form | Multi-step accordion |
| Collections | Categories nav | Top-level collections |

---

## Next Steps

1. Create `config/storefront-app/` with base files
2. Implement `app/api/storefront/` proxy routes
3. Build screens incrementally (home → search → product → cart → checkout)
4. Test each flow against Vendure backend
