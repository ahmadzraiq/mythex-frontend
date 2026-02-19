# SDUI Schema Reference

**Purpose:** This document defines the JSON schema for building screens, layouts, fragments, and actions. Use it when generating or modifying config files.

---

## 1. Project Structure

```
config/
├── app.ts              # Merges all config, resolves $ref/$slot
├── routes.json         # Paths, redirects, auth, layout
├── screens/            # One .json per screen
├── layouts/            # Layout structures (authenticated.json)
├── fragments/          # Reusable UI (header, drawer, modals/*)
└── actions/            # Action definitions (auth, products, layout, other)
```

**To add a screen:** Create `screens/myScreen.json`, add route in `routes.json`, import in `app.ts`.

---

## 2. Screen Schema

### Option A: Screen with layout (header + drawer)

```
layout: "authenticated"  → wraps content with header + drawer
content: { ... } or [ ... ]  → injected into layout's $slot
```

```json
{
  "meta": { "title": "Dashboard", "description": "..." },
  "state": { "modal": { "create": false } },
  "layout": "authenticated",
  "content": { "type": "Box", "children": [...] },
  "initActions": [{ "action": "fetchProducts" }]
}
```

### Option B: Screen without layout (standalone)

```
ui: { ... }  → direct root
```

```json
{
  "meta": { "title": "Login" },
  "state": { "form": { "email": "", "password": "" } },
  "ui": { "type": "Box", "children": [...] },
  "initActions": []
}
```

### Screen fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| meta | object | no | title, description |
| state | object | no | Initial state (form, modal, etc.) |
| layout | string | no | "authenticated" or omit |
| content | node or array | if layout | Content for $slot |
| ui | node | if no layout | Root UI tree |
| initActions | array | no | Actions to run on mount |

---

## 3. UI Node Schema

Every UI node has:

| Field | Type | Description |
|-------|------|-------------|
| type | string | Component: Box, Text, HStack, VStack, Button, Card, Form, Modal, etc. |
| props | object | Component props (className, size, variant, etc.) |
| children | array | Child nodes |
| text | string | Text content (use with {{variable}} interpolation) |
| condition | JSON Logic | Render only when truthy |
| map | string | State path to array; renders node per item |
| actions | object | Event handlers: click, change, etc. |
| $ref | string | Reference fragment: "fragments/modals/createProduct" |
| $slot | string | Layout placeholder: "content" |

### Interpolation

Use `{{path}}` in strings to inject state:

- `{{form.email}}` – nested state
- `{{auth.user.name}}` – auth user
- `{{meta.title}}` – screen title (from meta)
- `{{layout.drawerOpen}}` – drawer state (Redux)
- `{{route.path}}` – current path (/dashboard, /profile, etc.)
- `{{$item.name}}` – current item in map loop
- `{{$index}}` – index in map loop

### Condition (JSON Logic)

```json
{ "var": "showGradient" }
{ "==": [{ "var": "route.path" }, "/dashboard"] }
{ "!=": [{ "var": "route.path" }, "/dashboard"] }
{ "and": [{ ">": [{ "var": "count" }, 0] }, { "var": "isActive" }] }
```

### Map (loop)

```json
{
  "type": "Card",
  "map": "products.list",
  "key": "product",
  "children": [{ "type": "Text", "text": "{{$item.name}}" }]
}
```

### Actions

```json
"actions": {
  "click": { "action": "navigate", "payload": { "path": "/dashboard" } },
  "change": { "action": "setState", "payload": { "path": "form.email", "value": "$event" } }
}
```

---

## 4. Layout Schema

Layouts define structure with `$ref` and `$slot`:

```json
{
  "structure": {
    "type": "Box",
    "children": [
      { "$ref": "fragments/header" },
      { "type": "Box", "children": [{ "$slot": "content" }] },
      { "$ref": "fragments/drawer" }
    ]
  }
}
```

- `$ref` – resolved to fragment content
- `$slot` – replaced with screen's content

---

## 5. Fragment Schema

Fragments are reusable UI pieces. Reference with `$ref`.

**Path format:** `fragments/header`, `fragments/drawer`, `fragments/modals/createProduct`

**Register:** Add to `config/fragments/index.ts`: `'fragments/name': import`

**Example fragment:** `config/fragments/modals/createProduct.json` – a single UI node (Modal, Box, etc.).

---

## 6. Action Schema

Actions live in `config/actions/*.json`. Reference by name: `{ "action": "login" }`.

### fetch

```json
{
  "type": "fetch",
  "url": "/api/products",
  "method": "GET",
  "storeIn": "products.list",
  "responsePath": "data",
  "body": { "email": { "var": "form.email" } },
  "onSuccess": { "action": "navigate", "payload": { "path": "/dashboard" } }
}
```

### set (Redux state)

```json
{
  "type": "set",
  "path": "layout",
  "value": { "drawerOpen": true }
}
```

### setState (screen state)

