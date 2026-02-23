'use client';

/**
 * Overlay to browse logged AI responses from ai-responses.jsonl.
 * Floating button (bottom-left) opens a panel with generator tabs and JSON output.
 * When an entry is selected, applies the change to the page (layout or navbar).
 */

import { useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useLayoutGeneratorStore } from '@/store/layout-generator-store';
import { pickRandomNavbarTheme } from '@/lib/ai/navbar-theme-picker';
import { resolveScreenConfig } from '@/lib/sdui/config-resolver';
import root from '@/config/root';

type TabId = 'home' | 'collection' | 'product' | 'cart' | 'all';

const TABS: { id: TabId; page: string | null; label: string }[] = [
  { id: 'home', page: 'home', label: 'Home' },
  { id: 'collection', page: 'collection', label: 'Collection' },
  { id: 'product', page: 'product', label: 'Product' },
  { id: 'cart', page: 'cart', label: 'Cart' },
  { id: 'all', page: null, label: 'All' },
];

type LogEntry = {
  timestamp: string;
  generator: string;
  page?: string;
  input: Record<string, unknown>;
  output: unknown;
  source: 'api' | 'eval';
  evalResult?: 'PASS' | 'FAIL' | null;
  screen?: Record<string, unknown>;
};

type FileVersion = { name: string; mtime: number };

function inputSummary(input: Record<string, unknown>) {
  if (input.prompt) return String(input.prompt);
  if (input.designMood) {
    const mode = input.mode ? ` (${input.mode})` : '';
    return `${input.designMood}${mode}`;
  }
  return JSON.stringify(input).slice(0, 50);
}

function dedupeEntries(entries: LogEntry[]): LogEntry[] {
  const seen = new Map<string, LogEntry>();
  for (const e of entries) {
    const key = JSON.stringify({ input: e.input, output: e.output });
    const existing = seen.get(key);
    if (!existing) seen.set(key, e);
    else if (e.evalResult === 'PASS' && existing.evalResult !== 'PASS') seen.set(key, e);
  }
  return [...seen.values()].reverse();
}

