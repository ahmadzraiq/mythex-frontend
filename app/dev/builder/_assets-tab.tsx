'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useBuilderStore } from './_store';

// ── Types ─────────────────────────────────────────────────────────────────────

interface AssetItem {
  id: string | number;
  type: 'photo' | 'video';
  thumbnail: string;
  src: string;
  full: string;
  alt: string;
  width: number;
  height: number;
  author: string;
  authorUrl: string;
}

interface IconifyCollection {
  name: string;
  total: number;
  prefix: string;
}

interface IconifySearchResult {
  icons: string[];
  total: number;
  collections: Record<string, { name: string }>;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const ICONIFY_API = 'https://api.iconify.design';

const TEXT_DIM = '#6b7280';
const TEXT_MUTED = '#9ca3af';
const BG_INPUT = '#1f2937';
const BORDER = '1px solid #374151';

// ── Helpers ───────────────────────────────────────────────────────────────────

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

const MAX_W = 800;
const MAX_H = 600;

/** Scale down keeping aspect ratio so neither dimension exceeds the max. */
function clampDimensions(w: number, h: number, maxW = MAX_W, maxH = MAX_H) {
  const srcW = w || maxW;
  const srcH = h || maxH;
  const ratio = Math.min(1, maxW / srcW, maxH / srcH);
  return { w: Math.round(srcW * ratio), h: Math.round(srcH * ratio) };
}

function buildImageNode(item: AssetItem) {
  if (item.type === 'video') {
    const { w, h } = clampDimensions(item.width, item.height, MAX_W, MAX_H);
    return {
      type: 'Video',
      id: crypto.randomUUID(),
      props: {
        src: item.src,
        poster: item.thumbnail,
        controls: false,
        muted: true,
        loop: true,
        autoPlay: true,
        objectFit: 'cover' as const,
        className: 'rounded-md',
        style: { width: w, height: h, maxWidth: '100%' },
      },
    };
  }
  const { w, h } = clampDimensions(item.width, item.height, MAX_W, MAX_H);
  return {
    type: 'Image',
    id: crypto.randomUUID(),
    src: item.src,
    props: {
      alt: item.alt || 'image',
      className: 'object-cover rounded-md',
      style: { width: w, height: h, maxWidth: '100%' },
    },
  };
}

function buildIconNode(prefix: string, name: string) {
  return {
    type: 'Icon',
    id: crypto.randomUUID(),
    props: {
      icon: `${prefix}:${name}`,
      size: 24,
      // Use the CSS variable so the icon tracks theme changes dynamically.
      // Falls back to currentColor when --theme-primary isn't defined.
      color: 'var(--theme-primary, currentColor)',
    },
  };
}

// ── Stock Media ───────────────────────────────────────────────────────────────

function StockGrid({
  provider,
  mediaType,
}: {
  provider: 'unsplash' | 'pexels';
  mediaType: 'photo' | 'video';
}) {
  const addNode = useBuilderStore(s => s.addNode);
  const currentPageId = useBuilderStore(s => s.currentPageId);

  const [query, setQuery] = useState('');
  const [items, setItems] = useState<AssetItem[]>([]);
  const [loading, setLoading] = useState(false); // drives UI spinner only
  const [hasMore, setHasMore] = useState(true);  // drives UI "no more" state only
  const [hoverId, setHoverId] = useState<string | number | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const debouncedQuery = useDebounce(query, 150);

  // Refs so IntersectionObserver closure never goes stale — no deps needed
  const pageRef = useRef(1);
  const hasMoreRef = useRef(true);
  const loadingRef = useRef(false);
  const queryRef = useRef(debouncedQuery);
  queryRef.current = debouncedQuery;

  const fetchItems = useCallback(async (q: string, pg: number, append: boolean) => {
    if (loadingRef.current) return; // guard against concurrent calls
    if (abortRef.current) abortRef.current.abort();
    abortRef.current = new AbortController();
    loadingRef.current = true;
    setLoading(true);
    try {
      const params = new URLSearchParams({ q, page: String(pg) });
      if (provider === 'pexels') params.set('type', mediaType);
      const url = `/api/builder/assets/${provider}?${params}`;
      const res = await fetch(url, { signal: abortRef.current.signal });
      if (!res.ok) throw new Error('fetch failed');
      const data = await res.json();
      const newItems: AssetItem[] = data.results ?? [];
      const more = newItems.length === 30;
      setItems(prev => append ? [...prev, ...newItems] : newItems);
      setHasMore(more);
      hasMoreRef.current = more;
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        setHasMore(false);
        hasMoreRef.current = false;
      }
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [provider, mediaType]);

  // Stable ref so the observer closure always calls the latest version
  const fetchItemsRef = useRef(fetchItems);
  fetchItemsRef.current = fetchItems;

  // Reset and re-fetch when query, provider, or mediaType changes
  useEffect(() => {
    pageRef.current = 1;
    hasMoreRef.current = true;
    loadingRef.current = false;
    setItems([]);
    setHasMore(true);
    fetchItemsRef.current(debouncedQuery, 1, false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQuery, provider, mediaType]);

  // Infinite scroll — observer created ONCE; uses refs to avoid stale state
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && hasMoreRef.current && !loadingRef.current) {
        const next = pageRef.current + 1;
        pageRef.current = next;
        fetchItemsRef.current(queryRef.current, next, true);
      }
    }, { threshold: 0.1 });
    obs.observe(el);
    return () => obs.disconnect();
  // Empty deps: observer is created once; all mutable values accessed via refs
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleClick = (item: AssetItem) => {
    if (!currentPageId) return;
    const node = buildImageNode(item);
    addNode(node, null, undefined);
  };