```json
{
  "action": "setState",
  "payload": { "path": "modal.create", "value": true }
}
```

### navigate

```json
{ "action": "navigate", "payload": { "path": "/dashboard" } }
```

### validate

```json
{
  "type": "validate",
  "rules": {
    "form.email": { "required": true, "pattern": "email" },
    "form.password": { "required": true, "minLength": 8 }
  },
  "storeErrorsIn": "errors",
  "onSuccess": { "action": "login" }
}
```

### runMultiple

```json
{
  "type": "runMultiple",
  "actions": [
    { "action": "closeDrawer" },
    { "action": "navigate", "payload": { "path": "/dashboard" } }
  ]
}
```

---

## 7. Route Schema

`config/routes.json`:

```json
{
  "defaultRedirect": "/login",
  "routes": [
    { "path": "/dashboard", "config": "dashboard", "auth": true, "layout": "full" },
    { "path": "/login", "config": "login", "auth": false, "layout": "centered" }
  ]
}
```

| Field | Description |
|-------|-------------|
| path | URL path |
| config | Screen name (matches config key in app.ts) |
| auth | true = requires auth |
| layout | "full" = authenticated layout, "centered" = centered |
| redirect | Redirect path (no config) |

---

## 8. Form Schema

Form must wrap FormInputWithLabel and FormSubmitButton. FormSubmitButton must be a child of Form.

```json
{
  "type": "Form",
  "props": {
    "defaultValues": { "form": { "product": { "var": ["form.product", {}] } } },
    "validationRules": {
      "form.product.name": { "required": true, "minLength": 2 },
      "form.product.price": { "required": true, "min": 0 }
    },
    "submitAction": "createProduct"
  },
  "children": [
    { "type": "Box", "children": [/* FormInputWithLabel */] },
    { "type": "ModalFooter", "children": [
      { "type": "Button", "text": "Cancel", "actions": { "click": { "action": "closeCreateModal" } } },
      { "type": "FormSubmitButton", "props": { "action": "primary" }, "text": "Save" }
    ]}
  ]
}
```

---

## 9. Modal Schema

```json
{
  "type": "Modal",
  "props": {
    "isOpen": "{{modal.create}}",
    "onClose": { "action": "closeCreateModal" },
    "closeOnOverlayClick": true
  },
  "children": [
    { "type": "ModalBackdrop", "actions": { "click": { "action": "closeCreateModal" } } },
    { "type": "ModalContent", "children": [...] }
  ]
}
```

---

## 10. Available Components

All components from `@/components/ui/*` are supported. Use `type` in JSON to reference them.

### Layout
| Component | Description |
|-----------|-------------|
| Box | Flex container, base layout |
| View | Base view (react-native) |
| HStack | Horizontal stack |
| VStack | Vertical stack |
| Center | Centered content |
| Grid | CSS grid layout |
| GridItem | Grid cell |
| Divider | Horizontal/vertical divider |

### Typography
| Component | Description |
|-----------|-------------|
| Text | Body text |
| Heading | Headings (size: xs–6xl) |

### Interactive
| Component | Description |
|-----------|-------------|
| Button | Primary action (use `text` or children) |
| ButtonText | Button label |
| ButtonIcon | Button icon |
| ButtonSpinner | Loading spinner in button |
| Pressable | Pressable area |
| Link | Navigation link |
| LinkText | Link label |

### Form
| Component | Description |
|-----------|-------------|
| Form | Form wrapper (defaultValues, validationRules, submitAction) |
| FormInputWithLabel | Input with label (name, label required) |
| FormSubmitButton | Submit button (must be inside Form) |
| Input | Text input (composite: Input + InputField) |
| InputField | Raw input field |
| InputIcon | Input icon |
| Checkbox | Checkbox (value required) |
| CheckboxIndicator | Checkbox indicator |
| CheckboxIcon | Checkbox check icon |
| CheckboxLabel | Checkbox label |
| Switch | Toggle switch |
| Textarea | Multi-line input |
| TextareaInput | Textarea field |
| Radio | Radio option (value required) |
| RadioGroup | Radio group |
| RadioIndicator | Radio indicator |
| RadioLabel | Radio label |
| RadioIcon | Radio icon |
| Select | Dropdown select |
| SelectTrigger | Select trigger |
| SelectInput | Select input |
| SelectIcon | Select icon |
| SelectPortal | Select portal |
| SelectBackdrop | Select backdrop |
| SelectContent | Select content |
| SelectDragIndicator | Select drag indicator |
| SelectDragIndicatorWrapper | Wrapper for drag indicator |
| SelectItem | Select option (label, value required) |
| SelectScrollView | Select scroll container |
| SelectVirtualizedList | Virtualized list for select |
| SelectFlatList | Flat list for select |
| SelectSectionList | Section list for select |
| SelectSectionHeaderText | Section header text |
| FormControl | Form control wrapper |
| FormControlLabel | Form control label |
| FormControlLabelText | Form control label text |
| FormControlError | Error message |
| FormControlErrorText | Error text |
| FormControlHelper | Helper text |
| FormControlHelperText | Helper text content |

