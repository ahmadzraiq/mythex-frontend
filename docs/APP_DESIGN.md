# Admin Dashboard App – Design Document

## 1. Overview

A JSON-driven admin dashboard with auth, CRUD tables, and rich UI components (Modal, Tooltip, Popover, Dropdown). All logic and API config in `app.json`.

---

## 2. API Endpoints

### Auth
| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/api/auth/login` | Login – body: `{ email, password }` |
| POST | `/api/auth/signup` | Signup – body: `{ name, email, password }` |
| POST | `/api/auth/forgot-password` | Request reset – body: `{ email }` |
| POST | `/api/auth/reset-password` | Reset with token – body: `{ token, password, confirmPassword }` |
| POST | `/api/auth/logout` | Logout (optional, or client-side clear) |

### Products (CRUD)
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/products` | List all products |
| GET | `/api/products/[id]` | Get single product |
| POST | `/api/products` | Create product |
| PUT | `/api/products/[id]` | Update product |
| DELETE | `/api/products/[id]` | Delete product |

### Profile
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/profile` | Get current user profile |
| PUT | `/api/profile` | Update profile – body: `{ name, email, avatar? }` |

---

## 3. Routes & Screens

```
/login              → Login form
/signup             → Signup form
/forgot-password    → Enter email for reset
/reset-password     → New password (token from query)
/dashboard          → Overview + quick stats
/dashboard/products → Products table (CRUD)
/profile            → User profile (view/edit)
```

---

## 4. UI Components

### 4.1 Modal
**Use cases:**
- Create product form
- Edit product form
- Delete confirmation
- View product details

**Config (JSON):**
```json
{
  "type": "Modal",
  "props": { "isOpen": "{{modal.createProduct}}", "onClose": "..." },
  "children": [ "...form or content..." ]
}
```

### 4.2 Tooltip
**Use cases:**
- Icon buttons (Edit, Delete, View)
- Table header info
- Form field hints

**Config:**
```json
{
  "type": "Tooltip",
  "props": { "content": "Edit this item" },
  "children": [{ "type": "Button", "text": "Edit" }]
}
```

### 4.3 Popover
**Use cases:**
- Filter/sort options
- Quick actions menu
- Date range picker

**Config:**
```json
{
  "type": "Popover",
  "props": { "trigger": "...", "placement": "bottom" },
  "children": [ "...menu content..." ]
}
```

### 4.4 Dropdown
**Use cases:**
- User menu (Profile, Logout)
- Table row actions (Edit, Delete, View)
- Category filter
- Sort options

**Config:**
```json
{
  "type": "Dropdown",
  "props": { "trigger": "..." },
  "children": [
    { "type": "DropdownItem", "text": "Edit", "action": "openEditModal" },
    { "type": "DropdownItem", "text": "Delete", "action": "confirmDelete" }
  ]
}
```

---

## 5. Screen Layouts

### 5.1 Auth Layout (Centered)
- Centered card
- Logo/title
- Form
- Links (Forgot password, Sign up, etc.)

### 5.2 Dashboard Layout (Sidebar + Header)
```
┌─────────────────────────────────────────────────┐
│ Header: Logo | Nav | [Search] | [Profile ▼]     │
├──────────┬──────────────────────────────────────┤
│ Sidebar  │                                      │
│ - Dashboard                                     │
│ - Products                                      │
│ - Profile                                       │
│          │  Main Content                        │
│          │  (tables, forms, cards)               │
│          │                                      │
└──────────┴──────────────────────────────────────┘
```

### 5.3 Profile Page
- Avatar (with upload)
- Name, Email (editable)
- Change password section
- Save button

---

## 5.4 Wireframe – Dashboard with Table

```
┌────────────────────────────────────────────────────────────────────┐
│  Logo    Dashboard  Products  Profile          [Search]  [Avatar ▼] │
├─────────┬──────────────────────────────────────────────────────────┤
│         │  Products                                    [+ Add New]  │
│ Dashboard│  ┌─────────────────────────────────────────────────────┐ │
│ Products │  │ Name        │ Price   │ Category │ Actions          │ │
│ Profile  │  ├─────────────┼─────────┼──────────┼──────────────────┤ │
│         │  │ Product A   │ $10.00  │ Cat 1    │ [⋮] Edit | Delete │ │
│         │  │ Product B   │ $25.00  │ Cat 2    │ [⋮] Edit | Delete │ │
│         │  └─────────────────────────────────────────────────────┘ │
└─────────┴──────────────────────────────────────────────────────────┘