export function AiResponsePreviewOverlay() {
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>('home');
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [files, setFiles] = useState<FileVersion[]>([]);
  const [currentFile, setCurrentFile] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<LogEntry | null>(null);
  const [editedJson, setEditedJson] = useState('');

  const router = useRouter();
  const pathname = usePathname();
  const setGenerated = useLayoutGeneratorStore((s) => s.setGenerated);
  const activePage = TABS.find((t) => t.id === activeTab)?.page ?? null;

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    setSelected(null);
    setEditedJson('');
    const fileParam = selectedFile ? `&file=${encodeURIComponent(selectedFile)}` : '';
    const pageParam = activePage ? `&page=${encodeURIComponent(activePage)}` : '';
    fetch(`/api/ai-responses?${pageParam}${fileParam}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setEntries(dedupeEntries(data.entries ?? []));
        setFiles(data.files ?? []);
        setCurrentFile(data.file ?? null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, [open, activePage, selectedFile]);

  useEffect(() => {
    if (!selected) {
      setGenerated(null, null, null);
      return;
    }
    const gen = selected.generator;
    const navbarGenerators = new Set(['navbar', 'navbar-structure']);
    if (gen === 'layout') {
      const out = selected.output as { layout?: unknown; theme?: unknown };
      const screen = (selected as LogEntry & { screen?: Record<string, unknown> }).screen;
      const style = (out.theme as { style?: string })?.style ?? (out.layout as { style?: string })?.style ?? null;
      if (screen) {
        setGenerated(screen, style, out.theme as Record<string, unknown> | undefined);
        if (pathname !== '/' && pathname !== '') router.push('/');
      } else {
        setGenerated(null, null, null);
      }
    } else if (navbarGenerators.has(gen)) {
      const output = selected.output as Record<string, unknown>;
      if (output && typeof output === 'object') {
        if (output.screen && typeof output.screen === 'object') {
          setGenerated(
            output.screen as Record<string, unknown>,
            (output.style as string) ?? null,
            (output.theme as Record<string, unknown>) ?? undefined
          );
          if (pathname !== '/' && pathname !== '') router.push('/');
        } else {
          const structure = output.structure ?? output;
          const theme = output.theme as { style?: string; fonts?: { heading?: string; body?: string } } | undefined;
          const pick = theme ? { style: theme.style ?? 'modern', fonts: theme.fonts ?? { heading: 'geist', body: 'geist' } } : pickRandomNavbarTheme();
          const registry = { layouts: root.layouts, fragments: root.fragments };
          const homeScreen = root.screens.home as Record<string, unknown>;
          const screen = resolveScreenConfig(
            {
              ...homeScreen,
              layoutParts: typeof structure === 'object' && structure
                ? { navbar: { structure: structure as Record<string, unknown> } }
                : undefined,
            } as Parameters<typeof resolveScreenConfig>[0],
            registry
          ) as Record<string, unknown>;
          setGenerated(screen, pick.style, { fonts: pick.fonts });
          if (pathname !== '/' && pathname !== '') router.push('/');
        }
      }
    } else if (gen === 'screen') {
      const output = selected.output as Record<string, unknown>;
      if (output?.screen && typeof output.screen === 'object') {
        setGenerated(output.screen as Record<string, unknown>, null, undefined);
        if (pathname !== '/' && pathname !== '') router.push('/');
      }
    } else if (gen === 'page') {
      const output = selected.output as Record<string, unknown>;
      if (output && output.content) {
        const registry = { layouts: root.layouts, fragments: root.fragments };
        const screen = resolveScreenConfig(
          output as Parameters<typeof resolveScreenConfig>[0],
          registry
        ) as Record<string, unknown>;
        const themeHint = output.themeHint as { designMood?: string; palette?: Record<string, unknown>; fonts?: { heading?: string; body?: string } } | undefined;
        const style = themeHint?.designMood ?? null;
        const theme = themeHint
          ? { designMood: themeHint.designMood, colors: themeHint.palette, fonts: themeHint.fonts }
          : undefined;
        setGenerated(screen, style, theme as Record<string, unknown> | undefined);
        if (pathname !== '/' && pathname !== '') router.push('/');
      }
    } else {
      setGenerated(null, null, null);
    }
  }, [selected, setGenerated, pathname, router]);

  return (
    <div style={{ display: 'contents' }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="fixed bottom-6 left-6 z-50 w-12 h-12 rounded-full bg-slate-700 dark:bg-slate-300 text-white dark:text-slate-900 shadow-lg hover:bg-slate-600 dark:hover:bg-slate-200 transition-colors flex items-center justify-center"
        aria-label="Preview AI responses"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
        </svg>
      </button>
      {open && (
        <div
          className="fixed bottom-24 left-6 z-50 flex flex-col rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 shadow-xl overflow-hidden"
          style={{
            width: 520,
            height: 640,
            minWidth: 360,
            minHeight: 400,
            maxWidth: 'min(90vw, 900px)',
            maxHeight: 'min(90vh, 900px)',
            resize: 'both',
          }}
        >
          <div className="flex flex-col gap-0.5 px-3 py-2 border-b border-gray-200 dark:border-gray-700 shrink-0">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-sm text-gray-900 dark:text-gray-100">AI Response Preview</span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="p-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500"
                aria-label="Close"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="flex items-center gap-2 min-w-0">
              {files.length > 1 ? (
                <select
                  value={selectedFile ?? currentFile ?? files[0]?.name ?? ''}
                  onChange={(e) => setSelectedFile(e.target.value || null)}
                  className="flex-1 min-w-0 text-[10px] text-gray-600 dark:text-gray-400 bg-transparent border border-gray-200 dark:border-gray-700 rounded px-1.5 py-0.5 truncate max-w-[200px]"
                  title="Switch version"
                >
                  {files.map((f) => (
                    <option key={f.name} value={f.name}>
                      {f.name}
                    </option>
                  ))}
                </select>
              ) : currentFile ? (
                <span className="text-[10px] text-gray-500 dark:text-gray-400 truncate" title={currentFile}>
                  {currentFile}
                </span>
              ) : null}
            </div>
          </div>
          <div className="flex gap-1 px-2 py-1 border-b border-gray-200 dark:border-gray-700 shrink-0 overflow-x-auto">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id)}
                className={`px-2 py-1.5 text-xs font-medium rounded-md whitespace-nowrap ${
                  activeTab === t.id
                    ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300'
                    : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="flex-1 min-h-0 flex overflow-hidden">
            <div className="w-48 shrink-0 border-r border-gray-200 dark:border-gray-700 overflow-y-auto p-2">
              {loading ? (
                <p className="text-xs text-gray-500">Loading...</p>
              ) : error ? (
                <p className="text-xs text-red-500">{error}</p>
              ) : entries.length === 0 ? (
                <p className="text-xs text-gray-500">No entries</p>
              ) : (
                entries.map((e, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      setSelected(e);
                      setEditedJson(JSON.stringify(e.output, null, 2));
                    }}
                    className={`w-full text-left px-2 py-1.5 rounded text-xs mb-1 ${
                      selected === e
                        ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300'
                        : 'hover:bg-gray-100 dark:hover:bg-gray-800'
                    }`}
                  >
                    <span className="block truncate">{inputSummary(e.input)}</span>
                    <span className="flex items-center gap-1 mt-0.5">
                      <span className="text-[9px] px-1 rounded bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                        {e.generator}
                      </span>
                      {e.evalResult && (
                        <span className={`text-[10px] ${e.evalResult === 'PASS' ? 'text-green-600' : 'text-red-600'}`}>
                          {e.evalResult}
                        </span>
                      )}
                    </span>
                  </button>
                ))
              )}
            </div>
            <div className="flex-1 min-h-0 flex flex-col p-2 min-w-0">
              {selected ? (
                <>
                  <textarea
                    value={editedJson}
                    onChange={(e) => setEditedJson(e.target.value)}
                    className="flex-1 min-h-0 w-full resize-none rounded border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 p-2 text-xs font-mono text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    spellCheck={false}
                    placeholder="Edit JSON..."
                  />
                  <button
                    type="button"
                    onClick={() => {
                      try {
                        const parsed = JSON.parse(editedJson) as Record<string, unknown>;
                        if (parsed && typeof parsed === 'object') {
                          if (parsed.screen && typeof parsed.screen === 'object') {
                            // layout or screen generator response wrapped in { screen, style, theme }
                            setGenerated(
                              parsed.screen as Record<string, unknown>,
                              (parsed.style as string) ?? null,
                              (parsed.theme as Record<string, unknown>) ?? undefined
                            );
                            if (pathname !== '/' && pathname !== '') router.push('/');
                          } else if (parsed.content && parsed.meta) {
                            // page generator output — resolve $ref and apply
                            const registry = { layouts: root.layouts, fragments: root.fragments };
                            const screen = resolveScreenConfig(
                              parsed as Parameters<typeof resolveScreenConfig>[0],
                              registry
                            ) as Record<string, unknown>;
                            const themeHint = parsed.themeHint as { designMood?: string; palette?: Record<string, unknown>; fonts?: { heading?: string; body?: string } } | undefined;
                            const style = themeHint?.designMood ?? null;
                            const theme = themeHint
                              ? { designMood: themeHint.designMood, colors: themeHint.palette, fonts: themeHint.fonts }
                              : undefined;
                            setGenerated(screen, style, theme as Record<string, unknown> | undefined);
                            if (pathname !== '/' && pathname !== '') router.push('/');
                          } else if (parsed.structure) {
                            // navbar generator
                            const theme = parsed.theme as { style?: string; fonts?: { heading?: string; body?: string } } | undefined;
                            const pick = theme ? { style: theme.style ?? 'modern', fonts: theme.fonts ?? { heading: 'geist', body: 'geist' } } : pickRandomNavbarTheme();
                            const registry = { layouts: root.layouts, fragments: root.fragments };
                            const homeScreen = root.screens.home as Record<string, unknown>;
                            const screen = resolveScreenConfig(
                              {
                                ...homeScreen,
                                layoutParts: { navbar: { structure: parsed.structure as Record<string, unknown> } },
                              } as Parameters<typeof resolveScreenConfig>[0],
                              registry
                            ) as Record<string, unknown>;
                            setGenerated(screen, pick.style, { fonts: pick.fonts } as Record<string, unknown>);
                            if (pathname !== '/' && pathname !== '') router.push('/');
                          }
                        }
                      } catch {
                        // invalid JSON - could show toast
                      }
                    }}
                    className="mt-2 px-3 py-1.5 text-xs font-medium rounded bg-blue-600 text-white hover:bg-blue-700"
                  >
                    Apply
                  </button>
                </>
              ) : (
                <p className="text-xs text-gray-500">Select an entry</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
