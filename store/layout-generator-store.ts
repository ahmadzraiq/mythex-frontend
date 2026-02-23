/**
 * Store for AI-generated layout - when set, the main page renders it instead of the route config.
 * Persists generatedScreen, generatedStyle, generatedTheme to localStorage so theme survives refresh.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Palette } from '@/lib/ai/palette-schema';
import type { FontPairing } from '@/lib/ai/font-pairing-schema';

export type ConversationContext = {
  layout?: string;
  style?: string;
  mood?: string;
  designMood?: string;
  mode?: 'light' | 'dark' | 'both';
  colors?: Record<string, string>;
  fonts?: { heading?: string; body?: string };
  fontSizes?: string;
  step?: number;
};

export type NavbarConfig = Record<string, unknown>;

export const useLayoutGeneratorStore = create<{
  generatedScreen: Record<string, unknown> | null;
  generatedStyle: string | null;
  generatedTheme: Record<string, unknown> | null;
  navbar: NavbarConfig | null;
  conversationContext: ConversationContext;
  paletteOptions: Palette[] | null;
  selectedPalette: Palette | null;
  fontPairingOptions: FontPairing[] | null;
  selectedFontPairing: FontPairing | null;
  selectedSections: string[];
  sectionVariants: Record<string, string>;
  paletteLoading: boolean;
  fontPairingLoading: boolean;
  setSectionVariants: (v: Record<string, string> | ((prev: Record<string, string>) => Record<string, string>)) => void;
  setGeneratedScreen: (screen: Record<string, unknown> | null) => void;
  setGeneratedStyle: (style: string | null) => void;
  setGeneratedTheme: (theme: Record<string, unknown> | null) => void;
  setGenerated: (
    screen: Record<string, unknown> | null,
    style: string | null,
    theme?: Record<string, unknown> | null
  ) => void;
  setNavbar: (config: NavbarConfig | null) => void;
  setConversationContext: (ctx: ConversationContext | ((prev: ConversationContext) => ConversationContext)) => void;
  setPaletteOptions: (palettes: Palette[] | null) => void;
  setSelectedPalette: (palette: Palette | null) => void;
  setFontPairingOptions: (pairings: FontPairing[] | null) => void;
  setSelectedFontPairing: (pairing: FontPairing | null) => void;
  setSelectedSections: (sections: string[]) => void;
  setPaletteLoading: (loading: boolean) => void;
  setFontPairingLoading: (loading: boolean) => void;
  resetConversation: () => void;
}>(
  persist(
    (set) => ({
  generatedScreen: null,
  generatedStyle: null,
  generatedTheme: null,
  navbar: null,
  conversationContext: {},
  paletteOptions: null,
  selectedPalette: null,
  fontPairingOptions: null,
  selectedFontPairing: null,
  selectedSections: ['navbar', 'hero', 'product-grid', 'feature-grid', 'footer'],
  sectionVariants: {},
  paletteLoading: false,
  fontPairingLoading: false,
  setSectionVariants: (v) =>
    set((s) => ({
      sectionVariants: typeof v === 'function' ? v(s.sectionVariants) : v,
    })),
  setGeneratedScreen: (screen) => set({ generatedScreen: screen }),
  setGeneratedStyle: (style) => set({ generatedStyle: style }),
  setGeneratedTheme: (theme) => set({ generatedTheme: theme }),
  setGenerated: (screen, style, theme = null) =>
    set({
      generatedScreen: screen,
      generatedStyle: style,
      generatedTheme: theme ?? null,
      navbar: null,
    }),
  setNavbar: (config) => set({ navbar: config }),
  setConversationContext: (ctx) =>
    set((s) => ({
      conversationContext: typeof ctx === 'function' ? ctx(s.conversationContext) : ctx,
    })),
  setPaletteOptions: (palettes) => set({ paletteOptions: palettes }),
  setSelectedPalette: (palette) => set({ selectedPalette: palette }),
  setFontPairingOptions: (pairings) => set({ fontPairingOptions: pairings }),
  setSelectedFontPairing: (pairing) => set({ selectedFontPairing: pairing }),
  setSelectedSections: (sections) => set({ selectedSections: sections }),
  setPaletteLoading: (loading) => set({ paletteLoading: loading }),
  setFontPairingLoading: (loading) => set({ fontPairingLoading: loading }),
  resetConversation: () =>
    set({
      conversationContext: {},
      paletteOptions: null,
      selectedPalette: null,
      fontPairingOptions: null,
      selectedFontPairing: null,
      selectedSections: ['navbar', 'hero', 'product-grid', 'feature-grid', 'footer'],
      sectionVariants: {},
    }),
}),
    {
      name: 'layout-generator',
      partialize: (s) => ({
        generatedScreen: s.generatedScreen,
        generatedStyle: s.generatedStyle,
        generatedTheme: s.generatedTheme,
      }),
    }
  )
);