  const handleDragStart = (e: React.DragEvent, item: AssetItem) => {
    const node = buildImageNode(item);
    const data = JSON.stringify(node);
    e.dataTransfer.setData('text/primitive-node', data);
    // Store as JSON string so the canvas onDrop CDP fallback can call JSON.parse on it
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__primitiveDrag = data;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      {/* Search */}
      <div style={{ padding: '8px 8px 4px', flexShrink: 0 }}>
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder={`Search ${provider}…`}
          style={{ width: '100%', background: BG_INPUT, border: BORDER, borderRadius: 5, color: 'var(--bld-text-2)', fontSize: 11, padding: '5px 8px', boxSizing: 'border-box', outline: 'none' }}
        />
      </div>

      {/* Grid */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 8px' }}>
        <div style={{ columns: 2, columnGap: 6 }}>
          {items.map(item => (
            <div
              key={item.id}
              draggable
              onDragStart={e => handleDragStart(e, item)}
              onClick={() => handleClick(item)}
              onMouseEnter={() => setHoverId(item.id)}
              onMouseLeave={() => setHoverId(null)}
              style={{
                breakInside: 'avoid',
                marginBottom: 6,
                borderRadius: 5,
                overflow: 'hidden',
                cursor: 'pointer',
                position: 'relative',
                outline: hoverId === item.id ? '2px solid #3b82f6' : 'none',
                outlineOffset: -1,
              }}
              title={item.alt || item.author}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={item.thumbnail}
                alt={item.alt}
                style={{ display: 'block', width: '100%', height: 'auto' }}
                loading="lazy"
              />
              {item.type === 'video' && (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.3)', pointerEvents: 'none' }}>
                  <svg width={20} height={20} viewBox="0 0 24 24" fill="white"><path d="M8 5v14l11-7z" /></svg>
                </div>
              )}
              {hoverId === item.id && item.author && (
                <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '3px 5px', fontSize: 9, color: 'rgba(255,255,255,0.8)', background: 'rgba(0,0,0,0.5)', pointerEvents: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {item.author}
                </div>
              )}
            </div>
          ))}
        </div>

        {loading && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '12px 0' }}>
            <div style={{ width: 18, height: 18, border: '2px solid #374151', borderTopColor: '#3b82f6', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
          </div>
        )}

        {!loading && items.length === 0 && (
          <div style={{ textAlign: 'center', color: TEXT_DIM, fontSize: 11, paddingTop: 24 }}>No results found</div>
        )}

