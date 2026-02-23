/**
 * Minimal SDUI JSON examples for each common e-commerce section type.
 * These are injected into the page-generator prompt as "show don't tell" patterns.
 * Each example is minimal but 100% correct — the AI copies the structure, not improvises.
 *
 * KEY RULES encoded in these examples:
 * 1. Never use NextImage with local paths (/images/...) — use CSS gradient boxes for editorial images.
 * 2. Always pre-populate state with demo data for any section that uses "map" over a data path.
 * 3. CountdownTimer must be stacked vertically (flex-col) below the section heading — never inline.
 * 4. Brand story / hero editorial copy must be string literals in "text", not {{state}} interpolation.
 */

export const SECTION_EXAMPLES: Record<string, object> = {
  'announcement-bar': {
    type: 'Box',
    props: { className: 'w-full h-10 flex flex-row items-center justify-center gap-4 bg-[var(--theme-announcement-bg)] px-4' },
    children: [
      { type: 'Text', props: { className: 'text-sm font-medium text-[var(--theme-announcement-text)]' }, text: '🚚 Free shipping on orders over $50' },
      { type: 'NavIcon', props: { icon: 'X', size: 14, className: 'text-[var(--theme-announcement-text)] cursor-pointer' } },
    ],
  },

  // Hero split: text on the left, CSS gradient pane on the right.
  // NEVER put a NextImage with a local path here — use a gradient box that always renders.
  'hero-split': {
    type: 'Box',
    props: { className: 'w-full min-h-[90vh] flex flex-row items-center bg-[var(--theme-hero-bg)]' },
    children: [
      {
        type: 'Box',
        props: { className: 'flex-1 flex flex-col gap-6 px-12 py-16' },
        children: [
          { type: 'Heading', props: { size: '4xl', className: 'font-bold text-[var(--theme-content-text)]' }, text: '{{hero.heading}}' },
          { type: 'Text', props: { className: 'text-lg text-[var(--theme-content-textMuted)]' }, text: '{{hero.subheading}}' },
          {
            type: 'Box', props: { className: 'flex flex-row gap-4' },
            children: [
              { type: 'Button', props: { className: '!bg-[var(--theme-shop-button)] !text-[var(--theme-shop-buttonText)]' }, actions: { click: { action: 'navigate', payload: { path: '/collection' } } }, children: [{ type: 'ButtonText', text: 'Shop Now' }] },
              { type: 'Button', props: { variant: 'outline', className: '!border-[var(--theme-shop-button)] !text-[var(--theme-shop-button)]' }, actions: { click: { action: 'navigate', payload: { path: '/collection/new-arrivals' } } }, children: [{ type: 'ButtonText', text: 'New Arrivals' }] },
            ],
          },
        ],
      },
      // Right pane: CSS gradient — always renders, never breaks. Adapt gradient colors to the brand mood.
      {
        type: 'Box',
        props: { className: 'flex-1 min-h-[90vh] bg-gradient-to-br from-slate-200 to-slate-400 dark:from-slate-700 dark:to-slate-900' },
      },
    ],
  },

  'hero-centered': {
    type: 'Box',
    props: { className: 'w-full min-h-[70vh] flex flex-col items-center justify-center gap-6 px-6 bg-[var(--theme-hero-bg)]' },
    children: [
      { type: 'Heading', props: { size: '4xl', className: 'font-bold text-center text-[var(--theme-content-text)]' }, text: '{{hero.heading}}' },
      { type: 'Text', props: { className: 'text-lg text-center text-[var(--theme-content-textMuted)] max-w-xl' }, text: '{{hero.subheading}}' },
      { type: 'Button', props: { className: '!bg-[var(--theme-shop-button)] !text-[var(--theme-shop-buttonText)] px-8' }, actions: { click: { action: 'navigate', payload: { path: '/collection' } } }, children: [{ type: 'ButtonText', text: 'Shop Now' }] },
    ],
  },

  // Category grid: demo state pre-populated with 4 items using solid background colors.
  // initActions can call fetchFeaturedCategories to replace with real API data.
  // Cards use a solid color background — no NextImage, no broken image risk.
  // NOTE: state must always include this demo data so the section renders in preview.
  'featured-categories': {
    _stateNote: 'Add to screen state: { "featured": { "categories": [ { "id": "1", "name": "Women", "slug": "women", "bg": "bg-rose-400" }, { "id": "2", "name": "Men", "slug": "men", "bg": "bg-blue-400" }, { "id": "3", "name": "Accessories", "slug": "accessories", "bg": "bg-amber-400" }, { "id": "4", "name": "Sale", "slug": "sale", "bg": "bg-emerald-400" } ] } }',
    type: 'Box',
    props: { className: 'w-full py-16 px-6 bg-[var(--theme-content-bg)]' },
    children: [
      { type: 'Heading', props: { size: '2xl', className: 'font-bold text-center text-[var(--theme-content-text)] mb-10' }, text: 'Shop by Category' },
      {
        type: 'Box', props: { className: 'max-w-6xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-6' },
        children: [
          {
            type: 'Box', map: 'featured.categories', key: '$item.id', props: { className: 'contents' },
            children: [
              {
                type: 'Pressable', props: { className: 'group rounded-xl overflow-hidden aspect-square flex flex-col items-center justify-end pb-4 bg-[var(--theme-shop-button)] hover:opacity-80' },
                actions: { click: { action: 'navigate', payload: { routeConfig: 'collection', slug: { var: '$item.slug' } } } },
                children: [
                  { type: 'Text', props: { className: 'text-[var(--theme-shop-buttonText)] font-semibold text-lg drop-shadow-sm text-center' }, text: '{{$item.name}}' },
                ],
              },
            ],
          },
        ],
      },
    ],
  },

  // Flash sale: heading + CountdownTimer stacked in flex-col — NEVER put them side by side in flex-row.
  // CountdownTimer inline with heading causes "⚡ Flash Sale36 d : 08 h" run-on text.
  'flash-sale': {
    type: 'Box',
    props: { className: 'w-full py-16 px-6 bg-[var(--theme-shop-button)]' },
    children: [
      {
        type: 'Box', props: { className: 'max-w-6xl mx-auto' },
        children: [
          // Heading and timer stacked vertically — timer is always on its own row
          {
            type: 'Box', props: { className: 'flex flex-col gap-2 mb-8' },
            children: [
              { type: 'Heading', props: { size: '2xl', className: 'font-bold text-white' }, text: '⚡ Flash Sale' },
              { type: 'CountdownTimer', props: { target: '{{flashSale.endsAt}}', className: 'text-white font-mono text-lg font-bold' } },
            ],
          },
          {
            type: 'Carousel', props: { loop: true, align: 'start', showArrows: true },
            children: [
              {
                type: 'CarouselSlide', map: 'flashSale.products', key: '$item.id', props: { className: 'basis-full sm:basis-1/2 lg:basis-1/3 xl:basis-1/4' },
                children: [{ $ref: 'fragments/cards/product-card' }],
              },
            ],
          },
        ],
      },
    ],
  },

  // Product grid: MUST include 4 demo products in state so the grid renders in preview.
  // initActions replaces demo data with real products in production.
  // NOTE: copy the _stateNote demo data into screen state.
  'product-grid': {
    _stateNote: 'Add to screen state: { "newArrivals": { "products": [ { "id": "1", "name": "Classic Tee", "slug": "classic-tee", "priceWithTax": 2999, "currencyCode": "USD", "featuredAsset": { "preview": "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=400" } }, { "id": "2", "name": "Slim Chinos", "slug": "slim-chinos", "priceWithTax": 5999, "currencyCode": "USD", "featuredAsset": { "preview": "https://images.unsplash.com/photo-1473966968600-fa801b869a1a?w=400" } }, { "id": "3", "name": "Linen Shirt", "slug": "linen-shirt", "priceWithTax": 4499, "currencyCode": "USD", "featuredAsset": { "preview": "https://images.unsplash.com/photo-1596755094514-f87e34085b2c?w=400" } }, { "id": "4", "name": "Canvas Sneakers", "slug": "canvas-sneakers", "priceWithTax": 7999, "currencyCode": "USD", "featuredAsset": { "preview": "https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=400" } } ] } }',
    type: 'Box',
    props: { className: 'w-full py-16 px-6 bg-[var(--theme-content-bg)]' },
    children: [
      { type: 'Heading', props: { size: '2xl', className: 'font-bold text-[var(--theme-content-text)] mb-8 text-center' }, text: 'New Arrivals' },
      {
        type: 'Box', props: { className: 'max-w-6xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-4' },
        children: [
          { type: 'Box', map: 'newArrivals.products', key: 'product', props: { className: 'contents' }, children: [{ $ref: 'fragments/cards/product-card' }] },
        ],
      },
    ],
  },

  // Product carousel: MUST include 4 demo products in state — same pattern as product-grid.
  'product-carousel': {
    _stateNote: 'Add to screen state: { "bestSellers": { "products": [ { "id": "1", "name": "Classic Tee", "slug": "classic-tee", "priceWithTax": 2999, "currencyCode": "USD", "featuredAsset": { "preview": "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=400" } }, { "id": "2", "name": "Slim Chinos", "slug": "slim-chinos", "priceWithTax": 5999, "currencyCode": "USD", "featuredAsset": { "preview": "https://images.unsplash.com/photo-1473966968600-fa801b869a1a?w=400" } }, { "id": "3", "name": "Linen Shirt", "slug": "linen-shirt", "priceWithTax": 4499, "currencyCode": "USD", "featuredAsset": { "preview": "https://images.unsplash.com/photo-1596755094514-f87e34085b2c?w=400" } }, { "id": "4", "name": "Canvas Sneakers", "slug": "canvas-sneakers", "priceWithTax": 7999, "currencyCode": "USD", "featuredAsset": { "preview": "https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=400" } } ] } }',
    type: 'Box',
    props: { className: 'w-full py-16 px-6 bg-[var(--theme-content-bg)]' },
    children: [
      { type: 'Heading', props: { size: '2xl', className: 'font-bold text-[var(--theme-content-text)] mb-8' }, text: 'Best Sellers' },
      {
        type: 'Box', props: { className: 'max-w-6xl mx-auto' },
        children: [
          {
            type: 'Carousel', props: { loop: true, align: 'start', showArrows: true },
            children: [
              {
                type: 'CarouselSlide', map: 'bestSellers.products', key: '$item.id', props: { className: 'basis-full sm:basis-1/2 lg:basis-1/3 xl:basis-1/4' },
                children: [{ $ref: 'fragments/cards/product-card' }],
              },
            ],
          },
        ],
      },
    ],
  },

  // Brand story: image pane uses CSS gradient — never a NextImage with a local path.
  // Headline and body are string literals — NOT {{state}} interpolation (no fetchBrandStory exists).
  // Use w-full md:w-1/2 for even split, not flex-1 + aspect-square which distorts proportions.
  'brand-story': {
    type: 'Box',
    props: { className: 'w-full py-16 px-6 bg-[var(--theme-hero-bg)]' },
    children: [
      {
        type: 'Box', props: { className: 'max-w-6xl mx-auto flex flex-col md:flex-row items-center gap-12' },
        children: [
          // Image pane: gradient box — always renders, no broken image risk
          {
            type: 'Box',
            props: { className: 'w-full md:w-1/2 aspect-[4/3] rounded-2xl bg-gradient-to-br from-slate-300 to-slate-500 dark:from-slate-600 dark:to-slate-800' },
          },
          // Text pane: hardcoded string literals, not state interpolation
          {
            type: 'Box', props: { className: 'w-full md:w-1/2 flex flex-col gap-6' },
            children: [
              { type: 'Text', props: { className: 'text-sm uppercase tracking-widest text-[var(--theme-content-textMuted)]' }, text: 'Our Story' },
              { type: 'Heading', props: { size: '3xl', className: 'font-bold text-[var(--theme-content-text)]' }, text: 'Crafted With Intention' },
              { type: 'Text', props: { className: 'text-[var(--theme-content-textMuted)] leading-relaxed' }, text: 'Every piece is thoughtfully designed for modern life — quality materials, timeless style, and attention to every detail.' },
              { type: 'Button', props: { variant: 'outline', className: '!border-[var(--theme-shop-button)] !text-[var(--theme-shop-button)] self-start' }, actions: { click: { action: 'navigate', payload: { path: '/about' } } }, children: [{ type: 'ButtonText', text: 'Read More' }] },
            ],
          },
        ],
      },
    ],
  },

  'social-proof': {
    type: 'Box',
    props: { className: 'w-full py-16 px-6 bg-[var(--theme-content-bg)]' },
    children: [
      { type: 'Heading', props: { size: '2xl', className: 'font-bold text-center text-[var(--theme-content-text)] mb-3' }, text: 'As seen on Instagram' },
      { type: 'Text', props: { className: 'text-center text-[var(--theme-content-textMuted)] mb-10' }, text: '#YourBrand — Tag us to be featured' },
      {
        type: 'Box', props: { className: 'max-w-6xl mx-auto grid grid-cols-3 md:grid-cols-6 gap-2' },
        children: [
          {
            type: 'Box', map: 'social.images', key: '$item.id', props: { className: 'contents' },
            children: [{ type: 'Box', props: { className: 'aspect-square relative overflow-hidden rounded-sm' }, children: [{ type: 'NextImage', props: { src: '{{$item.url}}', alt: '{{$item.caption}}', fill: true, className: 'object-cover hover:scale-105 transition-transform duration-300' } }] }],
          },
        ],
      },
    ],
  },

  'newsletter': {
    type: 'Box',
    props: { className: 'w-full py-16 px-6 bg-[var(--theme-hero-bg)]' },
    children: [
      {
        type: 'Box', props: { className: 'max-w-lg mx-auto flex flex-col items-center gap-6' },
        children: [
          { type: 'Heading', props: { size: '2xl', className: 'font-bold text-center text-[var(--theme-content-text)]' }, text: 'Get 10% Off Your First Order' },
          { type: 'Text', props: { className: 'text-center text-[var(--theme-content-textMuted)]' }, text: 'Subscribe for exclusive deals, new arrivals, and style tips.' },
          {
            type: 'Box', props: { className: 'flex flex-row gap-2 w-full' },
            children: [
              {
                type: 'Input', props: { variant: 'outline', className: 'flex-1 !border-gray-300 dark:!border-gray-600 !bg-white dark:!bg-gray-900' },
                children: [{ type: 'InputField', props: { placeholder: 'Your email address', placeholderTextColor: '#9ca3af', className: '!text-gray-900 dark:!text-gray-100' }, actions: { change: { action: 'setState', payload: { path: 'screens.home.form.email', value: '$event' } } } }],
              },
              { type: 'Button', props: { className: '!bg-[var(--theme-shop-button)] !text-[var(--theme-shop-buttonText)]' }, actions: { click: { action: 'subscribeNewsletter' } }, children: [{ type: 'ButtonText', text: 'Subscribe' }] },
            ],
          },
        ],
      },
    ],
  },

  'testimonials': {
    type: 'Box',
    props: { className: 'w-full py-16 px-6 bg-[var(--theme-content-bg)]' },
    children: [
      { type: 'Heading', props: { size: '2xl', className: 'font-bold text-center text-[var(--theme-content-text)] mb-10' }, text: 'What Our Customers Say' },
      {
        type: 'Box', props: { className: 'max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-6' },
        children: [
          {
            type: 'Box', map: 'testimonials.items', key: '$item.id', props: { className: 'contents' },
            children: [
              {
                type: 'Box', props: { className: 'flex flex-col gap-4 p-6 rounded-xl border border-gray-100 dark:border-gray-800' },
                children: [
                  { type: 'Text', props: { className: 'text-[var(--theme-content-text)] leading-relaxed italic' }, text: '"{{$item.review}}"' },
                  { type: 'Text', props: { className: 'text-sm font-semibold text-[var(--theme-content-textMuted)]' }, text: '— {{$item.author}}' },
                ],
              },
            ],
          },
        ],
      },
    ],
  },

  'features-grid': {
    type: 'Box',
    props: { className: 'w-full py-16 px-6 bg-[var(--theme-content-bg)]' },
    children: [
      {
        type: 'Box', props: { className: 'max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-8' },
        children: [
          { type: 'Box', props: { className: 'flex flex-col items-center gap-3 text-center' }, children: [{ type: 'NavIcon', props: { icon: 'Truck', size: 32, color: 'var(--theme-shop-button)' } }, { type: 'Heading', props: { size: 'md', className: 'font-semibold text-[var(--theme-content-text)]' }, text: 'Free Shipping' }, { type: 'Text', props: { className: 'text-sm text-[var(--theme-content-textMuted)]' }, text: 'On all orders over $50' }] },
          { type: 'Box', props: { className: 'flex flex-col items-center gap-3 text-center' }, children: [{ type: 'NavIcon', props: { icon: 'RotateCcw', size: 32, color: 'var(--theme-shop-button)' } }, { type: 'Heading', props: { size: 'md', className: 'font-semibold text-[var(--theme-content-text)]' }, text: 'Easy Returns' }, { type: 'Text', props: { className: 'text-sm text-[var(--theme-content-textMuted)]' }, text: '30-day hassle-free returns' }] },
          { type: 'Box', props: { className: 'flex flex-col items-center gap-3 text-center' }, children: [{ type: 'NavIcon', props: { icon: 'ShieldCheck', size: 32, color: 'var(--theme-shop-button)' } }, { type: 'Heading', props: { size: 'md', className: 'font-semibold text-[var(--theme-content-text)]' }, text: 'Secure Checkout' }, { type: 'Text', props: { className: 'text-sm text-[var(--theme-content-textMuted)]' }, text: 'Your data is always protected' }] },
        ],
      },
    ],
  },
};