[⋮] = Dropdown/Menu with Edit, Delete (Tooltip: "Actions")
```

---

## 5.5 Wireframe – Modal (Create/Edit Product)

```
┌─────────────────────────────────────────┐
│  Add Product                        [X] │
├─────────────────────────────────────────┤
│  Name:    [________________]             │
│  Price:   [________________]             │
│  Category:[________________]  (Dropdown) │
│  Desc:    [________________]             │
│           [________________]             │
├─────────────────────────────────────────┤
│                    [Cancel]  [Save]     │
└─────────────────────────────────────────┘
```

---

## 5.6 Wireframe – Profile Page

```
┌─────────────────────────────────────────────────┐
│  Profile                                         │
├─────────────────────────────────────────────────┤
│  ┌─────┐                                         │
│  │ 👤  │  Name:  [John Doe        ]              │
│  │     │  Email: [john@example.com]  (Tooltip:   │
│  └─────┘         Cannot change email)            │
│  [Change Photo]                                  │
│                                                  │
│  Change Password                                 │
│  Current: [••••••••]                             │
│  New:     [••••••••]                             │
│  Confirm: [••••••••]                             │
│                                                  │
│                              [Save Changes]      │
└─────────────────────────────────────────────────┘
```

---

## 6. Component Registry Additions

| Component | Status | Purpose |
|-----------|--------|---------|
| Modal | ✅ Exists (`components/ui/modal`) | Overlay dialogs |
| Tooltip | ✅ Exists (`components/ui/tooltip`) | Hover hints |
| Popover | ✅ Exists (`components/ui/popover`) | Floating menus |
| Menu | ✅ Exists (`components/ui/menu`) | Dropdown action menus |
| Table | To add | Data grid |
| Avatar | ✅ Exists | User image |
| Badge | ✅ Exists | Status, count |

**Note:** Modal, Tooltip, Popover, Menu need to be added to SDUI component registry for JSON-driven use.

---

## 7. State & Actions (app.json)

### State
- `auth.user`, `auth.error`
- `products` (list)
- `modal.createProduct`, `modal.editProduct`, `modal.deleteConfirm`
- `profile` (user data)

### Actions
- `login`, `signup`, `forgotPassword`, `resetPassword`, `logout`
- `fetchProducts`, `createProduct`, `updateProduct`, `deleteProduct`
- `openModal`, `closeModal`
- `fetchProfile`, `updateProfile`

---

## 8. Validation (All Forms)

Use **react-hook-form + yup** for client-side validation. Rules defined in JSON, mapped to yup schema.

### 8.1 Login
| Field | Rules |
|-------|-------|
| email | required, pattern: email |
| password | required |

### 8.2 Signup
| Field | Rules |
|-------|-------|
| name | required, minLength: 2 |
| email | required, pattern: email |
| password | required, minLength: 8 |
| confirmPassword | required, equals: password, message: "Passwords must match" |

### 8.3 Forgot Password
| Field | Rules |
|-------|-------|
| email | required, pattern: email |

### 8.4 Reset Password
| Field | Rules |
|-------|-------|
| password | required, minLength: 8 |
| confirmPassword | required, equals: password, message: "Passwords must match" |

### 8.5 Product (Create/Edit)
| Field | Rules |
|-------|-------|
| name | required, minLength: 2 |
| price | required, positive number |
| category | required |
| description | optional, maxLength: 500 |

### 8.6 Profile
| Field | Rules |
|-------|-------|
| name | required, minLength: 2 |
| email | required, pattern: email |
| currentPassword | required when changing password |
| newPassword | minLength: 8 when provided |
| confirmPassword | equals: newPassword when provided |

### 8.7 Validation UX
- **Inline errors** – Show under each field on blur/submit
- **Form-level error** – API errors (e.g. "Invalid credentials") at top of form
- **Success feedback** – Toast or inline message after save
- **Loading state** – Disable submit button, show spinner during API call
- **Clear on success** – Reset form after successful create/update

---

## 9. Design System & Visual Design

### 9.1 Design Principles
- **Consistency** – Same patterns for forms, buttons, tables across the app
- **Clarity** – Clear labels, helpful placeholders, visible error states
- **Feedback** – Loading, success, error states for every action
- **Accessibility** – Focus states, ARIA where needed, keyboard navigation
- **Whitespace** – Adequate padding; avoid cramped layouts

### 9.2 Color Palette
| Token | Use |
|-------|-----|
| `primary` | Main actions, links, active states |
| `primary-50` to `primary-900` | Backgrounds, hover, pressed |
| `error` | Validation errors, destructive actions |
| `success` | Success messages, confirmations |
| `warning` | Warnings, caution |
| `typography-900` | Headings |
| `typography-600` | Body text |
| `typography-500` | Secondary text, placeholders |
| `background-50` | Page background |
| `background-100` | Cards, inputs |

### 9.3 Typography
| Element | Size | Weight |
|---------|------|--------|
| Page title | xl/2xl | semibold |
| Section title | lg | semibold |
| Card title | md | medium |
| Body | sm/md | normal |
| Caption | xs | normal |
| Error text | sm | normal, error color |

### 9.4 Spacing
- **Card padding:** p-4 to p-6
- **Form gaps:** mb-4 between fields, mb-6 before submit
- **Section gaps:** mb-8 between sections
- **Table:** p-4, row gap consistent

### 9.5 Components Styling
- **Buttons:** Rounded (rounded-lg), clear primary/secondary/ghost variants
- **Inputs:** Outline variant, focus ring, error border when invalid
- **Cards:** Subtle shadow, rounded corners, hover for clickable
- **Tables:** Zebra striping optional, hover on row, clear header
- **Modals:** Backdrop blur, centered, max-width for forms

### 9.6 Responsive
- **Mobile:** Stack layout, full-width forms, collapsible sidebar
- **Tablet:** Sidebar collapse to icons
- **Desktop:** Full sidebar, comfortable max-width for content

### 9.7 Dark Mode (Optional)
- Support `prefers-color-scheme` or manual toggle
- Invert background/typography tokens

---

## 10. Implementation Order

1. **Phase 1:** Add Modal, Tooltip, Popover, Menu to component registry
2. **Phase 2:** API routes (auth + products CRUD)
3. **Phase 3:** Dashboard layout (sidebar, header)
4. **Phase 4:** Products table + CRUD modals (with validation)
5. **Phase 5:** Forgot/Reset password screens (with validation)
6. **Phase 6:** Profile page (with validation)
7. **Phase 7:** Polish – tooltips, dropdowns, loading states, success/error feedback

---

## 11. JSON Config Structure (High Level)

```json
{
  "routes": [...],
  "screens": {
    "login": {...},
    "signup": {...},
    "forgotPassword": {...},
    "resetPassword": {...},
    "dashboard": {...},
    "products": {...},
    "profile": {...}
  },
  "actions": {
    "login": {...},
    "signup": {...},
    "forgotPassword": {...},
    "resetPassword": {...},
    "fetchProducts": {...},
    "createProduct": {...},
    "updateProduct": {...},
    "deleteProduct": {...},
    "fetchProfile": {...},
    "updateProfile": {...},
    "openModal": {...},
    "closeModal": {...}
  }
}
```
