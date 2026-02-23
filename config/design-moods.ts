/**
 * Design mood options for the layout generator.
 * Each mood guides AI palette, font, and variant selection.
 */

export type DesignMood = {
  id: string;
  label: string;
  description: string;
};

export const DESIGN_MOODS: DesignMood[] = [
  {
    id: 'artistic',
    label: 'Artistic & Creative',
    description: 'Expressive, imaginative design that celebrates creativity and artistic vision.',
  },
  {
    id: 'bold',
    label: 'Bold & Vibrant',
    description: 'High-energy, attention-grabbing design with aggressive use of color and dynamic layouts.',
  },
  {
    id: 'brutalist',
    label: 'Brutalist',
    description: 'Raw, bold design emphasizing function over form with stark, uncompromising aesthetics.',
  },
  {
    id: 'glassmorphism',
    label: 'Glassmorphism',
    description: 'Translucent, glass-like design with blur effects and layered transparency.',
  },
  {
    id: 'industrial',
    label: 'Industrial',
    description: 'Raw, functional design inspired by industrial machinery and utilitarian aesthetics.',
  },
  {
    id: 'luxury',
    label: 'Luxury & Elegant',
    description: 'Sophisticated, premium aesthetic with refined details and spacious layouts.',
  },
  {
    id: 'minimalist',
    label: 'Minimalist',
    description: 'Clean, simple, focused on essential elements with maximum impact through restraint.',
  },
  {
    id: 'neumorphism',
    label: 'Neumorphism',
    description: 'Soft, tactile design with subtle shadows and highlights creating embossed effects.',
  },
  {
    id: 'organic',
    label: 'Organic & Natural',
    description: 'Earth-inspired design reflecting nature, sustainability, and organic harmony.',
  },
  {
    id: 'playful',
    label: 'Playful & Energetic',
    description: 'Fun, bouncy design with rounded elements and cheerful interactions.',
  },
  {
    id: 'professional',
    label: 'Professional & Trustworthy',
    description: 'Reliable, credible design that inspires confidence through consistent, polished aesthetics.',
  },
  {
    id: 'retro',
    label: 'Retro & Vintage',
    description: 'Nostalgic design celebrating past eras with authentic vintage aesthetics.',
  },
  {
    id: 'tech',
    label: 'Tech-Savvy & Futuristic',
    description: 'Cutting-edge design with glowing effects, dark themes, and sci-fi aesthetics.',
  },
  {
    id: 'traditional',
    label: 'Traditional & Conservative',
    description: 'Timeless, established design reflecting heritage, stability, and proven values.',
  },
  {
    id: 'whimsical',
    label: 'Whimsical',
    description: 'Playful, imaginative design full of delightful surprises and magical elements.',
  },
];
