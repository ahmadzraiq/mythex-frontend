/**
 * Dev-only: Returns a minimal SDUI screen config for a single section variant.
 * Used by the section browser and Playwright snapshot script.
 *
 * GET /api/dev/section-preview?variantId=hero.overlay-centered&theme=dark
 *
 * Response: { screen, state, variantId, meta }
 */

import { NextRequest, NextResponse } from 'next/server';
import { sectionLibrary } from '@/lib/ai/section-library';
import { MOCK_STATE_BY_SECTION } from '@/lib/ai/section-library/preview-state';

export async function GET(request: NextRequest) {
  const variantId = request.nextUrl.searchParams.get('variantId');

  if (!variantId) {
    return NextResponse.json({ error: 'Missing variantId query param' }, { status: 400 });
  }

  const variant = sectionLibrary.getVariant(variantId);
  if (!variant) {
    return NextResponse.json({ error: `Unknown variantId: ${variantId}` }, { status: 404 });
  }

  // Merge slot defaults with any slot_ overrides from query params
  const slotParams: Record<string, string> = { ...(variant._meta.slotDefaults ?? {}) };
  request.nextUrl.searchParams.forEach((value, key) => {
    if (key.startsWith('slot_')) slotParams[key.slice(5)] = value;
  });

  let node: Record<string, unknown>;
  try {
    node = sectionLibrary.instantiate(variantId, slotParams);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }

  // Build pre-populated state for this section type
  const sectionType = variantId.split('.')[0];
  const previewState = MOCK_STATE_BY_SECTION[sectionType] ?? {};

  const isNavbar = sectionType === 'navbar';
  const isFooter = sectionType === 'footer';

  let screen: Record<string, unknown>;

  if (isNavbar) {
    // Render navbar standalone — needs min-height below it so the fixed bar is visible
    screen = {
      meta: { title: `Preview: ${variant._meta.label}` },
      state: previewState,
      ui: {
        type: 'Box',
        props: { className: 'w-full min-h-[160px] !bg-[rgb(var(--background)/1)]' },
        children: [node],
      },
    };
  } else if (isFooter) {
    // Render footer with a spacer above so it's in natural position
    screen = {
      meta: { title: `Preview: ${variant._meta.label}` },
      state: previewState,
      ui: {
        type: 'Box',
        props: { className: 'w-full flex flex-col min-h-screen !bg-[rgb(var(--background)/1)]' },
        children: [
          { type: 'Box', props: { className: 'flex-1 flex items-center justify-center py-16' }, children: [{ type: 'Text', props: { className: 'text-sm text-[var(--theme-content-textMuted)]' }, text: '— page content —' }] },
          node,
        ],
      },
    };
  } else {
    screen = {
      meta: { title: `Preview: ${variant._meta.label}` },
      state: previewState,
      layout: 'store',
      content: {
        type: 'Box',
        props: { className: 'w-full flex flex-col !bg-[rgb(var(--background)/1)]' },
        children: [node],
      },
      initActions: [],
    };
  }

  return NextResponse.json({
    variantId,
    meta: variant._meta,
    screen,
  });
}
