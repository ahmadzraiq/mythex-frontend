---
name: styling-and-animation
description: Style and animate UI nodes — flat SxProps (layout, size, spacing, color, typography, border, position, effects), responsive breakpoints, the animation config, and popover/dropdown/tooltip panels. Use when styling, laying out, making responsive, or animating any node in a page or component.
---

# Styling & Animation

## SxProps — flat in `props`

Write all styling as flat keys directly in `props`. The server converts them to CSS.

### Layout

| key | values |
|-----|--------|
| `flex` | `true` — enables `display: flex` |
| `col` | `true` — flex + direction col (vertical stack) |
| `row` | `true` — flex + direction row (horizontal stack) |
| `grid` | `true` — enables `display: grid` |
| `center` | `true` — items: center + justify: center |
| `display` | `"flex"` \| `"grid"` \| `"block"` \| `"inline-block"` \| `"inline"` \| `"none"` — layout switching only; use `condition` to remove a node |
| `direction` | `"row"` \| `"col"` \| `"row-reverse"` \| `"col-reverse"` |
| `items` | `"start"` \| `"end"` \| `"center"` \| `"stretch"` \| `"baseline"` |
| `justify` | `"start"` \| `"end"` \| `"center"` \| `"between"` \| `"around"` \| `"evenly"` |
| `self` | `"auto"` \| `"start"` \| `"center"` \| `"end"` \| `"stretch"` |
| `wrap` | `"wrap"` \| `"nowrap"` \| `"wrap-reverse"` |
| `flex1` | `true` — flex: 1 |
| `cols` / `gridCols` | number — grid columns |
| `gridRows` | number |
| `gridFlow` | `"row"` \| `"col"` \| `"dense"` |
| `colSpan` | number |
| `colSpanFull` | `true` |
| `rowSpan` | number |
| `gap` | number (px) |
| `gapX` | number (px) |
| `gapY` | number (px) |

### Size

| key | values |
|-----|--------|
| `w` | number (px) \| `"full"` \| `"screen"` \| `"fit"` \| `"auto"` |
| `h` | number (px) \| `"full"` \| `"screen"` \| `"fit"` \| `"auto"` |
| `minW` | number (px) \| `"full"` \| `"fit"` \| `"auto"` |
| `maxW` | number (px) \| `"full"` \| `"fit"` |
| `minH` | number (px) \| `"full"` \| `"screen"` \| `"fit"` |
| `maxH` | number (px) \| `"full"` \| `"screen"` \| `"fit"` |

### Spacing

| key | values |
|-----|--------|
| `p` | number (px) |
| `px` | number (px) |
| `py` | number (px) |
| `pt` `pr` `pb` `pl` | number (px) |
| `m` | number (px) \| `"auto"` |
| `mx` | number (px) \| `"auto"` |
| `my` | number (px) \| `"auto"` |
| `mt` `mr` `mb` `ml` | number (px) |

### Color & typography

| key | values |
|-----|--------|
| `bg` | hex / css color string |
| `text` / `size` | number (font-size in px) |
| `textColor` / `color` | hex / css color string |
| `weight` | `"thin"` \| `"light"` \| `"normal"` \| `"medium"` \| `"semibold"` \| `"bold"` \| `"extrabold"` \| `"black"` |
| `textAlign` / `align` | `"left"` \| `"center"` \| `"right"` \| `"justify"` |
| `leading` | `"none"` \| `"tight"` \| `"snug"` \| `"normal"` \| `"relaxed"` \| `"loose"` |
| `tracking` | `"tighter"` \| `"tight"` \| `"normal"` \| `"wide"` \| `"wider"` \| `"widest"` |
| `textDecoration` | `"underline"` \| `"line-through"` \| `"no-underline"` |
| `textTransform` | `"uppercase"` \| `"lowercase"` \| `"capitalize"` |
| `uppercase` | `true` — shorthand for textTransform uppercase |
| `lowercase` | `true` — shorthand for textTransform lowercase |
| `textOverflow` | `"truncate"` |
| `whitespace` | `"nowrap"` \| `"pre"` \| `"normal"` |
| `wordBreak` | `"all"` \| `"words"` \| `"keep"` |

### Border & shape

| key | values |
|-----|--------|
| `border` | number (px width) |
| `borderStyle` | `"solid"` \| `"dashed"` \| `"dotted"` \| `"none"` |
| `borderColor` | hex / css color string |
| `radius` | number (px) — use `999` for pill/circle |
| `radiusTL` `radiusTR` `radiusBR` `radiusBL` | number (px) |

### Position & z

| key | values |
|-----|--------|
| `position` | `"relative"` \| `"absolute"` \| `"fixed"` \| `"sticky"` \| `"static"` |
| `absolute` | `true` — shorthand for position absolute |
| `relative` | `true` — shorthand for position relative |
| `fixed` | `true` — shorthand for position fixed |
| `sticky` | `true` — shorthand for position sticky |
| `inset0` | `true` — inset: 0 |
| `top` `right` `bottom` `left` | number (px) |
| `z` | number |

### Misc

| key | values |
|-----|--------|
| `overflow` | `"hidden"` \| `"auto"` \| `"visible"` \| `"scroll"` |
| `cursor` | `"pointer"` \| `"default"` \| `"not-allowed"` \| `"grab"` \| `"move"` \| `"text"` |
| `opacity` | number (0–1) |
| `objectFit` | `"cover"` \| `"contain"` \| `"fill"` \| `"none"` |
| `shadow` | `"sm"` \| `"md"` \| `"lg"` \| `"xl"` \| `"2xl"` \| `"none"` |

