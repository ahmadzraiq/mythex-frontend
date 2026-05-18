/**
 * Shared theme preset catalogue.
 *
 * Used by both the Theme panel UI ([app/dev/builder/_theme-panel.tsx]) and the
 * AI tool executor ([lib/ai/tool-executor.ts]) so the `apply_theme_preset` tool
 * can resolve a preset name → light/dark/fonts payload identical to what the
 * user gets from clicking a chip in the panel.
 */

export interface ThemePreset {
  id: string;
  name: string;
  swatchColors: string[];
  fonts?: { heading?: string; body?: string };
  light: Record<string, string>;
  dark: Record<string, string>;
}

export const THEME_PRESETS: ThemePreset[] = [
  {
    id: 'clean',
    name: 'Clean',
    swatchColors: ['#1e293b', '#f1f5f9', '#ffffff'],
    fonts: { heading: 'system-ui, sans-serif', body: 'system-ui, sans-serif' },
    light: {
      background: '#ffffff', foreground: '#171923',
      card: '#ffffff', 'card-foreground': '#171923',
      popover: '#ffffff', 'popover-foreground': '#171923',
      primary: '#1e293b', 'primary-foreground': '#f8fafc',
      secondary: '#f1f5f9', 'secondary-foreground': '#1e293b',
      muted: '#f1f5f9', 'muted-foreground': '#64748b',
      accent: '#f1f5f9', 'accent-foreground': '#1e293b',
      destructive: '#ef4444', 'destructive-foreground': '#ffffff',
      border: '#e2e8f0', input: '#e2e8f0', ring: '#94a3b8',
    },
    dark: {
      background: '#0f172a', foreground: '#f8fafc',
      card: '#1e293b', 'card-foreground': '#f8fafc',
      popover: '#1e293b', 'popover-foreground': '#f8fafc',
      primary: '#f8fafc', 'primary-foreground': '#1e293b',
      secondary: '#1e293b', 'secondary-foreground': '#f8fafc',
      muted: '#334155', 'muted-foreground': '#94a3b8',
      accent: '#334155', 'accent-foreground': '#f8fafc',
      destructive: '#ef4444', 'destructive-foreground': '#f8fafc',
      border: '#334155', input: '#334155', ring: '#94a3b8',
    },
  },
  {
    id: 'ocean',
    name: 'Ocean',
    swatchColors: ['#0284c7', '#e0f2fe', '#f0f9ff'],
    fonts: { heading: "'Inter', sans-serif", body: "'Inter', sans-serif" },
    light: {
      background: '#f0f9ff', foreground: '#0c2340',
      card: '#ffffff', 'card-foreground': '#0c2340',
      popover: '#ffffff', 'popover-foreground': '#0c2340',
      primary: '#0284c7', 'primary-foreground': '#ffffff',
      secondary: '#e0f2fe', 'secondary-foreground': '#0c2340',
      muted: '#e0f2fe', 'muted-foreground': '#0369a1',
      accent: '#bae6fd', 'accent-foreground': '#0c2340',
      destructive: '#ef4444', 'destructive-foreground': '#ffffff',
      border: '#bae6fd', input: '#bae6fd', ring: '#0284c7',
    },
    dark: {
      background: '#082032', foreground: '#e0f2fe',
      card: '#0c2d48', 'card-foreground': '#e0f2fe',
      popover: '#0c2d48', 'popover-foreground': '#e0f2fe',
      primary: '#38bdf8', 'primary-foreground': '#082032',
      secondary: '#0c3a5c', 'secondary-foreground': '#e0f2fe',
      muted: '#0c3a5c', 'muted-foreground': '#7dd3fc',
      accent: '#0c3a5c', 'accent-foreground': '#e0f2fe',
      destructive: '#ef4444', 'destructive-foreground': '#ffffff',
      border: '#1d4f72', input: '#1d4f72', ring: '#38bdf8',
    },
  },
  {
    id: 'forest',
    name: 'Forest',
    swatchColors: ['#16a34a', '#dcfce7', '#f0fdf4'],
    fonts: { heading: "'DM Sans', sans-serif", body: "'DM Sans', sans-serif" },
    light: {
      background: '#f0fdf4', foreground: '#052e16',
      card: '#ffffff', 'card-foreground': '#052e16',
      popover: '#ffffff', 'popover-foreground': '#052e16',
      primary: '#16a34a', 'primary-foreground': '#ffffff',
      secondary: '#dcfce7', 'secondary-foreground': '#052e16',
      muted: '#dcfce7', 'muted-foreground': '#15803d',
      accent: '#bbf7d0', 'accent-foreground': '#052e16',
      destructive: '#ef4444', 'destructive-foreground': '#ffffff',
      border: '#bbf7d0', input: '#bbf7d0', ring: '#16a34a',
    },
    dark: {
      background: '#052e16', foreground: '#dcfce7',
      card: '#14532d', 'card-foreground': '#dcfce7',
      popover: '#14532d', 'popover-foreground': '#dcfce7',
      primary: '#16a34a', 'primary-foreground': '#ffffff',
      secondary: '#14532d', 'secondary-foreground': '#dcfce7',
      muted: '#166534', 'muted-foreground': '#86efac',
      accent: '#166534', 'accent-foreground': '#dcfce7',
      destructive: '#f87171', 'destructive-foreground': '#1a1a1a',
      border: '#166534', input: '#166534', ring: '#16a34a',
    },
  },
  {
    id: 'sunset',
    name: 'Sunset',
    swatchColors: ['#ea580c', '#fde68a', '#fffbeb'],
    fonts: { heading: "'Poppins', sans-serif", body: "'Poppins', sans-serif" },
    light: {
      background: '#fffbeb', foreground: '#431407',
      card: '#ffffff', 'card-foreground': '#431407',
      popover: '#ffffff', 'popover-foreground': '#431407',
      primary: '#ea580c', 'primary-foreground': '#ffffff',
      secondary: '#fff7ed', 'secondary-foreground': '#431407',
      muted: '#fed7aa', 'muted-foreground': '#9a3412',
      accent: '#fde68a', 'accent-foreground': '#431407',
      destructive: '#dc2626', 'destructive-foreground': '#ffffff',
      border: '#fed7aa', input: '#fed7aa', ring: '#ea580c',
    },
    dark: {
      background: '#1c0a00', foreground: '#fff7ed',
      card: '#2d1200', 'card-foreground': '#fff7ed',
      popover: '#2d1200', 'popover-foreground': '#fff7ed',
      primary: '#fb923c', 'primary-foreground': '#1c0a00',
      secondary: '#2d1200', 'secondary-foreground': '#fff7ed',
      muted: '#431407', 'muted-foreground': '#fdba74',
      accent: '#431407', 'accent-foreground': '#fff7ed',
      destructive: '#ef4444', 'destructive-foreground': '#fff7ed',
      border: '#431407', input: '#431407', ring: '#fb923c',
    },
  },
  {
    id: 'midnight',
    name: 'Midnight',
    swatchColors: ['#7c3aed', '#ddd6fe', '#faf5ff'],
    fonts: { heading: "'Space Grotesk', sans-serif", body: "'Space Grotesk', sans-serif" },
    light: {
      background: '#faf5ff', foreground: '#3b0764',
      card: '#ffffff', 'card-foreground': '#3b0764',
      popover: '#ffffff', 'popover-foreground': '#3b0764',
      primary: '#7c3aed', 'primary-foreground': '#ffffff',
      secondary: '#ede9fe', 'secondary-foreground': '#3b0764',
      muted: '#ede9fe', 'muted-foreground': '#6d28d9',
      accent: '#ddd6fe', 'accent-foreground': '#3b0764',
      destructive: '#ef4444', 'destructive-foreground': '#ffffff',
      border: '#ddd6fe', input: '#ddd6fe', ring: '#7c3aed',
    },
    dark: {
      background: '#0f0720', foreground: '#ede9fe',
      card: '#1a0a38', 'card-foreground': '#ede9fe',
      popover: '#1a0a38', 'popover-foreground': '#ede9fe',
      primary: '#a78bfa', 'primary-foreground': '#0f0720',
      secondary: '#1a0a38', 'secondary-foreground': '#ede9fe',
      muted: '#2d1b69', 'muted-foreground': '#c4b5fd',
      accent: '#2d1b69', 'accent-foreground': '#ede9fe',
      destructive: '#ef4444', 'destructive-foreground': '#ede9fe',
      border: '#2d1b69', input: '#2d1b69', ring: '#a78bfa',
    },
  },
];

/** Look up a preset by name (case-insensitive) or id. Returns null if no match. */
export function findThemePreset(query: string): ThemePreset | null {
  if (!query) return null;
  const lower = query.toLowerCase();
  return THEME_PRESETS.find(p => p.id === lower || p.name.toLowerCase() === lower) ?? null;
}
