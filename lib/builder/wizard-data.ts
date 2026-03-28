/**
 * Static data for the AI Project Creation Wizard.
 * All data is hardcoded — AI generation comes in a later phase.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface BusinessCategory {
  id: string;
  label: string;
  description: string;
}

export interface DesignMood {
  id: string;
  label: string;
  description: string;
}

export interface ColorPalette {
  name: string;
  description: string;
  primary: string;
  secondary: string;
  accent: string;
  bg: string;
  textPrimary: string;
  textSecondary: string;
  /** Optional explicit dark-mode variant. If absent, use deriveDarkPalette(). */
  dark?: {
    bg: string;
    primary?: string;
    secondary?: string;
    accent?: string;
    textPrimary: string;
    textSecondary: string;
  };
}

export interface FontPair {
  id: string;
  headingFont: string;
  bodyFont: string;
  headingStyle?: string;
}

export interface SuggestedPage {
  id: string;
  name: string;
  route: string;
  sections: string[];
  required?: boolean;
}

// ── Business categories ───────────────────────────────────────────────────────

export const BUSINESS_CATEGORIES: BusinessCategory[] = [
  { id: 'automotive', label: 'Automotive', description: 'Car dealerships, auto services, automotive brands, vehicle sales' },
  { id: 'beauty-cosmetics', label: 'Beauty & Cosmetics', description: 'Beauty brands, cosmetics companies, skincare, beauty services' },
  { id: 'corporate-enterprise', label: 'Corporate Enterprise', description: 'Large corporations, consulting firms, professional services' },
  { id: 'creative-agency', label: 'Creative Agency', description: 'Design studios, advertising agencies, creative collectives' },
  { id: 'education', label: 'Education', description: 'Schools, universities, online courses, educational platforms' },
  { id: 'entertainment', label: 'Entertainment', description: 'Gaming, streaming, events, entertainment venues' },
  { id: 'fashion-ecommerce', label: 'Fashion E-commerce', description: 'Clothing brands, fashion retailers, luxury goods' },
  { id: 'finance', label: 'Finance', description: 'Banks, investment firms, insurance, financial services' },
  { id: 'fitness-wellness', label: 'Fitness & Wellness', description: 'Gyms, yoga studios, wellness centers, fitness apps' },
  { id: 'general-ecommerce', label: 'General E-commerce', description: 'Multi-category stores, marketplaces, general retail' },
  { id: 'healthcare', label: 'Healthcare', description: 'Hospitals, clinics, medical practices, health services' },
  { id: 'legal-services', label: 'Legal Services', description: 'Law firms, legal consultancies, attorneys, legal advice platforms' },
  { id: 'manufacturing', label: 'Manufacturing & Industrial', description: 'Manufacturing companies, industrial services, B2B suppliers' },
  { id: 'news-media', label: 'News & Media', description: 'News outlets, magazines, media companies, journalism platforms' },
  { id: 'non-profit', label: 'Non-Profit', description: 'Charities, NGOs, social causes, community organizations' },
  { id: 'personal-portfolio', label: 'Personal Portfolio', description: 'Individual portfolios, personal brands, freelancers' },
  { id: 'real-estate', label: 'Real Estate', description: 'Property listings, real estate agencies, property management' },
  { id: 'restaurant', label: 'Restaurant', description: 'Restaurants, cafes, food delivery, culinary experiences' },
  { id: 'saas', label: 'SaaS Product', description: 'Software as a service, apps, productivity tools' },
  { id: 'tech-startup', label: 'Tech Startup', description: 'Modern tech companies, SaaS platforms, innovative solutions' },
  { id: 'travel-tourism', label: 'Travel & Tourism', description: 'Travel agencies, hotels, tourism boards, booking platforms' },
];

// ── Design moods ──────────────────────────────────────────────────────────────

export const DESIGN_MOODS: DesignMood[] = [
  { id: 'artistic', label: 'Artistic & Creative', description: 'Expressive, imaginative design that celebrates creativity and artistic vision' },
  { id: 'bold', label: 'Bold & Vibrant', description: 'High-energy, attention-grabbing design with aggressive use of color and dynamic layouts' },
  { id: 'brutalist', label: 'Brutalist', description: 'Raw, bold design emphasizing function over form with stark, uncompromising aesthetics' },
  { id: 'glassmorphism', label: 'Glassmorphism', description: 'Translucent, glass-like design with blur effects and layered transparency' },
  { id: 'industrial', label: 'Industrial', description: 'Raw, functional design inspired by industrial machinery and utilitarian aesthetics' },
  { id: 'luxury', label: 'Luxury & Elegant', description: 'Sophisticated, premium aesthetic with refined details and spacious layouts' },
  { id: 'minimalist', label: 'Minimalist', description: 'Clean, simple, focused on essential elements with maximum impact through restraint' },
  { id: 'neumorphism', label: 'Neumorphism', description: 'Soft, tactile design with subtle shadows and highlights creating embossed effects' },
  { id: 'organic', label: 'Organic & Natural', description: 'Earth-inspired design reflecting nature, sustainability, and organic harmony' },
  { id: 'playful', label: 'Playful & Energetic', description: 'Fun, bouncy design with rounded elements and cheerful interactions' },
  { id: 'professional', label: 'Professional & Trustworthy', description: 'Reliable, credible design that inspires confidence through consistent, polished aesthetics' },
  { id: 'retro', label: 'Retro & Vintage', description: 'Nostalgic design celebrating past eras with authentic vintage aesthetics' },
  { id: 'tech-futuristic', label: 'Tech-Savvy & Futuristic', description: 'Cutting-edge design with glowing effects, dark themes, and sci-fi aesthetics' },
  { id: 'traditional', label: 'Traditional & Conservative', description: 'Timeless, established design reflecting heritage, stability, and proven values' },
  { id: 'whimsical', label: 'Whimsical', description: 'Playful, imaginative design full of delightful surprises and magical elements' },
];

// ── Color palettes (4 per mood) ───────────────────────────────────────────────

