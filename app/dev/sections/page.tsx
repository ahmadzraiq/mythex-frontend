'use client';

/**
 * Visual Section Browser — /dev/sections
 *
 * Lets you browse and preview all 72 section variants from the section library.
 * Each variant renders in an iframe using the main SDUI renderer.
 *
 * Features:
 *  - Grouped sidebar by section type
 *  - Desktop (1280px) / Tablet (768px) / Mobile (375px) viewport toggle
 *  - Light / Dark theme toggle
 *  - Direct link to the standalone preview URL
 *  - Copy JSON button (raw instantiated node)
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import CanvasPreview from './_canvas';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ManifestEntry {
  variantId: string;
  label: string;
  bestFor: string[];
  requiredSlots: string[];
  optionalSlots: string[];
}

interface LayoutPartEntry {
  id: string;
  label: string;
  description: string;
  wrapMode: string;
}

interface GroupedVariants {
  sectionType: string;
  label: string;
  variants: ManifestEntry[];
}

type ActiveItem =
  | { kind: 'variant'; variantId: string }
  | { kind: 'layoutPart'; partId: string };

interface VariantDetail {
  variantId: string;
  meta: {
    label: string;
    bestFor: string[];
    requiredSlots: string[];
    optionalSlots: string[];
    slotDefaults?: Record<string, string>;
    statePaths?: string[];
    initActions?: string[];
  };
  anchorIds: string[];
  nodeJson: Record<string, unknown>;
}

// ─── Extract all `id` fields from a node tree ─────────────────────────────────
function extractAnchorIds(node: unknown, ids: string[] = []): string[] {
  if (!node || typeof node !== 'object') return ids;
  const n = node as Record<string, unknown>;
  if (typeof n.id === 'string') ids.push(n.id);
  if (Array.isArray(n.children)) n.children.forEach(c => extractAnchorIds(c, ids));
  return ids;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const SECTION_TYPE_LABELS: Record<string, string> = {
  navbar: 'Navbar',
  footer: 'Footer',
  hero: 'Hero',
  'hero-carousel': 'Hero Carousel',
  'hero-video': 'Hero Video',
  'announcement-bar': 'Announcement Bar',
  'countdown-banner': 'Countdown Banner',
  'featured-categories': 'Featured Categories',
  'product-grid': 'Product Grid',
  'product-carousel': 'Product Carousel',
  'flash-sale': 'Flash Sale',
  'shop-the-look': 'Shop the Look',
  'gift-guide': 'Gift Guide',
  'bundle-builder': 'Bundle Builder',
  'product-comparison': 'Product Comparison',
  'recently-viewed': 'Recently Viewed',
  'brand-story': 'Brand Story',
  'video-feature': 'Video Feature',
  lookbook: 'Lookbook',
  'founder-story': 'Founder Story',
  sustainability: 'Sustainability',
  'how-it-works': 'How It Works',
  'awards-certifications': 'Awards & Certifications',
  testimonials: 'Testimonials',
  'press-mentions': 'Press Mentions',
  'features-grid': 'Features Grid',
  'social-proof': 'Social Proof',
  'community-section': 'Community',
  'ambassador-section': 'Ambassadors',
  newsletter: 'Newsletter',
  'quiz-finder': 'Style Quiz',
  'loyalty-program': 'Loyalty Program',
  'blog-articles': 'Blog Articles',
  waitlist: 'Waitlist',
  'gift-card-promo': 'Gift Card',
  'referral-program': 'Referral Program',
  'tiktok-feed': 'TikTok Feed',
};

const VIEWPORT_WIDTHS = {
  Desktop: 1280,
  Tablet: 768,
  Mobile: 375,
} as const;

const VIEWPORT_HEIGHTS = {
  Desktop: 900,
  Tablet: 1024,
  Mobile: 844,
} as const;

type ViewportName = keyof typeof VIEWPORT_WIDTHS;

// ─── Utilities ────────────────────────────────────────────────────────────────

function groupVariants(entries: ManifestEntry[]): GroupedVariants[] {
  const map = new Map<string, ManifestEntry[]>();
  for (const entry of entries) {
    const type = entry.variantId.split('.')[0];
    if (!map.has(type)) map.set(type, []);
    map.get(type)!.push(entry);
  }
  return Array.from(map.entries()).map(([type, variants]) => ({
    sectionType: type,
    label: SECTION_TYPE_LABELS[type] ?? type,
    variants,
  }));
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function SectionBrowserPage() {
  const [manifest, setManifest] = useState<ManifestEntry[]>([]);
  const [groups, setGroups] = useState<GroupedVariants[]>([]);
  const [layoutParts, setLayoutParts] = useState<LayoutPartEntry[]>([]);
  const [active, setActive] = useState<ActiveItem | null>(null);
  const [viewport, setViewport] = useState<ViewportName>('Desktop');
  const [isDark, setIsDark] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(['layout-parts']));
  const [search, setSearch] = useState('');

  // Properties panel
  const [detail, setDetail] = useState<VariantDetail | null>(null);
  const [slotOverrides, setSlotOverrides] = useState<Record<string, string>>({});
  const [showJson, setShowJson] = useState(false);
  const [panelTab, setPanelTab] = useState<'slots' | 'state' | 'anchors' | 'json'>('slots');

  // Load section manifest + layout parts manifest
  useEffect(() => {
    Promise.all([
      fetch('/api/dev/section-preview/manifest').then(r => r.json()),
      fetch('/api/dev/layout-part-preview/manifest').then(r => r.json()),
    ]).then(([sectionData, partsData]) => {
      const entries = (sectionData as { manifest: ManifestEntry[] }).manifest;
      const parts = (partsData as { parts: LayoutPartEntry[] }).parts;
      setManifest(entries);
      setLayoutParts(parts);
      const grouped = groupVariants(entries);
      setGroups(grouped);
      setExpandedGroups(new Set(['layout-parts', ...grouped.map(g => g.sectionType)]));
      // Default: select navbar
      if (parts[0]) setActive({ kind: 'layoutPart', partId: parts[0].id });
    }).catch(() => {});
  }, []);

  // Fetch detail whenever active variant/part changes
  useEffect(() => {
    if (!active) { setDetail(null); setSlotOverrides({}); return; }

    const url = active.kind === 'variant'
      ? `/api/dev/section-preview?variantId=${encodeURIComponent(active.variantId)}`
      : `/api/dev/layout-part-preview?part=${encodeURIComponent(active.partId)}`;

    fetch(url).then(r => r.json()).then(data => {
      if (data.error) return;
      const meta = data.meta ?? {};
      const node = active.kind === 'variant'
        ? (data.screen?.content?.children?.[0] ?? data.screen?.ui?.children?.[0] ?? data.screen)
        : data.screen;
      const anchorIds = extractAnchorIds(node);
      setDetail({
        variantId: active.kind === 'variant' ? active.variantId : active.partId,
        meta,
        anchorIds,
        nodeJson: node ?? {},
      });
      // Reset slot overrides to defaults
      setSlotOverrides(meta.slotDefaults ?? {});
      setPanelTab('slots');
    }).catch(() => {});
  }, [active]);

  // Rebuild preview URL when active item, slot overrides, viewport, or theme changes
  useEffect(() => {
    if (!active) { setPreviewUrl(null); return; }
    const params = new URLSearchParams({ dark: String(isDark) });
    if (active.kind === 'variant') {
      params.set('variantId', active.variantId);
      // Pass slot overrides as query params (preview API picks them up)
      Object.entries(slotOverrides).forEach(([k, v]) => params.set(`slot_${k}`, v));
    } else {
      params.set('layoutPart', active.partId);
    }
    setPreviewUrl(`/dev/sections/render?${params}`);
  }, [active, isDark, slotOverrides]);

  const handleCopyJson = useCallback(async () => {
    if (!active) return;
    try {
      const url = active.kind === 'variant'
        ? `/api/dev/section-preview?variantId=${active.variantId}`
        : `/api/dev/layout-part-preview?part=${active.partId}`;
      const res = await fetch(url);
      const data = await res.json();
      const node = active.kind === 'variant'
        ? (data.screen?.content?.children?.[0] ?? data.screen)
        : data.screen;
      await navigator.clipboard.writeText(JSON.stringify(node, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard unavailable */ }
  }, [active]);

  const toggleGroup = (type: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  const filteredGroups = search.trim()
    ? groups.map(g => ({
        ...g,
        variants: g.variants.filter(v =>
          v.variantId.toLowerCase().includes(search.toLowerCase()) ||
          v.label.toLowerCase().includes(search.toLowerCase())
        ),
      })).filter(g => g.variants.length > 0)
    : groups;

  const filteredParts = search.trim()
    ? layoutParts.filter(p =>
        p.label.toLowerCase().includes(search.toLowerCase()) ||
        p.id.toLowerCase().includes(search.toLowerCase())
      )
    : layoutParts;

  const activeVariantId = active?.kind === 'variant' ? active.variantId : null;
  const activePartId = active?.kind === 'layoutPart' ? active.partId : null;
  const activeVariant = manifest.find(v => v.variantId === activeVariantId);
  const activeLayoutPart = layoutParts.find(p => p.id === activePartId);
  const viewportWidth = VIEWPORT_WIDTHS[viewport];
  const viewportHeight = VIEWPORT_HEIGHTS[viewport];

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', fontFamily: 'system-ui, sans-serif', background: '#0f172a', color: '#f1f5f9' }}>

      {/* ── Sidebar ─────────────────────────────────────────────── */}
      <div style={{ width: 280, flexShrink: 0, overflowY: 'auto', background: '#1e293b', borderRight: '1px solid #334155', display: 'flex', flexDirection: 'column' }}>

        {/* Header */}
        <div style={{ padding: '16px 16px 12px', borderBottom: '1px solid #334155' }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#f1f5f9', marginBottom: 4 }}>
            Section Library
          </div>
          <div style={{ fontSize: 11, color: '#64748b' }}>
            {manifest.length} variants · {groups.length} types
          </div>
        </div>

        {/* Search */}
        <div style={{ padding: '10px 12px', borderBottom: '1px solid #334155' }}>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search variants..."
            style={{ width: '100%', padding: '6px 10px', background: '#0f172a', border: '1px solid #334155', borderRadius: 6, color: '#f1f5f9', fontSize: 12, outline: 'none', boxSizing: 'border-box' }}
          />
        </div>

        {/* Variant list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>

          {/* ── Layout Parts group (always first) ── */}
          {filteredParts.length > 0 && (
            <div>
              <button
                onClick={() => toggleGroup('layout-parts')}
                style={{ width: '100%', textAlign: 'left', padding: '6px 16px', background: 'none', border: 'none', color: '#f59e0b', fontSize: 11, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
              >
                Layout Parts
                <span style={{ fontSize: 10, color: '#78350f' }}>
                  {expandedGroups.has('layout-parts') ? '▲' : '▼'} {filteredParts.length}
                </span>
              </button>
              {expandedGroups.has('layout-parts') && filteredParts.map(part => {
                const isActive = activePartId === part.id;
                return (
                  <button
                    key={part.id}
                    onClick={() => setActive({ kind: 'layoutPart', partId: part.id })}
                    style={{
                      width: '100%', textAlign: 'left', padding: '7px 16px 7px 24px',
                      background: isActive ? 'rgba(245,158,11,0.12)' : 'none',
                      border: 'none',
                      borderLeft: isActive ? '2px solid #f59e0b' : '2px solid transparent',
                      color: isActive ? '#fcd34d' : '#94a3b8',
                      fontSize: 12, cursor: 'pointer', display: 'block', lineHeight: 1.4,
                    }}
                  >
                    <div style={{ fontWeight: isActive ? 600 : 400 }}>{part.label}</div>
                    <div style={{ fontSize: 10, color: '#475569', marginTop: 1 }}>
                      {part.description.length > 45 ? part.description.slice(0, 45) + '…' : part.description}
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {/* ── Section library groups ── */}
          {filteredGroups.map(group => (
            <div key={group.sectionType}>
              <button
                onClick={() => toggleGroup(group.sectionType)}
                style={{ width: '100%', textAlign: 'left', padding: '6px 16px', background: 'none', border: 'none', color: '#94a3b8', fontSize: 11, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
              >
                {group.label}
                <span style={{ fontSize: 10, color: '#475569' }}>
                  {expandedGroups.has(group.sectionType) ? '▲' : '▼'} {group.variants.length}
                </span>
              </button>
              {expandedGroups.has(group.sectionType) && group.variants.map(variant => {
                const isActive = activeVariantId === variant.variantId;
                return (
                  <button
                    key={variant.variantId}
                    onClick={() => setActive({ kind: 'variant', variantId: variant.variantId })}
                    style={{
                      width: '100%', textAlign: 'left', padding: '7px 16px 7px 24px',
                      background: isActive ? 'rgba(99,102,241,0.15)' : 'none',
                      border: 'none',
                      borderLeft: isActive ? '2px solid #6366f1' : '2px solid transparent',
                      color: isActive ? '#a5b4fc' : '#94a3b8',
                      fontSize: 12, cursor: 'pointer', display: 'block', lineHeight: 1.4,
                    }}
                  >
                    <div style={{ fontWeight: isActive ? 600 : 400 }}>{variant.variantId.split('.')[1]}</div>
                    <div style={{ fontSize: 10, color: '#475569', marginTop: 1 }}>
                      {variant.label.length > 45 ? variant.label.slice(0, 45) + '…' : variant.label}
                    </div>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* ── Main area ─────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'row', overflow: 'hidden' }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* Toolbar */}
        <div style={{ padding: '10px 16px', background: '#1e293b', borderBottom: '1px solid #334155', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>

          {/* Active item info */}
          <div style={{ flex: 1, minWidth: 0 }}>
            {activeVariant && (
              <>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#f1f5f9' }}>{activeVariant.variantId}</div>
                <div style={{ fontSize: 11, color: '#64748b' }}>{activeVariant.label}</div>
              </>
            )}
            {activeLayoutPart && (
              <>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#fcd34d' }}>{activeLayoutPart.label}</div>
                <div style={{ fontSize: 11, color: '#78350f' }}>{activeLayoutPart.description}</div>
              </>
            )}
            {!active && (
              <div style={{ fontSize: 12, color: '#475569' }}>Select a variant or layout part from the sidebar</div>
            )}
          </div>

          {/* Viewport */}
          <div style={{ display: 'flex', gap: 4 }}>
            {(Object.keys(VIEWPORT_WIDTHS) as ViewportName[]).map(v => (
              <button
                key={v}
                onClick={() => setViewport(v)}
                style={{ padding: '4px 10px', background: viewport === v ? '#6366f1' : '#0f172a', border: '1px solid #334155', borderRadius: 5, color: viewport === v ? '#fff' : '#94a3b8', fontSize: 11, cursor: 'pointer' }}
              >
                {v}
              </button>
            ))}
          </div>

          {/* Theme toggle */}
          <button
            onClick={() => setIsDark(d => !d)}
            style={{ padding: '4px 10px', background: '#0f172a', border: '1px solid #334155', borderRadius: 5, color: '#94a3b8', fontSize: 11, cursor: 'pointer' }}
          >
            {isDark ? '☀ Light' : '☾ Dark'}
          </button>

          {/* Copy JSON */}
          <button
            onClick={handleCopyJson}
            disabled={!activeVariantId}
            style={{ padding: '4px 10px', background: copied ? '#22c55e' : '#0f172a', border: '1px solid #334155', borderRadius: 5, color: copied ? '#fff' : '#94a3b8', fontSize: 11, cursor: 'pointer' }}
          >
            {copied ? '✓ Copied' : 'Copy JSON'}
          </button>

          {/* Open standalone */}
          {previewUrl && (
            <a
              href={previewUrl}
              target="_blank"
              rel="noreferrer"
              style={{ padding: '4px 10px', background: '#0f172a', border: '1px solid #334155', borderRadius: 5, color: '#94a3b8', fontSize: 11, textDecoration: 'none', whiteSpace: 'nowrap' }}
            >
              Open ↗
            </a>
          )}
        </div>

        {/* Tags row */}
        {(activeVariant || activeLayoutPart) && (
          <div style={{ padding: '6px 16px', background: '#0f172a', borderBottom: '1px solid #1e293b', display: 'flex', gap: 6, flexWrap: 'wrap', flexShrink: 0, alignItems: 'center' }}>
            {activeVariant && (
              <>
                <span style={{ fontSize: 10, color: '#475569' }}>Best for:</span>
                {activeVariant.bestFor.map(tag => (
                  <span key={tag} style={{ fontSize: 10, padding: '2px 8px', background: '#1e293b', border: '1px solid #334155', borderRadius: 20, color: '#94a3b8' }}>{tag}</span>
                ))}
                {activeVariant.requiredSlots.map(slot => (
                  <span key={slot} style={{ fontSize: 10, padding: '2px 8px', background: '#450a0a', border: '1px solid #7f1d1d', borderRadius: 20, color: '#fca5a5' }}>required: {slot}</span>
                ))}
                {activeVariant.optionalSlots.map(slot => (
                  <span key={slot} style={{ fontSize: 10, padding: '2px 8px', background: '#0c2339', border: '1px solid #1e3a5f', borderRadius: 20, color: '#93c5fd' }}>slot: {slot}</span>
                ))}
              </>
            )}
            {activeLayoutPart && (
              <>
                <span style={{ fontSize: 10, padding: '2px 8px', background: '#451a03', border: '1px solid #92400e', borderRadius: 20, color: '#fcd34d' }}>
                  layout part
                </span>
                <span style={{ fontSize: 10, padding: '2px 8px', background: '#1e293b', border: '1px solid #334155', borderRadius: 20, color: '#94a3b8' }}>
                  mode: {activeLayoutPart.wrapMode}
                </span>
                <span style={{ fontSize: 10, color: '#475569' }}>
                  config/fragments/layout/{activeLayoutPart.id}.json
                </span>
              </>
            )}
          </div>
        )}

        {/* Preview area — Figma-style canvas */}
        <CanvasPreview
          src={previewUrl ?? null}
          frameWidth={viewportWidth}
          frameHeight={viewportHeight}
        />
      </div>

      {/* ── Properties Panel (right) ──────────────────────────────── */}
      {detail && (
        <div style={{ width: 280, flexShrink: 0, borderLeft: '1px solid #334155', background: '#1e293b', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

          {/* Panel header */}
          <div style={{ padding: '12px 14px 8px', borderBottom: '1px solid #334155' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Properties</div>
            <div style={{ fontSize: 12, color: '#f1f5f9', marginTop: 2, fontWeight: 600 }}>{detail.variantId}</div>
          </div>

          {/* Tab bar */}
          <div style={{ display: 'flex', borderBottom: '1px solid #334155', flexShrink: 0 }}>
            {(['slots', 'state', 'anchors', 'json'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setPanelTab(tab)}
                style={{ flex: 1, padding: '7px 4px', background: 'none', border: 'none', borderBottom: panelTab === tab ? '2px solid #6366f1' : '2px solid transparent', color: panelTab === tab ? '#a5b4fc' : '#64748b', fontSize: 10, fontWeight: panelTab === tab ? 600 : 400, cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.04em' }}
              >
                {tab === 'slots' ? `Slots (${(detail.meta.requiredSlots?.length ?? 0) + (detail.meta.optionalSlots?.length ?? 0)})` :
                 tab === 'state' ? `State (${detail.meta.statePaths?.length ?? 0})` :
                 tab === 'anchors' ? `IDs (${detail.anchorIds.length})` : 'JSON'}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div style={{ flex: 1, overflowY: 'auto', padding: 14 }}>

            {/* ── Slots tab ── */}
            {panelTab === 'slots' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {(detail.meta.requiredSlots?.length ?? 0) + (detail.meta.optionalSlots?.length ?? 0) === 0 ? (
                  <div style={{ fontSize: 11, color: '#475569', fontStyle: 'italic' }}>No slots — this variant has no configurable parameters.</div>
                ) : (
                  <>
                    {detail.meta.requiredSlots?.map(slot => (
                      <div key={slot}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
                          <span style={{ fontSize: 10, padding: '1px 6px', background: '#450a0a', border: '1px solid #7f1d1d', borderRadius: 10, color: '#fca5a5' }}>required</span>
                          <span style={{ fontSize: 11, color: '#f1f5f9', fontFamily: 'monospace' }}>{slot}</span>
                        </div>
                        <input
                          value={slotOverrides[slot] ?? ''}
                          onChange={e => setSlotOverrides(prev => ({ ...prev, [slot]: e.target.value }))}
                          placeholder={`[[${slot}]]`}
                          style={{ width: '100%', padding: '5px 8px', background: '#0f172a', border: '1px solid #7f1d1d', borderRadius: 5, color: '#f1f5f9', fontSize: 11, fontFamily: 'monospace', boxSizing: 'border-box', outline: 'none' }}
                        />
                      </div>
                    ))}
                    {detail.meta.optionalSlots?.map(slot => (
                      <div key={slot}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
                          <span style={{ fontSize: 10, padding: '1px 6px', background: '#0c2339', border: '1px solid #1e3a5f', borderRadius: 10, color: '#93c5fd' }}>optional</span>
                          <span style={{ fontSize: 11, color: '#f1f5f9', fontFamily: 'monospace' }}>{slot}</span>
                        </div>
                        <input
                          value={slotOverrides[slot] ?? detail.meta.slotDefaults?.[slot] ?? ''}
                          onChange={e => setSlotOverrides(prev => ({ ...prev, [slot]: e.target.value }))}
                          placeholder={detail.meta.slotDefaults?.[slot] ?? `[[${slot}]]`}
                          style={{ width: '100%', padding: '5px 8px', background: '#0f172a', border: '1px solid #334155', borderRadius: 5, color: '#f1f5f9', fontSize: 11, fontFamily: 'monospace', boxSizing: 'border-box', outline: 'none' }}
                        />
                      </div>
                    ))}
                    <div style={{ fontSize: 10, color: '#475569', fontStyle: 'italic', marginTop: 4 }}>
                      Changes live-update the preview
                    </div>
                  </>
                )}
              </div>
            )}

            {/* ── State tab ── */}
            {panelTab === 'state' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {(detail.meta.statePaths?.length ?? 0) === 0 ? (
                  <div style={{ fontSize: 11, color: '#475569', fontStyle: 'italic' }}>No state paths — this variant uses no dynamic data.</div>
                ) : (
                  <>
                    <div style={{ fontSize: 10, color: '#475569', marginBottom: 4 }}>State paths this section reads at runtime:</div>
                    {detail.meta.statePaths?.map(path => (
                      <div key={path} style={{ padding: '5px 8px', background: '#0f172a', border: '1px solid #334155', borderRadius: 5, fontSize: 11, fontFamily: 'monospace', color: '#86efac' }}>
                        {path}
                      </div>
                    ))}
                    {(detail.meta.initActions?.length ?? 0) > 0 && (
                      <>
                        <div style={{ fontSize: 10, color: '#475569', marginTop: 8, marginBottom: 4 }}>initActions required to load this data:</div>
                        {detail.meta.initActions?.map(action => (
                          <div key={action} style={{ padding: '5px 8px', background: '#0f172a', border: '1px solid #1d4ed8', borderRadius: 5, fontSize: 11, fontFamily: 'monospace', color: '#93c5fd' }}>
                            {'{'}{'{'} action: &quot;{action}&quot; {'}'}{'}'}
                          </div>
                        ))}
                      </>
                    )}
                  </>
                )}
              </div>
            )}

            {/* ── Anchors tab ── */}
            {panelTab === 'anchors' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {detail.anchorIds.length === 0 ? (
                  <div style={{ fontSize: 11, color: '#475569', fontStyle: 'italic' }}>No anchor IDs found.</div>
                ) : (
                  <>
                    <div style={{ fontSize: 10, color: '#475569', marginBottom: 4 }}>
                      Stable IDs for the 4-tier edit system — used by Tier 1 style patches and Tier 2 EditAgent:
                    </div>
                    {detail.anchorIds.map(id => (
                      <div
                        key={id}
                        style={{ padding: '4px 8px', background: '#0f172a', border: '1px solid #334155', borderRadius: 5, fontSize: 11, fontFamily: 'monospace', color: '#fbbf24', cursor: 'pointer' }}
                        onClick={() => navigator.clipboard.writeText(id).catch(() => {})}
                        title="Click to copy"
                      >
                        #{id}
                      </div>
                    ))}
                    <div style={{ fontSize: 10, color: '#475569', fontStyle: 'italic', marginTop: 4 }}>Click any ID to copy</div>
                  </>
                )}
              </div>
            )}

            {/* ── JSON tab ── */}
            {panelTab === 'json' && (
              <div>
                <pre style={{ margin: 0, fontSize: 9, fontFamily: 'monospace', color: '#94a3b8', whiteSpace: 'pre-wrap', wordBreak: 'break-all', lineHeight: 1.5 }}>
                  {JSON.stringify(detail.nodeJson, null, 2)}
                </pre>
              </div>
            )}

          </div>

          {/* Panel footer — best-for tags */}
          {detail.meta.bestFor?.length > 0 && (
            <div style={{ padding: '8px 14px', borderTop: '1px solid #334155', display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {detail.meta.bestFor.map(tag => (
                <span key={tag} style={{ fontSize: 9, padding: '2px 6px', background: '#1e293b', border: '1px solid #334155', borderRadius: 10, color: '#64748b' }}>{tag}</span>
              ))}
            </div>
          )}
        </div>
      )}

      </div>
    </div>
  );
}
