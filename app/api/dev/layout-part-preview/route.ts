/**
 * Dev-only: Returns a minimal SDUI screen config wrapping a layout part
 * (navbar, footer, cart-drawer, account-sidebar) for the section browser.
 *
 * GET /api/dev/layout-part-preview?part=navbar&dark=false
 *
 * Navbar / footer: shown standalone in a white canvas so their fixed/sticky
 * positioning renders correctly and is easy to inspect.
 *
 * Cart drawer: rendered inside a screen with layout:"store" so the drawer
 * overlay works properly.
 */

import { NextRequest, NextResponse } from 'next/server';
import { fragments } from '@/config/fragments';

// ─── Layout part catalog ──────────────────────────────────────────────────────

export const LAYOUT_PARTS: Record<string, {
  label: string;
  description: string;
  fragmentKey: string;
  wrapMode: 'navbar' | 'footer' | 'drawer' | 'sidebar';
}> = {
  navbar: {
    label: 'Navbar',
    description: 'Global top navigation bar (fixed, theme-aware, cart + auth)',
    fragmentKey: 'fragments/layout/navbar',
    wrapMode: 'navbar',
  },
  footer: {
    label: 'Footer',
    description: 'Global footer with brand, links, and newsletter',
    fragmentKey: 'fragments/layout/footer',
    wrapMode: 'footer',
  },
  'cart-drawer': {
    label: 'Cart Drawer',
    description: 'Slide-in cart drawer (right side)',
    fragmentKey: 'fragments/layout/cart-drawer',
    wrapMode: 'drawer',
  },
  'account-sidebar': {
    label: 'Account Sidebar',
    description: 'Account pages sidebar navigation',
    fragmentKey: 'fragments/layout/account-sidebar',
    wrapMode: 'sidebar',
  },
};

export const LAYOUT_PARTS_LIST = Object.entries(LAYOUT_PARTS).map(([id, meta]) => ({
  id,
  ...meta,
}));

// ─── Mock state for layout parts ──────────────────────────────────────────────

const LAYOUT_PART_STATE: Record<string, Record<string, unknown>> = {
  navbar: {
    nav: {
      collections: [
        { id: '1', name: 'Women', slug: 'women' },
        { id: '2', name: 'Men', slug: 'men' },
        { id: '3', name: 'Sale', slug: 'sale' },
        { id: '4', name: 'New Arrivals', slug: 'new-arrivals' },
      ],
      colorScheme: 'light',
      themeMenuOpen: false,
    },
    cart: { totalQuantity: 2 },
    auth: { user: null },
  },
  footer: {
    nav: {
      collections: [
        { id: '1', name: 'Women', slug: 'women' },
        { id: '2', name: 'Men', slug: 'men' },
        { id: '3', name: 'Accessories', slug: 'accessories' },
        { id: '4', name: 'Sale', slug: 'sale' },
      ],
    },
  },
  'cart-drawer': {
    layout: { drawerOpen: true },
    cart: {
      totalQuantity: 3,
      subTotal: { value: 14997, currencyCode: 'USD' },
      lines: [
        {
          id: 'l1',
          quantity: 1,
          linePriceWithTax: { value: 2999 },
          productVariant: {
            product: {
              name: 'Classic Tee',
              slug: 'classic-tee',
              featuredAsset: { preview: 'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=200&fit=crop' },
            },
          },
        },
        {
          id: 'l2',
          quantity: 2,
          linePriceWithTax: { value: 11998 },
          productVariant: {
            product: {
              name: 'Slim Chinos',
              slug: 'slim-chinos',
              featuredAsset: { preview: 'https://images.unsplash.com/photo-1473966968600-fa801b869a1a?w=200&fit=crop' },
            },
          },
        },
      ],
    },
  },
  'account-sidebar': {
    auth: {
      user: { firstName: 'Alex', lastName: 'Chen', emailAddress: 'alex@example.com' },
    },
  },
};

// ─── Route handler ────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const partId = request.nextUrl.searchParams.get('part');

  if (!partId) {
    return NextResponse.json({ error: 'Missing part query param' }, { status: 400 });
  }

  const partMeta = LAYOUT_PARTS[partId];
  if (!partMeta) {
    return NextResponse.json(
      { error: `Unknown part: ${partId}. Valid values: ${Object.keys(LAYOUT_PARTS).join(', ')}` },
      { status: 404 }
    );
  }

  const fragment = fragments[partMeta.fragmentKey as keyof typeof fragments] as Record<string, unknown> | undefined;
  if (!fragment) {
    return NextResponse.json({ error: `Fragment not found: ${partMeta.fragmentKey}` }, { status: 500 });
  }

  const state = LAYOUT_PART_STATE[partId] ?? {};

  let screen: Record<string, unknown>;

  if (partMeta.wrapMode === 'navbar') {
    // Navbar: render in isolation at the top of a tall canvas so sticky/fixed works
    screen = {
      meta: { title: `Preview: ${partMeta.label}` },
      state,
      ui: {
        type: 'Box',
        props: { className: 'w-full min-h-[200px] !bg-[rgb(var(--background)/1)]' },
        children: [fragment],
      },
    };
  } else if (partMeta.wrapMode === 'footer') {
    // Footer: render with enough top space to see it in context
    screen = {
      meta: { title: `Preview: ${partMeta.label}` },
      state,
      ui: {
        type: 'Box',
        props: { className: 'w-full flex flex-col min-h-screen !bg-[rgb(var(--background)/1)]' },
        children: [
          {
            type: 'Box',
            props: { className: 'flex-1 flex items-center justify-center py-20' },
            children: [
              {
                type: 'Text',
                props: { className: 'text-[var(--theme-content-textMuted)] text-sm' },
                text: '↑ Page content area ↑',
              },
            ],
          },
          fragment,
        ],
      },
    };
  } else {
    // Cart drawer / account sidebar: use layout:store so overlay context is available
    screen = {
      meta: { title: `Preview: ${partMeta.label}` },
      state,
      layout: 'store',
      content: {
        type: 'Box',
        props: { className: 'w-full min-h-[600px] flex items-center justify-center !bg-[rgb(var(--background)/1)]' },
        children: [
          {
            type: 'Text',
            props: { className: 'text-[var(--theme-content-textMuted)] text-sm' },
            text: `${partMeta.label} is shown in the overlay →`,
          },
        ],
      },
      initActions: [],
    };
  }

  return NextResponse.json({
    partId,
    meta: partMeta,
    screen,
  });
}
