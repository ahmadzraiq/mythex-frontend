'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { projects as projectsApi } from '@/lib/platform/api-client';
import {
  BUSINESS_CATEGORIES,
  DESIGN_MOODS,
  FONT_PAIRINGS,
  DESCRIPTION_CHIPS,
  deriveDarkPalette,
  type ColorPalette,
  type FontPair,
} from '@/lib/builder/wizard-data';
import type { AiPage, AiSection } from '@/app/api/ai/generate-pages/route';
import type { AiPageStub } from '@/app/api/ai/generate-page-names/route';

// ── Types ─────────────────────────────────────────────────────────────────────

interface WizardState {
  step: 1 | 2 | 3 | 4;
  businessDescription: string;
  // AI-populated at step 1→2
  /** AI-generated app/brand name from classify */
  appName: string;
  category: string;
  mood: string;
  /** Original AI-suggested category — never changes after AI classifies */
  aiCategory: string;
  /** Original AI-suggested mood — never changes after AI classifies */
  aiMood: string;
  // Default is fixed (AI doesn't select these), but user can change them
  animationLevel: 0 | 1 | 2 | 3;
  layoutStructure: 0 | 1 | 2 | 3 | 4;
  // AI-populated at step 2→3
  palettes: ColorPalette[];
  fonts: FontPair[];
  selectedPaletteIdx: number;
  selectedFontIdx: number;
  // Loading flags for step 3 (non-blocking inline loaders)
  palettesLoading: boolean;
  fontsLoading: boolean;
  // AI-populated at step 3→4
  pages: AiPage[];
  selectedPageIds: string[];
  // Step 4 loading flags
  pageNamesLoading: boolean;
  sectionsLoadingIds: string[];
  // Legacy flag (only used for classify overlay on step 1)
  aiClassifying: boolean;
  // Modals
  showCategoryModal: boolean;
  showMoodModal: boolean;
  // Final generate
  generating: boolean;
  generateError: string | null;
}

// ── Colours & constants ───────────────────────────────────────────────────────

const BG = '#0a0a0a';
const CARD_BG = '#111111';
const CARD_BORDER = '1px solid #1f2937';
const TEXT_PRIMARY = '#f9fafb';
const TEXT_MUTED = '#9ca3af';
const TEXT_DIM = '#6b7280';
const BADGE_BLUE: React.CSSProperties = {
  background: '#1d4ed8', color: '#bfdbfe', fontSize: 10, fontWeight: 700,
  padding: '2px 7px', borderRadius: 4, letterSpacing: '0.03em',
};
const BADGE_USER: React.CSSProperties = {
  background: '#374151', color: '#d1d5db', fontSize: 10, fontWeight: 700,
  padding: '2px 7px', borderRadius: 4, letterSpacing: '0.03em',
};
const BTN_PRIMARY: React.CSSProperties = {
  padding: '9px 20px', borderRadius: 8, border: 'none', cursor: 'pointer',
  background: '#2563eb', color: '#fff', fontSize: 13, fontWeight: 600,
  display: 'flex', alignItems: 'center', gap: 6,
};
const BTN_GHOST: React.CSSProperties = {
  padding: '9px 20px', borderRadius: 8, border: '1px solid #374151', cursor: 'pointer',
  background: 'transparent', color: TEXT_MUTED, fontSize: 13, fontWeight: 500,
  display: 'flex', alignItems: 'center', gap: 6,
};
const BTN_DISABLED: React.CSSProperties = {
  ...BTN_PRIMARY, background: '#1e3a6e', opacity: 0.5, cursor: 'not-allowed',
};
const BTN_SMALL: React.CSSProperties = {
  padding: '5px 12px', borderRadius: 6, border: '1px solid #374151', cursor: 'pointer',
  background: 'transparent', color: TEXT_DIM, fontSize: 11, fontWeight: 500,
  display: 'flex', alignItems: 'center', gap: 4,
};

const ANIMATION_LABELS = ['None', 'Low', 'Medium', 'High'];
const ANIMATION_DESCS  = ['No animations', 'Subtle motion', 'Balanced experience', 'Rich animations'];
const LAYOUT_LABELS    = ['Symmetric', 'Mostly Symmetric', 'Mixed', 'Mostly Asymmetric', 'Asymmetric'];
const LAYOUT_DESCS     = ['Balanced & traditional', 'Balanced with variety', 'Equal balance', 'Dynamic with structure', 'Dynamic & modern'];

const STEP_INFO = [
  { num: 1, icon: '📝', label: 'Business' },
  { num: 2, icon: '✦', label: 'Design Style' },
  { num: 3, icon: '🎨', label: 'Colors & Fonts' },
  { num: 4, icon: '📄', label: 'Pages' },
];

// ── Google Font injection helper ──────────────────────────────────────────────

