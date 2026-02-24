/**
 * Mock state for the section preview browser and snapshot tests.
 * Each section type gets realistic pre-populated state so sections
 * render visibly (not blank) in the dev browser and Playwright snapshots.
 *
 * State structure mirrors what initActions would load from the real API.
 */

const UNSPLASH = {
  fashion1: 'https://images.unsplash.com/photo-1483985988355-763728e1935b?w=800&fit=crop',
  fashion2: 'https://images.unsplash.com/photo-1469334031218-e382a71b716b?w=800&fit=crop',
  fashion3: 'https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=800&fit=crop',
  product1: 'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=400&fit=crop',
  product2: 'https://images.unsplash.com/photo-1473966968600-fa801b869a1a?w=400&fit=crop',
  product3: 'https://images.unsplash.com/photo-1596755094514-f87e34085b2c?w=400&fit=crop',
  product4: 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=400&fit=crop',
  product5: 'https://images.unsplash.com/photo-1551489186-cf8726f514f8?w=400&fit=crop',
  product6: 'https://images.unsplash.com/photo-1591047139829-d91aecb6caea?w=400&fit=crop',
  lifestyle1: 'https://images.unsplash.com/photo-1490481651871-ab68de25d43d?w=800&fit=crop',
  lifestyle2: 'https://images.unsplash.com/photo-1558769132-cb1aea458c5e?w=800&fit=crop',
  founder: 'https://images.unsplash.com/photo-1494790108755-2616b612b047?w=400&fit=crop',
  team: 'https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=800&fit=crop',
};

const MOCK_PRODUCTS = [
  { id: '1', productName: 'Classic Tee', slug: 'classic-tee', productAsset: { preview: UNSPLASH.product1 }, priceWithTax: { __typename: 'SinglePrice', value: 2999 }, currencyCode: 'USD' },
  { id: '2', productName: 'Slim Chinos', slug: 'slim-chinos', productAsset: { preview: UNSPLASH.product2 }, priceWithTax: { __typename: 'SinglePrice', value: 5999 }, currencyCode: 'USD' },
  { id: '3', productName: 'Linen Shirt', slug: 'linen-shirt', productAsset: { preview: UNSPLASH.product3 }, priceWithTax: { __typename: 'SinglePrice', value: 4499 }, currencyCode: 'USD' },
  { id: '4', productName: 'Canvas Sneakers', slug: 'canvas-sneakers', productAsset: { preview: UNSPLASH.product4 }, priceWithTax: { __typename: 'SinglePrice', value: 7999 }, currencyCode: 'USD' },
  { id: '5', productName: 'Wool Coat', slug: 'wool-coat', productAsset: { preview: UNSPLASH.product5 }, priceWithTax: { __typename: 'SinglePrice', value: 14999 }, currencyCode: 'USD' },
  { id: '6', productName: 'Silk Blouse', slug: 'silk-blouse', productAsset: { preview: UNSPLASH.product6 }, priceWithTax: { __typename: 'SinglePrice', value: 8999 }, currencyCode: 'USD' },
];

const MOCK_CATEGORIES = [
  { id: '1', name: 'Women', slug: 'women', imageUrl: UNSPLASH.fashion1 },
  { id: '2', name: 'Men', slug: 'men', imageUrl: UNSPLASH.fashion2 },
  { id: '3', name: 'Accessories', slug: 'accessories', imageUrl: UNSPLASH.fashion3 },
  { id: '4', name: 'Sale', slug: 'sale', imageUrl: UNSPLASH.lifestyle1 },
];

const MOCK_NAV = {
  nav: {
    collections: [
      { id: '1', name: 'Women', slug: 'women' },
      { id: '2', name: 'Men', slug: 'men' },
      { id: '3', name: 'Accessories', slug: 'accessories' },
      { id: '4', name: 'Sale', slug: 'sale' },
    ],
    colorScheme: 'light',
    themeMenuOpen: false,
  },
  cart: { totalQuantity: 2 },
  auth: { user: null },
};

