'use client';

/**
 * useAIGeneration
 * Reads wizardResult from localStorage, generates Nav+Footer once (shared across pages),
 * then processes content sections in parallel (2 pages × 3 sections concurrently).
 * Streams each completed SDUINode directly into the builder store via insertNodeIntoPage.
 */

import { useCallback, useRef, useState } from 'react';
import { useBuilderStore } from './_store';
import type { SDUINode } from '@/lib/sdui/types/node';
import type { BuilderPage } from './_store-types';
import type { AiSectionWithHints } from '@/app/api/ai/generate-sections/route';
import { SHARED_NAV_SECTION, SHARED_FOOTER_SECTION } from '@/lib/builder/wizard-data';
import type { ColorPalette, FontPair } from '@/lib/builder/wizard-data';
import type { AiPage } from '@/app/api/ai/generate-pages/route';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WizardResult {
  appName: string;
  businessDescription: string;
  category: string;
  mood: string;
  animationLevel: number;
  layoutStructure: number;
  selectedPalette: ColorPalette | null;
  selectedFont: FontPair | null;
  selectedPages: AiPage[];
}

export type SectionStatus = 'pending' | 'generating' | 'done' | 'error';

export interface SectionProgress {
  pageId: string;
  pageName: string;
  sectionName: string;
  status: SectionStatus;
  nodeCount: number;
}

export interface GenerationState {
  active: boolean;
  totalSections: number;
  doneSections: number;
  totalNodes: number;
  progress: SectionProgress[];
  error: string | null;
}

// ---------------------------------------------------------------------------
// SSE parsing helpers
// ---------------------------------------------------------------------------

type SSEEvent =
  | { type: 'shell'; shellId: string; node: SDUINode }
  | { type: 'node'; node: SDUINode }
  | { type: 'section_child'; parentId: string; node: SDUINode }
  | { type: 'progress'; chars: number }
  | { type: 'done' }
  | { type: 'error'; message: string };

// Yielded items from the section stream:
// - { kind: 'shell', shellId, node }  → insert as a new page-level node (section container, children=[])
// - { kind: 'node', node }            → insert as a new page-level node (leaf, already has children)
// - { kind: 'child', parentId, node } → append as a child of an already-inserted shell node
type StreamItem =
  | { kind: 'shell'; shellId: string; node: SDUINode }
  | { kind: 'node'; node: SDUINode }
  | { kind: 'child'; parentId: string; node: SDUINode };

