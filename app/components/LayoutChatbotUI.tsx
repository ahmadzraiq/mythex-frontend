'use client';

import { useRef, useEffect } from 'react';
import type { ConversationContext } from '@/store/layout-generator-store';
import type { Palette } from '@/lib/ai/palette-schema';
import type { FontPairing } from '@/lib/ai/font-pairing-schema';
import { DESIGN_MOODS } from '@/config/design-moods';
import { SECTION_VARIANTS } from '@/config/section-variants';

const SECTION_OPTIONS = [
  { id: 'hero', label: 'Hero', required: false },
  { id: 'product-grid', label: 'Product Grid', required: false },
  { id: 'product-carousel', label: 'Product Carousel', required: false },
  { id: 'feature-grid', label: 'Feature Grid', required: false },
] as const;

const MODE_OPTIONS = [
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
  { id: 'both', label: 'Both' },
] as const;

type Message = {
  id: string;
  role: 'user' | 'assistant';
  prompt?: string;
  success?: boolean;
  style?: string;
  error?: string;
  question?: string;
};

type Props = {
  open: boolean;
  setOpen: (fn: (o: boolean) => boolean) => void;
  messages: Message[];
  input: string;
  setInput: (v: string) => void;
  loading: boolean;
  hasGenerated: boolean;
  step: number;
  context: ConversationContext;
  paletteOptions: Palette[] | null;
  selectedPalette: Palette | null;
  fontPairingOptions: FontPairing[] | null;
  selectedFontPairing: FontPairing | null;
  selectedSections: string[];
  sectionVariants: Record<string, string>;
  sectionVariantsLoading: boolean;
  paletteLoading: boolean;
  fontPairingLoading: boolean;
  onClear: () => void;
  onSubmit: (e: React.FormEvent) => void;
  onDesignMoodSelect: (id: string) => void;
  onModeSelect: (mode: 'light' | 'dark' | 'both') => void;
  onPaletteSelect: (palette: Palette) => void;
  onPaletteRegenerate: () => void;
  onFontPairingSelect: (pairing: FontPairing) => void;
  onFontPairingRegenerate: () => void;
  onSectionToggle: (id: string, checked: boolean) => void;
  onSectionVariantChange: (section: string, variant: string) => void;
  onAiSuggestVariants: () => void;
  onAdvanceToSummary: () => void;
  onGenerate: () => void;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
};

