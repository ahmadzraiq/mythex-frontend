'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { projects as projectsApi } from '@/lib/platform/api-client';
import {
  BUSINESS_CATEGORIES,
  DESIGN_MOODS,
  FONT_PAIRINGS,
  DESCRIPTION_CHIPS,
  guessCategoryFromDescription,
  guessMoodFromCategory,
  getPalettesForMood,
  getPagesForCategory,
  type ColorPalette,
  type FontPair,
  type SuggestedPage,
} from '@/lib/builder/wizard-data';

// ── Types ─────────────────────────────────────────────────────────────────────

interface WizardState {
  step: 1 | 2 | 3 | 4;
  businessDescription: string;
  category: string;
  mood: string;
  themeMode: 'light' | 'dark' | 'both';
  animationLevel: 0 | 1 | 2 | 3;
  layoutStructure: 0 | 1 | 2 | 3 | 4;
  selectedPaletteIdx: number;
  selectedFontIdx: number;
  palettes: ColorPalette[];
  selectedPages: string[];
  showCategoryModal: boolean;
  showMoodModal: boolean;
  generating: boolean;
}

// ── Colours & constants ───────────────────────────────────────────────────────

const BG = '#0a0a0a';
const CARD_BG = '#111111';
const CARD_BORDER = '1px solid #1f2937';
const SELECTED_BORDER = '2px solid #3b82f6';
const TEXT_PRIMARY = '#f9fafb';
const TEXT_MUTED = '#9ca3af';
const TEXT_DIM = '#6b7280';
const BADGE_BLUE: React.CSSProperties = { background: '#1d4ed8', color: '#bfdbfe', fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4, letterSpacing: '0.03em' };
const BTN_PRIMARY: React.CSSProperties = { padding: '9px 20px', borderRadius: 8, border: 'none', cursor: 'pointer', background: '#2563eb', color: '#fff', fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 };
const BTN_GHOST: React.CSSProperties = { padding: '9px 20px', borderRadius: 8, border: '1px solid #374151', cursor: 'pointer', background: 'transparent', color: TEXT_MUTED, fontSize: 13, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6 };
const BTN_DISABLED: React.CSSProperties = { ...BTN_PRIMARY, background: '#1e3a6e', opacity: 0.5, cursor: 'not-allowed' };

const ANIMATION_LABELS = ['None', 'Low', 'Medium', 'High'];
const ANIMATION_DESCS  = ['No animations', 'Subtle motion', 'Balanced experience', 'Rich animations'];
const LAYOUT_LABELS    = ['Symmetric', 'Mostly Symmetric', 'Mixed', 'Mostly Asymmetric', 'Asymmetric'];
const LAYOUT_DESCS     = ['Balanced & traditional', 'Balanced with variety', 'Equal balance', 'Dynamic with structure', 'Dynamic & modern'];

// Step header info
const STEP_INFO = [
  { num: 1, icon: '📝', label: 'Business' },
  { num: 2, icon: '🎨', label: 'Design Category & Mood' },
  { num: 3, icon: '🎨', label: 'Colors & Fonts' },
  { num: 4, icon: '📄', label: 'Pick Pages' },
];

// ── Sub-components ────────────────────────────────────────────────────────────

