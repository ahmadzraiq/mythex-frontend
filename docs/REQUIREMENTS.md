# E-Commerce Store – Requirements & Design Spec

> Full redesign from scratch. JSON-driven UI with new design and pages.

---

## 🌍 GLOBAL STRUCTURE (APPLIES TO ALL STORE PAGES)

### Header System

#### 1. Announcement Bar (Optional)
- Marketing message
- Flash sale countdown
- Closable
- Multi-language support

#### 2. Main Navbar (Sticky)
- **Left:** Logo (Home link)
- **Center:** Primary navigation (Men / Women / Kids / Accessories / Sale)
  - Mega menu (desktop)
- **Right:**
  - Search icon (opens Search Drawer)
  - Account icon
  - Wishlist icon (with counter)
  - Cart icon (with counter)

### Global Drawers / Overlays
- Mobile navigation drawer
- Search drawer (full overlay with suggestions)
- Cart drawer (mini cart)
- Filter drawer (mobile)
- Size guide modal
- Quick view modal

### Footer (Global)
- **Columns:** Shop | Help | Company | Account
- Newsletter signup
- **Bottom:** Payment icons, Social icons, Legal text

---

## 🏠 HOME PAGE

**Layout:** Main Store Layout

### Sections
1. **Hero Banner** – Campaign slider, CTA buttons, optional countdown, mobile-optimized images
2. **Featured Collections** – Collection cards, image + title + CTA, hover animation
3. **New Arrivals** – Product grid, wishlist icon, quick add to cart, dynamic pricing
4. **Best Sellers** – Product grid, rating preview
5. **Trending Categories** – Image grid layout, category links
6. **Flash Sale Section** – Countdown timer, discount badge, dynamic price override, limited stock indicator
7. **Brand Story Block** – Image + text, CTA to About page
8. **Instagram / Social Feed** – Clickable posts, shop-the-look option
9. **Newsletter Signup** – Email input, success state, optional privacy checkbox

---

## 🛍 SHOP PAGE (All Products)

**Layout:** Shop Layout

### Header Section
- Breadcrumb
- Page title
- Results count

### Filters
- **Desktop:** Sidebar filters
  - Size, Color, Price range slider, Brand, Fabric, Availability, Discount %
  - Clear all filters
- **Mobile:** Filter button → opens drawer

### Sorting Options
- Newest, Price low→high, Price high→low, Best selling, Recommended

### Product Grid
- Image (hover swap), Product title, Price, Compare-at price, Discount badge
- Wishlist button, Quick add option

### Display Options
- Grid / List toggle
- Infinite scroll or Pagination

### Empty State
- No results message, Clear filters button

---

## 👗 CATEGORY PAGE

**Layout:** Shop Layout

Includes everything from Shop Page plus:
- **Category Banner** – Image, category title, description
- **Subcategories Section** – Horizontal scroll or grid, clickable cards
- **Applied Filters Tags** – Removable filter chips

---

## 🔎 SEARCH RESULTS PAGE

**Layout:** Shop Layout

### Search Header
- Search input (sticky)
- Result count

### Auto-Suggest (Drawer)
- Product suggestions
- Category suggestions
- Recent searches
- Trending searches

### Results Section
- Same grid system as Shop
- Same filters
- "Did you mean?" suggestion
- No results state

---

## 👕 PRODUCT PAGE (CRITICAL)

**Layout:** Product Layout

### Main Product Section

**Left**
- Image gallery (multiple images)
- Zoom on hover
- Thumbnail navigation
- Optional product video

**Right**
- Product title
- Rating summary
- Dynamic pricing, Compare-at price, Discount badge
- Variant selectors (size / color)
- Stock status: In stock | Low stock | Out of stock
- Quantity selector
- Add to cart, Buy now, Wishlist, Share buttons
- Delivery estimate preview
- Size guide popup

### Product Info Tabs
- Description, Material & care, Delivery info, Returns policy
- Mobile → Accordion layout

### Reviews Section
- Rating breakdown
- Filter by rating
- Reviews list
- Add review form

### Cross-Sell Sections
- Related products
- Frequently bought together
- Bundle offers
- Recently viewed

### Sticky UX
- **Desktop:** Sticky product info panel
- **Mobile:** Sticky add-to-cart bar

---

## ❤️ WISHLIST PAGE

**Layout:** Main Layout

- Saved products grid
- Move to cart button
- Remove item
- Share wishlist link
- Empty state

---

## 🛒 CART PAGE

**Layout:** Cart Layout

### Cart Items List
- Image, Variant summary, Quantity update, Remove item, Save for later

### Coupon Section
- Apply discount code
- Error state handling

### Shipping Calculator
- Country selector, Zip code, Estimated cost

### Tax Preview
- Estimated tax breakdown

### Order Summary
- Subtotal, Discount, Shipping, Tax, Total

### Upsell Section
- Recommended products

### Checkout Button

---

## 💳 CHECKOUT

**Layout:** Minimal Checkout Layout (no mega menu, no promotional banners)

### Step 1 – Information
- Guest checkout
- Login option
- Email input
- Shipping address (address auto-complete)
- Save address option

### Step 2 – Shipping
- Multiple shipping methods
- Delivery estimate
- Shipping cost display

### Step 3 – Payment
- **Supported:** Stripe, Tabby, Tamara, Cash on Delivery
- Discount code field
- Order notes
- Terms checkbox
- Place order button

### Summary Sidebar (Sticky)
- Product list, Subtotal, Shipping, Tax, Total
- Mobile → collapsible

---

## ✅ ORDER CONFIRMATION PAGE

**Layout:** Minimal Layout

- Thank you message
- Order number
- Order summary
- Payment method
- Shipping address
- Download invoice
- Track order button
- Continue shopping

---

## 👤 CUSTOMER ACCOUNT

**Layout:** Account Layout

### Dashboard
- Welcome message
- Recent orders
- Loyalty points
- Quick links

### Orders Page
- Orders list, Status badge, View details

### Order Details
- Order summary
- Status timeline
- Tracking link
- Invoice download
- Return request button
- Reorder button

### Wishlist (Account View)
- Saved products

### Saved Addresses
- Add, Edit, Delete, Set default

### Loyalty Page
- Points balance
- Points history
- Rewards options

### Returns Page
- Select order → Select item → Choose reason → Upload image → Submit
- Track return status

---

## 📄 STATIC PAGES

- About Us
- Contact Us (form + contact info)
- FAQ
- Shipping Policy
- Returns Policy
- Privacy Policy
- Terms & Conditions
- Size Guide (optional standalone)

---

## 🚨 SYSTEM PAGES

- 404 page
- 500 error page
- Maintenance page
- Password reset page
- Email verification page
- Account activation page

---

## 📱 RESPONSIVE BEHAVIOR

| Breakpoint | Behavior |
|------------|----------|
| **Desktop** | Sidebar filters, Sticky summary panels, Mega menu |
| **Tablet** | Collapsed filters, 2–3 product columns |
| **Mobile** | Drawer navigation, Bottom sticky actions, Accordion info sections |