export function LayoutChatbotUI(props: Props) {
  const {
    open,
    setOpen,
    messages,
    input,
    setInput,
    loading,
    hasGenerated,
    step,
    context,
    paletteOptions,
    selectedPalette,
    fontPairingOptions,
    selectedFontPairing,
    selectedSections,
    sectionVariants,
    sectionVariantsLoading,
    paletteLoading,
    fontPairingLoading,
    onClear,
    onSubmit,
    onDesignMoodSelect,
    onModeSelect,
    onPaletteSelect,
    onPaletteRegenerate,
    onFontPairingSelect,
    onFontPairingRegenerate,
    onSectionToggle,
    onSectionVariantChange,
    onAiSuggestVariants,
    onAdvanceToSummary,
    onGenerate,
    messagesEndRef,
  } = props;

  const scrollToBottom = () => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });

  useEffect(() => {
    if (open) scrollToBottom();
  }, [open, messages, step]);

  const isReady = step >= 5;
  const showGenerate = isReady && !loading;

  return (
    <div style={{ display: 'contents' }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 shadow-lg hover:bg-slate-800 dark:hover:bg-slate-200 transition-colors flex items-center justify-center"
        aria-label="Open layout generator"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m3 21 1.9-5.7a8.5 8.5 0 0 0 9 9 9 9 0 1 1-9-9Z" />
        </svg>
      </button>
      {open && (
        <div className="fixed bottom-24 right-6 z-50 w-[min(420px,calc(100vw-3rem))] max-h-[min(640px,calc(100vh-7rem))] flex flex-col rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 shadow-xl">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700 shrink-0">
            <span className="font-semibold text-gray-900 dark:text-gray-100">Design Builder</span>
            <div className="flex items-center gap-2">
              {hasGenerated && (
                <button
                  type="button"
                  onClick={onClear}
                  className="px-2 py-1 text-xs rounded-md border border-gray-200 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-400"
                >
                  Clear
                </button>
              )}
              <button
                type="button"
                onClick={() => setOpen(() => false)}
                className="p-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500"
                aria-label="Close"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0">
            {messages.map((msg) => (
              <div key={msg.id} className={msg.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                {msg.role === 'user' && msg.prompt && (
                  <div className="max-w-[85%] px-3 py-2 rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-sm">
                    {msg.prompt}
                  </div>
                )}
                {msg.role === 'assistant' && (
                  <div className="max-w-full w-full">
                    {msg.error && (
                      <div className="px-3 py-2 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
                        {msg.error}
                      </div>
                    )}
                    {msg.success && (
                      <div className="px-3 py-2 rounded-lg bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 text-sm">
                        Layout updated! Check the page below.
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}

            {step === 0 && (
              <div className="space-y-3">
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100">Choose a Design Mood</p>
                <div className="grid grid-cols-2 gap-2 max-h-64 overflow-y-auto">
                  {DESIGN_MOODS.map((mood) => (
                    <button
                      key={mood.id}
                      type="button"
                      onClick={() => onDesignMoodSelect(mood.id)}
                      disabled={loading}
                      className={`p-3 rounded-lg border text-left transition-colors ${
                        context.designMood === mood.id
                          ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                          : 'border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800'
                      }`}
                    >
                      <p className="font-medium text-sm text-gray-900 dark:text-gray-100">{mood.label}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-2">{mood.description}</p>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {step === 1 && (
              <div className="space-y-3">
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100">Light or Dark Mode?</p>
                <div className="flex flex-wrap gap-2">
                  {MODE_OPTIONS.map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => onModeSelect(opt.id)}
                      disabled={loading}
                      className={`px-4 py-2 rounded-lg border text-sm transition-colors ${
                        context.mode === opt.id
                          ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300'
                          : 'border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100">Color Palettes</p>
                  <button
                    type="button"
                    onClick={onPaletteRegenerate}
                    disabled={paletteLoading || loading}
                    className="text-xs px-2 py-1 rounded border border-gray-200 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-400"
                  >
                    {paletteLoading ? 'Loading...' : 'Regenerate'}
                  </button>
                </div>
                {paletteOptions && paletteOptions.length > 0 ? (
                  <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto">
                    {paletteOptions.map((p) => (
                      <button
                        key={p.name}
                        type="button"
                        onClick={() => onPaletteSelect(p)}
                        disabled={loading}
                        className={`p-3 rounded-lg border text-left transition-colors ${
                          selectedPalette?.name === p.name
                            ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                            : 'border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800'
                        }`}
                      >
                        <p className="font-medium text-xs text-gray-900 dark:text-gray-100">{p.name}</p>
                        <div className="flex gap-1 mt-2">
                          {[p.light.primary, p.light.secondary, p.light.accent].map((c, i) => (
                            <span key={i} className="w-5 h-5 rounded border border-gray-200" style={{ backgroundColor: c }} />
                          ))}
                        </div>
                      </button>
                    ))}
                  </div>
                ) : paletteLoading ? (
                  <p className="text-sm text-gray-500">Loading palettes...</p>
                ) : (
                  <p className="text-sm text-gray-500">Click Regenerate to load palettes.</p>
                )}
              </div>
            )}

            {step === 3 && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100">Font Pairings</p>
                  <button
                    type="button"
                    onClick={onFontPairingRegenerate}
                    disabled={fontPairingLoading || loading}
                    className="text-xs px-2 py-1 rounded border border-gray-200 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-400"
                  >
                    {fontPairingLoading ? 'Loading...' : 'Regenerate'}
                  </button>
                </div>
                {fontPairingOptions && fontPairingOptions.length > 0 ? (
                  <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto">
                    {fontPairingOptions.map((fp, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => onFontPairingSelect(fp)}
                        disabled={loading}
                        className={`p-3 rounded-lg border text-left transition-colors ${
                          selectedFontPairing?.heading === fp.heading && selectedFontPairing?.body === fp.body
                            ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                            : 'border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800'
                        }`}
                      >
                        <p className="font-medium text-xs text-gray-900 dark:text-gray-100">{fp.headingName} + {fp.bodyName}</p>
                      </button>
                    ))}
                  </div>
                ) : fontPairingLoading ? (
                  <p className="text-sm text-gray-500">Loading font pairings...</p>
                ) : (
                  <p className="text-sm text-gray-500">Click Regenerate to load fonts.</p>
                )}
              </div>
            )}

            {step === 4 && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100">Page Sections</p>
                  <button
                    type="button"
                    onClick={onAiSuggestVariants}
                    disabled={sectionVariantsLoading || loading || !context.designMood}
                    className="text-xs px-2 py-1 rounded border border-gray-200 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-400"
                  >
                    {sectionVariantsLoading ? 'Loading...' : 'AI Suggest'}
                  </button>
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400">Select sections for your homepage. Navbar and footer are always included.</p>
                <div className="space-y-3">
                  {SECTION_OPTIONS.map((opt) => {
                    const checked = selectedSections.includes(opt.id);
                    const variants = SECTION_VARIANTS[opt.id];
                    const currentVariant = sectionVariants[opt.id] ?? variants?.[0]?.id ?? '';
                    return (
                      <div key={opt.id} className="space-y-1">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => onSectionToggle(opt.id, e.target.checked)}
                            disabled={loading}
                            className="rounded border-gray-300"
                          />
                          <span className="text-sm text-gray-900 dark:text-gray-100">{opt.label}</span>
                        </label>
                        {checked && variants && variants.length > 1 && (
                          <select
                            value={currentVariant}
                            onChange={(e) => onSectionVariantChange(opt.id, e.target.value)}
                            disabled={loading}
                            className="ml-6 mt-1 w-full max-w-[200px] text-xs px-2 py-1.5 rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
                          >
                            {variants.map((v) => (
                              <option key={v.id} value={v.id}>
                                {v.label}
                              </option>
                            ))}
                          </select>
                        )}
                      </div>
                    );
                  })}
                </div>
                <button
                  type="button"
                  onClick={onAdvanceToSummary}
                  disabled={loading}
                  className="w-full py-2 rounded-lg border border-slate-900 dark:border-slate-100 text-slate-900 dark:text-slate-100 text-sm font-medium hover:bg-slate-50 dark:hover:bg-slate-900/50 transition-colors"
                >
                  Continue
                </button>
              </div>
            )}

            {showGenerate && (
              <div className="space-y-3">
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100">Your choices</p>
                <div className="text-xs text-gray-500 dark:text-gray-400 space-y-1">
                  {context.designMood && <p>Mood: {DESIGN_MOODS.find((m) => m.id === context.designMood)?.label ?? context.designMood}</p>}
                  {context.mode && <p>Mode: {context.mode}</p>}
                  {selectedPalette && <p>Palette: {selectedPalette.name}</p>}
                  {selectedFontPairing && <p>Fonts: {selectedFontPairing.headingName} + {selectedFontPairing.bodyName}</p>}
                  <p>Sections: {selectedSections.join(', ')}</p>
                  {Object.keys(sectionVariants).length > 0 && (
                    <p>Variants: {Object.entries(sectionVariants).map(([k, v]) => `${k}=${v}`).join(', ')}</p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={onGenerate}
                  disabled={loading || !selectedPalette || !selectedFontPairing}
                  className="w-full py-2.5 rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-sm font-medium hover:bg-slate-800 dark:hover:bg-slate-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {loading ? 'Generating...' : 'Generate Homepage'}
                </button>
              </div>
            )}

            {loading && (
              <div className="flex justify-start">
                <div className="px-3 py-2 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 text-sm">
                  Generating...
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
          {!isReady && step < 4 && (
            <form onSubmit={onSubmit} className="p-4 border-t border-gray-200 dark:border-gray-700 shrink-0">
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">Or type to skip to generate</p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="e.g. Modern fashion store..."
                  className="flex-1 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 text-sm"
                  disabled={loading}
                />
                <button type="submit" disabled={loading} className="px-4 py-2 rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-sm font-medium">
                  Skip
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