export const COLOR_PALETTES: Record<string, ColorPalette[]> = {
  organic: [
    { name: 'Forest Sage', description: 'Calm, sustainable, and rooted — evokes shaded gardens and mature plantings', primary: '#4a7c59', secondary: '#8fbc8f', accent: '#d4a84b', bg: '#ffffff', textPrimary: '#1a2e1a', textSecondary: '#4a5a4a' },
    { name: 'Terracotta Olive', description: 'Warm, earthy, and approachable — balances built elements with living landscapes', primary: '#c4622d', secondary: '#8b956d', accent: '#e8a87c', bg: '#fdf6f0', textPrimary: '#2d1a0f', textSecondary: '#6b4f3a' },
    { name: 'Coastal Sand', description: 'Airy, grounded, and trustworthy — inspired by shoreline stone and cultivated greens', primary: '#6b8f71', secondary: '#a8c5a0', accent: '#d4b896', bg: '#f8f5f0', textPrimary: '#2a3428', textSecondary: '#5a6b58' },
    { name: 'Stone Chestnut', description: 'Elegant, stable, and refined — stone neutrals with warm wood-like accents for premium appeal', primary: '#8b7355', secondary: '#c4b49a', accent: '#6b8e6b', bg: '#f9f7f4', textPrimary: '#2c2316', textSecondary: '#6b5e4e' },
  ],
  minimalist: [
    { name: 'Pure White', description: 'Crisp, clean, and timeless — lets content breathe with maximum whitespace', primary: '#1a1a1a', secondary: '#666666', accent: '#0066cc', bg: '#ffffff', textPrimary: '#111111', textSecondary: '#555555' },
    { name: 'Soft Ash', description: 'Warm neutral tones with gentle contrast — approachable yet refined', primary: '#3d3d3d', secondary: '#9a9a9a', accent: '#5b8dd9', bg: '#fafafa', textPrimary: '#1c1c1c', textSecondary: '#6b6b6b' },
    { name: 'Ivory Calm', description: 'Warm off-whites with a single bold accent — elegant and restrained', primary: '#2c2c2c', secondary: '#8c8c8c', accent: '#c9a96e', bg: '#fdfcf9', textPrimary: '#1a1a1a', textSecondary: '#6a6055' },
    { name: 'Slate Cool', description: 'Cool grays with blue undertones — modern, precise, and professional', primary: '#2d3748', secondary: '#718096', accent: '#4299e1', bg: '#f7f8fa', textPrimary: '#1a202c', textSecondary: '#4a5568' },
  ],
  luxury: [
    { name: 'Midnight Gold', description: 'Deep, opulent, and prestigious — dark backgrounds with warm gold accents', primary: '#c9a84c', secondary: '#e8d5a3', accent: '#b8860b', bg: '#0a0a0a', textPrimary: '#f5f0e8', textSecondary: '#a89070' },
    { name: 'Champagne Rose', description: 'Soft, feminine luxury — blush tones with metallic rose gold highlights', primary: '#c4a882', secondary: '#e8d5c4', accent: '#b5838d', bg: '#fdf9f5', textPrimary: '#2c1810', textSecondary: '#8b6b58' },
    { name: 'Deep Sapphire', description: 'Authoritative and refined — navy depths with silver and platinum accents', primary: '#1b3a6b', secondary: '#4a6fa5', accent: '#c0c0c0', bg: '#f8f9fb', textPrimary: '#0d1b2e', textSecondary: '#4a5a70' },
    { name: 'Emerald Obsidian', description: 'Bold, exclusive, and modern luxury — black with rich emerald and bronze', primary: '#2d6a4f', secondary: '#4a9e7a', accent: '#b8860b', bg: '#0c0c0c', textPrimary: '#e8f5e9', textSecondary: '#7a9e8a' },
  ],
  professional: [
    { name: 'Corporate Blue', description: 'Trustworthy, competent, and dependable — classic corporate identity palette', primary: '#1a56db', secondary: '#3b82f6', accent: '#059669', bg: '#ffffff', textPrimary: '#111928', textSecondary: '#4b5563' },
    { name: 'Navy Slate', description: 'Authoritative and modern — deep navy with clean slate accents', primary: '#1e3a5f', secondary: '#3d5a80', accent: '#e07b39', bg: '#f8f9fa', textPrimary: '#0d1b2e', textSecondary: '#4a5568' },
    { name: 'Steel Gray', description: 'Neutral, precise, and efficient — gray-led professional palette', primary: '#374151', secondary: '#6b7280', accent: '#2563eb', bg: '#ffffff', textPrimary: '#111827', textSecondary: '#4b5563' },
    { name: 'Teal Authority', description: 'Modern authority with warmth — teal and charcoal signal innovation and trust', primary: '#0d7377', secondary: '#14a8ab', accent: '#f97316', bg: '#f0fafa', textPrimary: '#0c2a2b', textSecondary: '#2d6e70' },
  ],
  bold: [
    { name: 'Electric Citrus', description: 'High-energy, punchy, and impossible to ignore — neon accents on deep base', primary: '#7c3aed', secondary: '#a855f7', accent: '#facc15', bg: '#0d0d0d', textPrimary: '#ffffff', textSecondary: '#c4b5fd' },
    { name: 'Coral Surge', description: 'Energetic, warm, and vibrant — bold coral with electric blue contrast', primary: '#f43f5e', secondary: '#fb7185', accent: '#06b6d4', bg: '#ffffff', textPrimary: '#0f172a', textSecondary: '#475569' },
    { name: 'Urban Neon', description: 'Street-smart and electric — neon greens and magentas on matte black', primary: '#16a34a', secondary: '#4ade80', accent: '#e879f9', bg: '#111111', textPrimary: '#f0fdf4', textSecondary: '#86efac' },
    { name: 'Sunset Blast', description: 'Warm, powerful, and celebratory — vibrant oranges and hot pinks', primary: '#ea580c', secondary: '#fb923c', accent: '#ec4899', bg: '#fff7ed', textPrimary: '#1c0700', textSecondary: '#7c3107' },
  ],
  playful: [
    { name: 'Candy Pop', description: 'Sweet, fun, and welcoming — bright pastels that feel friendly and approachable', primary: '#ec4899', secondary: '#f9a8d4', accent: '#818cf8', bg: '#fff0f7', textPrimary: '#1a0010', textSecondary: '#7c2d5a' },
    { name: 'Sunshine Bounce', description: 'Cheerful, optimistic, and energetic — yellow and orange bring perpetual summer', primary: '#f59e0b', secondary: '#fcd34d', accent: '#10b981', bg: '#fffbeb', textPrimary: '#1c1500', textSecondary: '#92400e' },
    { name: 'Rainbow Soft', description: 'Inclusive, joyful, and light — soft multicolor accents on a clean white base', primary: '#6366f1', secondary: '#a5b4fc', accent: '#34d399', bg: '#fafafa', textPrimary: '#1e1b4b', textSecondary: '#4338ca' },
    { name: 'Aqua Zest', description: 'Fresh, lively, and bubbly — aqua and lime bring youthful digital energy', primary: '#06b6d4', secondary: '#67e8f9', accent: '#84cc16', bg: '#f0fdff', textPrimary: '#0c2a2b', textSecondary: '#0e7490' },
  ],
  tech_futuristic: [
    { name: 'Cyber Matrix', description: 'Hacker-chic with terminal greens on pitch-black — iconic and immersive', primary: '#00ff41', secondary: '#00cc33', accent: '#00b4d8', bg: '#0a0a0a', textPrimary: '#e0ffe6', textSecondary: '#00cc33' },
    { name: 'Neon Pulse', description: 'Glowing blues and purples — the aesthetic of the near-future city at night', primary: '#818cf8', secondary: '#a5b4fc', accent: '#38bdf8', bg: '#0f0f1a', textPrimary: '#e0e7ff', textSecondary: '#a5b4fc' },
    { name: 'Aurora Dark', description: 'Dark space with aurora-inspired teal and violet gradients', primary: '#14b8a6', secondary: '#5eead4', accent: '#c084fc', bg: '#030712', textPrimary: '#f0fdfa', textSecondary: '#5eead4' },
    { name: 'Plasma Drive', description: 'Hot magenta and electric cyan — aggressive and cutting-edge tech vibes', primary: '#e879f9', secondary: '#f0abfc', accent: '#22d3ee', bg: '#0c0011', textPrimary: '#fdf4ff', textSecondary: '#d946ef' },
  ],
  retro: [
    { name: 'Sunset Diner', description: '70s warmth — burnt oranges, harvest gold, and avocado green', primary: '#c2410c', secondary: '#fb923c', accent: '#65a30d', bg: '#fef9f0', textPrimary: '#1c0a00', textSecondary: '#7c3420' },
    { name: 'Neon Arcade', description: '80s nostalgia — hot pink and electric teal on dark backgrounds', primary: '#db2777', secondary: '#f472b6', accent: '#06b6d4', bg: '#0f0f0f', textPrimary: '#fdf2f8', textSecondary: '#ec4899' },
    { name: 'Groovy Sage', description: 'Late 60s peace — muted earth tones and dusty bohemian shades', primary: '#6b7c5a', secondary: '#a0b08a', accent: '#c4a35a', bg: '#f5f0e6', textPrimary: '#1e2018', textSecondary: '#5c6b4d' },
    { name: 'Bauhaus Primary', description: 'Mid-century modernist — pure red, blue, yellow on white geometry', primary: '#dc2626', secondary: '#2563eb', accent: '#ca8a04', bg: '#ffffff', textPrimary: '#0c0c0c', textSecondary: '#374151' },
  ],
  artistic: [
    { name: 'Gallery White', description: 'Museum-quality space — pure white lets artwork and design breathe', primary: '#111111', secondary: '#555555', accent: '#e63946', bg: '#ffffff', textPrimary: '#0a0a0a', textSecondary: '#444444' },
    { name: 'Ink & Watercolor', description: 'Expressive and fluid — deep ink with delicate watercolor accents', primary: '#1a1a2e', secondary: '#16213e', accent: '#e94560', bg: '#f7f3ee', textPrimary: '#0a0a1a', textSecondary: '#444466' },
    { name: 'Prism Studio', description: 'Bold, chromatic, and expressive — vibrant spectrum for creative brands', primary: '#7c3aed', secondary: '#c026d3', accent: '#0891b2', bg: '#0a0a0a', textPrimary: '#fafafa', textSecondary: '#c4b5fd' },
    { name: 'Linen Sketch', description: 'Warm, textured, and handcrafted — natural linen tones with charcoal accents', primary: '#4a3728', secondary: '#8b7355', accent: '#c4722a', bg: '#f9f4ed', textPrimary: '#1a0e07', textSecondary: '#6b4e38' },
  ],
  glassmorphism: [
    { name: 'Frosted Sky', description: 'Clear, airy, and modern — blue-tinted glass layers with depth and translucency', primary: '#3b82f6', secondary: '#93c5fd', accent: '#8b5cf6', bg: 'linear-gradient(135deg, #dbeafe 0%, #ede9fe 100%)', textPrimary: '#1e3a5f', textSecondary: '#3b4f6b' },
    { name: 'Aurora Glass', description: 'Magical translucent layers — aurora gradients seen through frosted glass', primary: '#8b5cf6', secondary: '#a78bfa', accent: '#06b6d4', bg: 'linear-gradient(135deg, #f0e6ff 0%, #e0f7fa 100%)', textPrimary: '#2d1b69', textSecondary: '#5b4a8a' },
    { name: 'Midnight Frost', description: 'Dark glass panels with luminous glow — sleek and premium', primary: '#6366f1', secondary: '#818cf8', accent: '#22d3ee', bg: '#0f1117', textPrimary: '#e0e7ff', textSecondary: '#a5b4fc' },
    { name: 'Rose Glass', description: 'Warm, soft, and feminine — blush-tinted glass with delicate gold reflections', primary: '#f43f5e', secondary: '#fda4af', accent: '#f59e0b', bg: 'linear-gradient(135deg, #fff1f2 0%, #fff7ed 100%)', textPrimary: '#4c0519', textSecondary: '#9f1239' },
  ],
  industrial: [
    { name: 'Raw Steel', description: 'Functional, honest, raw — exposed metal tones and factory aesthetics', primary: '#374151', secondary: '#6b7280', accent: '#f59e0b', bg: '#111111', textPrimary: '#f3f4f6', textSecondary: '#9ca3af' },
    { name: 'Oxidized Copper', description: 'Aged, patinated, and authentic — rust and verdigris industrial palette', primary: '#b45309', secondary: '#d97706', accent: '#0d9488', bg: '#1c1208', textPrimary: '#fef3c7', textSecondary: '#d97706' },
    { name: 'Concrete Block', description: 'Brutalist utility — raw concrete grays with a single punch of color', primary: '#4b5563', secondary: '#9ca3af', accent: '#ef4444', bg: '#f3f4f6', textPrimary: '#111827', textSecondary: '#374151' },
    { name: 'Machine Blue', description: 'Industrial utility meets precision engineering — deep navy with signal colors', primary: '#1e3a5f', secondary: '#2d4e7e', accent: '#f59e0b', bg: '#0a0e14', textPrimary: '#dbeafe', textSecondary: '#60a5fa' },
  ],
  traditional: [
    { name: 'Classic Navy', description: 'Enduring, authoritative, and familiar — traditional business in its finest form', primary: '#1e3a5f', secondary: '#2d5a8e', accent: '#c9a84c', bg: '#ffffff', textPrimary: '#0d1b2e', textSecondary: '#4a5a70' },
    { name: 'Heritage Green', description: 'Established, trustworthy, and enduring — classic British heritage palette', primary: '#2d5016', secondary: '#4a7c2a', accent: '#c9a84c', bg: '#fafaf5', textPrimary: '#0a1a05', textSecondary: '#3d5a20' },
    { name: 'Burgundy Cream', description: 'Formal, distinguished, and rich — deep burgundy with warm cream accents', primary: '#7f1d1d', secondary: '#b91c1c', accent: '#c9a84c', bg: '#fdf8f0', textPrimary: '#1c0a0a', textSecondary: '#6b2020' },
    { name: 'Oxford Gray', description: 'Reserved, cultivated, and precise — academic gray with considered warmth', primary: '#374151', secondary: '#6b7280', accent: '#1e3a5f', bg: '#f9fafb', textPrimary: '#111827', textSecondary: '#374151' },
  ],
  whimsical: [
    { name: 'Fairy Garden', description: 'Magical, enchanting, and dreamy — pastels and iridescence for wonder', primary: '#a855f7', secondary: '#c084fc', accent: '#34d399', bg: '#faf5ff', textPrimary: '#2e1065', textSecondary: '#7c3aed' },
    { name: 'Storybook', description: 'Warm, illustrated, and inviting — rich storybook colors with golden light', primary: '#d97706', secondary: '#fbbf24', accent: '#6d28d9', bg: '#fffbeb', textPrimary: '#1c1500', textSecondary: '#92400e' },
    { name: 'Bubblegum Dream', description: 'Sweet, light, and fantastical — pastel pinks and mints with pops of color', primary: '#ec4899', secondary: '#f9a8d4', accent: '#34d399', bg: '#fdf2f8', textPrimary: '#500724', textSecondary: '#9d174d' },
    { name: 'Cosmic Candy', description: 'Space magic — deep purples and starlight pinks for otherworldly delight', primary: '#7c3aed', secondary: '#a78bfa', accent: '#f472b6', bg: '#1a0533', textPrimary: '#faf5ff', textSecondary: '#c4b5fd' },
  ],
  brutalist: [
    { name: 'Black & White', description: 'Zero compromise — pure black on white with zero decoration', primary: '#000000', secondary: '#333333', accent: '#ffffff', bg: '#ffffff', textPrimary: '#000000', textSecondary: '#333333' },
    { name: 'Warning Zone', description: 'Industrial safety aesthetics — black, yellow, and hard angles', primary: '#1a1a1a', secondary: '#333333', accent: '#fbbf24', bg: '#f5f5f5', textPrimary: '#000000', textSecondary: '#1a1a1a' },
    { name: 'Concrete Red', description: 'Raw construction — concrete gray with assertive red structural elements', primary: '#dc2626', secondary: '#ef4444', accent: '#1a1a1a', bg: '#e5e5e5', textPrimary: '#0a0a0a', textSecondary: '#333333' },
    { name: 'Blueprint', description: 'Technical drawing aesthetic — classic blueprint blue with white lines', primary: '#1d4ed8', secondary: '#3b82f6', accent: '#ffffff', bg: '#1e3a8a', textPrimary: '#dbeafe', textSecondary: '#93c5fd' },
  ],
  neumorphism: [
    { name: 'Soft Clay', description: 'Tactile and satisfying — warm clay with soft embossed shadows', primary: '#4a7c59', secondary: '#6ba37e', accent: '#c4722a', bg: '#e0e5ec', textPrimary: '#2d3a2d', textSecondary: '#5a7060' },
    { name: 'Pebble Gray', description: 'Cool and precise — neutral grays with perfectly balanced shadows', primary: '#4b5563', secondary: '#6b7280', accent: '#3b82f6', bg: '#e8ecef', textPrimary: '#1f2937', textSecondary: '#4b5563' },
    { name: 'Peach Soft', description: 'Warm, inviting, and modern — peachy beige with delicate depth', primary: '#c4722a', secondary: '#e8956d', accent: '#6b5ce7', bg: '#f0e6dc', textPrimary: '#2c1810', textSecondary: '#7c4a30' },
    { name: 'Lavender Mist', description: 'Gentle, calming, and refined — soft lavender with ethereal depth', primary: '#6d28d9', secondary: '#8b5cf6', accent: '#ec4899', bg: '#e8e0f0', textPrimary: '#2e1065', textSecondary: '#5b21b6' },
  ],
};

