/**
 * primitives.ts — Map SDUI component types to HTML tags + JSX opening.
 *
 * Returns the HTML element name and any required default attributes so
 * nodes.ts can build the full JSX tag.
 */

export interface PrimitiveInfo {
  /** HTML tag or component import name */
  tag: string;
  /** For external component imports: { from, importName, isDefault } */
  importFrom?: string;
  importName?: string;
  isDefaultImport?: boolean;
  /** Additional required JSX props (e.g. alt="" for img) */
  defaultProps?: Record<string, string>;
  /** If true, this element is self-closing when it has no children */
  selfClose?: boolean;
  /** If true, this should always be wrapped in a motion.* when animated */
  supportsMotion?: boolean;
}

const PRIMITIVES: Record<string, PrimitiveInfo> = {
  Box: {
    tag: 'div',
    supportsMotion: true,
  },
  Text: {
    tag: 'span', // nodes.ts may upgrade to p/h1/h2/h3/label based on heuristics
    supportsMotion: true,
  },
  Icon: {
    tag: 'Icon',
    importFrom: '@iconify/react',
    importName: 'Icon',
    isDefaultImport: false,
    defaultProps: { icon: '"mdi:circle"' },
    selfClose: true,
    supportsMotion: false,
  },
  Image: {
    tag: 'Image',
    importFrom: 'next/image',
    importName: 'Image',
    isDefaultImport: true,
    defaultProps: { alt: '""', width: '400', height: '300' },
    selfClose: true,
    supportsMotion: false,
  },
  Video: {
    tag: 'video',
    supportsMotion: false,
  },
  FormContainer: {
    tag: 'form',
    supportsMotion: false,
  },
  Input: {
    tag: 'input',
    selfClose: true,
    supportsMotion: false,
  },
  InputField: {
    tag: 'input',
    selfClose: true,
    supportsMotion: false,
  },
  Textarea: {
    tag: 'textarea',
    supportsMotion: false,
  },
  TextareaInput: {
    tag: 'textarea',
    supportsMotion: false,
  },
  Iframe: {
    tag: 'iframe',
    supportsMotion: false,
  },
  Chart: {
    tag: 'DynamicChart',
    importFrom: '@/components/primitives/dynamic-chart',
    importName: 'DynamicChart',
    isDefaultImport: false,
    supportsMotion: false,
  },
  QRCodeWidget: {
    tag: 'QRCodeSVG',
    importFrom: 'qrcode.react',
    importName: 'QRCodeSVG',
    isDefaultImport: false,
    selfClose: true,
    supportsMotion: false,
  },
  MarkdownViewer: {
    tag: 'ReactMarkdown',
    importFrom: 'react-markdown',
    importName: 'ReactMarkdown',
    isDefaultImport: true,
    supportsMotion: false,
  },
  GoogleMap: {
    tag: 'GoogleMapEmbed',
    importFrom: '../components/primitives/google-map',
    importName: 'GoogleMapEmbed',
    isDefaultImport: false,
    supportsMotion: false,
  },
  GoogleMapPlaces: {
    tag: 'GoogleMapEmbed',
    importFrom: '../components/primitives/google-map',
    importName: 'GoogleMapEmbed',
    isDefaultImport: false,
    supportsMotion: false,
  },
  LottiePlayer: {
    tag: 'LottiePlayer',
    importFrom: '@/components/primitives/lottie-player',
    importName: 'LottiePlayer',
    isDefaultImport: false,
    supportsMotion: false,
  },
  HtmlContent: {
    tag: 'div',
    defaultProps: {},
    supportsMotion: true,
  },
};

export function getPrimitive(type: string): PrimitiveInfo {
  return PRIMITIVES[type] ?? { tag: 'div', supportsMotion: true };
}

/** Map a Text node to the appropriate semantic tag based on props */
export function resolveTextTag(props: Record<string, unknown>): string {
  const role = props.role as string | undefined;
  const as = props.as as string | undefined;
  if (as) return as;
  if (role === 'heading' || role === 'h1') return 'h1';
  if (role === 'h2') return 'h2';
  if (role === 'h3') return 'h3';
  if (role === 'h4') return 'h4';
  if (role === 'h5') return 'h5';
  if (role === 'h6') return 'h6';
  if (role === 'label') return 'label';
  if (role === 'p' || role === 'paragraph') return 'p';
  // Heuristic: Tailwind font-size classes suggest block-level text
  const cls = (props.className as string) ?? '';
  if (/text-[3-9]xl/.test(cls) || /text-2xl/.test(cls)) return 'p';
  // Arbitrary pixel sizes: text-[24px], text-[30px], etc. — treat any >= 18px as block-level
  const pxMatch = cls.match(/text-\[(\d+(?:\.\d+)?)px\]/);
  if (pxMatch && parseFloat(pxMatch[1]) >= 18) return 'p';
  // Any arbitrary rem/em size also treated as block-level styled text
  if (/text-\[\d+(?:\.\d+)?r?em\]/.test(cls)) return 'p';
  return 'span';
}