export const MOCK_STATE_BY_SECTION: Record<string, Record<string, unknown>> = {
  navbar: MOCK_NAV,
  footer: { ...MOCK_NAV },
  hero: {
    hero: {
      heading: 'Elevate Your Style',
      subheading: 'Discover our latest collection — crafted for the modern wardrobe.',
      ctaLabel: 'Shop Now',
      ctaSecondaryLabel: 'View Lookbook',
      imageUrl: UNSPLASH.fashion1,
    },
  },
  'hero-carousel': {
    heroCarousel: {
      slides: [
        { id: '1', heading: 'New Arrivals', subheading: 'Fresh styles for every season', ctaLabel: 'Shop Now', imageUrl: UNSPLASH.fashion1 },
        { id: '2', heading: 'Sale Up To 50%', subheading: 'Limited time — while stocks last', ctaLabel: 'View Sale', imageUrl: UNSPLASH.fashion2 },
        { id: '3', heading: 'The Essentials Edit', subheading: 'Timeless pieces, enduring quality', ctaLabel: 'Explore', imageUrl: UNSPLASH.fashion3 },
      ],
      activeIndex: 0,
    },
  },
  'announcement-bar': {
    announcement: {
      messages: [
        { id: '1', text: '🚚 Free shipping on orders over $50' },
        { id: '2', text: '✨ New arrivals every Friday' },
        { id: '3', text: '🎁 Free gift on orders over $150' },
      ],
    },
  },
  'countdown-banner': {
    countdownBanner: {
      headline: 'Summer Sale Ends In',
      endsAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
      ctaLabel: 'Shop the Sale',
    },
  },
  'featured-categories': {
    featured: { categories: MOCK_CATEGORIES },
  },
  'product-grid': {
    newArrivals: { products: MOCK_PRODUCTS },
    bestSellers: { products: MOCK_PRODUCTS.slice().reverse() },
  },
  'product-carousel': {
    carousel: { products: MOCK_PRODUCTS },
    bestSellers: { products: MOCK_PRODUCTS },
  },
  'flash-sale': {
    flashSale: {
      products: MOCK_PRODUCTS.slice(0, 4),
      endsAt: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
    },
  },
  'shop-the-look': {
    look: {
      imageUrl: UNSPLASH.lifestyle2,
      products: MOCK_PRODUCTS.slice(0, 3),
    },
  },
  'recently-viewed': {
    recentlyViewed: { products: MOCK_PRODUCTS.slice(0, 4) },
  },
  'gift-guide': {
    giftGuide: {
      categories: [
        { id: '1', title: 'For Her', description: 'Thoughtful gifts she\'ll love', imageUrl: UNSPLASH.fashion1, slug: 'for-her' },
        { id: '2', title: 'For Him', description: 'Curated picks for the modern man', imageUrl: UNSPLASH.fashion2, slug: 'for-him' },
        { id: '3', title: 'Under $50', description: 'Great gifts, great price', imageUrl: UNSPLASH.fashion3, slug: 'under-50' },
      ],
    },
  },
  testimonials: {
    testimonials: {
      items: [
        { id: '1', author: 'Sarah M.', review: 'The quality is absolutely amazing. I\'ve ordered 5 times now and every piece is perfect.', rating: 5, location: 'New York, NY' },
        { id: '2', author: 'James K.', review: 'Fast shipping, beautiful packaging, and the clothes fit perfectly. Will be back!', rating: 5, location: 'London, UK' },
        { id: '3', author: 'Priya S.', review: 'Found my go-to brand for minimalist fashion. The linen shirts are incredible.', rating: 5, location: 'Toronto, CA' },
      ],
    },
  },
  'press-mentions': {
    press: {
      mentions: [
        { id: '1', publication: 'Vogue', quote: 'The brand redefining minimalist fashion', logo: '/logos/vogue.svg' },
        { id: '2', publication: 'GQ', quote: 'Essential pieces for the modern wardrobe', logo: '/logos/gq.svg' },
        { id: '3', publication: 'Forbes', quote: 'Sustainable fashion done right', logo: '/logos/forbes.svg' },
        { id: '4', publication: 'Hypebeast', quote: 'The drop everyone is talking about', logo: '/logos/hypebeast.svg' },
      ],
    },
  },
  'features-grid': {
    features: {
      items: [
        { id: '1', icon: 'Truck', title: 'Free Shipping', body: 'On all orders over $50. Fast, reliable delivery.' },
        { id: '2', icon: 'RotateCcw', title: 'Easy Returns', body: '30-day hassle-free returns on all items.' },
        { id: '3', icon: 'Shield', title: 'Secure Payment', body: 'Your payment info is always protected.' },
        { id: '4', icon: 'Star', title: 'Quality Guaranteed', body: 'Every item passes our quality check.' },
      ],
    },
  },
  newsletter: {
    form: { email: '' },
  },
  'brand-story': {
    brandStory: {
      headline: 'Crafted with Purpose',
      body: 'We believe great design is about more than aesthetics. Every piece we make is built to last, ethically sourced, and designed to become a wardrobe staple for years to come.',
      imageUrl: UNSPLASH.lifestyle1,
      ctaLabel: 'Our Story',
    },
  },
  'video-feature': {
    video: {
      headline: 'See the Craft',
      subheading: 'Behind every piece is a story worth telling.',
      videoUrl: 'https://www.youtube.com/embed/dQw4w9WgXcQ',
      posterUrl: UNSPLASH.fashion2,
    },
  },
  lookbook: {
    lookbook: {
      headline: 'The Spring Edit',
      subtitle: 'Styled for every occasion',
      items: [
        { id: '1', imageUrl: UNSPLASH.lifestyle1, caption: 'The Minimalist', products: MOCK_PRODUCTS.slice(0, 2) },
        { id: '2', imageUrl: UNSPLASH.lifestyle2, caption: 'Street Ready', products: MOCK_PRODUCTS.slice(2, 4) },
        { id: '3', imageUrl: UNSPLASH.fashion3, caption: 'Elevated Casual', products: MOCK_PRODUCTS.slice(1, 3) },
      ],
    },
  },
  sustainability: {
    sustainability: {
      headline: 'Designed for the Planet',
      body: 'We use 100% organic cotton, recycled packaging, and carbon-neutral shipping on every order.',
      stats: [
        { id: '1', value: '100%', label: 'Organic Cotton' },
        { id: '2', value: '0', label: 'Carbon Footprint' },
        { id: '3', value: '50K+', label: 'Trees Planted' },
      ],
    },
  },
  'how-it-works': {
    howItWorks: {
      headline: 'How It Works',
      steps: [
        { id: '1', step: '1', title: 'Browse & Choose', body: 'Explore our curated collections and find your perfect match.' },
        { id: '2', step: '2', title: 'Place Your Order', body: 'Checkout in seconds with our secure payment system.' },
        { id: '3', step: '3', title: 'Wear & Love', body: 'Receive your order in 2-3 days, ready to wear.' },
      ],
    },
  },
  'founder-story': {
    founder: {
      name: 'Alex Chen',
      title: 'Founder & Creative Director',
      imageUrl: UNSPLASH.founder,
      quote: 'I started this brand because I couldn\'t find clothes that were both beautiful and ethical. Now I\'m building the brand I always wanted to shop from.',
      story: 'After 10 years in the fashion industry, Alex left to build something different — a brand that proves you don\'t have to choose between style and sustainability.',
    },
  },
  'blog-articles': {
    blog: {
      articles: [
        { id: '1', title: 'How to Build a Capsule Wardrobe', excerpt: 'The 10 pieces you actually need for a minimalist wardrobe.', imageUrl: UNSPLASH.fashion1, slug: 'capsule-wardrobe', publishedAt: '2025-03-15' },
        { id: '2', title: 'Spring Colour Trends 2025', excerpt: 'The palettes dominating runways this season.', imageUrl: UNSPLASH.lifestyle1, slug: 'spring-trends', publishedAt: '2025-02-28' },
        { id: '3', title: 'Caring for Natural Fibres', excerpt: 'Keep your linen and cotton looking perfect, longer.', imageUrl: UNSPLASH.fashion2, slug: 'natural-fibres', publishedAt: '2025-02-10' },
      ],
    },
  },
  'loyalty-program': {
    loyalty: {
      headline: 'Join the Rewards Program',
      tiers: [
        { id: '1', name: 'Silver', minPoints: 0, benefits: ['Free shipping', 'Early access'] },
        { id: '2', name: 'Gold', minPoints: 500, benefits: ['All Silver benefits', '10% off every order', 'Birthday gift'] },
        { id: '3', name: 'Platinum', minPoints: 2000, benefits: ['All Gold benefits', '20% off', 'Personal stylist', 'Free returns'] },
      ],
    },
  },
  'quiz-finder': {
    quiz: {
      headline: 'Find Your Style',
      subtitle: 'Answer 3 quick questions and we\'ll curate your perfect wardrobe.',
      questions: [
        { id: '1', question: 'What\'s your style vibe?', options: ['Minimal', 'Bold', 'Classic', 'Casual'] },
      ],
      currentQuestion: 0,
    },
  },
  'social-proof': {
    socialProof: {
      reviewCount: 12847,
      averageRating: 4.9,
      highlights: ['Fast shipping', 'True to size', 'Great quality'],
      recentReviews: [
        { id: '1', author: 'Emma T.', rating: 5, text: 'Love this brand so much!', productName: 'Linen Shirt' },
        { id: '2', author: 'Marcus B.', rating: 5, text: 'Best quality I\'ve found online.', productName: 'Canvas Sneakers' },
      ],
    },
  },
  'community-section': {
    community: {
      headline: 'Join Our Community',
      memberCount: 84000,
      posts: [
        { id: '1', imageUrl: UNSPLASH.fashion1, username: '@sarah_style', likes: 234 },
        { id: '2', imageUrl: UNSPLASH.lifestyle1, username: '@minimal.james', likes: 189 },
        { id: '3', imageUrl: UNSPLASH.fashion2, username: '@priya.wears', likes: 312 },
        { id: '4', imageUrl: UNSPLASH.lifestyle2, username: '@alex.mode', likes: 156 },
      ],
    },
  },
  'tiktok-feed': {
    tiktok: {
      headline: 'As Seen On TikTok',
      videos: [
        { id: '1', thumbnailUrl: UNSPLASH.fashion1, views: '1.2M', username: '@trendsetters' },
        { id: '2', thumbnailUrl: UNSPLASH.lifestyle1, views: '890K', username: '@stylewatch' },
        { id: '3', thumbnailUrl: UNSPLASH.fashion2, views: '2.1M', username: '@fashionfix' },
      ],
    },
  },
  waitlist: {
    form: { email: '' },
    waitlist: { productName: 'The Limited Edition Cashmere Set', count: 2847 },
  },
  'gift-card-promo': {
    giftCard: {
      headline: 'Give the Gift of Style',
      amounts: [25, 50, 100, 250],
    },
  },
};