// Fallback palettes for moods not explicitly defined above
export const DEFAULT_PALETTES: ColorPalette[] = [
  { name: 'Ocean Blue', description: 'Clean and trustworthy — classic blue palette for professional brands', primary: '#2563eb', secondary: '#60a5fa', accent: '#10b981', bg: '#ffffff', textPrimary: '#0f172a', textSecondary: '#475569' },
  { name: 'Slate Modern', description: 'Contemporary neutrals — works beautifully with any content', primary: '#334155', secondary: '#64748b', accent: '#6366f1', bg: '#f8fafc', textPrimary: '#0f172a', textSecondary: '#475569' },
  { name: 'Forest Fresh', description: 'Natural and grounded — earthy greens with warm contrast', primary: '#16a34a', secondary: '#4ade80', accent: '#f97316', bg: '#f0fdf4', textPrimary: '#14532d', textSecondary: '#166534' },
  { name: 'Purple Wave', description: 'Creative and innovative — deep purple with contemporary accents', primary: '#7c3aed', secondary: '#a78bfa', accent: '#ec4899', bg: '#faf5ff', textPrimary: '#2e1065', textSecondary: '#5b21b6' },
];

// ── Font pairings ─────────────────────────────────────────────────────────────

export const FONT_PAIRINGS: FontPair[] = [
  { id: 'playfair-lora', headingFont: 'Playfair Display', bodyFont: 'Lora', headingStyle: 'serif' },
  { id: 'comfortaa-nunito', headingFont: 'Comfortaa', bodyFont: 'Nunito', headingStyle: 'rounded' },
  { id: 'merriweather-roboto', headingFont: 'Merriweather', bodyFont: 'Roboto', headingStyle: 'serif' },
  { id: 'fraunces-inter', headingFont: 'Fraunces', bodyFont: 'Inter', headingStyle: 'serif' },
  { id: 'montserrat-open-sans', headingFont: 'Montserrat', bodyFont: 'Open Sans', headingStyle: 'sans' },
  { id: 'raleway-source-sans', headingFont: 'Raleway', bodyFont: 'Source Sans 3', headingStyle: 'sans' },
  { id: 'cormorant-crimson', headingFont: 'Cormorant Garamond', bodyFont: 'Crimson Text', headingStyle: 'serif' },
  { id: 'josefin-jost', headingFont: 'Josefin Sans', bodyFont: 'Jost', headingStyle: 'geometric' },
];