### Data display
| Component | Description |
|-----------|-------------|
| Table | Table container |
| TableHeader | Table header |
| TableBody | Table body |
| TableRow | Table row |
| TableHead | Table header cell |
| TableData | Table data cell |
| Card | Card container |
| Badge | Badge/tag |
| BadgeText | Badge text |
| BadgeIcon | Badge icon |
| Alert | Alert message |
| AlertText | Alert text |
| AlertIcon | Alert icon |
| Skeleton | Loading skeleton |
| SkeletonText | Skeleton text |
| Avatar | User avatar |
| AvatarImage | Avatar image |
| AvatarFallbackText | Avatar fallback |
| Progress | Progress bar |
| ProgressFilledTrack | Progress fill |

### Overlay
| Component | Description |
|-----------|-------------|
| Modal | Modal dialog |
| ModalBackdrop | Modal backdrop |
| ModalContent | Modal content |
| ModalHeader | Modal header |
| ModalBody | Modal body |
| ModalFooter | Modal footer |
| ModalCloseButton | Modal close button |
| Drawer | Drawer/sidebar |
| DrawerBackdrop | Drawer backdrop |
| DrawerContent | Drawer content |
| DrawerHeader | Drawer header |
| DrawerBody | Drawer body |
| DrawerFooter | Drawer footer |
| DrawerCloseButton | Drawer close button |
| Popover | Popover |
| PopoverBackdrop | Popover backdrop |
| PopoverContent | Popover content |
| PopoverHeader | Popover header |
| PopoverBody | Popover body |
| PopoverFooter | Popover footer |
| PopoverCloseButton | Popover close button |
| Tooltip | Tooltip (needs trigger) |
| TooltipContent | Tooltip content |
| TooltipText | Tooltip text |
| Menu | Menu (needs trigger) |
| MenuItem | Menu item |
| MenuItemLabel | Menu item label |
| MenuSeparator | Menu separator |
| Actionsheet | Action sheet |
| ActionsheetContent | Actionsheet content |
| ActionsheetItem | Actionsheet item |
| ActionsheetItemText | Actionsheet item text |
| ActionsheetDragIndicator | Actionsheet drag indicator |
| ActionsheetDragIndicatorWrapper | Wrapper for drag indicator |
| ActionsheetBackdrop | Actionsheet backdrop |
| ActionsheetScrollView | Actionsheet scroll |
| ActionsheetIcon | Actionsheet icon |
| ActionsheetVirtualizedList | Virtualized list |
| ActionsheetFlatList | Flat list |
| ActionsheetSectionList | Section list |
| ActionsheetSectionHeaderText | Section header text |
| AlertDialog | Confirmation dialog |
| AlertDialogContent | AlertDialog content |
| AlertDialogCloseButton | AlertDialog close |
| AlertDialogHeader | AlertDialog header |
| AlertDialogFooter | AlertDialog footer |
| AlertDialogBody | AlertDialog body |
| AlertDialogBackdrop | AlertDialog backdrop |
| BottomSheet* | Bottom sheet (requires react-native-gesture-handler, react-native-reanimated) |

### Feedback & media
| Component | Description |
|-----------|-------------|
| Spinner | Loading spinner |
| Icon | Icon (as, name, size) |
| Image | Image (source, alt) |
| NextImage | Next.js Image (src, alt, fill, width, height) |

### Scroll & layout
| Component | Description |
|-----------|-------------|
| ScrollView | Scrollable container |
| SafeAreaView | Safe area wrapper |

### FAB
| Component | Description |
|-----------|-------------|
| Fab | Floating action button |
| FabLabel | FAB label |
| FabIcon | FAB icon |

### Accordion
| Component | Description |
|-----------|-------------|
| Accordion | Accordion container |
| AccordionItem | Accordion item (value, children) |
| AccordionHeader | Accordion header |
| AccordionTrigger | Accordion trigger |
| AccordionTitleText | Accordion title |
| AccordionContentText | Accordion content text |
| AccordionIcon | Accordion icon |
| AccordionContent | Accordion content |

### Slider
| Component | Description |
|-----------|-------------|
| Slider | Slider input |
| SliderThumb | Slider thumb |
| SliderTrack | Slider track |
| SliderFilledTrack | Slider filled track |

---

## 11. Quick Reference: Adding a New Screen

1. Create `config/screens/myScreen.json`
2. Add route in `config/routes.json`
3. Import screen in `config/app.ts`

**With layout (header + drawer):**
```json
{ "meta": { "title": "My Screen" }, "layout": "authenticated", "content": {...} }
```

**Without layout:**
```json
{ "meta": { "title": "My Screen" }, "layout": "authenticated", "ui": {...} }
```

**With modals:** Use `content: [ mainContent, { "$ref": "fragments/modals/myModal" } ]` and register modal in `fragments/index.ts`.