### Dynamic SxProp

Any SxProp value can be dynamic using `{ "js": "expr" }`:

```json
"bg": { "js": "isActive ? '#007AFF' : '#333333'" }
```

Dynamic `{ "js": "..." }` values are resolved at render time.

### Responsive — desktop-first, breakpoints as sibling props

Base props apply to all screens. Override smaller screens with `xl`, `lg`, or `md` sibling props inside `props`:

| sibling key | applies when viewport is |
|-------------|--------------------------|
| `xl` | ≤ 1280px |
| `lg` | ≤ 1024px |
| `md` | ≤ 768px |

```json
{
  "type": "Box",
  "props": {
    "p": 40,
    "lg": { "p": 24 },
    "md": { "p": 16 }
  }
}
```

- The base value (`"p": 40`) covers desktop and above.
- `lg` and `md` objects accept the same flat SxProps keys as base `props`.
- There is **no** `{ "default": ... }` per-key wrapper — use the sibling format above.

## Hover / press / scroll styles — shorthand in `props`

Write `hover`, `press`, or `scroll` directly in `props` alongside other SxProp keys. Any SxProp key inside the object (`bg`, `textColor`, `borderColor`, `opacity`, `radius`, etc.) is converted to CSS automatically. Animation-control keys (`scale`, `duration`, `easing`, `y`, `x`) stay flat on the phase:

```json
"props": {
  "bg": "#6366f1",
  "cursor": "pointer",
  "hover": { "bg": "#4f46e5", "scale": 1.02, "duration": 150 },
  "press": { "scale": 0.97, "opacity": 0.85, "duration": 100 }
}
```

## Animation — enter/exit/loop/scroll (motion) — `props.animation`

For entrance animations, looping effects, and scroll-triggered transitions use `props.animation`:

```json
"animation": {
  "enter": {
    "type": "fadeIn",
    "duration": 400,
    "delay": 0,
    "easing": "easeOut",
    "stagger": 80
  },
  "exit": {
    "type": "fadeOut",
    "duration": 300
  },
  "loop": {
    "type": "pulse",
    "duration": 1500,
    "repeatCount": -1
  },
  "scroll": {
    "type": "slideInUp",
    "duration": 500,
    "threshold": 0.2,
    "once": true
  }
}
```

**Enter types:** `fadeIn` | `slideInUp` | `slideInDown` | `slideInLeft` | `slideInRight` | `zoomIn` | `bounceIn` | `flipInX` | `blurIn` | `glowIn` | `revealUp` | `dropIn` | `riseFade`  
**Exit types:** `fadeOut` | `slideOutUp` | `slideOutDown` | `slideOutLeft` | `slideOutRight` | `zoomOut` | `blurOut`  
**Loop types:** `pulse` | `breathe` | `float` | `flash` | `spin` | `shake` | `wiggle` | `bounce` | `heartbeat` | `glowPulse`  
**Easing:** `linear` | `easeIn` | `easeOut` | `easeInOut` | `backIn` | `backOut` | `backInOut`

## Popover — floating panel / dropdown / tooltip

Add a `popover` config to any `Box` node to turn it into a trigger for a floating panel (dropdown menu, context menu, tooltip, etc.). One child of that node must have `"_popoverContent": true` — it renders in the float, not inline.

```json
{
  "type": "Box",
  "props": { "cursor": "pointer", "row": true, "items": "center", "gap": 8 },
  "popover": {
    "trigger": "click",
    "placement": "bottom-start",
    "offset": 4,
    "closeOnOutsideClick": true,
    "closeOnEscape": true,
    "matchTriggerWidth": false
  },
  "children": [
    {
      "type": "Text",
      "props": { "text": 14 },
      "text": "Options"
    },
    {
      "type": "Box",
      "_popoverContent": true,
      "props": { "col": true, "bg": "#ffffff", "radius": 8, "shadow": "lg", "p": 8, "minW": 160 },
      "children": [
        { "type": "Text", "props": { "text": 14, "p": 8, "cursor": "pointer" }, "text": "Edit" },
        { "type": "Text", "props": { "text": 14, "p": 8, "cursor": "pointer" }, "text": "Delete" }
      ]
    }
  ]
}
```

**`popover` fields:**

| field | type | default | notes |
|---|---|---|---|
| `trigger` | `"click"` \| `"hover"` | required | what opens the panel |
| `placement` | string | `"bottom"` | `top` \| `bottom` \| `left` \| `right`, each with optional `-start` or `-end` suffix |
| `offset` | number | `4` | px gap between trigger and panel |
| `closeOnOutsideClick` | boolean | `true` | close when clicking outside |
| `closeOnEscape` | boolean | `true` | close on Escape key |
| `matchTriggerWidth` | boolean | `false` | panel min-width matches trigger — useful for select dropdowns |
| `openVariable` | UUID string | — | syncs open/close state to a store variable for programmatic control |
| `componentId` | string | — | use a shared component as the floating content instead of an inline `_popoverContent` child |

**Rules:**
- The `_popoverContent` child is **not** rendered in the normal child flow — it always appears in the floating panel.
- Use `"trigger": "hover"` for tooltips.
- For a `select`-style dropdown, set `matchTriggerWidth: true`.
- `openVariable` UUID must point to a boolean variable; the popover reads and writes it automatically.
