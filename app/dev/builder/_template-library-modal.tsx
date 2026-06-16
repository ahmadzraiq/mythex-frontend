'use client';

/**
 * Template Library Modal
 *
 * Displays all templates from TEMPLATE_LIBRARY grouped by category.
 * Allows users to search and import templates as shared components.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { SearchInput } from './_panel-primitives';
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

const CATEGORY_COLORS: Record<TemplateCategory, { accent: string }> = {
  Layout:       { accent: '#38bdf8' },
  Typography:   { accent: '#a78bfa' },
  'Form inputs':{ accent: '#34d399' },
  Navigation:   { accent: '#fb923c' },
  Feedback:     { accent: '#f87171' },
  Composite:    { accent: '#60a5fa' },
  Overlays:     { accent: '#c084fc' },
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
  const accent = CATEGORY_COLORS[item.category].accent;

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: hovered ? 'var(--bld-bg-elevated)' : 'var(--bld-bg-input)',
        border: `1px solid ${hovered ? 'var(--bld-border-subtle)' : 'var(--bld-border)'}`,
        borderRadius: 10,
        padding: '12px',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        transition: 'all 140ms',
        cursor: 'default',
      }}
    >
      {/* Icon + name row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <span
          style={{
            fontSize: 16,
            lineHeight: 1,
            width: 34,
            height: 34,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'var(--bld-bg-elevated)',
            borderRadius: 8,
            flexShrink: 0,
            color: accent,
            fontWeight: 500,
          }}
        >
          {item.icon}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--bld-text-1)', lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {item.name}
          </div>
          <span
            style={{
              fontSize: 9,
              fontWeight: 600,
              padding: '1px 5px',
              borderRadius: 3,
              background: `${accent}15`,
              color: accent,
              border: `1px solid ${accent}28`,
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
        <p style={{ fontSize: 10.5, color: 'var(--bld-text-3)', lineHeight: 1.5, margin: 0 }}>
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
              color: 'var(--bld-success)',
              background: 'rgba(52,211,153,0.1)',
              border: '1px solid rgba(52,211,153,0.25)',
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
              background: importing ? 'rgba(99,102,241,0.25)' : 'var(--bld-accent)',
              border: 'none',
              borderRadius: 6,
              color: '#fff',
              cursor: importing ? 'wait' : 'pointer',
              fontSize: 11,
              fontWeight: 600,
              padding: '5px 10px',
              transition: 'background 140ms',
              opacity: importing ? 0.7 : 1,
            }}
            onMouseEnter={e => {
              if (!importing) (e.currentTarget as HTMLElement).style.background = 'var(--bld-accent-hover)';
            }}
            onMouseLeave={e => {
              if (!importing) (e.currentTarget as HTMLElement).style.background = 'var(--bld-accent)';
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
  const accent = CATEGORY_COLORS[category].accent;

  return (
    <div style={{ marginBottom: 28 }}>
      {/* Section header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10 }}>
        <span style={{ display: 'inline-block', width: 3, height: 12, borderRadius: 2, background: accent, flexShrink: 0 }} />
        <span style={{ fontSize: 11, fontWeight: 700, color: accent }}>
          {category}
        </span>
        <span style={{ fontSize: 10, color: 'var(--bld-text-disabled)', marginLeft: 'auto' }}>
          {items.length} {items.length === 1 ? 'template' : 'templates'}
        </span>
      </div>

      {/* Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 8 }}>
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
          background: 'rgba(0,0,0,0.6)',
          backdropFilter: 'blur(4px)',
          WebkitBackdropFilter: 'blur(4px)',
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
            backgroundColor: 'var(--bld-bg-panel)',
            backgroundImage: [
              'radial-gradient(ellipse 80% 40% at 50% 0%, rgba(99,102,241,0.08) 0%, transparent 60%)',
              'radial-gradient(circle, rgba(255,255,255,0.025) 1px, transparent 1px)',
            ].join(', '),
            backgroundSize: 'auto, 22px 22px',
            border: '1px solid var(--bld-border-subtle)',
            borderRadius: 14,
            boxShadow: '0 24px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(99,102,241,0.1)',
            display: 'flex',
            flexDirection: 'column',
            width: '100%',
            maxWidth: 800,
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
              flexShrink: 0,
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--bld-text-1)' }}>
                Template Library
              </span>
              <span style={{ fontSize: 11, color: 'var(--bld-text-3)' }}>
                {TEMPLATE_LIBRARY.length} templates · import as shared components
              </span>
            </div>
            <button
              onClick={onClose}
              title="Close"
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--bld-text-disabled)',
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
                (e.currentTarget as HTMLElement).style.background = 'var(--bld-bg-elevated)';
                (e.currentTarget as HTMLElement).style.color = 'var(--bld-text-2)';
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLElement).style.background = 'none';
                (e.currentTarget as HTMLElement).style.color = 'var(--bld-text-disabled)';
              }}
            >
              <IconClose />
            </button>
          </div>

          {/* Tabs + Search row */}
          <div style={{ display: 'flex', alignItems: 'center', padding: '0 20px 10px', flexShrink: 0, gap: 8 }}>
            <div style={{ display: 'flex', gap: 2, background: 'var(--bld-bg-elevated)', borderRadius: 8, padding: '3px' }}>
              {([
                { id: 'frontend', label: 'Frontend' },
                { id: 'backend',  label: 'Backend' },
              ] as const).map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  style={{
                    padding: '5px 12px',
                    fontSize: 12,
                    fontWeight: 500,
                    color: activeTab === tab.id ? 'var(--bld-text-1)' : 'var(--bld-text-3)',
                    background: activeTab === tab.id ? 'var(--bld-bg-input)' : 'transparent',
                    border: 'none',
                    borderRadius: 6,
                    cursor: 'pointer',
                    transition: 'all 120ms',
                  }}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <div style={{ flex: 1 }}>
              <SearchInput value={search} onChange={setSearch} placeholder="Search templates…" inputRef={searchRef} />
            </div>
          </div>

          {/* Body */}
          <div style={{ flex: 1, overflow: 'auto', padding: '12px 20px 24px' }}>
            {activeTab === 'backend' && (
              <BackendTemplatesTab onClose={onClose} />
            )}
            {activeTab === 'frontend' && grouped.size === 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '48px 0' }}>
                <span style={{ fontSize: 28 }}>🔍</span>
                <span style={{ fontSize: 13, color: 'var(--bld-text-3)', fontWeight: 500 }}>
                  No templates match &ldquo;{search}&rdquo;
                </span>
                <button
                  onClick={() => setSearch('')}
                  style={{ background: 'none', border: 'none', color: 'var(--bld-accent)', cursor: 'pointer', fontSize: 12, marginTop: 4 }}
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
              borderTop: '1px solid var(--bld-border)',
              flexShrink: 0,
            }}
          >
            <span style={{ fontSize: 11, color: 'var(--bld-text-3)' }}>
              Imported templates appear in the <strong style={{ color: 'var(--bld-text-2)', fontWeight: 600 }}>Shared</strong> tab.
            </span>
            <button
              onClick={onClose}
              style={{
                background: 'var(--bld-bg-elevated)',
                border: '1px solid var(--bld-border)',
                borderRadius: 6,
                color: 'var(--bld-text-3)',
                cursor: 'pointer',
                fontSize: 11,
                fontWeight: 500,
                padding: '5px 14px',
                transition: 'all 120ms',
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLElement).style.borderColor = 'var(--bld-border-subtle)';
                (e.currentTarget as HTMLElement).style.color = 'var(--bld-text-2)';
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLElement).style.borderColor = 'var(--bld-border)';
                (e.currentTarget as HTMLElement).style.color = 'var(--bld-text-3)';
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
  Auth: 'var(--bld-accent)',
  CRUD: '#8b5cf6',
  Payments: 'var(--bld-warning)',
  Email: 'var(--bld-success)',
  Storage: 'var(--bld-accent)',
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
      <div style={{ fontSize: 11, color: 'var(--bld-text-disabled)', lineHeight: 1.6 }}>
        Backend templates scaffold ready-to-use API Endpoints and data models into the <strong style={{ color: 'var(--bld-text-3)' }}>Data &amp; API</strong> section.
        Click <strong style={{ color: 'var(--bld-text-3)' }}>Use template</strong> to apply.
      </div>

      {categories.map(cat => (
        <div key={cat}>
          <div style={{ fontSize: 10, fontWeight: 700, color: BACKEND_CATEGORY_COLORS[cat] ?? 'var(--bld-text-disabled)', textTransform: 'none', marginBottom: 10 }}>
            {cat}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
            {BACKEND_TEMPLATES.filter(t => t.category === cat).map(t => {
              const isApplying = applying === t.id;
              const isDone = applied.has(t.id);
              const accent = BACKEND_CATEGORY_COLORS[t.category] ?? 'var(--bld-text-disabled)';
              return (
                <div key={t.id} style={{ background: isDone ? `${accent}10` : 'var(--bld-bg-input)', border: `1px solid ${isDone ? accent + '30' : 'var(--bld-border)'}`, borderRadius: 10, padding: 12, display: 'flex', flexDirection: 'column', gap: 10, transition: 'all 140ms' }}>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                    <span style={{ fontSize: 16, flexShrink: 0, width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bld-bg-elevated)', borderRadius: 8, color: accent, fontWeight: 500 }}>{t.icon}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--bld-text-1)', marginBottom: 4 }}>{t.name}</div>
                      <div style={{ fontSize: 10.5, color: 'var(--bld-text-3)', lineHeight: 1.5 }}>{t.description}</div>
                    </div>
                  </div>
                  <button
                    disabled={isApplying || isDone}
                    onClick={() => { handleApply(t); }}
                    style={{
                      padding: '5px 12px',
                      fontSize: 11,
                      fontWeight: 600,
                      borderRadius: 6,
                      border: 'none',
                      cursor: isDone ? 'default' : 'pointer',
                      background: isDone ? 'rgba(52,211,153,0.15)' : accent,
                      color: isDone ? 'var(--bld-success)' : '#fff',
                      opacity: isApplying ? 0.7 : 1,
                      transition: 'all 0.2s',
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