function injectGoogleFontLinkWizard(fontName: string) {
  if (typeof document === 'undefined') return;
  const skip = new Set(['System UI', 'system-ui', 'sans-serif', 'serif', 'monospace', 'cursive', 'Geist']);
  if (skip.has(fontName)) return;
  const id = `gf-wizard-${fontName.replace(/\s+/g, '-').toLowerCase()}`;
  if (document.getElementById(id)) return;
  const link = document.createElement('link');
  link.id = id;
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(fontName)}:wght@400;600;700&display=swap`;
  document.head.appendChild(link);
}

// ── Sub-components ────────────────────────────────────────────────────────────

function WizardStepBar({ step }: { step: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0, paddingBottom: 32 }}>
      {STEP_INFO.map((s, i) => {
        const done = step > s.num;
        const active = step === s.num;
        return (
          <div key={s.num} style={{ display: 'flex', alignItems: 'center' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
              <div style={{
                width: 36, height: 36, borderRadius: '50%',
                background: done ? '#16a34a' : active ? '#2563eb' : '#1f2937',
                border: done ? '2px solid #16a34a' : active ? '2px solid #3b82f6' : '2px solid #374151',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#fff', fontSize: 14, fontWeight: 700, transition: 'all 0.2s',
              }}>
                {done ? '✓' : <span style={{ fontSize: 16 }}>{s.icon}</span>}
              </div>
              <span style={{ fontSize: 10, color: active ? '#93c5fd' : done ? '#4ade80' : TEXT_DIM, fontWeight: active ? 600 : 400, whiteSpace: 'nowrap' }}>
                {s.label}
              </span>
            </div>
            {i < STEP_INFO.length - 1 && (
              <div style={{ width: 80, height: 2, background: step > s.num ? '#16a34a' : '#1f2937', margin: '0 4px', marginBottom: 20 }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function AiLoadingOverlay({ message }: { message: string }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 10001,
      background: 'rgba(10,10,10,0.92)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 20,
    }}>
      <div style={{ display: 'flex', gap: 8 }}>
        {[0, 1, 2].map(i => (
          <div key={i} style={{
            width: 10, height: 10, borderRadius: '50%', background: '#3b82f6',
            animation: `bounce 1.2s ease-in-out ${i * 0.2}s infinite`,
          }} />
        ))}
      </div>
      <div style={{ fontSize: 15, color: TEXT_PRIMARY, fontWeight: 500 }}>{message}</div>
      <div style={{ fontSize: 12, color: TEXT_MUTED }}>Powered by Claude AI</div>
      <style>{`@keyframes bounce { 0%,80%,100%{transform:scale(0.6);opacity:0.4} 40%{transform:scale(1);opacity:1} }`}</style>
    </div>
  );
}

function PaletteSkeletonCard() {
  return (
    <div style={{ borderRadius: 10, border: CARD_BORDER, background: CARD_BG, padding: 14, position: 'relative', overflow: 'hidden' }}>
      <div style={{ height: 13, background: '#1f2937', borderRadius: 4, marginBottom: 8, width: '55%', animation: 'shimmer 1.5s ease-in-out infinite' }} />
      <div style={{ height: 10, background: '#1a1a1a', borderRadius: 4, marginBottom: 14, width: '80%' }} />
      <div style={{ fontSize: 9, color: TEXT_DIM, letterSpacing: '0.06em', textTransform: 'uppercase' as const, marginBottom: 4 }}>Light</div>
      <div style={{ display: 'flex', gap: 3, marginBottom: 8 }}>
        {[1,2,3,4,5].map(i => <div key={i} style={{ flex: 1, height: 20, borderRadius: 4, background: '#1f2937' }} />)}
      </div>
      <div style={{ fontSize: 9, color: TEXT_DIM, letterSpacing: '0.06em', textTransform: 'uppercase' as const, marginBottom: 4 }}>Dark</div>
      <div style={{ display: 'flex', gap: 3 }}>
        {[1,2,3,4,5].map(i => <div key={i} style={{ flex: 1, height: 20, borderRadius: 4, background: '#1a1a1a' }} />)}
      </div>
      <style>{`@keyframes shimmer { 0%,100%{opacity:0.4} 50%{opacity:0.8} }`}</style>
    </div>
  );
}

function FontSkeletonCard() {
  return (
    <div style={{ borderRadius: 10, border: CARD_BORDER, background: CARD_BG, padding: 20, position: 'relative', overflow: 'hidden' }}>
      <div style={{ height: 22, background: '#1f2937', borderRadius: 4, marginBottom: 10, width: '65%', animation: 'shimmer 1.5s ease-in-out infinite' }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ height: 9, background: '#1a1a1a', borderRadius: 3, width: '35%' }} />
        <div style={{ height: 9, background: '#1a1a1a', borderRadius: 3, width: '30%' }} />
      </div>
      <div style={{ height: 1, background: '#1f2937', marginBottom: 12 }} />
      <div style={{ height: 9, background: '#1a1a1a', borderRadius: 3, marginBottom: 5, width: '90%' }} />
      <div style={{ height: 9, background: '#1a1a1a', borderRadius: 3, marginBottom: 5, width: '75%' }} />
      <div style={{ height: 9, background: '#1a1a1a', borderRadius: 3, width: '60%' }} />
    </div>
  );
}

function PaletteCard({ palette, selected, onClick }: { palette: ColorPalette; selected: boolean; onClick: () => void }) {
  const dark = deriveDarkPalette(palette);
  return (
    <div
      onClick={onClick}
      style={{
        borderRadius: 10,
        border: CARD_BORDER,
        outline: selected ? '2px solid #3b82f6' : 'none',
        outlineOffset: '-1px',
        background: selected ? 'rgba(37,99,235,0.08)' : CARD_BG,
        padding: 14, cursor: 'pointer', position: 'relative',
        transition: 'outline-color 0.15s, background 0.15s',
      }}
    >
      {selected && (
        <div style={{ position: 'absolute', top: 10, right: 10, width: 18, height: 18, borderRadius: '50%', background: '#2563eb', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 11 }}>✓</div>
      )}
      <div style={{ fontWeight: 600, fontSize: 13, color: TEXT_PRIMARY, marginBottom: 3 }}>{palette.name}</div>
      <div style={{ fontSize: 11, color: TEXT_MUTED, marginBottom: 10, lineHeight: 1.4 }}>{palette.description}</div>

      {/* Light mode swatches */}
      <div style={{ marginBottom: 6 }}>
        <div style={{ fontSize: 9, color: TEXT_DIM, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 4 }}>Light</div>
        <div style={{ display: 'flex', gap: 3 }}>
          {[
            { color: palette.primary, label: 'Primary' },
            { color: palette.secondary, label: 'Second.' },
            { color: palette.accent, label: 'Accent' },
            { color: palette.bg, label: 'BG' },
            { color: palette.textPrimary, label: 'Text' },
          ].map(({ color, label }) => (
            <div key={label} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
              <div style={{ width: '100%', height: 20, borderRadius: 4, background: color, border: '1px solid rgba(255,255,255,0.08)' }} />
              <span style={{ fontSize: 8, color: TEXT_DIM }}>{label}</span>
          </div>
        ))}
      </div>
      </div>

      {/* Dark mode swatches */}
      <div>
        <div style={{ fontSize: 9, color: TEXT_DIM, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 4 }}>Dark</div>
        <div style={{ display: 'flex', gap: 3 }}>
          {[
            { color: dark.primary ?? palette.primary, label: 'Primary' },
            { color: dark.secondary ?? palette.secondary, label: 'Second.' },
            { color: dark.accent ?? palette.accent, label: 'Accent' },
            { color: dark.bg, label: 'BG' },
            { color: dark.textPrimary, label: 'Text' },
          ].map(({ color, label }) => (
            <div key={label} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
              <div style={{ width: '100%', height: 20, borderRadius: 4, background: color, border: '1px solid rgba(255,255,255,0.08)' }} />
              <span style={{ fontSize: 8, color: TEXT_DIM }}>{label}</span>
          </div>
        ))}
        </div>
      </div>
    </div>
  );
}

function FontPairCard({ pair, selected, onClick }: { pair: FontPair; selected: boolean; onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      style={{
        borderRadius: 10,
        border: CARD_BORDER,
        outline: selected ? '2px solid #3b82f6' : 'none',
        outlineOffset: '-1px',
        background: selected ? 'rgba(37,99,235,0.08)' : CARD_BG,
        padding: 20, cursor: 'pointer', position: 'relative',
        transition: 'outline-color 0.15s, background 0.15s',
      }}
    >
      {selected && (
        <div style={{ position: 'absolute', top: 10, right: 10, width: 18, height: 18, borderRadius: '50%', background: '#2563eb', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 11 }}>✓</div>
      )}
      <div style={{ fontSize: 20, fontWeight: 700, color: TEXT_PRIMARY, marginBottom: 8, fontFamily: `'${pair.headingFont}', serif` }}>
        Beautiful Headings
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <span style={{ fontSize: 9, color: TEXT_DIM, letterSpacing: '0.08em', textTransform: 'uppercase' }}>HEADINGS</span>
        <span style={{ fontSize: 10, color: TEXT_MUTED }}>{pair.headingFont}</span>
      </div>
      <div style={{ height: 1, background: '#1f2937', marginBottom: 10 }} />
      <div style={{ fontSize: 12, color: TEXT_MUTED, lineHeight: 1.6, marginBottom: 8, fontFamily: `'${pair.bodyFont}', sans-serif` }}>
        Clear and readable body text that flows naturally and ensures excellent readability across all devices.
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 9, color: TEXT_DIM, letterSpacing: '0.08em', textTransform: 'uppercase' }}>BODY TEXT</span>
        <span style={{ fontSize: 10, color: TEXT_MUTED }}>{pair.bodyFont}</span>
      </div>
    </div>
  );
}

function SliderInput({ value, onChange, labels, descs, title }: {
  value: number; onChange: (v: number) => void;
  labels: string[]; descs: string[]; title: string;
}) {
  return (
    <div>
      <div style={{ fontWeight: 600, fontSize: 13, color: TEXT_PRIMARY, marginBottom: 4 }}>{title}</div>
      <div style={{ fontSize: 11, color: TEXT_MUTED, marginBottom: 14 }}>Choose {title.toLowerCase().replace('level', '').trim()}</div>
      <div style={{ position: 'relative', paddingBottom: 28 }}>
        <div style={{ height: 4, background: '#1f2937', borderRadius: 2, position: 'relative', margin: '12px 0' }}>
          <div style={{ position: 'absolute', left: 0, height: '100%', width: `${(value / (labels.length - 1)) * 100}%`, background: '#2563eb', borderRadius: 2 }} />
          {labels.map((_, i) => (
            <div key={i} onClick={() => onChange(i as never)} style={{
                position: 'absolute', top: '50%', transform: 'translate(-50%, -50%)',
                left: `${(i / (labels.length - 1)) * 100}%`,
                width: 12, height: 12, borderRadius: '50%', cursor: 'pointer',
                background: i <= value ? '#2563eb' : '#374151',
              border: i === value ? '2px solid #60a5fa' : '2px solid #1f2937', zIndex: 1,
            }} />
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
          {labels.map((label, i) => (
            <div key={i} style={{ textAlign: 'center', flex: 1 }}>
              <div style={{ fontSize: 11, fontWeight: i === value ? 600 : 400, color: i === value ? '#93c5fd' : TEXT_DIM }}>{label}</div>
              <div style={{ fontSize: 9, color: TEXT_DIM, marginTop: 1 }}>{descs[i]}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function CategoryMoodModal({ title, items, selectedId, aiSelectedId, onSelect, onClose }: {
  title: string;
  items: Array<{ id: string; label: string; description: string }>;
  selectedId: string;
  aiSelectedId: string;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: '#111', border: CARD_BORDER, borderRadius: 14, width: '100%', maxWidth: 680, maxHeight: '80vh', display: 'flex', flexDirection: 'column', boxShadow: '0 25px 60px rgba(0,0,0,0.6)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 24px', borderBottom: CARD_BORDER }}>
          <div style={{ fontWeight: 700, fontSize: 15, color: TEXT_PRIMARY }}>{title}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: TEXT_MUTED, cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: 4 }}>×</button>
        </div>
        <div style={{ overflow: 'auto', padding: 20, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
          {items.map(item => {
            const isSelected = item.id === selectedId;
            const isAi = item.id === aiSelectedId;
            return (
              <div key={item.id} onClick={() => { onSelect(item.id); onClose(); }}
                style={{ borderRadius: 8, border: CARD_BORDER, outline: isSelected ? '2px solid #3b82f6' : 'none', outlineOffset: '-1px', background: isSelected ? 'rgba(37,99,235,0.1)' : 'transparent', padding: '14px 16px', cursor: 'pointer', position: 'relative', transition: 'outline-color 0.1s' }}>
                {/* AI badge always stays on the AI-suggested item */}
                {isAi && <div style={{ ...BADGE_BLUE, position: 'absolute', top: 8, right: 8 }}>AI</div>}
                <div style={{ fontWeight: 600, fontSize: 12, color: TEXT_PRIMARY, marginBottom: 4, paddingRight: isAi ? 36 : 0 }}>{item.label}</div>
                <div style={{ fontSize: 11, color: TEXT_MUTED, lineHeight: 1.4 }}>{item.description}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Section row with description expand + hover reorder/delete UI ────────────

function SectionRow({ section, idx, total, onMoveUp, onMoveDown, onDelete }: {
  section: AiSection; idx: number; total: number;
  onMoveUp: () => void; onMoveDown: () => void; onDelete: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const isLocked = section.name === 'Navigation' || section.name === 'Footer';

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}
    >
      <div
        onClick={() => setExpanded(e => !e)}
              style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '4px 10px',
          background: expanded ? 'rgba(255,255,255,0.04)' : hovered ? 'rgba(255,255,255,0.025)' : 'transparent',
          cursor: 'pointer',
          transition: 'background 0.1s',
          minHeight: 28,
        }}
      >
        <span style={{ fontSize: 11, color: isLocked ? TEXT_DIM : TEXT_MUTED, flex: 1, fontWeight: expanded ? 500 : 400 }}>
          {section.name}
          {isLocked && (
            <span style={{ marginLeft: 5, fontSize: 8, fontWeight: 700, letterSpacing: '0.05em', color: '#ef4444', background: 'rgba(239,68,68,0.1)', padding: '1px 4px', borderRadius: 3 }}>REQUIRED</span>
          )}
        </span>

        {/* Right side: reorder/delete fade in on hover for non-locked; chevron always visible */}
        <div style={{ display: 'flex', gap: 2, flexShrink: 0, height: 20, alignItems: 'center' }}>
          {!isLocked && (
            <>
              <button
                onClick={e => { e.stopPropagation(); onMoveUp(); }}
                disabled={idx === 0}
                style={{ width: 18, height: 18, borderRadius: 4, border: 'none', cursor: idx === 0 ? 'not-allowed' : 'pointer', background: '#1d4ed8', color: '#fff', fontSize: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: hovered ? (idx === 0 ? 0.35 : 1) : 0, transition: 'opacity 0.1s', pointerEvents: hovered ? 'auto' : 'none' }}
                title="Move up">↑</button>
              <button
                onClick={e => { e.stopPropagation(); onMoveDown(); }}
                disabled={idx === total - 1}
                style={{ width: 18, height: 18, borderRadius: 4, border: 'none', cursor: idx === total - 1 ? 'not-allowed' : 'pointer', background: '#1d4ed8', color: '#fff', fontSize: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: hovered ? (idx === total - 1 ? 0.35 : 1) : 0, transition: 'opacity 0.1s', pointerEvents: hovered ? 'auto' : 'none' }}
                title="Move down">↓</button>
              <button
                onClick={e => { e.stopPropagation(); onDelete(); }}
                style={{ width: 18, height: 18, borderRadius: 4, border: 'none', cursor: 'pointer', background: '#dc2626', color: '#fff', fontSize: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: hovered ? 1 : 0, transition: 'opacity 0.1s', pointerEvents: hovered ? 'auto' : 'none' }}
                title="Remove">✕</button>
            </>
          )}
          <svg
            width={10} height={10} viewBox="0 0 12 12" fill="none"
            style={{ flexShrink: 0, transition: 'transform 0.15s', transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)', color: TEXT_DIM }}
          >
            <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
          </svg>
            </div>
        </div>

      {/* Expanded panel — description only */}
      {expanded && section.description && (
        <div style={{ padding: '5px 10px 8px', background: 'rgba(255,255,255,0.02)', borderTop: '1px solid rgba(255,255,255,0.04)' }}>
          <p style={{ fontSize: 10, color: TEXT_DIM, lineHeight: 1.55, margin: 0 }}>{section.description}</p>
      </div>
      )}
    </div>
  );
}

function SectionSkeletonRow() {
  return (
    <div style={{ padding: '5px 10px', borderBottom: '1px solid rgba(255,255,255,0.04)', display: 'flex', alignItems: 'center', gap: 8, minHeight: 28 }}>
      <div style={{ height: 7, background: '#1f2937', borderRadius: 3, flex: 1, animation: 'shimmer 1.5s ease-in-out infinite' }} />
    </div>
  );
}

// ── Page card with reorderable section list ───────────────────────────────────

function PageCard({ page, selected, sectionsLoading, onToggle, onSectionsChange }: {
  page: AiPage; selected: boolean; sectionsLoading: boolean; onToggle: () => void;
  onSectionsChange: (sections: AiSection[]) => void;
}) {
  const moveSection = (idx: number, dir: -1 | 1) => {
    const next = [...page.sections];
    const swap = idx + dir;
    if (swap < 0 || swap >= next.length) return;
    [next[idx], next[swap]] = [next[swap], next[idx]];
    onSectionsChange(next);
  };
  const deleteSection = (idx: number) => {
    onSectionsChange(page.sections.filter((_, i) => i !== idx));
  };

  return (
    <div style={{
      borderRadius: 8,
      border: CARD_BORDER,
      outline: selected ? '2px solid #3b82f6' : 'none',
      outlineOffset: '-1px',
      background: selected ? 'rgba(37,99,235,0.06)' : CARD_BG,
      overflow: 'hidden',
      transition: 'outline-color 0.15s',
    }}>
      {/* Page header */}
      <div onClick={onToggle} style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        background: selected ? 'rgba(37,99,235,0.12)' : 'rgba(255,255,255,0.02)', cursor: 'pointer',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <span style={{ fontWeight: 600, fontSize: 12, color: TEXT_PRIMARY, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{page.name}</span>
          <span style={{ fontSize: 9, color: TEXT_DIM, background: '#1a1a1a', padding: '1px 5px', borderRadius: 3, flexShrink: 0 }}>{page.route}</span>
        </div>
        <div style={{ width: 15, height: 15, borderRadius: '50%', border: selected ? '2px solid #3b82f6' : '2px solid #374151', background: selected ? '#2563eb' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginLeft: 6 }}>
          {selected && <span style={{ color: '#fff', fontSize: 9, lineHeight: 1 }}>✓</span>}
      </div>
          </div>

      {/* Section list or skeleton */}
      <div>
        {sectionsLoading ? (
          <>
            <SectionSkeletonRow />
            <SectionSkeletonRow />
            <SectionSkeletonRow />
            <div style={{ padding: '5px 10px' }}>
              <span style={{ fontSize: 10, color: TEXT_DIM }}>Loading sections…</span>
            </div>
          </>
        ) : (
          page.sections.map((section, i) => (
            <SectionRow
              key={`${section.name}-${i}`}
              section={section}
              idx={i}
              total={page.sections.length}
              onMoveUp={() => moveSection(i, -1)}
              onMoveDown={() => moveSection(i, 1)}
              onDelete={() => deleteSection(i)}
            />
          ))
        )}
      </div>
    </div>
  );
}

// ── Main Wizard ───────────────────────────────────────────────────────────────

export default function CreateAiProjectWizard({
  workspaceId, onClose,
}: { workspaceId: string; onClose: () => void }) {
  const router = useRouter();

  const [state, setState] = useState<WizardState>(() => ({
      step: 1,
      businessDescription: '',
    appName: '',
    category: 'general-ecommerce',
    mood: 'professional',
    aiCategory: 'general-ecommerce',
    aiMood: 'professional',
      animationLevel: 2,
      layoutStructure: 0,
    palettes: [],
    fonts: FONT_PAIRINGS.slice(0, 6),
      selectedPaletteIdx: 0,
      selectedFontIdx: 0,
    palettesLoading: false,
    fontsLoading: false,
    pages: [],
    selectedPageIds: [],
    pageNamesLoading: false,
    sectionsLoadingIds: [],
    aiClassifying: false,
      showCategoryModal: false,
      showMoodModal: false,
      generating: false,
    generateError: null,
  }));

  const update = useCallback((patch: Partial<WizardState>) => {
    setState(prev => ({ ...prev, ...patch }));
  }, []);

  // Inject Google Fonts for current font cards whenever fonts change
  useEffect(() => {
    state.fonts.forEach(pair => {
      injectGoogleFontLinkWizard(pair.headingFont);
      injectGoogleFontLinkWizard(pair.bodyFont);
    });
  }, [state.fonts]);

  // Step 1 → 2: AI classifies the description
  const handleStep1Next = useCallback(async () => {
    update({ aiClassifying: true });
    try {
      const res = await fetch('/api/ai/classify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: state.businessDescription }),
      });
      const data = await res.json();
      const cat = data.category ?? 'general-ecommerce';
      const moo = data.mood ?? 'professional';
    update({
        aiClassifying: false,
      step: 2,
        appName: data.appName ?? '',
        category: cat,
        mood: moo,
        aiCategory: cat,
        aiMood: moo,
      });
    } catch {
      update({ aiClassifying: false, step: 2 });
    }
  }, [state.businessDescription, update]);

  // Step 2 → 3: Navigate immediately, load palettes/fonts in background
  const handleStep2Next = useCallback(async () => {
    update({ step: 3, palettesLoading: true, fontsLoading: true });
    try {
      const res = await fetch('/api/ai/generate-theme', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: state.businessDescription, mood: state.mood }),
      });
      const data = await res.json();
      update({
        palettes: data.palettes ?? [],
        fonts: data.fonts ?? FONT_PAIRINGS.slice(0, 6),
        selectedPaletteIdx: 0,
        selectedFontIdx: 0,
        palettesLoading: false,
        fontsLoading: false,
      });
    } catch {
      update({ palettesLoading: false, fontsLoading: false });
    }
  }, [state.businessDescription, state.mood, update]);

  // Regenerate palettes only
  const handleRegeneratePalettes = useCallback(async () => {
    update({ palettesLoading: true });
    try {
      const res = await fetch('/api/ai/generate-theme', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: state.businessDescription, mood: state.mood }),
      });
      const data = await res.json();
      update({ palettes: data.palettes ?? [], palettesLoading: false, selectedPaletteIdx: 0 });
    } catch {
      update({ palettesLoading: false });
    }
  }, [state.businessDescription, state.mood, update]);

  // Regenerate fonts only
  const handleRegenerateFonts = useCallback(async () => {
    update({ fontsLoading: true });
    try {
      const res = await fetch('/api/ai/generate-theme', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: state.businessDescription, mood: state.mood }),
      });
      const data = await res.json();
      update({ fonts: data.fonts ?? FONT_PAIRINGS.slice(0, 6), fontsLoading: false, selectedFontIdx: 0 });
    } catch {
      update({ fontsLoading: false });
    }
  }, [state.businessDescription, state.mood, update]);

  // Step 3 → 4: Two-phase — page names first, then sections concurrently
  const handleStep3Next = useCallback(async () => {
    update({ step: 4, pageNamesLoading: true });
    try {
      // Phase 1: get page name stubs
      const res = await fetch('/api/ai/generate-page-names', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: state.businessDescription, category: state.category, mood: state.mood }),
      });
      const data = await res.json();
      const stubs: AiPageStub[] = data.pages ?? [];

      const pages: AiPage[] = stubs.map(s => ({ ...s, sections: [] }));
      const allIds = pages.map(p => p.id);

      // Show page cards with section loading state
      setState(prev => ({
        ...prev,
        pages,
        selectedPageIds: allIds,
        pageNamesLoading: false,
        sectionsLoadingIds: allIds,
      }));

      // Phase 2: load sections for each page concurrently
      stubs.forEach(async stub => {
        try {
          const sRes = await fetch('/api/ai/generate-sections', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              pageId: stub.id,
              pageName: stub.name,
              route: stub.route,
              description: state.businessDescription,
              category: state.category,
              mood: state.mood,
            }),
          });
          const sData = await sRes.json();
          const sections: AiSection[] = sData.sections ?? [];
          setState(prev => ({
            ...prev,
            pages: prev.pages.map(p => p.id === stub.id ? { ...p, sections } : p),
            sectionsLoadingIds: prev.sectionsLoadingIds.filter(id => id !== stub.id),
          }));
        } catch {
          setState(prev => ({
            ...prev,
            pages: prev.pages.map(p => p.id === stub.id ? {
              ...p,
              sections: [{ name: 'Navigation' }, { name: 'Hero' }, { name: 'Footer' }],
            } : p),
            sectionsLoadingIds: prev.sectionsLoadingIds.filter(id => id !== stub.id),
          }));
        }
      });
    } catch {
      update({ pageNamesLoading: false });
    }
  }, [state.businessDescription, state.category, state.mood, update]);

  // Regenerate pages (re-runs both phases)
  const handleRegeneratePages = useCallback(() => {
    handleStep3Next();
  }, [handleStep3Next]);

  // Toggle page selection
  const togglePage = useCallback((pageId: string) => {
    setState(prev => {
      const already = prev.selectedPageIds.includes(pageId);
      return { ...prev, selectedPageIds: already ? prev.selectedPageIds.filter(id => id !== pageId) : [...prev.selectedPageIds, pageId] };
    });
  }, []);

  // Update sections for a page
  const updatePageSections = useCallback((pageId: string, sections: AiSection[]) => {
    setState(prev => ({
      ...prev,
      pages: prev.pages.map(p => p.id === pageId ? { ...p, sections } : p),
    }));
  }, []);

  // Final generate
  const handleGenerate = useCallback(async () => {
    update({ generating: true, generateError: null });
    try {
      const name = state.appName.trim() || state.businessDescription.trim().slice(0, 60) || 'New Project';
      const { project } = await projectsApi.create(workspaceId, { name });

      const palette = state.palettes[state.selectedPaletteIdx] ?? state.palettes[0];
      const font = state.fonts[state.selectedFontIdx] ?? state.fonts[0] ?? FONT_PAIRINGS[0];
      const selectedPages = state.pages.filter(p => state.selectedPageIds.includes(p.id));

      const dark = palette ? deriveDarkPalette(palette) : null;
      const themeOverrides: Record<string, string> = {};
      const themeDarkOverrides: Record<string, string> = {};

      if (palette) {
        const safe = (hex: string, fallback: string) => (hex.startsWith('#') ? hex : fallback);
        themeOverrides['background']           = safe(palette.bg, '#ffffff');
        themeOverrides['foreground']           = safe(palette.textPrimary, '#0f172a');
        themeOverrides['primary']              = safe(palette.primary, '#2563eb');
        themeOverrides['primary-foreground']   = '#ffffff';
        themeOverrides['secondary']            = safe(palette.secondary, '#64748b');
        themeOverrides['secondary-foreground'] = safe(palette.textPrimary, '#0f172a');
        themeOverrides['accent']               = safe(palette.accent, '#10b981');
        themeOverrides['accent-foreground']    = '#ffffff';
        themeOverrides['muted']                = palette.bg.startsWith('#') ? mixHexLight(palette.bg, '#94a3b8', 0.12) : '#f1f5f9';
        themeOverrides['muted-foreground']     = safe(palette.textSecondary, '#64748b');
        themeOverrides['border']               = palette.textPrimary.startsWith('#') ? mixHexLight(safe(palette.bg, '#ffffff'), palette.textPrimary, 0.12) : '#e2e8f0';
        themeOverrides['card']                  = safe(palette.bg, '#ffffff');
        themeOverrides['card-foreground']       = safe(palette.textPrimary, '#0f172a');
        themeOverrides['popover']               = safe(palette.bg, '#ffffff');
        themeOverrides['popover-foreground']    = safe(palette.textPrimary, '#0f172a');
        themeOverrides['input']                 = palette.textPrimary.startsWith('#') ? mixHexLight(safe(palette.bg, '#ffffff'), palette.textPrimary, 0.18) : '#e2e8f0';
        themeOverrides['ring']                  = safe(palette.primary, '#2563eb');
        themeOverrides['destructive']           = '#ef4444';
        themeOverrides['destructive-foreground'] = '#ffffff';

        if (dark) {
          const dsafe = (hex: string, fallback: string) => ((hex ?? '').startsWith('#') ? hex : fallback);
          themeDarkOverrides['background']            = dsafe(dark.bg, '#0a0a0a');
          themeDarkOverrides['foreground']            = dsafe(dark.textPrimary, '#f3f4f6');
          themeDarkOverrides['primary']               = dsafe(dark.primary ?? palette.primary, '#3b82f6');
          themeDarkOverrides['primary-foreground']    = '#ffffff';
          themeDarkOverrides['secondary']             = dsafe(dark.secondary ?? palette.secondary, '#475569');
          themeDarkOverrides['secondary-foreground']  = dsafe(dark.textPrimary, '#f3f4f6');
          themeDarkOverrides['accent']                = dsafe(dark.accent ?? palette.accent, '#10b981');
          themeDarkOverrides['accent-foreground']     = '#ffffff';
          themeDarkOverrides['muted']                 = mixHexLight(dsafe(dark.bg, '#0a0a0a'), '#94a3b8', 0.08);
          themeDarkOverrides['muted-foreground']      = dsafe(dark.textSecondary, '#9ca3af');
          themeDarkOverrides['border']                = mixHexLight(dsafe(dark.bg, '#0a0a0a'), '#ffffff', 0.1);
          themeDarkOverrides['card']                  = mixHexLight(dsafe(dark.bg, '#0a0a0a'), '#ffffff', 0.04);
          themeDarkOverrides['card-foreground']       = dsafe(dark.textPrimary, '#f3f4f6');
          themeDarkOverrides['popover']               = mixHexLight(dsafe(dark.bg, '#0a0a0a'), '#ffffff', 0.06);
          themeDarkOverrides['popover-foreground']    = dsafe(dark.textPrimary, '#f3f4f6');
          themeDarkOverrides['input']                 = mixHexLight(dsafe(dark.bg, '#0a0a0a'), '#ffffff', 0.14);
          themeDarkOverrides['ring']                  = dsafe(dark.primary ?? palette.primary, '#3b82f6');
          themeDarkOverrides['destructive']           = '#ef4444';
          themeDarkOverrides['destructive-foreground'] = '#ffffff';
        }
      }

      const FONT_CSS_MAP: Record<string, string> = {
        'System UI':          'system-ui, sans-serif',
        'Geist':              "'Geist', sans-serif",
        'Inter':              "'Inter', sans-serif",
        'DM Sans':            "'DM Sans', sans-serif",
        'Space Grotesk':      "'Space Grotesk', sans-serif",
        'Nunito':             "'Nunito', sans-serif",
        'Poppins':            "'Poppins', sans-serif",
        'Playfair Display':   "'Playfair Display', serif",
        'Lora':               "'Lora', serif",
        'Merriweather':       "'Merriweather', serif",
        'Roboto Mono':        "'Roboto Mono', monospace",
        'Roboto':             "'Roboto', sans-serif",
        'Comfortaa':          "'Comfortaa', cursive",
        'Fraunces':           "'Fraunces', serif",
        'Montserrat':         "'Montserrat', sans-serif",
        'Open Sans':          "'Open Sans', sans-serif",
        'Raleway':            "'Raleway', sans-serif",
        'Source Sans 3':      "'Source Sans 3', sans-serif",
        'Cormorant Garamond': "'Cormorant Garamond', serif",
        'Crimson Text':       "'Crimson Text', serif",
        'Josefin Sans':       "'Josefin Sans', sans-serif",
        'Jost':               "'Jost', sans-serif",
      };
      const toCssFontFamily = (name: string) => FONT_CSS_MAP[name] ?? `'${name}', sans-serif`;

      if (font) {
        if (font.headingFont) themeOverrides['font-heading'] = toCssFontFamily(font.headingFont);
        if (font.bodyFont)    themeOverrides['font-body']    = toCssFontFamily(font.bodyFont);
      }

      // Build page stubs with stable IDs — we'll match them in the builder by route/name
      const pageIdMap: Record<string, string> = {};
      const pages = selectedPages.map(p => {
        const id = crypto.randomUUID();
        pageIdMap[p.id] = id;
        return { id, name: p.name, route: p.route ?? '/', nodes: [] };
      });

      const selectedPagesFlat = selectedPages.map(p => ({
        ...p,
        sections: p.sections.map(s => (typeof s === 'string' ? s : s.name)),
      }));

      await fetch(`/api/projects/${project.id}/config`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          pages,
          themeOverrides,
          themeDarkOverrides,
          projectMeta: {
            appName: state.appName,
            description: state.businessDescription,
            category: state.category,
            mood: state.mood,
            animationLevel: state.animationLevel,
            layoutStructure: state.layoutStructure,
            font,
          },
        }),
      });

      // Save full wizard result to localStorage so the builder can run AI generation
      const wizardResult = {
        appName: state.appName,
        businessDescription: state.businessDescription,
        category: state.category,
        mood: state.mood,
        animationLevel: state.animationLevel,
        layoutStructure: state.layoutStructure,
        selectedPalette: palette,
        selectedFont: font,
        // Use full AiSectionWithHints objects (not flattened) for the AI generator
        selectedPages: selectedPages.map(p => ({
          ...p,
          id: pageIdMap[p.id] ?? p.id, // map to builder page ID
        })),
      };
      localStorage.setItem(`ai_wizard_result_${project.id}`, JSON.stringify(wizardResult));

      router.push(`/builder/${project.id}?ai=build`);
    } catch {
      update({ generating: false, generateError: 'Something went wrong. Please try again.' });
    }
  }, [state, workspaceId, router, update]);

  const selectedCategory = BUSINESS_CATEGORIES.find(c => c.id === state.category);
  const selectedMood = DESIGN_MOODS.find(m => m.id === state.mood);

  // Keyboard: Escape closes
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !state.showCategoryModal && !state.showMoodModal && !state.aiClassifying) onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose, state.showCategoryModal, state.showMoodModal, state.aiClassifying]);

  const canGoNext1 = state.businessDescription.trim().length > 10;
  const canGoNext3 = !state.palettesLoading && !state.fontsLoading && state.palettes.length > 0;
  const canGenerate = state.selectedPageIds.length > 0 && !state.pageNamesLoading && state.sectionsLoadingIds.length === 0;

  // Log the full wizard result once all sections are done loading (step 4 only)
  useEffect(() => {
    if (state.step !== 4 || state.pageNamesLoading || state.pages.length === 0) return;
    if (state.sectionsLoadingIds.length > 0) return;
    const selectedPalette = state.palettes[state.selectedPaletteIdx] ?? state.palettes[0] ?? null;
    const selectedFont = state.fonts[state.selectedFontIdx] ?? state.fonts[0] ?? null;
    const selectedPages = state.pages.filter(p => state.selectedPageIds.includes(p.id));
    console.log('[Wizard] Generation complete:', {
      appName: state.appName,
      businessDescription: state.businessDescription,
      category: state.category,
      mood: state.mood,
      animationLevel: state.animationLevel,
      layoutStructure: state.layoutStructure,
      selectedPalette,
      selectedFont,
      selectedPages,
    });
  }, [state.step, state.pageNamesLoading, state.sectionsLoadingIds, state.pages, state.palettes, state.fonts, state.selectedPaletteIdx, state.selectedFontIdx, state.selectedPageIds, state.businessDescription, state.category, state.mood, state.animationLevel, state.layoutStructure]);

  return (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 9000, background: BG, display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
        {/* Top bar */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 24px', borderBottom: '1px solid #111', flexShrink: 0, background: BG }}>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: TEXT_MUTED, cursor: 'pointer', fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, padding: 0 }}>
            ← Back to dashboard
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#22c55e' }} />
            <span style={{ fontSize: 11, color: TEXT_DIM }}>AI-powered</span>
          </div>
        </div>

        {/* Content */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '40px 24px 60px' }}>
          <div style={{ width: '100%', maxWidth: 860 }}>
            <WizardStepBar step={state.step} />

            {/* ── Step 1: Business Description ── */}
            {state.step === 1 && (
              <div>
                <h1 style={{ fontSize: 28, fontWeight: 700, color: TEXT_PRIMARY, textAlign: 'center', marginBottom: 8 }}>
                  Describe your business
                </h1>
                <p style={{ fontSize: 14, color: TEXT_MUTED, textAlign: 'center', marginBottom: 32, lineHeight: 1.6 }}>
                  Tell us about your business, target audience, and the feeling you want your website to convey.<br />
                  AI will use this to design your perfect website.
                </p>

                <div style={{ position: 'relative', marginBottom: 24 }}>
                  <textarea
                    value={state.businessDescription}
                    onChange={e => update({ businessDescription: e.target.value })}
                    maxLength={800}
                    placeholder="e.g. A specialty coffee shop in a vibrant urban neighborhood, serving artisanal brews and pastries to remote workers and coffee enthusiasts..."
                    style={{ width: '100%', height: 130, padding: '14px 14px 32px', background: CARD_BG, border: CARD_BORDER, borderRadius: 10, color: TEXT_PRIMARY, fontSize: 14, lineHeight: 1.6, resize: 'none', outline: 'none', boxSizing: 'border-box', fontFamily: 'system-ui' }}
                  />
                  <div style={{ position: 'absolute', bottom: 10, left: 14, fontSize: 11, color: TEXT_DIM }}>
                    {state.businessDescription.length}/800
                  </div>
                </div>

                <div style={{ fontSize: 13, color: TEXT_MUTED, textAlign: 'center', marginBottom: 16 }}>
                  or start from one of the predefined descriptions below
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center', marginBottom: 36 }}>
                  {DESCRIPTION_CHIPS.map(chip => {
                    const isSelected = state.businessDescription === chip.prompt;
                    return (
                    <button
                        key={chip.label}
                        onClick={() => update({ businessDescription: chip.prompt })}
                      style={{
                          background: isSelected ? 'rgba(37,99,235,0.25)' : '#1a1a1a',
                          border: isSelected ? '1px solid #3b82f6' : '1px solid #2a2a2a',
                          color: isSelected ? '#93c5fd' : '#e5e7eb',
                          borderRadius: 999, padding: '7px 16px', fontSize: 13, cursor: 'pointer',
                          whiteSpace: 'nowrap', transition: 'all 0.12s', fontWeight: 400,
                          lineHeight: 1.4,
                        }}
                      >
                        {chip.label}
                    </button>
                    );
                  })}
                </div>

                <div style={{ display: 'flex', justifyContent: 'center' }}>
                  <button
                    onClick={canGoNext1 ? handleStep1Next : undefined}
                    style={canGoNext1 ? { ...BTN_PRIMARY, padding: '11px 32px', fontSize: 14 } : BTN_DISABLED}
                  >
                    {canGoNext1 ? 'Analyze with AI →' : 'Write a description to continue'}
                  </button>
                </div>
              </div>
            )}

            {/* ── Step 2: AI-selected design parameters ── */}
            {state.step === 2 && (
              <div>
                <h1 style={{ fontSize: 26, fontWeight: 700, color: TEXT_PRIMARY, textAlign: 'center', marginBottom: 8 }}>AI selected your design style</h1>
                {state.appName && (
                  <div style={{ textAlign: 'center', marginBottom: 10 }}>
                    <span style={{ fontSize: 12, color: TEXT_DIM }}>App name · </span>
                    <span style={{ fontSize: 14, fontWeight: 700, color: '#93c5fd' }}>{state.appName}</span>
                  </div>
                )}
                <p style={{ fontSize: 13, color: TEXT_MUTED, textAlign: 'center', marginBottom: 28, lineHeight: 1.6 }}>
                  Based on your description, AI chose the following. You can override any of them.
                </p>

                {/* Category + Mood row */}
                {(() => {
                  const userChangedCat = state.category !== state.aiCategory;
                  const userChangedMood = state.mood !== state.aiMood;
                  return (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 28 }}>
                  {/* Business Category */}
                  <div style={{ border: CARD_BORDER, borderRadius: 12, padding: 20, background: CARD_BG }}>
                    <div style={{ fontWeight: 700, fontSize: 14, color: TEXT_PRIMARY, marginBottom: 14 }}>Business Category</div>
                    <div style={{
                          border: CARD_BORDER,
                          outline: !userChangedCat ? '2px solid #3b82f6' : 'none',
                          outlineOffset: '-1px',
                          borderRadius: 8, padding: '12px 14px',
                          background: !userChangedCat ? 'rgba(37,99,235,0.08)' : 'transparent',
                          marginBottom: 10, position: 'relative',
                        }}>
                          <div style={{ ...(!userChangedCat ? BADGE_BLUE : BADGE_USER), position: 'absolute', top: -8, right: 10 }}>
                            {!userChangedCat ? 'AI Selected' : 'User Selected'}
                          </div>
                      <div style={{ fontWeight: 600, fontSize: 13, color: TEXT_PRIMARY }}>{selectedCategory?.label ?? 'General E-commerce'}</div>
                      <div style={{ fontSize: 11, color: TEXT_MUTED, marginTop: 4 }}>{selectedCategory?.description}</div>
                    </div>
                        <button onClick={() => update({ showCategoryModal: true })} style={{ width: '100%', padding: '9px 0', borderRadius: 7, border: CARD_BORDER, background: 'transparent', color: TEXT_MUTED, fontSize: 12, cursor: 'pointer' }}>
                      Choose a different category
                    </button>
                  </div>

                  {/* Design Mood */}
                  <div style={{ border: CARD_BORDER, borderRadius: 12, padding: 20, background: CARD_BG }}>
                    <div style={{ fontWeight: 700, fontSize: 14, color: TEXT_PRIMARY, marginBottom: 14 }}>Design Mood</div>
                    <div style={{
                          border: CARD_BORDER,
                          outline: !userChangedMood ? '2px solid #3b82f6' : 'none',
                          outlineOffset: '-1px',
                          borderRadius: 8, padding: '12px 14px',
                          background: !userChangedMood ? 'rgba(37,99,235,0.08)' : 'transparent',
                          marginBottom: 10, position: 'relative',
                        }}>
                          <div style={{ ...(!userChangedMood ? BADGE_BLUE : BADGE_USER), position: 'absolute', top: -8, right: 10 }}>
                            {!userChangedMood ? 'AI Selected' : 'User Selected'}
                          </div>
                      <div style={{ fontWeight: 600, fontSize: 13, color: TEXT_PRIMARY }}>{selectedMood?.label ?? 'Professional & Trustworthy'}</div>
                      <div style={{ fontSize: 11, color: TEXT_MUTED, marginTop: 4 }}>{selectedMood?.description}</div>
                    </div>
                        <button onClick={() => update({ showMoodModal: true })} style={{ width: '100%', padding: '9px 0', borderRadius: 7, border: CARD_BORDER, background: 'transparent', color: TEXT_MUTED, fontSize: 12, cursor: 'pointer' }}>
                      Choose a different mood
                    </button>
                  </div>
                </div>
                  );
                })()}

                {/* Animation Level */}
                <div style={{ border: CARD_BORDER, borderRadius: 12, padding: 20, background: CARD_BG, marginBottom: 16 }}>
                  <SliderInput title="Animation Level" value={state.animationLevel} onChange={v => update({ animationLevel: v as 0 | 1 | 2 | 3 })} labels={ANIMATION_LABELS} descs={ANIMATION_DESCS} />
                </div>

                {/* Layout Structure */}
                <div style={{ border: CARD_BORDER, borderRadius: 12, padding: 20, background: CARD_BG, marginBottom: 28 }}>
                  <SliderInput title="Layout Structure" value={state.layoutStructure} onChange={v => update({ layoutStructure: v as 0 | 1 | 2 | 3 | 4 })} labels={LAYOUT_LABELS} descs={LAYOUT_DESCS} />
                </div>

                <div style={{ display: 'flex', justifyContent: 'center', gap: 12 }}>
                  <button onClick={() => update({ step: 1 })} style={BTN_GHOST}>← Back</button>
                  <button onClick={handleStep2Next} style={{ ...BTN_PRIMARY, padding: '11px 28px', fontSize: 14 }}>
                    Generate Colors & Fonts →
                  </button>
                </div>
              </div>
            )}

            {/* ── Step 3: AI-generated Colors & Fonts ── */}
            {state.step === 3 && (
              <div>
                <h1 style={{ fontSize: 26, fontWeight: 700, color: TEXT_PRIMARY, textAlign: 'center', marginBottom: 8 }}>Colors & Fonts</h1>
                <p style={{ fontSize: 13, color: TEXT_MUTED, textAlign: 'center', marginBottom: 28, lineHeight: 1.6 }}>
                  {state.palettesLoading || state.fontsLoading
                    ? 'AI is generating your custom palette and typography…'
                    : 'Custom colors and fonts crafted for your brand. Each palette shows both light and dark mode.'}
                </p>

                {/* Color Palettes section */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                  <span style={{ fontWeight: 700, fontSize: 15, color: TEXT_PRIMARY }}>Color Palettes</span>
                  {!state.palettesLoading && (
                    <button onClick={handleRegeneratePalettes} style={BTN_SMALL}>
                      ↺ Regenerate
                  </button>
                  )}
                  {state.palettesLoading && (
                    <span style={{ fontSize: 11, color: TEXT_DIM, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ width: 10, height: 10, border: '2px solid #3b82f6', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.6s linear infinite', display: 'inline-block' }} />
                      Generating…
                    </span>
                  )}
                </div>
                {/* 4-column palette grid */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 32 }}>
                  {state.palettesLoading
                    ? [1,2,3,4].map(i => <PaletteSkeletonCard key={i} />)
                    : state.palettes.map((palette, i) => (
                        <PaletteCard key={i} palette={palette} selected={state.selectedPaletteIdx === i} onClick={() => update({ selectedPaletteIdx: i })} />
                      ))
                  }
                </div>

                {/* Font Pairings section */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                  <span style={{ fontWeight: 700, fontSize: 15, color: TEXT_PRIMARY }}>Font Pairings</span>
                  {!state.fontsLoading && (
                    <button onClick={handleRegenerateFonts} style={BTN_SMALL}>
                      ↺ Regenerate
                  </button>
                  )}
                  {state.fontsLoading && (
                    <span style={{ fontSize: 11, color: TEXT_DIM, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ width: 10, height: 10, border: '2px solid #3b82f6', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.6s linear infinite', display: 'inline-block' }} />
                      Generating…
                    </span>
                  )}
                </div>
                {/* 3-column font grid (6 fonts = 2 rows) */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 32 }}>
                  {state.fontsLoading
                    ? [1,2,3,4,5,6].map(i => <FontSkeletonCard key={i} />)
                    : state.fonts.map((pair, i) => (
                        <FontPairCard key={pair.id ?? i} pair={pair} selected={state.selectedFontIdx === i} onClick={() => update({ selectedFontIdx: i })} />
                      ))
                  }
                </div>

                <div style={{ display: 'flex', justifyContent: 'center', gap: 12 }}>
                  <button onClick={() => update({ step: 2 })} style={BTN_GHOST}>← Back</button>
                  <button
                    onClick={canGoNext3 ? handleStep3Next : undefined}
                    style={canGoNext3 ? { ...BTN_PRIMARY, padding: '11px 28px', fontSize: 14 } : BTN_DISABLED}
                  >
                    {state.palettesLoading || state.fontsLoading ? 'Generating…' : 'Pick Pages →'}
                  </button>
                </div>
              </div>
            )}

            {/* ── Step 4: Pages & Sections ── */}
            {state.step === 4 && (
              <div>
                {/* Phase 1: Page names loading */}
                {state.pageNamesLoading ? (
                  <div style={{ minHeight: 400, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
                    <div style={{ display: 'flex', gap: 8 }}>
                      {[0, 1, 2].map(i => (
                        <div key={i} style={{
                          width: 10, height: 10, borderRadius: '50%', background: '#3b82f6',
                          animation: `bounce 1.2s ease-in-out ${i * 0.2}s infinite`,
                        }} />
                      ))}
                    </div>
                    <div style={{ fontSize: 20, fontWeight: 600, color: TEXT_PRIMARY }}>Generating page suggestions...</div>
                    <div style={{ fontSize: 13, color: TEXT_MUTED }}>Creating beautiful page suggestions based on your business description.</div>
                  </div>
                ) : (
                  <>
                    <h1 style={{ fontSize: 26, fontWeight: 700, color: TEXT_PRIMARY, textAlign: 'center', marginBottom: 8 }}>AI built your page structure</h1>
                    <p style={{ fontSize: 13, color: TEXT_MUTED, textAlign: 'center', marginBottom: 16, lineHeight: 1.6, maxWidth: 600, margin: '0 auto 20px' }}>
                      Pages and sections tailored to your business. Select which pages to include, reorder or remove sections as needed.
                      Inside the editor you can create <strong style={{ color: TEXT_PRIMARY }}>unlimited pages</strong> and edit everything with <strong style={{ color: TEXT_PRIMARY }}>AI Assistant</strong>.
                    </p>

                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 16 }}>
                  <span style={{ fontSize: 13, color: TEXT_MUTED }}>
                        {state.selectedPageIds.length} of {state.pages.length} page{state.pages.length !== 1 ? 's' : ''} selected
                        {state.sectionsLoadingIds.length > 0 && (
                          <span style={{ marginLeft: 8, color: TEXT_DIM }}>· Loading sections for {state.sectionsLoadingIds.length} page{state.sectionsLoadingIds.length !== 1 ? 's' : ''}…</span>
                        )}
                  </span>
                      <button onClick={handleRegeneratePages} style={BTN_SMALL}>↺ Regenerate</button>
                </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20, marginBottom: 32 }}>
                      {state.pages.map(page => (
                    <PageCard
                      key={page.id}
                      page={page}
                          selected={state.selectedPageIds.includes(page.id)}
                          sectionsLoading={state.sectionsLoadingIds.includes(page.id)}
                      onToggle={() => togglePage(page.id)}
                          onSectionsChange={sections => updatePageSections(page.id, sections)}
                    />
                  ))}
                </div>

                    {state.generateError && (
                      <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, padding: '10px 16px', marginBottom: 16, fontSize: 13, color: '#fca5a5', textAlign: 'center' }}>
                        {state.generateError}
                      </div>
                    )}

                <div style={{ display: 'flex', justifyContent: 'center', gap: 12 }}>
                  <button onClick={() => update({ step: 3 })} style={BTN_GHOST}>← Back</button>
                  <button
                    onClick={canGenerate && !state.generating ? handleGenerate : undefined}
                        style={canGenerate && !state.generating
                          ? { ...BTN_PRIMARY, background: 'linear-gradient(135deg, #6366f1, #2563eb)', padding: '11px 32px', fontSize: 14, gap: 8 }
                          : BTN_DISABLED}
                  >
                    {state.generating ? (
                      <>
                            <span style={{ width: 14, height: 14, border: '2px solid rgba(255,255,255,0.4)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.6s linear infinite', display: 'inline-block' }} />
                        Creating project...
                      </>
                        ) : state.sectionsLoadingIds.length > 0 ? 'Loading sections…' : '✨ Generate Project'}
                  </button>
                </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Category modal */}
      {state.showCategoryModal && (
        <CategoryMoodModal title="Choose a Business Category" items={BUSINESS_CATEGORIES} selectedId={state.category} aiSelectedId={state.aiCategory} onSelect={id => update({ category: id })} onClose={() => update({ showCategoryModal: false })} />
      )}

      {/* Mood modal */}
      {state.showMoodModal && (
        <CategoryMoodModal title="Choose a Design Mood" items={DESIGN_MOODS} selectedId={state.mood} aiSelectedId={state.aiMood} onSelect={id => update({ mood: id })} onClose={() => update({ showMoodModal: false })} />
      )}

      {/* AI loading overlay only for classify (step 1→2) */}
      {state.aiClassifying && <AiLoadingOverlay message="AI is reading your description..." />}

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes bounce { 0%,80%,100%{transform:scale(0.6);opacity:0.4} 40%{transform:scale(1);opacity:1} }
        @keyframes shimmer { 0%,100%{opacity:0.4} 50%{opacity:0.8} }
      `}</style>
    </>
  );
}

// ── Tiny helper (local, not exported) ────────────────────────────────────────

function mixHexLight(hex1: string, hex2: string, ratio: number): string {
  if (!hex1.startsWith('#') || !hex2.startsWith('#')) return hex1;
  const parse = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const [r1, g1, b1] = parse(hex1);
  const [r2, g2, b2] = parse(hex2);
  const r = Math.round(r1 * (1 - ratio) + r2 * ratio);
  const g = Math.round(g1 * (1 - ratio) + g2 * ratio);
  const b = Math.round(b1 * (1 - ratio) + b2 * ratio);
  return '#' + [r, g, b].map(v => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('');
}