// ── Page templates per business category ─────────────────────────────────────

export const PAGE_TEMPLATES: Record<string, SuggestedPage[]> = {
  'real-estate': [
    { id: 'homepage', name: 'Homepage', route: '/', sections: ['Navigation', 'Hero — Property Search', 'Featured Listings', 'Why Choose Us', 'Neighborhood Guide', 'Testimonials', 'Footer'], required: false },
    { id: 'listings', name: 'Listings', route: '/listings', sections: ['Navigation', 'Search & Filters', 'Property Grid', 'Map View', 'Footer'] },
    { id: 'property-detail', name: 'Property Detail', route: '/property/:id', sections: ['Navigation', 'Image Gallery', 'Property Info & Price', 'Key Features', 'Agent Contact', 'Similar Properties', 'Footer'] },
    { id: 'about', name: 'About Us', route: '/about', sections: ['Navigation', 'Team Hero', 'Our Story', 'Meet The Team', 'Awards & Recognition', 'Footer'] },
    { id: 'contact', name: 'Contact', route: '/contact', sections: ['Navigation', 'Contact Form', 'Office Locations', 'Map', 'Footer'] },
  ],
  restaurant: [
    { id: 'homepage', name: 'Homepage', route: '/', sections: ['Navigation', 'Hero — Ambiance Shot', 'Featured Dishes', 'Our Story', 'Reservation CTA', 'Opening Hours', 'Footer'], required: false },
    { id: 'menu', name: 'Menu', route: '/menu', sections: ['Navigation', 'Menu Categories', 'Starters', 'Mains', 'Desserts', 'Drinks', 'Footer'] },
    { id: 'reservations', name: 'Reservations', route: '/reservations', sections: ['Navigation', 'Booking Form', 'Special Occasions', 'Policies', 'Footer'] },
    { id: 'about', name: 'About & Chef', route: '/about', sections: ['Navigation', 'Chef Story', 'Restaurant History', 'Philosophy', 'Press & Awards', 'Footer'] },
  ],
  'tech-startup': [
    { id: 'homepage', name: 'Homepage', route: '/', sections: ['Navigation', 'Hero — Product Showcase', 'Key Features', 'How It Works', 'Social Proof', 'Pricing Preview', 'Final CTA', 'Footer'], required: false },
    { id: 'features', name: 'Features', route: '/features', sections: ['Navigation', 'Features Hero', 'Feature Details', 'Comparison Table', 'Use Cases', 'Footer'] },
    { id: 'pricing', name: 'Pricing', route: '/pricing', sections: ['Navigation', 'Pricing Hero', 'Pricing Plans', 'Feature Comparison', 'FAQ', 'Footer'] },
    { id: 'about', name: 'About', route: '/about', sections: ['Navigation', 'Mission Statement', 'Team Grid', 'Investors & Partners', 'Open Positions', 'Footer'] },
    { id: 'blog', name: 'Blog', route: '/blog', sections: ['Navigation', 'Blog Hero', 'Featured Post', 'Post Grid', 'Newsletter Signup', 'Footer'] },
  ],
  saas: [
    { id: 'homepage', name: 'Homepage', route: '/', sections: ['Navigation', 'Hero — Dashboard Preview', 'Trusted By Logos', 'Core Features', 'Workflow Demo', 'Testimonials', 'Pricing CTA', 'Footer'], required: false },
    { id: 'features', name: 'Features', route: '/features', sections: ['Navigation', 'Features Overview', 'Deep Dive Sections', 'Integrations', 'Footer'] },
    { id: 'pricing', name: 'Pricing', route: '/pricing', sections: ['Navigation', 'Pricing Plans', 'Annual/Monthly Toggle', 'Feature Comparison', 'Enterprise CTA', 'FAQ', 'Footer'] },
    { id: 'docs', name: 'Docs / Help', route: '/docs', sections: ['Navigation', 'Search Bar', 'Getting Started', 'Popular Articles', 'Footer'] },
    { id: 'blog', name: 'Blog', route: '/blog', sections: ['Navigation', 'Featured Article', 'Article Grid', 'Categories', 'Footer'] },
  ],
  'personal-portfolio': [
    { id: 'homepage', name: 'Homepage', route: '/', sections: ['Navigation', 'Hero — Introduction', 'Featured Work', 'Skills & Stack', 'Experience Timeline', 'Contact CTA', 'Footer'], required: false },
    { id: 'work', name: 'Work', route: '/work', sections: ['Navigation', 'Portfolio Grid', 'Case Study Cards', 'Filter by Category', 'Footer'] },
    { id: 'about', name: 'About', route: '/about', sections: ['Navigation', 'Full Bio', 'Skills & Tools', 'Experience & Education', 'Download Resume', 'Footer'] },
    { id: 'contact', name: 'Contact', route: '/contact', sections: ['Navigation', 'Contact Form', 'Social Links', 'Availability Status', 'Footer'] },
  ],
  healthcare: [
    { id: 'homepage', name: 'Homepage', route: '/', sections: ['Navigation', 'Hero — Trust & Care', 'Services Overview', 'Why Choose Us', 'Doctor Profiles', 'Patient Testimonials', 'Book Appointment', 'Footer'], required: false },
    { id: 'services', name: 'Services', route: '/services', sections: ['Navigation', 'Services Hero', 'Service Cards', 'Treatment Details', 'Insurance Info', 'Footer'] },
    { id: 'doctors', name: 'Our Doctors', route: '/doctors', sections: ['Navigation', 'Team Hero', 'Doctor Grid', 'Specialties Filter', 'Footer'] },
    { id: 'appointments', name: 'Appointments', route: '/appointments', sections: ['Navigation', 'Booking Form', 'Available Slots', 'Location & Hours', 'Footer'] },
    { id: 'about', name: 'About', route: '/about', sections: ['Navigation', 'Our History', 'Mission & Values', 'Certifications', 'Community Impact', 'Footer'] },
  ],
  'creative-agency': [
    { id: 'homepage', name: 'Homepage', route: '/', sections: ['Navigation', 'Hero — Bold Statement', 'Selected Work', 'Services', 'Client Logos', 'Latest Projects', 'Footer'], required: false },
    { id: 'work', name: 'Work', route: '/work', sections: ['Navigation', 'Portfolio Masonry', 'Case Studies', 'Awards', 'Footer'] },
    { id: 'services', name: 'Services', route: '/services', sections: ['Navigation', 'Services Overview', 'Process', 'Deliverables', 'Pricing', 'Footer'] },
    { id: 'about', name: 'About', route: '/about', sections: ['Navigation', 'Studio Story', 'Team Grid', 'Culture & Values', 'Careers', 'Footer'] },
    { id: 'contact', name: 'Contact', route: '/contact', sections: ['Navigation', 'Project Inquiry Form', 'Studio Location', 'Social Links', 'Footer'] },
  ],
  'general-ecommerce': [
    { id: 'homepage', name: 'Homepage', route: '/', sections: ['Navigation', 'Hero Banner', 'Featured Categories', 'Best Sellers', 'Promotions', 'Customer Reviews', 'Footer'], required: false },
    { id: 'shop', name: 'Shop', route: '/shop', sections: ['Navigation', 'Filter Sidebar', 'Product Grid', 'Pagination', 'Footer'] },
    { id: 'product', name: 'Product Detail', route: '/product/:id', sections: ['Navigation', 'Product Images', 'Product Info & CTA', 'Description & Specs', 'Related Products', 'Footer'] },
    { id: 'cart', name: 'Cart', route: '/cart', sections: ['Navigation', 'Cart Items', 'Order Summary', 'Checkout CTA', 'Footer'] },
    { id: 'about', name: 'About', route: '/about', sections: ['Navigation', 'Brand Story', 'Values & Mission', 'Social Proof', 'Footer'] },
  ],
  education: [
    { id: 'homepage', name: 'Homepage', route: '/', sections: ['Navigation', 'Hero — Learning Journey', 'Featured Courses', 'Why Learn Here', 'Instructor Highlights', 'Student Outcomes', 'Footer'], required: false },
    { id: 'courses', name: 'Courses', route: '/courses', sections: ['Navigation', 'Course Search', 'Category Filter', 'Course Grid', 'Footer'] },
    { id: 'about', name: 'About', route: '/about', sections: ['Navigation', 'Mission & Vision', 'Accreditations', 'Faculty', 'Campus Life', 'Footer'] },
    { id: 'contact', name: 'Admissions', route: '/admissions', sections: ['Navigation', 'Application Form', 'Requirements', 'Important Dates', 'FAQ', 'Footer'] },
  ],
  finance: [
    { id: 'homepage', name: 'Homepage', route: '/', sections: ['Navigation', 'Hero — Financial Security', 'Our Services', 'Trust Indicators', 'Partner Logos', 'Client Success Stories', 'Footer'], required: false },
    { id: 'services', name: 'Services', route: '/services', sections: ['Navigation', 'Services Overview', 'Service Detail Cards', 'Process Steps', 'Footer'] },
    { id: 'about', name: 'About', route: '/about', sections: ['Navigation', 'Firm History', 'Leadership Team', 'Regulatory Info', 'Awards', 'Footer'] },
    { id: 'contact', name: 'Contact', route: '/contact', sections: ['Navigation', 'Contact Form', 'Offices Map', 'Hours', 'Footer'] },
  ],
  'fitness-wellness': [
    { id: 'homepage', name: 'Homepage', route: '/', sections: ['Navigation', 'Hero — Transformation', 'Programs Overview', 'Trainers', 'Member Success', 'Membership Plans', 'Footer'], required: false },
    { id: 'classes', name: 'Classes', route: '/classes', sections: ['Navigation', 'Class Schedule', 'Class Types', 'Book A Class', 'Footer'] },
    { id: 'trainers', name: 'Trainers', route: '/trainers', sections: ['Navigation', 'Trainers Grid', 'Specialties', 'Book Session', 'Footer'] },
    { id: 'pricing', name: 'Membership', route: '/membership', sections: ['Navigation', 'Plans Comparison', 'Included Features', 'FAQ', 'Join CTA', 'Footer'] },
  ],
  'non-profit': [
    { id: 'homepage', name: 'Homepage', route: '/', sections: ['Navigation', 'Hero — Impact Statement', 'Mission Overview', 'Impact Numbers', 'Featured Stories', 'Donate CTA', 'Footer'], required: false },
    { id: 'about', name: 'About', route: '/about', sections: ['Navigation', 'Our Story', 'Team', 'Partners', 'Annual Reports', 'Footer'] },
    { id: 'programs', name: 'Programs', route: '/programs', sections: ['Navigation', 'Programs Overview', 'Program Details', 'Impact Metrics', 'Footer'] },
    { id: 'donate', name: 'Donate', route: '/donate', sections: ['Navigation', 'Donation Form', 'Impact Breakdown', 'Other Ways to Give', 'Footer'] },
  ],
  'travel-tourism': [
    { id: 'homepage', name: 'Homepage', route: '/', sections: ['Navigation', 'Hero — Destination Showcase', 'Popular Destinations', 'Featured Packages', 'Why Travel With Us', 'Testimonials', 'Footer'], required: false },
    { id: 'destinations', name: 'Destinations', route: '/destinations', sections: ['Navigation', 'Destination Grid', 'Search & Filter', 'Featured Itineraries', 'Footer'] },
    { id: 'packages', name: 'Packages', route: '/packages', sections: ['Navigation', 'Package Cards', 'Dates & Pricing', 'What\'s Included', 'Book Now', 'Footer'] },
    { id: 'about', name: 'About', route: '/about', sections: ['Navigation', 'Our Story', 'Expert Team', 'Certifications', 'Footer'] },
  ],
  automotive: [
    { id: 'homepage', name: 'Homepage', route: '/', sections: ['Navigation', 'Hero — Vehicle Showcase', 'New Arrivals', 'Services', 'Why Choose Us', 'Testimonials', 'Footer'], required: false },
    { id: 'inventory', name: 'Inventory', route: '/inventory', sections: ['Navigation', 'Search & Filters', 'Vehicle Grid', 'Compare Tool', 'Footer'] },
    { id: 'services', name: 'Services', route: '/services', sections: ['Navigation', 'Service Menu', 'Book Service', 'Service Offers', 'Footer'] },
    { id: 'contact', name: 'Contact', route: '/contact', sections: ['Navigation', 'Contact Form', 'Dealership Map', 'Hours', 'Footer'] },
  ],
  'legal-services': [
    { id: 'homepage', name: 'Homepage', route: '/', sections: ['Navigation', 'Hero — Trust & Expertise', 'Practice Areas', 'Why Choose Us', 'Attorney Profiles', 'Client Results', 'Footer'], required: false },
    { id: 'practice-areas', name: 'Practice Areas', route: '/practice', sections: ['Navigation', 'Practice Areas Grid', 'Area Detail', 'Case Results', 'Footer'] },
    { id: 'attorneys', name: 'Attorneys', route: '/attorneys', sections: ['Navigation', 'Attorney Grid', 'Attorney Profile', 'Footer'] },
    { id: 'contact', name: 'Contact', route: '/contact', sections: ['Navigation', 'Consultation Form', 'Office Info', 'Footer'] },
  ],
  'beauty-cosmetics': [
    { id: 'homepage', name: 'Homepage', route: '/', sections: ['Navigation', 'Hero — Product Beauty Shot', 'Best Sellers', 'Brand Story', 'Ingredients Highlight', 'Reviews', 'Footer'], required: false },
    { id: 'shop', name: 'Shop', route: '/shop', sections: ['Navigation', 'Category Filter', 'Product Grid', 'Footer'] },
    { id: 'about', name: 'Our Story', route: '/about', sections: ['Navigation', 'Founder Story', 'Ingredients Philosophy', 'Certifications', 'Press', 'Footer'] },
    { id: 'blog', name: 'Beauty Tips', route: '/blog', sections: ['Navigation', 'Featured Post', 'Blog Grid', 'Newsletter', 'Footer'] },
  ],
  'fashion-ecommerce': [
    { id: 'homepage', name: 'Homepage', route: '/', sections: ['Navigation', 'Hero — Lookbook', 'New Arrivals', 'Collections', 'Brand Values', 'Editorial', 'Footer'], required: false },
    { id: 'collections', name: 'Collections', route: '/collections', sections: ['Navigation', 'Collection Grid', 'Season Filter', 'Footer'] },
    { id: 'shop', name: 'Shop', route: '/shop', sections: ['Navigation', 'Filter Bar', 'Product Grid', 'Footer'] },
    { id: 'about', name: 'About', route: '/about', sections: ['Navigation', 'Brand Heritage', 'Sustainability', 'Craftsmanship', 'Footer'] },
  ],
};