function WizardStepBar({ step }: { step: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0, paddingBottom: 32 }}>
      {STEP_INFO.map((s, i) => {
        const done = step > s.num;
        const active = step === s.num;
        return (
          <div key={s.num} style={{ display: 'flex', alignItems: 'center' }}>
            {/* Step circle */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
              <div style={{
                width: 36, height: 36, borderRadius: '50%',
                background: done ? '#16a34a' : active ? '#2563eb' : '#1f2937',
                border: done ? '2px solid #16a34a' : active ? '2px solid #3b82f6' : '2px solid #374151',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#fff', fontSize: 14, fontWeight: 700,
                transition: 'all 0.2s',
              }}>
                {done ? '✓' : (
                  <span style={{ fontSize: 16 }}>{s.icon}</span>
                )}
              </div>
              <span style={{ fontSize: 10, color: active ? '#93c5fd' : done ? '#4ade80' : TEXT_DIM, fontWeight: active ? 600 : 400, whiteSpace: 'nowrap' }}>
                {s.label}
              </span>
            </div>
            {/* Connector line */}
            {i < STEP_INFO.length - 1 && (
              <div style={{ width: 80, height: 2, background: step > s.num ? '#16a34a' : '#1f2937', margin: '0 4px', marginBottom: 20 }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function PaletteCard({ palette, selected, onClick }: { palette: ColorPalette; selected: boolean; onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      style={{
        borderRadius: 10, border: selected ? SELECTED_BORDER : CARD_BORDER,
        background: selected ? 'rgba(37,99,235,0.08)' : CARD_BG,
        padding: 16, cursor: 'pointer', position: 'relative',
        transition: 'border-color 0.15s, background 0.15s',
      }}
    >
      {selected && (
        <div style={{ position: 'absolute', top: 10, right: 10, width: 18, height: 18, borderRadius: '50%', background: '#2563eb', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 11 }}>✓</div>
      )}
      <div style={{ fontWeight: 600, fontSize: 13, color: TEXT_PRIMARY, marginBottom: 4 }}>{palette.name}</div>
      <div style={{ fontSize: 11, color: TEXT_MUTED, marginBottom: 12, lineHeight: 1.4 }}>{palette.description}</div>
      {/* Primary / Secondary / Accent */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
        {[palette.primary, palette.secondary, palette.accent].map((c, i) => (
          <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
            <div style={{ width: '100%', height: 24, borderRadius: 5, background: c.startsWith('linear') ? c : c, border: '1px solid rgba(255,255,255,0.08)' }} />
            <span style={{ fontSize: 9, color: TEXT_DIM }}>{['Primary', 'Seconda...', 'Accent'][i]}</span>
          </div>
        ))}
      </div>
      {/* Bg / Text Primary / Text Secondary */}
      <div style={{ display: 'flex', gap: 4 }}>
        {[palette.bg, palette.textPrimary, palette.textSecondary].map((c, i) => (
          <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
            <div style={{ width: '100%', height: 20, borderRadius: 4, background: c.startsWith('linear') ? c : c, border: '1px solid rgba(255,255,255,0.12)' }} />
            <span style={{ fontSize: 9, color: TEXT_DIM }}>{['Backgro...', 'Text Pri...', 'Text Sec...'][i]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function FontPairCard({ pair, selected, onClick }: { pair: FontPair; selected: boolean; onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      style={{
        borderRadius: 10, border: selected ? SELECTED_BORDER : CARD_BORDER,
        background: selected ? 'rgba(37,99,235,0.08)' : CARD_BG,
        padding: 20, cursor: 'pointer', position: 'relative',
        transition: 'border-color 0.15s, background 0.15s',
      }}
    >
      {selected && (
        <div style={{ position: 'absolute', top: 10, right: 10, width: 18, height: 18, borderRadius: '50%', background: '#2563eb', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 11 }}>✓</div>
      )}
      {/* Heading preview */}
      <div style={{ fontSize: 20, fontWeight: 700, color: TEXT_PRIMARY, marginBottom: 8, fontFamily: `'${pair.headingFont}', serif` }}>
        Beautiful Headings
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <span style={{ fontSize: 9, color: TEXT_DIM, letterSpacing: '0.08em', textTransform: 'uppercase' }}>HEADINGS</span>
        <span style={{ fontSize: 10, color: TEXT_MUTED }}>{pair.headingFont}</span>
      </div>
      {/* Divider */}
      <div style={{ height: 1, background: '#1f2937', marginBottom: 10 }} />
      {/* Body preview */}
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

function SliderInput({
  value, onChange, labels, descs, title,
}: {
  value: number;
  onChange: (v: number) => void;
  labels: string[];
  descs: string[];
  title: string;
}) {
  return (
    <div>
      <div style={{ fontWeight: 600, fontSize: 13, color: TEXT_PRIMARY, marginBottom: 4 }}>{title}</div>
      <div style={{ fontSize: 11, color: TEXT_MUTED, marginBottom: 14 }}>Choose {title.toLowerCase().replace('level', '').trim()}</div>
      <div style={{ position: 'relative', paddingBottom: 28 }}>
        {/* Track */}
        <div style={{ height: 4, background: '#1f2937', borderRadius: 2, position: 'relative', margin: '12px 0' }}>
          <div style={{ position: 'absolute', left: 0, height: '100%', width: `${(value / (labels.length - 1)) * 100}%`, background: '#2563eb', borderRadius: 2 }} />
          {labels.map((_, i) => (
            <div
              key={i}
              onClick={() => onChange(i as never)}
              style={{
                position: 'absolute', top: '50%', transform: 'translate(-50%, -50%)',
                left: `${(i / (labels.length - 1)) * 100}%`,
                width: 12, height: 12, borderRadius: '50%', cursor: 'pointer',
                background: i <= value ? '#2563eb' : '#374151',
                border: i === value ? '2px solid #60a5fa' : '2px solid #1f2937',
                zIndex: 1,
              }}
            />
          ))}
        </div>
        {/* Labels */}
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

function ThemeModeCard({ mode, selected, onClick, locked }: { mode: 'light' | 'dark' | 'both'; selected: boolean; onClick: () => void; locked?: boolean }) {
  const info = {
    light: { icon: '☀', label: 'Light Only', desc: 'Classic light theme' },
    dark: { icon: '🌙', label: 'Dark Only', desc: 'Modern dark theme' },
    both: { icon: '🔒', label: 'Both', desc: 'Both modes are only available on a paid workspace' },
  }[mode];
  return (
    <div
      onClick={locked ? undefined : onClick}
      style={{
        flex: 1, borderRadius: 10,
        border: selected ? SELECTED_BORDER : CARD_BORDER,
        background: selected ? 'rgba(37,99,235,0.1)' : CARD_BG,
        padding: '16px 12px', cursor: locked ? 'not-allowed' : 'pointer',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
        opacity: locked ? 0.6 : 1, position: 'relative',
        transition: 'border-color 0.15s',
      }}
    >
      {selected && !locked && (
        <div style={{ position: 'absolute', top: 8, right: 8, width: 16, height: 16, borderRadius: '50%', background: '#2563eb', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 10 }}>✓</div>
      )}
      <div style={{ fontSize: 24 }}>{info.icon}</div>
      <div style={{ fontWeight: 600, fontSize: 13, color: TEXT_PRIMARY }}>{info.label}</div>
      <div style={{ fontSize: 10, color: TEXT_MUTED, textAlign: 'center', lineHeight: 1.4 }}>{info.desc}</div>
    </div>
  );
}

function CategoryMoodModal({
  title, items, selectedId, onSelect, onClose,
}: {
  title: string;
  items: Array<{ id: string; label: string; description: string; aiSelected?: boolean }>;
  selectedId: string;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ background: '#111', border: CARD_BORDER, borderRadius: 14, width: '100%', maxWidth: 680, maxHeight: '80vh', display: 'flex', flexDirection: 'column', boxShadow: '0 25px 60px rgba(0,0,0,0.6)' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 24px', borderBottom: CARD_BORDER }}>
          <div style={{ fontWeight: 700, fontSize: 15, color: TEXT_PRIMARY }}>{title}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: TEXT_MUTED, cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: 4 }}>×</button>
        </div>
        {/* Grid */}
        <div style={{ overflow: 'auto', padding: 20, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
          {items.map(item => (
            <div
              key={item.id}
              onClick={() => { onSelect(item.id); onClose(); }}
              style={{
                borderRadius: 8, border: item.id === selectedId ? SELECTED_BORDER : CARD_BORDER,
                background: item.id === selectedId ? 'rgba(37,99,235,0.1)' : 'transparent',
                padding: '14px 16px', cursor: 'pointer', position: 'relative',
                transition: 'border-color 0.1s',
              }}
            >
              {item.aiSelected && (
                <div style={{ ...BADGE_BLUE, position: 'absolute', top: 8, right: 8 }}>AI Selected</div>
              )}
              <div style={{ fontWeight: 600, fontSize: 12, color: TEXT_PRIMARY, marginBottom: 4 }}>{item.label}</div>
              <div style={{ fontSize: 11, color: TEXT_MUTED, lineHeight: 1.4 }}>{item.description}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function PageCard({ page, selected, onToggle }: { page: SuggestedPage; selected: boolean; onToggle: () => void }) {
  return (
    <div style={{
      borderRadius: 10,
      border: selected ? SELECTED_BORDER : CARD_BORDER,
      background: selected ? 'rgba(37,99,235,0.06)' : CARD_BG,
      padding: 0, overflow: 'hidden', cursor: 'pointer',
      transition: 'border-color 0.15s',
    }}>
      {/* Page name header */}
      <div
        onClick={onToggle}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '12px 16px', borderBottom: selected ? '1px solid rgba(37,99,235,0.3)' : CARD_BORDER,
          background: selected ? 'rgba(37,99,235,0.1)' : 'transparent',
        }}
      >
        <span style={{ fontWeight: 600, fontSize: 13, color: TEXT_PRIMARY }}>{page.name}</span>
        <div style={{
          width: 18, height: 18, borderRadius: '50%',
          border: selected ? '2px solid #2563eb' : '2px solid #374151',
          background: selected ? '#2563eb' : 'transparent',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}>
          {selected && <span style={{ color: '#fff', fontSize: 11 }}>✓</span>}
        </div>
      </div>
      {/* Section list */}
      <div style={{ padding: '8px 0' }}>
        {page.sections.map((section, i) => (
          <div
            key={i}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '7px 16px',
              borderBottom: i < page.sections.length - 1 ? '1px solid #0d1117' : 'none',
            }}
          >
            <span style={{ fontSize: 12, color: selected ? TEXT_MUTED : TEXT_DIM }}>
              {section}
              {(section === 'Navigation' || section === 'Footer') && (
                <span style={{ marginLeft: 6, fontSize: 9, fontWeight: 700, letterSpacing: '0.05em', color: '#ef4444', background: 'rgba(239,68,68,0.1)', padding: '1px 5px', borderRadius: 3 }}>REQUIRED</span>
              )}
            </span>
            <span style={{ color: TEXT_DIM, fontSize: 11 }}>↓</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main Wizard ───────────────────────────────────────────────────────────────

export default function CreateAiProjectWizard({
  workspaceId,
  onClose,
}: {
  workspaceId: string;
  onClose: () => void;
}) {
  const router = useRouter();

  const [state, setState] = useState<WizardState>(() => {
    const defaultCategory = 'general-ecommerce';
    const defaultMood = 'professional';
    return {
      step: 1,
      businessDescription: '',
      category: defaultCategory,
      mood: defaultMood,
      themeMode: 'light',
      animationLevel: 2,
      layoutStructure: 0,
      selectedPaletteIdx: 0,
      selectedFontIdx: 0,
      palettes: getPalettesForMood(defaultMood),
      selectedPages: [getPagesForCategory(defaultCategory)[0]?.id ?? ''],
      showCategoryModal: false,
      showMoodModal: false,
      generating: false,
    };
  });

  const update = useCallback((patch: Partial<WizardState>) => {
    setState(prev => ({ ...prev, ...patch }));
  }, []);

  // When category or mood changes, refresh suggested data
  const handleCategoryChange = useCallback((categoryId: string) => {
    const pages = getPagesForCategory(categoryId);
    update({
      category: categoryId,
      selectedPages: [pages[0]?.id ?? ''],
    });
  }, [update]);

  const handleMoodChange = useCallback((moodId: string) => {
    const palettes = getPalettesForMood(moodId);
    update({ mood: moodId, palettes, selectedPaletteIdx: 0 });
  }, [update]);

  // Advance to step 2 — auto-detect category/mood from description
  const handleStep1Next = useCallback(() => {
    const guessedCategory = guessCategoryFromDescription(state.businessDescription);
    const guessedMood = guessMoodFromCategory(guessedCategory);
    const palettes = getPalettesForMood(guessedMood);
    const pages = getPagesForCategory(guessedCategory);
    update({
      step: 2,
      category: guessedCategory,
      mood: guessedMood,
      palettes,
      selectedPages: [pages[0]?.id ?? ''],
    });
  }, [state.businessDescription, update]);

  // Toggle page selection
  const togglePage = useCallback((pageId: string) => {
    setState(prev => {
      const already = prev.selectedPages.includes(pageId);
      return { ...prev, selectedPages: already ? prev.selectedPages.filter(id => id !== pageId) : [...prev.selectedPages, pageId] };
    });
  }, []);

  // Generate
  const handleGenerate = useCallback(async () => {
    update({ generating: true });
    try {
      const name = state.businessDescription.trim().slice(0, 60) || 'New Project';
      const { project } = await projectsApi.create(workspaceId, { name });

      const pages = getPagesForCategory(state.category);
      const selectedPages = pages.filter(p => state.selectedPages.includes(p.id));
      const palette = state.palettes[state.selectedPaletteIdx] ?? state.palettes[0];
      const font = FONT_PAIRINGS[state.selectedFontIdx] ?? FONT_PAIRINGS[0];

      await fetch(`/api/projects/${project.id}/config`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          _wizardParams: {
            businessDescription: state.businessDescription,
            category: state.category,
            mood: state.mood,
            themeMode: state.themeMode,
            animationLevel: state.animationLevel,
            layoutStructure: state.layoutStructure,
            palette,
            font,
            selectedPages,
          },
        }),
      });

      router.push(`/builder/${project.id}`);
    } catch {
      update({ generating: false });
    }
  }, [state, workspaceId, router, update]);

  const suggestedPages = getPagesForCategory(state.category);
  const selectedCategory = BUSINESS_CATEGORIES.find(c => c.id === state.category);
  const selectedMood = DESIGN_MOODS.find(m => m.id === state.mood);

  // Keyboard: Escape closes
  const overlayRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !state.showCategoryModal && !state.showMoodModal) onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose, state.showCategoryModal, state.showMoodModal]);

  const canGoNext1 = state.businessDescription.trim().length > 0;
  const canGenerate = state.selectedPages.length > 0;

  return (
    <>
      {/* Fullscreen overlay */}
      <div
        ref={overlayRef}
        style={{ position: 'fixed', inset: 0, zIndex: 9000, background: BG, display: 'flex', flexDirection: 'column', overflowY: 'auto' }}
      >
        {/* Top bar */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 24px', borderBottom: '1px solid #111', flexShrink: 0, background: BG }}>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: TEXT_MUTED, cursor: 'pointer', fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, padding: 0 }}
          >
            ← Back to dashboard
          </button>
          <div style={{ fontSize: 11, color: TEXT_DIM }}>
            {/* Tokens remaining placeholder */}
          </div>
        </div>

        {/* Content */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '40px 24px 60px' }}>
          <div style={{ width: '100%', maxWidth: 800 }}>
            <WizardStepBar step={state.step} />

            {/* ── Step 1: Business Description ── */}
            {state.step === 1 && (
              <div>
                <h1 style={{ fontSize: 28, fontWeight: 700, color: TEXT_PRIMARY, textAlign: 'center', marginBottom: 8 }}>
                  Business description
                </h1>
                <p style={{ fontSize: 14, color: TEXT_MUTED, textAlign: 'center', marginBottom: 32, lineHeight: 1.6 }}>
                  Describe your business, target audience, and the feeling you want your website to convey. This will help create a perfect design for you.
                </p>

                {/* Textarea */}
                <div style={{ position: 'relative', marginBottom: 24 }}>
                  <textarea
                    value={state.businessDescription}
                    onChange={e => update({ businessDescription: e.target.value })}
                    maxLength={800}
                    placeholder="Describe your business..."
                    style={{
                      width: '100%', height: 120, padding: '14px 14px 32px',
                      background: CARD_BG, border: CARD_BORDER, borderRadius: 10,
                      color: TEXT_PRIMARY, fontSize: 14, lineHeight: 1.6, resize: 'none',
                      outline: 'none', boxSizing: 'border-box', fontFamily: 'system-ui',
                    }}
                  />
                  <div style={{ position: 'absolute', bottom: 10, left: 14, fontSize: 11, color: TEXT_DIM }}>
                    {state.businessDescription.length}/800
                  </div>
                </div>

                {/* Chips */}
                <div style={{ fontSize: 12, color: TEXT_MUTED, textAlign: 'center', marginBottom: 12 }}>
                  or start from one of the predefined descriptions below
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center', marginBottom: 32 }}>
                  {DESCRIPTION_CHIPS.map(chip => (
                    <button
                      key={chip}
                      onClick={() => update({ businessDescription: chip })}
                      style={{
                        background: state.businessDescription === chip ? 'rgba(37,99,235,0.2)' : CARD_BG,
                        border: state.businessDescription === chip ? '1px solid #3b82f6' : CARD_BORDER,
                        color: state.businessDescription === chip ? '#93c5fd' : TEXT_MUTED,
                        borderRadius: 20, padding: '6px 14px', fontSize: 12, cursor: 'pointer',
                        transition: 'all 0.1s',
                      }}
                    >
                      {chip}
                    </button>
                  ))}
                </div>

                {/* Browse Generated Projects placeholder */}
                <div style={{ textAlign: 'center', marginBottom: 32 }}>
                  <div style={{ fontSize: 20, fontWeight: 700, color: TEXT_PRIMARY, marginBottom: 4 }}>Browse Generated Projects</div>
                  <div style={{ fontSize: 13, color: TEXT_MUTED }}>Get inspired by projects created with AI</div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'center' }}>
                  <button
                    onClick={canGoNext1 ? handleStep1Next : undefined}
                    style={canGoNext1 ? BTN_PRIMARY : BTN_DISABLED}
                  >
                    Next →
                  </button>
                </div>
              </div>
            )}

            {/* ── Step 2: Category & Mood + Theme/Animation/Layout ── */}
            {state.step === 2 && (
              <div>
                {/* Category + Mood row */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
                  {/* Business Category */}
                  <div style={{ border: CARD_BORDER, borderRadius: 12, padding: 20, background: CARD_BG }}>
                    <div style={{ fontWeight: 700, fontSize: 14, color: TEXT_PRIMARY, marginBottom: 14 }}>Business Category</div>
                    <div style={{
                      border: SELECTED_BORDER, borderRadius: 8, padding: '12px 14px',
                      background: 'rgba(37,99,235,0.08)', marginBottom: 12, position: 'relative',
                    }}>
                      <div style={{ ...BADGE_BLUE, position: 'absolute', top: -8, right: 10 }}>AI Selected</div>
                      <div style={{ fontWeight: 600, fontSize: 13, color: TEXT_PRIMARY }}>{selectedCategory?.label ?? 'General E-commerce'}</div>
                      <div style={{ fontSize: 11, color: TEXT_MUTED, marginTop: 4 }}>{selectedCategory?.description}</div>
                    </div>
                    <button
                      onClick={() => update({ showCategoryModal: true })}
                      style={{ width: '100%', padding: '9px 0', borderRadius: 7, border: CARD_BORDER, background: 'transparent', color: TEXT_MUTED, fontSize: 12, cursor: 'pointer' }}
                    >
                      Choose a different category
                    </button>
                  </div>

                  {/* Design Mood */}
                  <div style={{ border: CARD_BORDER, borderRadius: 12, padding: 20, background: CARD_BG }}>
                    <div style={{ fontWeight: 700, fontSize: 14, color: TEXT_PRIMARY, marginBottom: 14 }}>Design Mood</div>
                    <div style={{
                      border: SELECTED_BORDER, borderRadius: 8, padding: '12px 14px',
                      background: 'rgba(37,99,235,0.08)', marginBottom: 12, position: 'relative',
                    }}>
                      <div style={{ ...BADGE_BLUE, position: 'absolute', top: -8, right: 10 }}>AI Selected</div>
                      <div style={{ fontWeight: 600, fontSize: 13, color: TEXT_PRIMARY }}>{selectedMood?.label ?? 'Professional & Trustworthy'}</div>
                      <div style={{ fontSize: 11, color: TEXT_MUTED, marginTop: 4 }}>{selectedMood?.description}</div>
                    </div>
                    <button
                      onClick={() => update({ showMoodModal: true })}
                      style={{ width: '100%', padding: '9px 0', borderRadius: 7, border: CARD_BORDER, background: 'transparent', color: TEXT_MUTED, fontSize: 12, cursor: 'pointer' }}
                    >
                      Choose a different mood
                    </button>
                  </div>
                </div>

                {/* Theme Mode */}
                <div style={{ border: CARD_BORDER, borderRadius: 12, padding: 20, background: CARD_BG, marginBottom: 20 }}>
                  <div style={{ fontWeight: 700, fontSize: 14, color: TEXT_PRIMARY, marginBottom: 6 }}>Theme Mode</div>
                  <div style={{ fontSize: 12, color: TEXT_MUTED, marginBottom: 16 }}>Choose how your website will handle light and dark themes for the best user experience.</div>
                  <div style={{ display: 'flex', gap: 12 }}>
                    <ThemeModeCard mode="light" selected={state.themeMode === 'light'} onClick={() => update({ themeMode: 'light' })} />
                    <ThemeModeCard mode="dark" selected={state.themeMode === 'dark'} onClick={() => update({ themeMode: 'dark' })} />
                    <ThemeModeCard mode="both" selected={state.themeMode === 'both'} onClick={() => update({ themeMode: 'both' })} locked />
                  </div>
                </div>

                {/* Animation Level */}
                <div style={{ border: CARD_BORDER, borderRadius: 12, padding: 20, background: CARD_BG, marginBottom: 20 }}>
                  <SliderInput
                    title="Animation Level"
                    value={state.animationLevel}
                    onChange={v => update({ animationLevel: v })}
                    labels={ANIMATION_LABELS}
                    descs={ANIMATION_DESCS}
                  />
                </div>

                {/* Layout Structure */}
                <div style={{ border: CARD_BORDER, borderRadius: 12, padding: 20, background: CARD_BG, marginBottom: 28 }}>
                  <SliderInput
                    title="Layout Structure"
                    value={state.layoutStructure}
                    onChange={v => update({ layoutStructure: v })}
                    labels={LAYOUT_LABELS}
                    descs={LAYOUT_DESCS}
                  />
                </div>

                <div style={{ display: 'flex', justifyContent: 'center', gap: 12 }}>
                  <button onClick={() => update({ step: 1 })} style={BTN_GHOST}>← Back</button>
                  <button onClick={() => update({ step: 3 })} style={BTN_PRIMARY}>Next →</button>
                </div>
              </div>
            )}

            {/* ── Step 3: Colors & Fonts ── */}
            {state.step === 3 && (
              <div>
                {/* Color Palettes */}
                <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8, gap: 8 }}>
                  <span style={{ fontWeight: 700, fontSize: 16, color: TEXT_PRIMARY }}>Color Palettes</span>
                  <span style={{ width: 16, height: 16, borderRadius: '50%', border: '1px solid #374151', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: TEXT_DIM, cursor: 'default' }}>?</span>
                  <button
                    onClick={() => {
                      const palettes = getPalettesForMood(state.mood);
                      const next = (state.selectedPaletteIdx + 1) % palettes.length;
                      update({ selectedPaletteIdx: next });
                    }}
                    style={{ marginLeft: 'auto', fontSize: 12, color: TEXT_MUTED, background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
                  >
                    ↻ Regenerate
                  </button>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 32 }}>
                  {state.palettes.map((palette, i) => (
                    <PaletteCard
                      key={i}
                      palette={palette}
                      selected={state.selectedPaletteIdx === i}
                      onClick={() => update({ selectedPaletteIdx: i })}
                    />
                  ))}
                </div>

                {/* Font Pairings */}
                <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8, gap: 8 }}>
                  <span style={{ fontWeight: 700, fontSize: 16, color: TEXT_PRIMARY }}>Font Pairings</span>
                  <span style={{ width: 16, height: 16, borderRadius: '50%', border: '1px solid #374151', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: TEXT_DIM, cursor: 'default' }}>?</span>
                  <button
                    onClick={() => setState(prev => {
                      // Advance the page of 4 fonts shown, keep selection in the new page
                      const pageSize = 4;
                      const totalPages = Math.ceil(FONT_PAIRINGS.length / pageSize);
                      const currentPage = Math.floor(prev.selectedFontIdx / pageSize);
                      const nextPage = (currentPage + 1) % totalPages;
                      return { ...prev, selectedFontIdx: nextPage * pageSize };
                    })}
                    style={{ marginLeft: 'auto', fontSize: 12, color: TEXT_MUTED, background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
                  >
                    ↻ Regenerate
                  </button>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 32 }}>
                  {(() => {
                    const pageSize = 4;
                    const page = Math.floor(state.selectedFontIdx / pageSize);
                    const start = page * pageSize;
                    return FONT_PAIRINGS.slice(start, start + pageSize).map((pair, i) => {
                      const actualIdx = start + i;
                      return (
                        <FontPairCard
                          key={pair.id}
                          pair={pair}
                          selected={state.selectedFontIdx === actualIdx}
                          onClick={() => update({ selectedFontIdx: actualIdx })}
                        />
                      );
                    });
                  })()}
                </div>

                <div style={{ display: 'flex', justifyContent: 'center', gap: 12 }}>
                  <button onClick={() => update({ step: 2 })} style={BTN_GHOST}>← Back</button>
                  <button onClick={() => update({ step: 4 })} style={BTN_PRIMARY}>Next →</button>
                </div>
              </div>
            )}

            {/* ── Step 4: Pick Pages ── */}
            {state.step === 4 && (
              <div>
                <h1 style={{ fontSize: 26, fontWeight: 700, color: TEXT_PRIMARY, textAlign: 'center', marginBottom: 8 }}>Page Selection</h1>
                <p style={{ fontSize: 13, color: TEXT_MUTED, textAlign: 'center', marginBottom: 8, lineHeight: 1.6, maxWidth: 600, margin: '0 auto 20px' }}>
                  These are suggested pages based on your business description. Once inside the editor, you can create <strong style={{ color: TEXT_PRIMARY }}>unlimited pages</strong> and <strong style={{ color: TEXT_PRIMARY }}>edit everything</strong> manually or with the help of the <strong style={{ color: TEXT_PRIMARY }}>AI Assistant</strong>.
                </p>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
                  <span style={{ fontSize: 13, color: TEXT_MUTED }}>
                    {state.selectedPages.length} page{state.selectedPages.length !== 1 ? 's' : ''} selected
                  </span>
                  <button
                    onClick={() => {
                      // Cycle to next category's pages as "regenerate"
                      const categories = Object.keys({ 'real-estate': 1, restaurant: 1, 'tech-startup': 1, saas: 1, 'personal-portfolio': 1 });
                      const currentIdx = categories.indexOf(state.category);
                      const nextCategory = categories[(currentIdx + 1) % categories.length] || state.category;
                      const pages = getPagesForCategory(nextCategory);
                      update({ selectedPages: [pages[0]?.id ?? ''] });
                    }}
                    style={{ marginLeft: 'auto', fontSize: 12, color: TEXT_MUTED, background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
                  >
                    ↻ Regenerate
                  </button>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(suggestedPages.length, 3)}, 1fr)`, gap: 16, marginBottom: 32 }}>
                  {suggestedPages.map(page => (
                    <PageCard
                      key={page.id}
                      page={page}
                      selected={state.selectedPages.includes(page.id)}
                      onToggle={() => togglePage(page.id)}
                    />
                  ))}
                </div>

                <div style={{ display: 'flex', justifyContent: 'center', gap: 12 }}>
                  <button onClick={() => update({ step: 3 })} style={BTN_GHOST}>← Back</button>
                  <button
                    onClick={canGenerate && !state.generating ? handleGenerate : undefined}
                    style={canGenerate && !state.generating ? { ...BTN_PRIMARY, background: 'linear-gradient(135deg, #6366f1, #2563eb)', padding: '10px 28px', fontSize: 14 } : BTN_DISABLED}
                  >
                    {state.generating ? (
                      <>
                        <span style={{
                          width: 14, height: 14, border: '2px solid rgba(255,255,255,0.4)', borderTopColor: '#fff',
                          borderRadius: '50%', animation: 'spin 0.6s linear infinite', display: 'inline-block',
                        }} />
                        Creating project...
                      </>
                    ) : 'Generate →'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Category modal */}
      {state.showCategoryModal && (
        <CategoryMoodModal
          title="Choose a Business Category"
          items={BUSINESS_CATEGORIES.map(c => ({ ...c, aiSelected: c.id === state.category }))}
          selectedId={state.category}
          onSelect={handleCategoryChange}
          onClose={() => update({ showCategoryModal: false })}
        />
      )}

      {/* Mood modal */}
      {state.showMoodModal && (
        <CategoryMoodModal
          title="Choose a Design Mood"
          items={DESIGN_MOODS.map(m => ({ ...m, aiSelected: m.id === state.mood }))}
          selectedId={state.mood}
          onSelect={handleMoodChange}
          onClose={() => update({ showMoodModal: false })}
        />
      )}

      {/* Spin animation */}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </>
  );
}