        <div ref={sentinelRef} style={{ height: 1 }} />
      </div>
    </div>
  );
}

// ── Stock Panel ───────────────────────────────────────────────────────────────

function StockPanel() {
  const [provider, setProvider] = useState<'unsplash' | 'pexels'>('unsplash');
  const [mediaType, setMediaType] = useState<'photo' | 'video'>('photo');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      {/* Provider tabs */}
      <div style={{ display: 'flex', padding: '6px 8px', gap: 4, flexShrink: 0 }}>
        {(['unsplash', 'pexels'] as const).map(p => (
          <button
            key={p}
            onClick={() => setProvider(p)}
            style={{
              flex: 1, padding: '5px 0', borderRadius: 5, border: 'none', cursor: 'pointer', fontSize: 11,
              background: provider === p ? '#1d4ed8' : BG_INPUT,
              color: provider === p ? '#fff' : TEXT_MUTED,
              fontWeight: provider === p ? 600 : 400,
              textTransform: 'capitalize',
            }}
          >
            {p}
          </button>
        ))}
      </div>

      {/* Photo / Video toggle (Pexels only) */}
      {provider === 'pexels' && (
        <div style={{ display: 'flex', padding: '0 8px 6px', gap: 4, flexShrink: 0 }}>
          {(['photo', 'video'] as const).map(t => (
            <button
              key={t}
              onClick={() => setMediaType(t)}
              style={{
                flex: 1, padding: '4px 0', borderRadius: 5, border: 'none', cursor: 'pointer', fontSize: 10,
                background: mediaType === t ? '#374151' : 'transparent',
                color: mediaType === t ? '#f3f4f6' : TEXT_DIM,
                textTransform: 'capitalize',
              }}
            >
              {t}s
            </button>
          ))}
        </div>
      )}

      <StockGrid key={`${provider}-${mediaType}`} provider={provider} mediaType={provider === 'unsplash' ? 'photo' : mediaType} />
    </div>
  );
}

// ── Icons Panel ───────────────────────────────────────────────────────────────