/** Build the section examples block for injection into a system prompt */
export function buildSectionExamplesContext(): string {
  const lines: string[] = [
    'E-COMMERCE SECTION EXAMPLES (use these patterns exactly — do not invent new component types or prop shapes):',
    '',
    'Each section below is a minimal but complete SDUI node tree. When the user requests a section that matches one of these types, follow the exact structure. Replace placeholder text/paths with appropriate values.',
    '',
  ];

  for (const [name, example] of Object.entries(SECTION_EXAMPLES)) {
    lines.push(`### ${name}`);
    lines.push('```json');
    lines.push(JSON.stringify(example, null, 2));
    lines.push('```');
    lines.push('');
  }

  lines.push('RULES:');
  lines.push('- Use theme vars: bg-[var(--theme-*)], text-[var(--theme-*)] — never hardcoded hex');
  lines.push('- Map over data paths using "map": "storePath" on a wrapper Box with className: "contents" inside a grid, or className: "flex flex-col gap-N" for stacked layouts');
  lines.push('- All sections are direct children of the root content Box');
  lines.push('- Do NOT include a footer section — the layout shell already has one');
  lines.push('- CountdownTimer: ALWAYS stack it in a flex-col below the heading — never inline in flex-row (causes text run-on like "⚡ Flash Sale36 d : 08 h")');
  lines.push('- product-card grids use $ref: "fragments/cards/product-card" inside the map');
  lines.push('- initActions must include fetchNavCollections + fetchCart first, then any section-specific fetches');
  lines.push('- IMAGES: Never use NextImage with local paths like /images/xxx.jpg — those files do not exist. Use CSS gradient boxes for editorial image panes (hero right-pane, brand story image).');
  lines.push('- DEMO STATE: Always pre-populate state with demo data for every section that uses "map". The _stateNote in each example shows exactly what to add. initActions will override with real API data in production.');
  lines.push('- BRAND STORY TEXT: Write headline and body as string literals in "text" — not {{brandStory.headline}} interpolation. There is no fetchBrandStory action.');

  return lines.join('\n');
}