// Fallback pages for categories not explicitly defined
export const DEFAULT_PAGES: SuggestedPage[] = [
  { id: 'homepage', name: 'Homepage', route: '/', sections: ['Navigation', 'Hero', 'About Overview', 'Services / Products', 'Testimonials', 'Contact CTA', 'Footer'], required: false },
  { id: 'about', name: 'About', route: '/about', sections: ['Navigation', 'Our Story', 'Team', 'Mission & Values', 'Footer'] },
  { id: 'services', name: 'Services', route: '/services', sections: ['Navigation', 'Services Overview', 'Service Details', 'Process', 'Footer'] },
  { id: 'contact', name: 'Contact', route: '/contact', sections: ['Navigation', 'Contact Form', 'Location', 'Footer'] },
];

// ── Predefined business description chips ─────────────────────────────────────

export interface DescriptionChip {
  label: string;
  prompt: string;
}

export const DESCRIPTION_CHIPS: DescriptionChip[] = [
  { label: 'Coffee Shop', prompt: 'A specialty coffee shop in a vibrant urban neighborhood, serving single-origin espresso, filter brews, and fresh pastries baked daily. We welcome commuters and remote workers with reliable Wi-Fi, plenty of outlets, and friendly baristas. Our focus is ethically sourced beans, zero-waste practices, and a comfortable space for meetups, small events, and weekend cuppings. Pre-order, whole-bean subscriptions, and gift cards available.' },
  { label: 'Tech Startup', prompt: 'An early-stage B2B SaaS startup building an AI-powered workflow automation platform for operations teams at mid-size companies. Our product eliminates repetitive manual tasks, connects existing tools via integrations, and surfaces real-time insights through a clean dashboard. We are a remote-first team of 12, backed by seed funding, and focused on fast onboarding, transparent pricing, and white-glove customer success for our first 100 customers.' },
  { label: 'Fashion Boutique', prompt: 'A premium fashion boutique curating minimalist, high-quality clothing and accessories for conscious consumers who value craftsmanship and timeless style over fast fashion. We carry independent European and local designers, offer personal styling sessions, and ship worldwide. Our brand values sustainability, slow fashion, and thoughtful packaging. We run seasonal collection drops, loyalty rewards, and an invite-only early access program for our top customers.' },
  { label: 'Fitness Studio', prompt: 'A boutique fitness studio offering small-group classes in yoga, pilates, HIIT, and functional training designed for busy professionals who want results without the big-box gym experience. We limit class sizes to 12 people for a personalized, high-energy atmosphere. Members get app-based booking, progress tracking, nutrition guidance, and access to an exclusive community of like-minded people committed to sustainable fitness habits.' },
  { label: 'Restaurant', prompt: 'A modern farm-to-table restaurant celebrating local, seasonal ingredients with a daily-changing menu, open kitchen, and natural wine selection. We seat 60 guests in a warm, candlelit dining room and offer weekend brunch, private dining for up to 20, and a takeout menu for weeknight convenience. Our chef partners with local farmers and foragers, and we donate 5% of profits to regional food banks every month.' },
  { label: 'Consulting Firm', prompt: 'A boutique management consulting firm specializing in organizational strategy, digital transformation, and operational excellence for mid-market companies in healthcare and manufacturing. Our team of 25 senior consultants delivers 90-day engagements with measurable outcomes, transparent deliverables, and hands-on implementation support. We do not just write reports — we work alongside your team to execute change and build internal capability that outlasts our engagement.' },
  { label: 'Creative Agency', prompt: 'A full-service creative agency helping purpose-driven brands build bold visual identities, compelling digital experiences, and culturally resonant marketing campaigns. Our multidisciplinary team covers branding, web design, motion, social content, and brand strategy. We work with startups, nonprofits, and consumer brands on 8-week brand sprints and ongoing retainer partnerships. Portfolio available on request. New inquiries open for Q3.' },
  { label: 'Healthcare Practice', prompt: 'A modern multi-specialty healthcare practice offering primary care, dermatology, and mental health services under one roof. We accept most major insurance plans and offer same-day appointments, telehealth visits, and an integrated patient portal for records, prescriptions, and messaging. Our patient-first approach means no rushed consultations — every visit is at least 30 minutes. We serve adults and adolescents across three clinic locations.' },
  { label: 'Law Firm', prompt: 'A client-focused law firm specializing in employment law, business contracts, and intellectual property for entrepreneurs, creators, and growing companies. We offer flat-fee packages for standard contracts, trademark filings, and employment agreements, as well as hourly representation for disputes and negotiations. Our attorneys respond within 24 hours, provide plain-English explanations, and work remotely with clients across the country via secure video consultations.' },
  { label: 'Real Estate Agency', prompt: 'A boutique real estate agency focused on luxury residential properties and new developments in the greater metro area. Our agents average 14 years of experience, and we handle every step from market valuation and staging to negotiation and closing. We offer buyers exclusive off-market listings, 3D virtual tours, and a concierge relocation service. Sellers get professional photography, drone video, targeted digital advertising, and a dedicated transaction coordinator.' },
  { label: 'Dental Clinic', prompt: 'A family dental clinic offering comprehensive preventive, cosmetic, and restorative dentistry for patients of all ages. We use digital X-rays, same-day crowns, and painless injection techniques to make every visit comfortable. Services include cleanings, whitening, Invisalign, implants, and emergency care with next-day availability. We accept most dental insurance plans and offer flexible 0% financing for major treatments. Online booking, text reminders, and a kids-friendly waiting area.' },
  { label: 'E-commerce Lifestyle Brand', prompt: 'A direct-to-consumer lifestyle brand selling premium home goods, candles, skincare, and wellness accessories designed for modern, mindful living. All products are made with natural materials, cruelty-free ingredients, and sustainable packaging. We sell exclusively through our website, with free shipping on orders over $75, a 30-day hassle-free returns policy, and a subscription box program that ships curated seasonal bundles every quarter.' },
  { label: 'SaaS Product', prompt: 'A project management and team collaboration SaaS platform built for creative agencies and design studios that need more flexibility than traditional tools. Features include Kanban and timeline views, client approval portals, asset storage, time tracking, and automated invoicing. We offer a 14-day free trial, monthly or annual plans, and dedicated onboarding for teams of five or more. Integrates with Figma, Slack, Notion, and Google Workspace.' },
  { label: 'Personal Coach', prompt: 'A certified life and career coach helping high-achieving professionals in their 30s and 40s navigate career transitions, overcome burnout, and design a life aligned with their values. I offer 1-on-1 coaching via 60-minute video sessions, a 12-week intensive program, and group workshops on clarity, boundaries, and mindset. My approach combines evidence-based frameworks, somatic techniques, and practical action plans. First session is a complimentary 30-minute discovery call.' },
  { label: 'Nonprofit / NGO', prompt: 'A nonprofit organization providing free vocational training, mentorship, and job placement support to underserved young adults aged 18 to 26 in urban communities. We run 16-week cohort programs in software development, healthcare administration, and skilled trades, with 78% of graduates employed within 90 days. Funded by corporate partners and individual donors, we have trained over 2,400 young people since 2015. Donations are tax-deductible and 89 cents of every dollar goes directly to program delivery.' },
  { label: 'Interior Design Studio', prompt: 'A residential interior design studio creating timeless, livable spaces that reflect each client\'s personality while maximizing function and flow. We specialize in full-room renovations, kitchen and bathroom redesigns, and new construction consultations. Our process includes an in-home discovery session, 3D renderings, material sourcing, and contractor coordination. We work with homes ranging from 800 to 8,000 sq ft and offer virtual design packages for clients outside our local area.' },
  { label: 'Photography Portfolio', prompt: 'A professional photographer specializing in editorial portraiture, brand identity photography, and intimate wedding coverage. My work has appeared in Vogue, The New York Times, and campaigns for global consumer brands. I shoot on film and digital, offer full print and licensing rights, and deliver final galleries within 3 weeks. Based in New York, available to travel worldwide. Currently booking portrait sessions 6 weeks out and weddings through 2026.' },
  { label: 'Luxury Hotel', prompt: 'A boutique luxury hotel with 32 individually designed suites nestled in a restored 19th-century villa overlooking the Mediterranean. Amenities include a Michelin-starred restaurant, a rooftop infinity pool, a spa, private beach access, and a personalized butler service for every guest. We cater to couples, solo travelers, and small incentive groups seeking a refined, discreet experience. Minimum two-night stay. Direct bookings receive complimentary breakfast and a welcome amenity.' },
  { label: 'Craft Brewery', prompt: 'An independent craft brewery and taproom producing small-batch ales, IPAs, sours, and seasonal lagers with locally sourced grain and hops. We release four to six new brews per month, available on draft and in limited canned releases shipped nationwide through our beer club subscription. Our taproom hosts trivia nights, live music, and brewery tours every Saturday. Dog-friendly patio, food trucks on weekends, and private event space for up to 80 guests.' },
  { label: 'Online Course / EdTech', prompt: 'An online learning platform offering expert-led courses in UX design, data analytics, digital marketing, and coding for working adults who want to upskill without pausing their careers. Courses are self-paced with live weekly Q&A sessions, community forums, and project-based assessments reviewed by industry mentors. Learners earn verifiable certificates upon completion. We partner with hiring companies who offer priority interviews to top graduates. Monthly subscription or pay-per-course options available.' },
  { label: 'Event Venue / Conference', prompt: 'A modern event venue and conference center offering flexible spaces for corporate retreats, product launches, award ceremonies, and private celebrations. Our facility includes a 500-seat auditorium, eight breakout rooms, a rooftop terrace, and a full catering kitchen. We provide AV production, lighting, event coordination, and valet parking as part of our all-inclusive packages. Day-hire and multi-day event bookings available with dedicated on-site support from our events team.' },
  { label: 'Pet Care / Veterinary Clinic', prompt: 'A full-service veterinary clinic and pet care center offering wellness exams, vaccinations, dental cleanings, urgent care, and surgical procedures for dogs, cats, and small animals. We also run an on-site grooming salon, doggy daycare, and a boutique pet supply shop. Our team of four licensed vets and certified technicians focuses on fear-free handling and transparent treatment plans. Online appointment booking, same-day sick visits, and payment plans available.' },
  { label: 'Landscaping & Garden Design', prompt: 'A residential and commercial landscaping company offering custom garden design, lawn maintenance, seasonal planting, hardscaping, and irrigation system installation. We serve homeowners, HOAs, and commercial properties across the region. Our design team creates detailed 3D plans before a single plant goes in the ground, and our maintenance crews visit weekly or bi-weekly depending on the package. Fully licensed, insured, and eco-conscious with water-smart planting solutions.' },
  { label: 'Construction / Contractor', prompt: 'A licensed general contractor specializing in full home renovations, room additions, kitchen and bathroom remodels, and custom new builds for residential clients. We handle everything from permitting and structural work to finish carpentry and final inspection. Our team of 30 skilled tradespeople operates with fixed-price contracts, a dedicated project manager for every job, and a client portal for real-time progress updates and photo documentation. Licensed in three states with over 400 completed projects.' },
  { label: 'Mobile App Landing', prompt: 'A productivity app that helps people build consistent daily habits through science-based streaks, micro-habit stacking, and a supportive accountability community. Available on iOS and Android, the app offers personalized habit plans, weekly progress reports, and AI-powered check-ins. Used by over 200,000 people in 45 countries, rated 4.8 stars, and featured in the App Store\'s "Apps We Love" collection. Free with a premium subscription for advanced analytics and coaching features.' },
  { label: 'Cybersecurity Company', prompt: 'A cybersecurity firm providing managed detection and response, penetration testing, compliance consulting, and employee security awareness training for businesses with 50 to 500 employees. We monitor client environments 24/7, respond to incidents within 15 minutes, and produce monthly executive-level risk reports. Our team holds CISSP, CEH, and SOC 2 certifications, and we specialize in helping companies achieve HIPAA, SOC 2, and ISO 27001 compliance on accelerated timelines.' },
  { label: 'Fintech / Neobank', prompt: 'A mobile-first neobank built for freelancers and self-employed professionals who need smarter banking, automatic tax savings, instant invoicing, and real-time expense categorization in one app. No monthly fees, no minimum balance, and a Visa debit card with 2% cashback on business purchases. We offer FDIC-insured accounts, instant ACH transfers, and integrations with QuickBooks, FreshBooks, and Stripe. Over 80,000 active users and growing 40% month over month.' },
  { label: 'Travel Agency / Tour Operator', prompt: 'A boutique travel agency specializing in small-group adventure tours and tailor-made itineraries across Southeast Asia, Patagonia, East Africa, and Central Asia. Maximum group size of 12 ensures an intimate, unhurried experience with deep local connections. Every trip includes expert local guides, handpicked accommodations, and immersive cultural experiences beyond the typical tourist trail. We handle all logistics from visa support to emergency assistance. Trips depart monthly with guaranteed departures.' },
];

