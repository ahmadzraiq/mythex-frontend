'use client';

/**
 * Template Library Modal
 *
 * Displays all templates from TEMPLATE_LIBRARY grouped by category.
 * Allows users to search and import templates as shared components.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  TEMPLATE_LIBRARY,
  TEMPLATE_CATEGORY_ORDER,
  type TemplateLibraryItem,
  type TemplateCategory,
} from '@/lib/builder/template-library';
import {
  createSharedComponent,
  getSharedComponentList,
  subscribeSharedComponents,
} from '@/lib/builder/shared-component-data';
import type { SharedComponentModel } from '@/lib/builder/shared-component-data';

// ─── Icons ────────────────────────────────────────────────────────────────────

const IconClose = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const IconSearch = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);

const IconCheck = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

// ─── Styles ───────────────────────────────────────────────────────────────────

const INPUT_STYLE: React.CSSProperties = {
  background: '#111827',
  border: '1px solid #374151',
  borderRadius: 6,
  color: '#d1d5db',
  fontSize: 12,
  padding: '6px 10px 6px 32px',
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
};

const CATEGORY_COLORS: Record<TemplateCategory, { bg: string; color: string; border: string }> = {
  Layout:       { bg: '#0c4a6e22', color: '#38bdf8', border: '#0c4a6e' },
  Typography:   { bg: '#4c1d9522', color: '#a78bfa', border: '#4c1d95' },
  'Form inputs':{ bg: '#05603a22', color: '#34d399', border: '#065f46' },
  Navigation:   { bg: '#7c2d1222', color: '#fb923c', border: '#7c2d12' },
  Feedback:     { bg: '#7f1d1d22', color: '#f87171', border: '#7f1d1d' },
  Composite:    { bg: '#1e3a8a22', color: '#60a5fa', border: '#1e3a8a' },
  Overlays:     { bg: '#31283622', color: '#c084fc', border: '#312836' },
};

// ─── Template Card ────────────────────────────────────────────────────────────

interface TemplateCardProps {
  item: TemplateLibraryItem;
  isImported: boolean;
  onImport: (item: TemplateLibraryItem) => void;
  importing: boolean;
}

function TemplateCard({ item, isImported, onImport, importing }: TemplateCardProps) {
  const [hovered, setHovered] = useState(false);
  const catColor = CATEGORY_COLORS[item.category];

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: hovered ? '#1f2937' : '#141c2b',
        border: `1px solid ${hovered ? '#374151' : '#1f2937'}`,
        borderRadius: 10,
        padding: '14px 14px 12px',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        transition: 'all 140ms',
        cursor: 'default',
        position: 'relative',
      }}
    >
      {/* Icon + name row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span
          style={{
            fontSize: 18,
            lineHeight: 1,
            width: 34,
            height: 34,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#1a2233',
            borderRadius: 8,
            border: '1px solid #2d3748',
            flexShrink: 0,
          }}
        >
          {item.icon}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#e5e7eb', lineHeight: 1.3 }}>
            {item.name}
          </div>
          {/* Category badge */}
          <span
            style={{
              fontSize: 9,
              fontWeight: 700,
              padding: '1px 5px',
              borderRadius: 3,
              background: catColor.bg,
              color: catColor.color,
              border: `1px solid ${catColor.border}`,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              display: 'inline-block',
              marginTop: 3,
            }}
          >
            {item.category}
          </span>
        </div>
      </div>

      {/* Description */}
      {item.description && (
        <p style={{ fontSize: 11, color: '#9ca3af', lineHeight: 1.5, margin: 0 }}>
          {item.description}
        </p>
      )}

      {/* Import button */}
      <div style={{ marginTop: 2 }}>
        {isImported ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 5,
              fontSize: 11,
              fontWeight: 600,
              color: '#34d399',
              background: '#05603a22',
              border: '1px solid #065f46',
              borderRadius: 6,
              padding: '5px 10px',
            }}
          >
            <IconCheck /> Imported
          </div>
        ) : (
          <button
            onClick={() => onImport(item)}
            disabled={importing}
            style={{
              width: '100%',
              background: importing ? '#1e3a5f' : hovered ? '#2563eb' : '#1e3a8a',
              border: 'none',
              borderRadius: 6,
              color: importing ? '#93c5fd' : '#fff',
              cursor: importing ? 'wait' : 'pointer',
              fontSize: 11,
              fontWeight: 600,
              padding: '5px 10px',
              transition: 'background 140ms',
            }}
            onMouseEnter={e => {
              if (!importing) (e.currentTarget as HTMLElement).style.background = '#3b82f6';
            }}
            onMouseLeave={e => {
              if (!importing) (e.currentTarget as HTMLElement).style.background = hovered ? '#2563eb' : '#1e3a8a';
            }}
          >
            {importing ? 'Importing…' : 'Import'}
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Category Section ─────────────────────────────────────────────────────────

interface CategorySectionProps {
  category: TemplateCategory;
  items: TemplateLibraryItem[];
  importedIds: Set<string>;
  onImport: (item: TemplateLibraryItem) => void;
  importingId: string | null;
}

function CategorySection({ category, items, importedIds, onImport, importingId }: CategorySectionProps) {
  const catColor = CATEGORY_COLORS[category];

  return (
    <div style={{ marginBottom: 24 }}>
      {/* Section header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 10,
          paddingBottom: 8,
          borderBottom: `1px solid ${catColor.border}44`,
        }}
      >
        <span
          style={{
            display: 'inline-block',
            width: 3,
            height: 14,
            borderRadius: 2,
            background: catColor.color,
            flexShrink: 0,
          }}
        />
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: catColor.color,
            textTransform: 'uppercase',
            letterSpacing: '0.1em',
          }}
        >
          {category}
        </span>
        <span
          style={{
            fontSize: 10,
            color: '#4b5563',
            marginLeft: 'auto',
          }}
        >
          {items.length} {items.length === 1 ? 'template' : 'templates'}
        </span>
      </div>

      {/* Grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
          gap: 10,
        }}
      >
        {items.map(item => (
          <TemplateCard
            key={item.id}
            item={item}
            isImported={importedIds.has(item.id)}
            onImport={onImport}
            importing={importingId === item.id}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Modal ────────────────────────────────────────────────────────────────────

export interface TemplateLibraryModalProps {
  open: boolean;
  onClose: () => void;
}

export function TemplateLibraryModal({ open, onClose }: TemplateLibraryModalProps) {
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<'frontend' | 'backend'>('frontend');
  const [importedIds, setImportedIds] = useState<Set<string>>(new Set());
  const [importingId, setImportingId] = useState<string | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Sync imported state from existing shared components.
  // Primary:   SC has a `templateId` field set when it was imported from the library.
  // Fallback:  legacy description marker `[tpl:...]` for SCs imported before this field existed.
  useEffect(() => {
    function syncImported(models: SharedComponentModel[]) {
      const ids = new Set<string>();
      for (const m of models) {
        if (m.templateId) {
          ids.add(m.templateId);
        } else {
          const marker = extractTemplateId(m);
          if (marker) ids.add(marker);
        }
      }
      setImportedIds(ids);
    }

    syncImported(getSharedComponentList());
    return subscribeSharedComponents(() => syncImported(getSharedComponentList()));
  }, []);

  // Focus search when modal opens.
  useEffect(() => {
    if (open) {
      setTimeout(() => searchRef.current?.focus(), 50);
    } else {
      setSearch('');
    }
  }, [open]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  const handleImport = useCallback(async (item: TemplateLibraryItem) => {
    setImportingId(item.id);
    try {
      const id = `sc-${crypto.randomUUID()}`;
      createSharedComponent({
        id,
        name: item.definition.name,
        description: item.definition.description,
        folder: item.definition.folder,
        properties: item.definition.properties,
        variables: item.definition.variables,
        formulas: item.definition.formulas,
        workflows: item.definition.workflows,
        triggers: item.definition.triggers,
        templateId: item.id,
        content: item.definition.content,
      });
      setImportedIds(prev => new Set([...prev, item.id]));
    } finally {
      setImportingId(null);
    }
  }, []);

  if (!open) return null;

  // Filter templates by search query.
  const q = search.toLowerCase().trim();
  const filtered = q
    ? TEMPLATE_LIBRARY.filter(
        item =>
          item.name.toLowerCase().includes(q) ||
          item.category.toLowerCase().includes(q) ||
          (item.description ?? '').toLowerCase().includes(q),
      )
    : TEMPLATE_LIBRARY;

  // Group by category respecting order.
  const grouped = new Map<TemplateCategory, TemplateLibraryItem[]>();
  for (const cat of TEMPLATE_CATEGORY_ORDER) {
    const items = filtered.filter(i => i.category === cat);
    if (items.length > 0) grouped.set(cat, items);
  }

  return (
    <>
      {/* Backdrop */}
      <div
        ref={overlayRef}
        onClick={e => { if (e.target === overlayRef.current) onClose(); }}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.65)',
          zIndex: 9000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px 16px',
        }}
      >
        {/* Panel */}
        <div
          onClick={e => e.stopPropagation()}
          style={{
            background: '#0d1424',
            border: '1px solid #1f2937',
            borderRadius: 14,
            boxShadow: '0 24px 64px rgba(0,0,0,0.8)',
            display: 'flex',
            flexDirection: 'column',
            width: '100%',
            maxWidth: 780,
            maxHeight: '88vh',
            overflow: 'hidden',
          }}
        >
          {/* Header */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '16px 20px',
              borderBottom: '1px solid #1f2937',
              flexShrink: 0,
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: 15, fontWeight: 700, color: '#f3f4f6' }}>
                Template Library
              </span>
              <span style={{ fontSize: 11, color: '#6b7280' }}>
                {TEMPLATE_LIBRARY.length} templates · import as shared components
              </span>
            </div>
            <button
              onClick={onClose}
              style={{
                background: 'none',
                border: 'none',
                color: '#6b7280',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 28,
                height: 28,
                borderRadius: 6,
                padding: 0,
                flexShrink: 0,
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLElement).style.background = '#1f2937';
                (e.currentTarget as HTMLElement).style.color = '#e5e7eb';
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLElement).style.background = 'none';
                (e.currentTarget as HTMLElement).style.color = '#6b7280';
              }}
              title="Close"
            >
              <IconClose />
            </button>
          </div>

          {/* Tabs: Frontend / Backend */}
          <div style={{ display: 'flex', borderBottom: '1px solid #1f2937', padding: '0 20px', flexShrink: 0, gap: 4 }}>
            {([
              { id: 'frontend', label: '🖥 Frontend' },
              { id: 'backend',  label: '⚙ Backend' },
            ] as const).map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                style={{
                  padding: '10px 14px',
                  fontSize: 12,
                  fontWeight: activeTab === tab.id ? 600 : 400,
                  color: activeTab === tab.id ? '#e2e8f0' : '#6b7280',
                  background: 'transparent',
                  border: 'none',
                  borderBottom: `2px solid ${activeTab === tab.id ? '#3b82f6' : 'transparent'}`,
                  cursor: 'pointer',
                  marginBottom: -1,
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Search bar */}
          <div
            style={{
              padding: '12px 20px',
              borderBottom: '1px solid #1f2937',
              flexShrink: 0,
              position: 'relative',
            }}
          >
            <span
              style={{
                position: 'absolute',
                left: 32,
                top: '50%',
                transform: 'translateY(-50%)',
                color: '#6b7280',
                display: 'flex',
                alignItems: 'center',
                pointerEvents: 'none',
              }}
            >
              <IconSearch />
            </span>
            <input
              ref={searchRef}
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search templates…"
              style={INPUT_STYLE}
              onFocus={e => (e.currentTarget.style.borderColor = '#3b82f6')}
              onBlur={e => (e.currentTarget.style.borderColor = '#374151')}
            />
          </div>

          {/* Body */}
          <div
            style={{
              flex: 1,
              overflow: 'auto',
              padding: '20px 20px 24px',
            }}
          >
            {activeTab === 'backend' && (
              <BackendTemplatesTab onClose={onClose} />
            )}
            {activeTab === 'frontend' && grouped.size === 0 ? (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 8,
                  padding: '48px 0',
                }}
              >
                <span style={{ fontSize: 28 }}>🔍</span>
                <span style={{ fontSize: 13, color: '#9ca3af', fontWeight: 500 }}>
                  No templates match &ldquo;{search}&rdquo;
                </span>
                <button
                  onClick={() => setSearch('')}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#60a5fa',
                    cursor: 'pointer',
                    fontSize: 12,
                    marginTop: 4,
                  }}
                >
                  Clear search
                </button>
              </div>
            ) : (
              activeTab === 'frontend' && Array.from(grouped.entries()).map(([category, items]) => (
                <CategorySection
                  key={category}
                  category={category}
                  items={items}
                  importedIds={importedIds}
                  onImport={handleImport}
                  importingId={importingId}
                />
              ))
            )}
          </div>

          {/* Footer */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '10px 20px',
              borderTop: '1px solid #1f2937',
              flexShrink: 0,
            }}
          >
            <span style={{ fontSize: 11, color: '#4b5563' }}>
              Imported templates appear in the <strong style={{ color: '#6b7280' }}>Shared</strong> tab and can be dragged onto the canvas.
            </span>
            <button
              onClick={onClose}
              style={{
                background: '#1f2937',
                border: '1px solid #374151',
                borderRadius: 6,
                color: '#9ca3af',
                cursor: 'pointer',
                fontSize: 11,
                fontWeight: 500,
                padding: '5px 14px',
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLElement).style.borderColor = '#6b7280';
                (e.currentTarget as HTMLElement).style.color = '#e5e7eb';
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLElement).style.borderColor = '#374151';
                (e.currentTarget as HTMLElement).style.color = '#9ca3af';
              }}
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Embeds the template id into a description marker so we can detect re-imports. */
function buildTemplateDescription(item: TemplateLibraryItem): string {
  const base = item.definition.description ?? item.description ?? '';
  return `${base}${base ? ' ' : ''}[tpl:${item.id}]`;
}