function IconsPanel() {
  const addNode = useBuilderStore(s => s.addNode);
  const currentPageId = useBuilderStore(s => s.currentPageId);

  const [query, setQuery] = useState('');
  const [collections, setCollections] = useState<IconifyCollection[]>([]);
  const [searchResults, setSearchResults] = useState<{ prefix: string; name: string }[]>([]);
  const [searchTotal, setSearchTotal] = useState<number | null>(null);
  const [expandedPrefix, setExpandedPrefix] = useState<string | null>(null);
  const [expandedIcons, setExpandedIcons] = useState<string[]>([]);
  const [loadingSearch, setLoadingSearch] = useState(false);
  const [loadingExpand, setLoadingExpand] = useState(false);
  const [hoveredIcon, setHoveredIcon] = useState<string | null>(null);
  const debouncedQuery = useDebounce(query, 150);

  // Load collections on mount
  useEffect(() => {
    fetch(`${ICONIFY_API}/collections`)
      .then(r => r.json())
      .then((data: Record<string, { name: string; total: number }>) => {
        const list: IconifyCollection[] = Object.entries(data)
          .map(([prefix, info]) => ({ prefix, name: info.name, total: info.total }))
          .sort((a, b) => a.name.localeCompare(b.name));
        setCollections(list);
      })
      .catch(() => {});
  }, []);

  // Search icons
  useEffect(() => {
    if (!debouncedQuery.trim()) {
      setSearchResults([]);
      setSearchTotal(null);
      return;
    }
    setLoadingSearch(true);
    fetch(`${ICONIFY_API}/search?query=${encodeURIComponent(debouncedQuery)}&limit=96`)
      .then(r => r.json())
      .then((data: IconifySearchResult) => {
        const icons = (data.icons ?? []).map(full => {
          const [prefix, ...rest] = full.split(':');
          return { prefix, name: rest.join(':') };
        });
        setSearchResults(icons);
        setSearchTotal(data.total ?? icons.length);
      })
      .catch(() => {})
      .finally(() => setLoadingSearch(false));
  }, [debouncedQuery]);

  // Expand collection
  const expandCollection = async (prefix: string) => {
    if (expandedPrefix === prefix) {
      setExpandedPrefix(null);
      return;
    }
    setExpandedPrefix(prefix);
    setExpandedIcons([]);
    setLoadingExpand(true);
    try {
      // Iconify collection endpoint — just ?prefix=xxx, no extra params
      const res = await fetch(`${ICONIFY_API}/collection?prefix=${prefix}`);
      const data = await res.json();
      // data.icons is an object keyed by icon name (APIv2/v3 standard)
      // Some collections also use data.categories: { catName: ["icon1", "icon2"] }
      const seen = new Set<string>();
      const push = (name: string) => { if (!seen.has(name)) { seen.add(name); } };

      if (data.icons && typeof data.icons === 'object' && !Array.isArray(data.icons)) {
        Object.keys(data.icons).forEach(push);
      } else if (Array.isArray(data.icons)) {
        (data.icons as string[]).forEach(push);
      }
      if (data.categories && typeof data.categories === 'object') {
        Object.values(data.categories as Record<string, string[]>).forEach(arr => {
          if (Array.isArray(arr)) arr.forEach(push);
        });
      }
      if (data.uncategorized && Array.isArray(data.uncategorized)) {
        (data.uncategorized as string[]).forEach(push);
      }
      const icons = Array.from(seen);
      setExpandedIcons(icons.slice(0, 200));
    } catch {
      setExpandedIcons([]);
    } finally {
      setLoadingExpand(false);
    }
  };

  const handleIconClick = (prefix: string, name: string) => {
    if (!currentPageId) return;
    addNode(buildIconNode(prefix, name), null, undefined);
  };

  const handleIconDrag = (e: React.DragEvent, prefix: string, name: string) => {
    const node = buildIconNode(prefix, name);
    const data = JSON.stringify(node);
    e.dataTransfer.setData('text/primitive-node', data);
    // Store as JSON string so the canvas onDrop CDP fallback can call JSON.parse on it
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__primitiveDrag = data;
  };

  const iconsToRender = debouncedQuery.trim() ? searchResults : [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      {/* Search */}
      <div style={{ padding: '8px 8px 4px', flexShrink: 0 }}>
        <input
          data-testid="assets-icon-search"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search icons…"
          style={{ width: '100%', background: BG_INPUT, border: BORDER, borderRadius: 5, color: 'var(--bld-text-2)', fontSize: 11, padding: '5px 8px', boxSizing: 'border-box', outline: 'none' }}
          autoComplete="off"
        />
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {/* Search results */}
        {debouncedQuery.trim() ? (
          <div style={{ padding: '0 8px 8px' }}>
            {searchTotal !== null && (
              <div style={{ padding: '6px 4px 8px' }}>
                <div style={{ fontSize: 11, color: 'var(--bld-text-2)', fontWeight: 600 }}>Icons found: {searchTotal.toLocaleString()}</div>
                {searchTotal > 96 && <div style={{ fontSize: 10, color: TEXT_DIM, marginTop: 2 }}>Try a more specific query to auto-expand results.</div>}
              </div>
            )}
            {loadingSearch && (
              <div style={{ display: 'flex', justifyContent: 'center', padding: 16 }}>
                <div style={{ width: 18, height: 18, border: '2px solid #374151', borderTopColor: '#3b82f6', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
              </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 4 }}>
              {iconsToRender.map(({ prefix, name }) => {
                const key = `${prefix}:${name}`;
                return (
                  <IconCell
                    key={key}
                    iconKey={key}
                    prefix={prefix}
                    name={name}
                    hovered={hoveredIcon === key}
                    onHover={setHoveredIcon}
                    onClick={() => handleIconClick(prefix, name)}
                    onDragStart={e => handleIconDrag(e, prefix, name)}
                  />
                );
              })}
            </div>
          </div>
        ) : (
          /* Category list */
          <div>
            {collections.map(col => (
              <div key={col.prefix}>
                <button
                  onClick={() => expandCollection(col.prefix)}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '7px 12px', background: 'none', border: 'none', cursor: 'pointer',
                    borderBottom: '1px solid rgba(255,255,255,0.04)',
                    color: expandedPrefix === col.prefix ? '#f3f4f6' : TEXT_MUTED,
                  }}
                >
                  <span style={{ fontSize: 12 }}>{col.name}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 10, color: TEXT_DIM }}>{col.total.toLocaleString()}</span>
                    <svg width={10} height={10} viewBox="0 0 12 12" fill="none" style={{ transition: 'transform 0.15s', transform: expandedPrefix === col.prefix ? 'rotate(90deg)' : 'rotate(0deg)', color: TEXT_DIM }}>
                      <path d="M4 2l4 4-4 4" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                </button>

                {expandedPrefix === col.prefix && (
                  <div style={{ padding: '6px 8px 8px', background: 'rgba(255,255,255,0.015)' }}>
                    {loadingExpand ? (
                      <div style={{ display: 'flex', justifyContent: 'center', padding: 12 }}>
                        <div style={{ width: 16, height: 16, border: '2px solid #374151', borderTopColor: '#3b82f6', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
                      </div>
                    ) : (
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 4 }}>
                        {expandedIcons.map(name => {
                          const key = `${col.prefix}:${name}`;
                          return (
                            <IconCell
                              key={key}
                              iconKey={key}
                              prefix={col.prefix}
                              name={name}
                              hovered={hoveredIcon === key}
                              onHover={setHoveredIcon}
                              onClick={() => handleIconClick(col.prefix, name)}
                              onDragStart={e => handleIconDrag(e, col.prefix, name)}
                            />
                          );
                        })}
                        {expandedIcons.length === 200 && (
                          <div style={{ gridColumn: '1 / -1', fontSize: 10, color: TEXT_DIM, textAlign: 'center', paddingTop: 4 }}>
                            Showing first 200 — search to find more
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Icon Cell ─────────────────────────────────────────────────────────────────

function IconCell({
  iconKey, prefix, name, hovered, onHover, onClick, onDragStart,
}: {
  iconKey: string;
  prefix: string;
  name: string;
  hovered: boolean;
  onHover: (key: string | null) => void;
  onClick: () => void;
  onDragStart: (e: React.DragEvent) => void;
}) {
  return (
    <div
      draggable
      data-testid="assets-icon-cell"
      onDragStart={onDragStart}
      onClick={onClick}
      onMouseEnter={() => onHover(iconKey)}
      onMouseLeave={() => onHover(null)}
      title={`${prefix}:${name}`}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        width: '100%', aspectRatio: '1', borderRadius: 5, cursor: 'pointer',
        background: hovered ? 'rgba(59,130,246,0.15)' : 'rgba(255,255,255,0.03)',
        outline: hovered ? '1px solid rgba(59,130,246,0.5)' : 'none',
        transition: 'background 0.1s',
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`${ICONIFY_API}/${prefix}/${name}.svg`}
        alt={name}
        width={20}
        height={20}
        style={{ width: 20, height: 20, filter: 'invert(0.8)' }}
        loading="lazy"
      />
    </div>
  );
}

// ── Main AssetsTab ─────────────────────────────────────────────────────────────

export function AssetsTab() {
  const [tab, setTab] = useState<'icons' | 'stock'>('icons');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}>
      {/* Tab bar */}
      <div style={{ display: 'flex', borderBottom: '1px solid #1f2937', flexShrink: 0 }}>
        {(['icons', 'stock'] as const).map(t => (
          <button
            key={t}
            data-testid={`assets-subtab-${t}`}
            onClick={() => setTab(t)}
            style={{
              flex: 1, padding: '8px 0', background: 'none', border: 'none',
              borderBottom: tab === t ? '2px solid #3b82f6' : '2px solid transparent',
              color: tab === t ? '#f3f4f6' : TEXT_DIM,
              fontSize: 11, cursor: 'pointer', textTransform: 'capitalize', marginBottom: -1,
            }}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'icons' && <IconsPanel />}
      {tab === 'stock' && <StockPanel />}

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
