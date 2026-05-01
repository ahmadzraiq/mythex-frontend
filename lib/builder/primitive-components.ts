/**
 * primitive-components.ts
 *
 * Single source of truth for all draggable builder components.
 * Imported by:
 *  - app/dev/builder/_components-tab.tsx  (palette UI)
 *  - lib/ai/sdui-component-schema.ts      (AI tool templates)
 *  - lib/ai/builder-tools.ts              (Anthropic tool enum)
 *  - app/api/ai/generate-sections/route.ts (section prompt labels)
 *
 * Pure TypeScript — no React, no 'use client'.
 */

export interface PrimitiveComponent {
  type: string;
  label: string;
  icon: string;
  /** AI-facing template. Minimal shell — what `add_component(label)` inserts. */
  defaultNode: object;
  /**
   * Palette-only richer default used by drag-and-drop in the builder.
   * The AI never sees this — `sdui-component-schema.ts` keeps reading `defaultNode`.
   * Use this to pre-populate structure or layout tokens that improve the drag-drop UX
   * but would clutter the AI's tool output.
   */
  builderDefaultNode?: object;
}

export const PRIMITIVE_COMPONENTS: Record<string, PrimitiveComponent[]> = {
  Primitives: [
    { type: 'Box',      label: 'Box',      icon: '□',
      defaultNode: { type: 'Box', props: {} },
      builderDefaultNode: { type: 'Box', props: { className: 'w-full h-[100px]' } } },
    { type: 'Text',     label: 'Text',     icon: 'T',
      defaultNode: { type: 'Text', text: 'Text', props: {} } },
    { type: 'Input',    label: 'Input',    icon: '▭',
      defaultNode: { type: 'Input', props: {} } },
    { type: 'Textarea', label: 'Textarea', icon: '≡',
      defaultNode: { type: 'Textarea', props: {} } },
    { type: 'Image',    label: 'Image',    icon: '🖼',
      defaultNode: { type: 'Image', props: {}, src: '' },
      builderDefaultNode: { type: 'Image', props: { className: 'w-[100px] h-[100px]' }, src: '' } },
    { type: 'Icon',     label: 'Icon',     icon: '◈',
      defaultNode: { type: 'Icon', props: { icon: 'lucide:star', size: 24 } } },
    { type: 'Video',    label: 'Video',    icon: '▶',
      defaultNode: { type: 'Video', props: {}, src: '' },
      builderDefaultNode: { type: 'Video', props: { className: 'w-[200px] h-[120px]' }, src: '' } },
    { type: 'Iframe',   label: 'Iframe',   icon: '⬜',
      defaultNode: { type: 'Iframe', props: {} },
      builderDefaultNode: { type: 'Iframe', props: { className: 'w-[320px] h-[200px]' } } },
  ],
};

/** Flat list of all primitive components across all sections */
export const ALL_PRIMITIVES: PrimitiveComponent[] = Object.values(PRIMITIVE_COMPONENTS).flat();