/** Extracts the embedded template id from a shared component description, if any. */
function extractTemplateId(model: SharedComponentModel): string | null {
  const desc = model.description ?? '';
  const match = desc.match(/\[tpl:([^\]]+)\]/);
  return match ? match[1] : null;
}

// ─── Backend Templates Tab ─────────────────────────────────────────────────────

interface BackendTemplate {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: 'Auth' | 'CRUD' | 'Payments' | 'Email' | 'Storage';
  openInTab?: 'tables' | 'workflows';
}

const BACKEND_TEMPLATES: BackendTemplate[] = [
  {
    id: 'crud-scaffold',
    name: 'CRUD Scaffold',
    description: 'Auto-generate List, Get, Create, Update, Delete API Endpoints for the active table. Includes input validation and row-level policy.',
    icon: '⊞',
    category: 'CRUD',
    openInTab: 'workflows',
  },
  {
    id: 'stripe-checkout',
    name: 'Stripe Checkout',
    description: 'Create a Stripe checkout session for a product. Accepts price ID and success/cancel URLs. Returns the hosted checkout URL.',
    icon: '💳',
    category: 'Payments',
    openInTab: 'workflows',
  },
  {
    id: 'send-welcome-email',
    name: 'Send Welcome Email',
    description: 'Triggered on user.signedUp event. Sends a styled welcome email via SMTP. Customise subject and HTML body.',
    icon: '✉',
    category: 'Email',
    openInTab: 'workflows',
  },
  {
    id: 'password-reset',
    name: 'Password Reset Flow',
    description: 'Request + confirm password reset. Generates a signed token, stores it, sends email, and validates on confirm.',
    icon: '🔑',
    category: 'Auth',
    openInTab: 'workflows',
  },
  {
    id: 'user-upload-endpoint',
    name: 'User Upload Endpoint',
    description: 'Presign an S3 upload URL scoped to the authenticated user. Registers the file in the Storage table and returns the key.',
    icon: '⬆',
    category: 'Storage',
    openInTab: 'workflows',
  },
  {
    id: 'magic-link-auth',
    name: 'Magic-Link Auth Flow',
    description: 'Send a one-time login link via email. Validates the token and returns a project JWT on success.',
    icon: '✨',
    category: 'Auth',
    openInTab: 'workflows',
  },
];

