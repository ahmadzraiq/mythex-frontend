'use client';

import { useState, useRef, useEffect } from 'react';
import { useLayoutGeneratorStore } from '@/store/layout-generator-store';
import { LayoutChatbotUI } from './LayoutChatbotUI';
import { DESIGN_MOODS } from '@/config/design-moods';

type Message = {
  id: string;
  role: 'user' | 'assistant';
  prompt?: string;
  success?: boolean;
  style?: string;
  error?: string;
  question?: string;
};

type ChatbotMode = 'guided' | 'custom';

const DEFAULT_SECTIONS = ['navbar', 'hero', 'product-grid', 'feature-grid', 'footer'];

export function LayoutChatbot() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [sectionVariantsLoading, setSectionVariantsLoading] = useState(false);
  const [chatbotMode, setChatbotMode] = useState<ChatbotMode>('guided');
  const [customSpec, setCustomSpec] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const setGenerated = useLayoutGeneratorStore((s) => s.setGenerated);
  const setConversationContext = useLayoutGeneratorStore((s) => s.setConversationContext);
  const resetConversation = useLayoutGeneratorStore((s) => s.resetConversation);
  const setPaletteOptions = useLayoutGeneratorStore((s) => s.setPaletteOptions);
  const setSelectedPalette = useLayoutGeneratorStore((s) => s.setSelectedPalette);
  const setFontPairingOptions = useLayoutGeneratorStore((s) => s.setFontPairingOptions);
  const setSelectedFontPairing = useLayoutGeneratorStore((s) => s.setSelectedFontPairing);
  const setSelectedSections = useLayoutGeneratorStore((s) => s.setSelectedSections);
  const setSectionVariants = useLayoutGeneratorStore((s) => s.setSectionVariants);
  const setPaletteLoading = useLayoutGeneratorStore((s) => s.setPaletteLoading);
  const setFontPairingLoading = useLayoutGeneratorStore((s) => s.setFontPairingLoading);

  const conversationContext = useLayoutGeneratorStore((s) => s.conversationContext);
  const paletteOptions = useLayoutGeneratorStore((s) => s.paletteOptions);
  const selectedPalette = useLayoutGeneratorStore((s) => s.selectedPalette);
  const fontPairingOptions = useLayoutGeneratorStore((s) => s.fontPairingOptions);
  const selectedFontPairing = useLayoutGeneratorStore((s) => s.selectedFontPairing);
  const selectedSections = useLayoutGeneratorStore((s) => s.selectedSections);
  const sectionVariants = useLayoutGeneratorStore((s) => s.sectionVariants);
  const paletteLoading = useLayoutGeneratorStore((s) => s.paletteLoading);
  const fontPairingLoading = useLayoutGeneratorStore((s) => s.fontPairingLoading);
  const hasGenerated = useLayoutGeneratorStore((s) => s.generatedScreen !== null);

  const step = conversationContext.step ?? 0;

  useEffect(() => {
    if (step === 2 && conversationContext.designMood && !paletteOptions && !paletteLoading) {
      setPaletteLoading(true);
      fetch('/api/generate-palettes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          designMood: conversationContext.designMood,
          mode: conversationContext.mode ?? 'both',
        }),
      })
        .then((r) => r.json())
        .then((data) => {
          if (data.palettes) setPaletteOptions(data.palettes);
        })
        .catch(() => setPaletteOptions(null))
        .finally(() => setPaletteLoading(false));
    }
  }, [step, conversationContext.designMood, conversationContext.mode, paletteOptions, paletteLoading, setPaletteOptions, setPaletteLoading]);

  useEffect(() => {
    if (step === 3 && conversationContext.designMood && !fontPairingOptions && !fontPairingLoading) {
      setFontPairingLoading(true);
      fetch('/api/generate-font-pairings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ designMood: conversationContext.designMood }),
      })
        .then((r) => r.json())
        .then((data) => {
          if (data.pairings) setFontPairingOptions(data.pairings);
        })
        .catch(() => setFontPairingOptions(null))
        .finally(() => setFontPairingLoading(false));
    }
  }, [step, conversationContext.designMood, fontPairingOptions, fontPairingLoading, setFontPairingOptions, setFontPairingLoading]);

  const handleDesignMoodSelect = (id: string) => {
    const mood = DESIGN_MOODS.find((m) => m.id === id);
    setMessages((m) => [...m, { id: crypto.randomUUID(), role: 'user', prompt: mood?.label ?? id }]);
    setConversationContext((prev) => ({ ...prev, designMood: id, step: 1 }));
  };

  const handleModeSelect = (mode: 'light' | 'dark' | 'both') => {
    setMessages((m) => [...m, { id: crypto.randomUUID(), role: 'user', prompt: mode }]);
    setConversationContext((prev) => ({ ...prev, mode, step: 2 }));
  };

  const handlePaletteSelect = (palette: typeof selectedPalette) => {
    if (!palette) return;
    setSelectedPalette(palette);
    setConversationContext((prev) => ({ ...prev, step: 3 }));
  };

  const handlePaletteRegenerate = async () => {
    if (!conversationContext.designMood) return;
    setPaletteLoading(true);
    setPaletteOptions(null);
    try {
      const res = await fetch('/api/generate-palettes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          designMood: conversationContext.designMood,
          mode: conversationContext.mode ?? 'both',
        }),
      });
      const data = await res.json();
      if (data.palettes) setPaletteOptions(data.palettes);
    } finally {
      setPaletteLoading(false);
    }
  };

  const handleFontPairingSelect = (pairing: typeof selectedFontPairing) => {
    if (!pairing) return;
    setSelectedFontPairing(pairing);
    setConversationContext((prev) => ({ ...prev, step: 4 }));
  };

  const handleFontPairingRegenerate = async () => {
    if (!conversationContext.designMood) return;
    setFontPairingLoading(true);
    setFontPairingOptions(null);
    try {
      const res = await fetch('/api/generate-font-pairings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ designMood: conversationContext.designMood }),
      });
      const data = await res.json();
      if (data.pairings) setFontPairingOptions(data.pairings);
    } finally {
      setFontPairingLoading(false);
    }
  };

  const handleSectionToggle = (id: string, checked: boolean) => {
    const base = ['navbar', 'footer'];
    const optional = ['hero', 'product-grid', 'product-carousel', 'feature-grid'];
    let content = checked
      ? [...new Set([...selectedSections.filter((s) => optional.includes(s)), id])]
      : selectedSections.filter((s) => s !== id && optional.includes(s));
    const hasContent = optional.some((o) => content.includes(o));
    if (!hasContent) content = ['hero', 'feature-grid'];
    setSelectedSections([...base, ...content]);
  };

  const handleSectionVariantChange = (section: string, variant: string) => {
    setSectionVariants((prev) => ({ ...prev, [section]: variant }));
  };

  const handleAiSuggestVariants = async () => {
    if (!conversationContext.designMood) return;
    setSectionVariantsLoading(true);
    try {
      const res = await fetch('/api/generate-variant-suggestions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ designMood: conversationContext.designMood }),
      });
      const data = await res.json();
      if (data.suggestions) setSectionVariants(data.suggestions);
    } finally {
      setSectionVariantsLoading(false);
    }
  };

  const handleAdvanceToSummary = () => {
    setConversationContext((prev) => ({ ...prev, step: 5 }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const prompt = input.trim();
    if (prompt) setMessages((m) => [...m, { id: crypto.randomUUID(), role: 'user', prompt }]);
    setConversationContext((prev) => ({ ...prev, step: 5 }));
  };

  const handleGenerate = async () => {
    if (!selectedPalette || !selectedFontPairing) return;
    setLoading(true);

    try {
      const sections = selectedSections.length > 0 ? selectedSections : DEFAULT_SECTIONS;
      const res = await fetch('/api/generate-layout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: input.trim() || 'Generate an e-commerce homepage.',
          fullBuildContext: {
            selectedSections: sections,
            sectionVariants: Object.keys(sectionVariants).length ? sectionVariants : undefined,
            designMood: conversationContext.designMood,
            mode: conversationContext.mode ?? 'both',
            selectedPalette,
            selectedFontPairing,
          },
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        setMessages((m) => [
          ...m,
          { id: crypto.randomUUID(), role: 'assistant', error: data.error ?? 'Failed to generate' },
        ]);
        return;
      }

      setGenerated(data.screen, data.style ?? null, data.theme ?? null);
      setMessages((m) => [
        ...m,
        { id: crypto.randomUUID(), role: 'assistant', success: true, style: data.style },
      ]);
    } catch (err) {
      setMessages((m) => [
        ...m,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          error: err instanceof Error ? err.message : 'Something went wrong',
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateCustom = async () => {
    if (!customSpec.trim()) return;
    setLoading(true);
    setMessages((m) => [...m, { id: crypto.randomUUID(), role: 'user', prompt: customSpec.trim() }]);

    try {
      const res = await fetch('/api/generate-page', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: customSpec.trim(),
          palette: selectedPalette ?? undefined,
          fontPairing: selectedFontPairing ?? undefined,
          pageName: 'home',
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        setMessages((m) => [
          ...m,
          { id: crypto.randomUUID(), role: 'assistant', error: data.error ?? 'Failed to generate' },
        ]);
        return;
      }

      setGenerated(data.screen, data.style ?? null, data.theme ?? null);
      setMessages((m) => [
        ...m,
        { id: crypto.randomUUID(), role: 'assistant', success: true, style: data.style },
      ]);
    } catch (err) {
      setMessages((m) => [
        ...m,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          error: err instanceof Error ? err.message : 'Something went wrong',
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleClear = () => {
    setGenerated(null, null, null);
    resetConversation();
    setMessages([]);
    setInput('');
    setCustomSpec('');
  };

  return (
    <LayoutChatbotUI
      open={open}
      setOpen={setOpen}
      messages={messages}
      input={input}
      setInput={setInput}
      loading={loading}
      hasGenerated={hasGenerated}
      step={step}
      context={conversationContext}
      paletteOptions={paletteOptions}
      selectedPalette={selectedPalette}
      fontPairingOptions={fontPairingOptions}
      selectedFontPairing={selectedFontPairing}
      selectedSections={selectedSections}
      sectionVariants={sectionVariants}
      sectionVariantsLoading={sectionVariantsLoading}
      paletteLoading={paletteLoading}
      fontPairingLoading={fontPairingLoading}
      chatbotMode={chatbotMode}
      setChatbotMode={setChatbotMode}
      customSpec={customSpec}
      setCustomSpec={setCustomSpec}
      onClear={handleClear}
      onSubmit={handleSubmit}
      onDesignMoodSelect={handleDesignMoodSelect}
      onModeSelect={handleModeSelect}
      onPaletteSelect={handlePaletteSelect}
      onPaletteRegenerate={handlePaletteRegenerate}
      onFontPairingSelect={handleFontPairingSelect}
      onFontPairingRegenerate={handleFontPairingRegenerate}
      onSectionToggle={handleSectionToggle}
      onSectionVariantChange={handleSectionVariantChange}
      onAiSuggestVariants={handleAiSuggestVariants}
      onAdvanceToSummary={handleAdvanceToSummary}
      onGenerate={handleGenerate}
      onGenerateCustom={handleGenerateCustom}
      messagesEndRef={messagesEndRef}
    />
  );
}