// ── Color helpers ─────────────────────────────────────────────────────────────

function hexToRgb(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return [r, g, b];
}

function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b]
    .map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0'))
    .join('');
}

function mixHex(hex1: string, hex2: string, ratio: number): string {
  if (!hex1.startsWith('#') || !hex2.startsWith('#')) return hex1;
  const [r1, g1, b1] = hexToRgb(hex1);
  const [r2, g2, b2] = hexToRgb(hex2);
  return rgbToHex(r1 * (1 - ratio) + r2 * ratio, g1 * (1 - ratio) + g2 * ratio, b1 * (1 - ratio) + b2 * ratio);
}

/**
 * Auto-derive a dark-mode color set from a light palette.
 * Darkens the background to near-black and lightens text toward white.
 */
export function deriveDarkPalette(p: ColorPalette): NonNullable<ColorPalette['dark']> {
  if (p.dark) return p.dark;
  const darkBg = p.bg.startsWith('linear') ? '#0d0d0d' : mixHex(p.bg, '#080808', 0.88);
  const darkTextPrimary = p.textPrimary.startsWith('#') ? mixHex(p.textPrimary, '#f3f4f6', 0.75) : '#f3f4f6';
  const darkTextSecondary = p.textSecondary.startsWith('#') ? mixHex(p.textSecondary, '#d1d5db', 0.55) : '#9ca3af';
  const darkPrimary = p.primary.startsWith('#') ? mixHex(p.primary, '#ffffff', 0.15) : p.primary;
  const darkSecondary = p.secondary.startsWith('#') ? mixHex(p.secondary, '#ffffff', 0.1) : p.secondary;
  return { bg: darkBg, primary: darkPrimary, secondary: darkSecondary, accent: p.accent, textPrimary: darkTextPrimary, textSecondary: darkTextSecondary };
}