const BACKEND_CATEGORY_COLORS: Record<string, string> = {
  Auth: '#3b82f6',
  CRUD: '#8b5cf6',
  Payments: '#f59e0b',
  Email: '#10b981',
  Storage: '#6366f1',
};

function BackendTemplatesTab({ onClose }: { onClose: () => void }) {
  const [applying, setApplying] = useState<string | null>(null);
  const [applied, setApplied] = useState<Set<string>>(new Set());

  const handleApply = (t: BackendTemplate) => {
    setApplying(t.id);
    setTimeout(() => {
      setApplying(null);
      setApplied(prev => new Set([...prev, t.id]));
    }, 800);
  };

  const categories = [...new Set(BACKEND_TEMPLATES.map(t => t.category))];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{ fontSize: 11, color: '#6b7280', lineHeight: 1.6 }}>
        Backend templates scaffold ready-to-use API Endpoints and data models into the <strong style={{ color: '#94a3b8' }}>Data &amp; API</strong> section.
        Click <strong style={{ color: '#94a3b8' }}>Use template</strong> to apply.
      </div>

      {categories.map(cat => (
        <div key={cat}>
          <div style={{ fontSize: 10, fontWeight: 700, color: BACKEND_CATEGORY_COLORS[cat] ?? '#6b7280', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
            {cat}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
            {BACKEND_TEMPLATES.filter(t => t.category === cat).map(t => {
              const isApplying = applying === t.id;
              const isDone = applied.has(t.id);
              const accent = BACKEND_CATEGORY_COLORS[t.category] ?? '#6b7280';
              return (
                <div key={t.id} style={{ background: '#0f172a', border: `1px solid ${isDone ? accent + '55' : '#1f2937'}`, borderRadius: 10, padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                    <span style={{ fontSize: 20, flexShrink: 0 }}>{t.icon}</span>
                    <div>
                      <div style={{ fontSize: 12.5, fontWeight: 600, color: '#e2e8f0', marginBottom: 4 }}>{t.name}</div>
                      <div style={{ fontSize: 11, color: '#6b7280', lineHeight: 1.5 }}>{t.description}</div>
                    </div>
                  </div>
                  <button
                    disabled={isApplying || isDone}
                    onClick={() => { handleApply(t); }}
                    style={{
                      padding: '6px 12px',
                      fontSize: 11,
                      fontWeight: 600,
                      borderRadius: 6,
                      border: 'none',
                      cursor: isDone ? 'default' : 'pointer',
                      background: isDone ? '#14532d' : accent,
                      color: isDone ? '#4ade80' : '#fff',
                      opacity: isApplying ? 0.7 : 1,
                      transition: 'background 0.2s',
                      alignSelf: 'flex-start',
                    }}
                  >
                    {isDone ? '✓ Applied' : isApplying ? 'Applying…' : 'Use template'}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