async function* streamSectionNodes(
  section: AiSectionWithHints,
  context: Omit<WizardResult, 'selectedPages'> & { pageRoutes: Array<{ name: string; route: string }> },
  signal: AbortSignal,
): AsyncGenerator<StreamItem> {
  const res = await fetch('/api/ai/generate-section-nodes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      section,
      animationLevel: context.animationLevel,
      mood: context.mood,
      appName: context.appName,
      businessDescription: context.businessDescription,
      category: context.category,
      pageRoutes: context.pageRoutes,
    }),
    signal,
  });

  if (!res.ok || !res.body) {
    throw new Error(`HTTP ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const json = line.slice(6).trim();
      if (!json) continue;
      try {
        const ev = JSON.parse(json) as SSEEvent;
        if (ev.type === 'shell') yield { kind: 'shell', shellId: ev.shellId, node: ev.node };
        if (ev.type === 'node') yield { kind: 'node', node: ev.node };
        if (ev.type === 'section_child') yield { kind: 'child', parentId: ev.parentId, node: ev.node };
        if (ev.type === 'done') return;
        if (ev.type === 'error') throw new Error(ev.message);
        // 'progress' events are intentionally ignored in the client (server-side heartbeat only)
      } catch {
        // skip malformed SSE lines
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Generate nav or footer nodes (shared across all pages)
// ---------------------------------------------------------------------------

// Reconstruct a full SDUINode tree from the shell + child stream events
async function generateSharedSection(
  section: AiSectionWithHints,
  context: Omit<WizardResult, 'selectedPages'> & { pageRoutes: Array<{ name: string; route: string }> },
  signal: AbortSignal,
): Promise<SDUINode[]> {
  // Map from shell id → shell node (for stitching children back)
  const shellMap = new Map<string, SDUINode>();
  const roots: SDUINode[] = [];

  for await (const item of streamSectionNodes(section, context, signal)) {
    if (item.kind === 'shell') {
      // New streaming format: shell arrives first with empty children
      shellMap.set(item.shellId, item.node);
      roots.push(item.node);
    } else if (item.kind === 'node') {
      // Leaf node (no children) or legacy format
      shellMap.set(item.node.id as string, item.node);
      roots.push(item.node);
    } else if (item.kind === 'child') {
      // Attach child to its parent shell so the final node is complete
      const parentId = item.parentId;
      const parent = shellMap.get(parentId);
      if (parent) {
        const existing = Array.isArray(parent.children) ? (parent.children as SDUINode[]) : [];
        (parent as unknown as Record<string, unknown>).children = [...existing, item.node];
      }
    }
  }
  return roots;
}

// Deep-clone a node tree replacing all IDs to avoid duplicate ID conflicts
function deepCloneWithNewIds(node: SDUINode): SDUINode {
  const clone = { ...node, id: crypto.randomUUID() };
  if (Array.isArray(clone.children)) {
    clone.children = (clone.children as SDUINode[]).map(deepCloneWithNewIds);
  }
  return clone;
}

// ---------------------------------------------------------------------------
// Main hook
// ---------------------------------------------------------------------------

export function useAIGeneration() {
  const store = useBuilderStore();
  const abortControllers = useRef<AbortController[]>([]);
  const [genState, setGenState] = useState<GenerationState>({
    active: false,
    totalSections: 0,
    doneSections: 0,
    totalNodes: 0,
    progress: [],
    error: null,
  });

  const updateSectionStatus = useCallback(
    (pageId: string, sectionName: string, update: Partial<SectionProgress>) => {
      setGenState(prev => ({
        ...prev,
        progress: prev.progress.map(p =>
          p.pageId === pageId && p.sectionName === sectionName ? { ...p, ...update } : p
        ),
      }));
    },
    [],
  );

  const cancel = useCallback(() => {
    abortControllers.current.forEach(a => a.abort());
    abortControllers.current = [];
    setGenState(prev => ({ ...prev, active: false }));
  }, []);

  const start = useCallback(
    async (wizardResult: WizardResult) => {
      const { appName, businessDescription, category, mood, animationLevel, selectedPages } = wizardResult;
      if (!selectedPages.length) return;

      // ALWAYS read fresh store state to avoid stale-closure issues.
      // store.pages captured by useCallback may be the pre-load empty array.
      const freshBuilderPages = (): BuilderPage[] =>
        useBuilderStore.getState().pages as BuilderPage[];

      const builderPages = freshBuilderPages();
      console.log('[AI gen] builder pages at start:', builderPages.map(p => ({ id: p.id, name: p.name, route: p.route })));

      // Build page routes list for CTA hrefs
      const pageRoutes = selectedPages.map(p => ({ name: p.name, route: p.route ?? '/' }));
      const context = { appName, businessDescription, category, mood, animationLevel, layoutStructure: wizardResult.layoutStructure, selectedFont: wizardResult.selectedFont, selectedPalette: wizardResult.selectedPalette, pageRoutes };

      // Map each wizard page to its builder page ID (by ID first, then route, then name)
      const resolveBuilderPage = (page: AiPage): BuilderPage | undefined => {
        const pages = freshBuilderPages();
        return (
          pages.find(p => p.id === page.id) ??
          pages.find(p => p.route === page.route) ??
          pages.find(p => p.name === page.name)
        );
      };

      // Build initial progress list — exclude Nav and Footer from count (shared)
      const initialProgress: SectionProgress[] = [];
      let totalSections = 0;

      initialProgress.push({ pageId: 'shared', pageName: 'Shared', sectionName: 'Navigation', status: 'pending', nodeCount: 0 });
      initialProgress.push({ pageId: 'shared', pageName: 'Shared', sectionName: 'Footer', status: 'pending', nodeCount: 0 });

      for (const page of selectedPages) {
        const bPage = resolveBuilderPage(page);
        if (!bPage) {
          console.warn('[AI gen] no builder page found for wizard page:', page.id, page.name, page.route);
          continue;
        }
        const contentSections = (page.sections as AiSectionWithHints[]).filter(
          s => s.name !== 'Navigation' && s.name !== 'Footer',
        );
        for (const section of contentSections) {
          initialProgress.push({ pageId: bPage.id, pageName: page.name, sectionName: section.name, status: 'pending', nodeCount: 0 });
          totalSections++;
        }
      }

      console.log('[AI gen] total content sections:', totalSections, '(+2 for shared nav/footer)');

      setGenState({
        active: true,
        totalSections: totalSections + 2,
        doneSections: 0,
        totalNodes: 0,
        progress: initialProgress,
        error: null,
      });

      const mainAbort = new AbortController();
      abortControllers.current = [mainAbort];

      try {
        // ── Phase 1: Generate Nav + Footer once ────────────────────────────────
        updateSectionStatus('shared', 'Navigation', { status: 'generating' });
        updateSectionStatus('shared', 'Footer', { status: 'generating' });

        const navSection: AiSectionWithHints = { ...SHARED_NAV_SECTION };
        const footerSection: AiSectionWithHints = { ...SHARED_FOOTER_SECTION };

        const [navNodes, footerNodes] = await Promise.all([
          generateSharedSection(navSection, context, mainAbort.signal),
          generateSharedSection(footerSection, context, mainAbort.signal),
        ]);

        console.log('[AI gen] nav nodes:', navNodes.length, '  footer nodes:', footerNodes.length);

        if (navNodes.length === 0 && footerNodes.length === 0) {
          console.warn('[AI gen] WARNING: no nav/footer nodes generated — AI may have returned empty');
        }

        // Copy Nav to ALL builder pages now (fresh read)
        // Prepend in REVERSE order so first nav node ends up at position 0
        const allBuilderPages = freshBuilderPages();
        for (const bPage of allBuilderPages) {
          for (let i = navNodes.length - 1; i >= 0; i--) {
            store.prependNodeIntoPage(bPage.id, deepCloneWithNewIds(navNodes[i]));
          }
        }

        updateSectionStatus('shared', 'Navigation', { status: 'done', nodeCount: navNodes.length });
        // Footer will be appended AFTER content sections (so order is Nav → content → Footer)
        setGenState(prev => ({
          ...prev,
          doneSections: prev.doneSections + 1,
          totalNodes: prev.totalNodes + navNodes.length,
        }));

        // ── Phase 2: Content sections — 2 pages in parallel, 3 sections each ──
        const pageChunks: AiPage[][] = [];
        for (let i = 0; i < selectedPages.length; i += 2) {
          pageChunks.push(selectedPages.slice(i, i + 2));
        }

        for (const pageChunk of pageChunks) {
          if (mainAbort.signal.aborted) break;

          await Promise.all(
            pageChunk.map(async (page) => {
              const bPage = resolveBuilderPage(page);
              if (!bPage) {
                console.warn('[AI gen] Phase 2: no builder page for:', page.name);
                return;
              }

              const contentSections = (page.sections as AiSectionWithHints[]).filter(
                s => s.name !== 'Navigation' && s.name !== 'Footer',
              );

              console.log('[AI gen] generating', contentSections.length, 'sections for', page.name, '(builder pageId:', bPage.id, ')');

              // Process up to 3 sections concurrently per page
              const sectionChunks: AiSectionWithHints[][] = [];
              for (let i = 0; i < contentSections.length; i += 3) {
                sectionChunks.push(contentSections.slice(i, i + 3));
              }

              for (const sectionBatch of sectionChunks) {
                if (mainAbort.signal.aborted) break;

                await Promise.all(
                  sectionBatch.map(async (section) => {
                    updateSectionStatus(bPage.id, section.name, { status: 'generating' });

                    const combined = new AbortController();
                    const onMainAbort = () => combined.abort();
                    mainAbort.signal.addEventListener('abort', onMainAbort);

                    let nodeCount = 0;
                    try {
                      for await (const item of streamSectionNodes(section, context, combined.signal)) {
                        if (item.kind === 'shell') {
                          // True streaming: shell arrives first — canvas renders section container instantly
                          store.insertNodeIntoPage(bPage.id, item.node);
                          nodeCount++;
                        } else if (item.kind === 'node') {
                          // Leaf node (no children) — insert directly
                          store.insertNodeIntoPage(bPage.id, item.node);
                          nodeCount++;
                        } else if (item.kind === 'child') {
                          // Progressive child — append inside the shell already on the canvas
                          const parentId = item.parentId;
                          store.appendChildToNode(bPage.id, parentId, item.node);
                          nodeCount++;
                        }
                        setGenState(prev => ({ ...prev, totalNodes: prev.totalNodes + 1 }));
                      }
                      updateSectionStatus(bPage.id, section.name, { status: 'done', nodeCount });
                    } catch (err) {
                      if (!combined.signal.aborted) {
                        console.error('[AI gen] section error:', section.name, err);
                        updateSectionStatus(bPage.id, section.name, { status: 'error' });
                      }
                    } finally {
                      mainAbort.signal.removeEventListener('abort', onMainAbort);
                      setGenState(prev => ({ ...prev, doneSections: prev.doneSections + 1 }));
                    }
                  }),
                );
              }
            }),
          );
        }

        // ── Phase 3: Append Footer to all pages (after content so order is Nav → content → Footer) ──
        if (!mainAbort.signal.aborted && footerNodes.length > 0) {
          const finalBuilderPages = freshBuilderPages();
          for (const bPage of finalBuilderPages) {
            for (const node of footerNodes) {
              store.appendNodeIntoPage(bPage.id, deepCloneWithNewIds(node));
            }
          }
        }
        updateSectionStatus('shared', 'Footer', { status: 'done', nodeCount: footerNodes.length });
        setGenState(prev => ({
          ...prev,
          doneSections: prev.doneSections + 1,
          totalNodes: prev.totalNodes + footerNodes.length,
        }));
      } catch (err) {
        if (!mainAbort.signal.aborted) {
          console.error('[AI gen] fatal error:', err);
          setGenState(prev => ({ ...prev, error: String(err) }));
        }
      } finally {
        setGenState(prev => ({ ...prev, active: false }));
        abortControllers.current = [];
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store, updateSectionStatus],
  );

  return { genState, start, cancel };
}