/**
 * Convert a hex color to the space-separated RGB triple used by Tailwind CSS vars
 * e.g. "#1e40af" → "30 64 175"
 */
export function hexToRgbTriple(hex: string): string {
  if (!hex.startsWith('#')) return '0 0 0';
  const [r, g, b] = hexToRgb(hex);
  return `${r} ${g} ${b}`;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Get palettes for a given mood id, falling back to DEFAULT_PALETTES */
export function getPalettesForMood(moodId: string): ColorPalette[] {
  return COLOR_PALETTES[moodId] ?? DEFAULT_PALETTES;
}

/** Get suggested pages for a given category id, falling back to DEFAULT_PAGES */
export function getPagesForCategory(categoryId: string): SuggestedPage[] {
  return PAGE_TEMPLATES[categoryId] ?? DEFAULT_PAGES;
}

/** Guess the most relevant category id from a description string */
export function guessCategoryFromDescription(desc: string): string {
  const d = desc.toLowerCase();
  if (d.includes('coffee') || d.includes('cafe') || d.includes('bakery')) return 'restaurant';
  if (d.includes('restaurant') || d.includes('food') || d.includes('dining')) return 'restaurant';
  if (d.includes('real estate') || d.includes('property') || d.includes('realty')) return 'real-estate';
  if (d.includes('gym') || d.includes('fitness') || d.includes('yoga') || d.includes('wellness')) return 'fitness-wellness';
  if (d.includes('startup') || d.includes('app') || d.includes('software') || d.includes('saas')) return 'saas';
  if (d.includes('tech') || d.includes('technology') || d.includes('digital')) return 'tech-startup';
  if (d.includes('shop') || d.includes('store') || d.includes('ecommerce') || d.includes('e-commerce')) return 'general-ecommerce';
  if (d.includes('fashion') || d.includes('clothing') || d.includes('apparel')) return 'fashion-ecommerce';
  if (d.includes('law') || d.includes('legal') || d.includes('attorney')) return 'legal-services';
  if (d.includes('doctor') || d.includes('clinic') || d.includes('health') || d.includes('medical')) return 'healthcare';
  if (d.includes('hotel') || d.includes('travel') || d.includes('tourism')) return 'travel-tourism';
  if (d.includes('agency') || d.includes('studio') || d.includes('creative')) return 'creative-agency';
  if (d.includes('portfolio') || d.includes('freelance') || d.includes('personal')) return 'personal-portfolio';
  if (d.includes('nonprofit') || d.includes('charity') || d.includes('ngo')) return 'non-profit';
  if (d.includes('education') || d.includes('course') || d.includes('school')) return 'education';
  return 'general-ecommerce';
}

// ── Shared page sections (same on every page) ─────────────────────────────────

export interface SharedSection {
  name: string;
  description: string;
}

export const SHARED_NAV_SECTION: SharedSection = {
  name: 'Navigation',
  description: 'Site-wide navigation bar with logo, primary menu links, optional secondary actions (search, CTA button), and a responsive mobile hamburger menu.',
};

export const SHARED_FOOTER_SECTION: SharedSection = {
  name: 'Footer',
  description: 'Site-wide footer with brand logo, grouped navigation links, social media icons, contact info, and copyright notice.',
};

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Guess the most relevant mood id from a category */
export function guessMoodFromCategory(categoryId: string): string {
  const map: Record<string, string> = {
    'restaurant': 'organic',
    'luxury': 'luxury',
    'real-estate': 'professional',
    'fitness-wellness': 'bold',
    'saas': 'tech-futuristic',
    'tech-startup': 'tech-futuristic',
    'creative-agency': 'artistic',
    'personal-portfolio': 'minimalist',
    'non-profit': 'traditional',
    'education': 'professional',
    'finance': 'traditional',
    'healthcare': 'professional',
    'general-ecommerce': 'professional',
    'fashion-ecommerce': 'luxury',
    'beauty-cosmetics': 'playful',
    'legal-services': 'traditional',
    'travel-tourism': 'organic',
  };
  return map[categoryId] ?? 'professional';
}
