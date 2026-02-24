/**
 * Structural pattern reference injected into the StructureAgent system prompt.
 *
 * Contains ONLY the key structural patterns as compact annotated snippets —
 * NOT a full page example (which would anchor the AI to one aesthetic).
 * The AI must apply these patterns with its own design choices from the spec.
 */

/**
 * Returns compact structural pattern snippets for injection into the StructureAgent prompt.
 * Each snippet shows only the minimum code needed to illustrate the correct pattern.
 */
export function buildFewShotExamples(): string {
  return `
STRUCTURAL PATTERNS (apply these exactly — use your own colors/content from the spec above):

PATTERN 1 — Grid: grid on CONTAINER (no map), map on ITEM inside
  WRONG: { "type": "Box", "map": "featured.categories", "props": { "className": "grid grid-cols-4 gap-6" } }
  RIGHT: { "type": "Box", "props": { "className": "grid grid-cols-2 md:grid-cols-4 gap-6" },
    "children": [{ "type": "Pressable", "map": "featured.categories", "key": "$item.id", ... }] }

PATTERN 2 — Category card: Pressable is clickable wrapper only. Inner Box owns the height.
  RIGHT: { "type": "Pressable", "props": { "className": "block rounded-xl overflow-hidden" }, "children": [
    { "type": "Box", "props": { "className": "relative w-full h-48" }, "children": [
      { "type": "NextImage", "props": { "src": "{{$item.imageUrl}}", "fill": true, "className": "object-cover" } },
      { "type": "Box", "props": { "className": "absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" } },
      { "type": "Box", "props": { "className": "absolute bottom-0 left-0 right-0 p-3" }, "children": [
        { "type": "Text", "props": { "className": "text-white font-bold text-lg text-center" }, "text": "{{$item.name}}" }
      ]}
    ]}
  ]}

PATTERN 3 — Product card: relative+h-52 wrapper required for NextImage fill
  RIGHT: { "type": "Box", "props": { "className": "flex flex-col rounded-xl overflow-hidden shadow-sm" }, "children": [
    { "type": "Box", "props": { "className": "relative w-full h-52" }, "children": [
      { "type": "NextImage", "props": { "src": "{{$item.productAsset.preview}}", "fill": true, "className": "object-cover" } }
    ]},
    { "type": "Box", "props": { "className": "p-4 flex flex-col gap-1" }, "children": [
      { "type": "Text", "text": "{{$item.productName}}" },
      { "type": "Text", "text": { "expr": { "formatCurrency": [{ "var": "$item.priceWithTax.value" }, 100] } } }
    ]}
  ]}

PATTERN 4 — Price: "expr" wrapper is MANDATORY
  WRONG: "text": "{{$item.priceWithTax.value}}"
  WRONG: "text": { "formatCurrency": [{ "var": "$item.priceWithTax.value" }, 100] }
  RIGHT: "text": { "expr": { "formatCurrency": [{ "var": "$item.priceWithTax.value" }, 100] } }

PATTERN 5 — flex-row: Box defaults flex-col. ALWAYS write flex-row explicitly for horizontal.
  WRONG: "className": "flex justify-between items-center"         ← still stacks vertically
  RIGHT: "className": "flex flex-row justify-between items-center"

PATTERN 6 — Newsletter input: InputField is DIRECT child of Input (never in InputSlot)
  WRONG: { "type": "Input", "children": [{ "type": "InputSlot", "children": [{ "type": "InputField" }] }] }
  RIGHT: { "type": "Input", "props": { "variant": "outline", "size": "md", "className": "flex-1 !rounded-md" },
    "children": [{ "type": "InputField", "props": { "placeholder": "Enter your email" },
      "actions": { "change": { "action": "setState", "payload": { "path": "screens.home.form.email", "value": "$event" } } }
    }]
  }

PATTERN 7 — Navbar: use featured.categories (brand-specific), NOT nav.collections (generic store)
  RIGHT: { "type": "Box", "id": "navbar-row", "props": { "className": "hidden md:flex flex-row items-center gap-6" },
    "children": [{ "type": "Pressable", "map": "featured.categories", "key": "$item.id",
      "actions": { "click": { "action": "navigate", "payload": { "routeConfig": "collection", "slug": "{{$item.slug}}" } } },
      "children": [{ "type": "Text", "props": { "className": "text-[var(--theme-header-text)] text-sm" }, "text": "{{$item.name}}" }]
    }]
  }

PATTERN 8 — Footer links: map on ITEM, maps featured.categories (NOT nav.collections)
  RIGHT: { "type": "Box", "props": { "className": "flex flex-col gap-1" }, "children": [
    { "type": "Pressable", "map": "featured.categories", "key": "$item.id",
      "actions": { "click": { "action": "navigate", "payload": { "routeConfig": "collection", "slug": "{{$item.slug}}" } } },
      "children": [{ "type": "Text", "props": { "className": "text-[var(--theme-footer-textMuted)]" }, "text": "{{$item.name}}" }]
    }
  ]}

PATTERN 9 — Testimonials: flex-row on CONTAINER, flex-1 on MAPPED item
  RIGHT: { "type": "Box", "props": { "className": "flex flex-col md:flex-row gap-6" },
    "children": [{ "type": "Box", "map": "testimonials.items", "key": "$item.id",
      "props": { "className": "flex-1 p-6 rounded-xl shadow-sm" }, "children": [...]
    }]
  }

PATTERN 10 — Announcement bar: flex-row with dismiss X button on right
  RIGHT: { "type": "Box", "props": { "className": "w-full bg-[var(--theme-announcement-bg)] py-2 px-4 flex flex-row items-center justify-between" }, "children": [
    { "type": "Box", "props": { "className": "flex-1" } },
    { "type": "Text", "props": { "className": "flex-1 text-[var(--theme-announcement-text)] text-sm text-center" }, "text": "Your message" },
    { "type": "Pressable", "props": { "className": "flex-none" },
      "actions": { "click": { "action": "setState", "payload": { "path": "screens.home.announcementDismissed", "value": true } } },
      "children": [{ "type": "Text", "props": { "className": "text-[var(--theme-announcement-text)] text-lg px-2" }, "text": "×" }]
    }
  ]}

PATTERN 11 — initActions: one fetch per mapped data path
  fetchNavCollections + fetchCart (always) + fetchFeaturedCategories + fetchNewArrivals + fetchBestSellers + fetchFlashSale + fetchTestimonials (add whichever sections you include)
`;
}
