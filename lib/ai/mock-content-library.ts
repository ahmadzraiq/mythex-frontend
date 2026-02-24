/**
 * Curated mock content library — deterministic, no AI call.
 *
 * All image URLs use public Unsplash CDN (no API key required).
 * Format: https://images.unsplash.com/photo-{id}?w={width}&fit=crop
 *
 * Content is bucketed by industry so every generated page gets
 * visually coherent images regardless of brand type.
 */

// ─── Product shape (matches fragments/cards/product-card.json) ───────────────

export interface MockProduct {
  id: string;
  productName: string;
  slug: string;
  priceWithTax: { __typename: 'SinglePrice'; value: number };
  currencyCode: string;
  productAsset: { preview: string };
}

export interface MockCategory {
  id: string;
  name: string;
  slug: string;
  imageUrl: string;
}

export interface MockTestimonial {
  id: string;
  review: string;
  author: string;
  rating: number;
  location: string;
}

// ─── Industry buckets ─────────────────────────────────────────────────────────

type IndustryKey = 'fashion' | 'food' | 'tech' | 'home' | 'beauty' | 'fitness' | 'jewelry' | 'generic';

/** Map industryType strings to bucket keys */
function resolveIndustryKey(industryType: string): IndustryKey {
  const t = industryType.toLowerCase();
  if (/fashion|cloth|apparel|wear|dress|boutique/.test(t)) return 'fashion';
  if (/bak|coffee|cafe|café|restaurant|food|beverage|brew|pastry|cake/.test(t)) return 'food';
  if (/tech|software|saas|developer|app|digital|startup|gadget|electron/.test(t)) return 'tech';
  if (/home|furniture|interior|decor|living|kitchen/.test(t)) return 'home';
  if (/beauty|skin|makeup|cosmetic|hair|fragrance|wellness/.test(t)) return 'beauty';
  if (/fitness|gym|sport|athlet|yoga|workout|health/.test(t)) return 'fitness';
  if (/jewel|jewelry|jewellery|ring|necklace|gem|watch|luxury/.test(t)) return 'jewelry';
  return 'generic';
}

// ─── Products per industry ────────────────────────────────────────────────────

const PRODUCTS_BY_INDUSTRY: Record<IndustryKey, MockProduct[]> = {
  fashion: [
    { id: 'f1', productName: 'Classic White Tee', slug: 'classic-white-tee', priceWithTax: { __typename: 'SinglePrice', value: 2999 }, currencyCode: 'USD', productAsset: { preview: 'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=400&fit=crop' } },
    { id: 'f2', productName: 'Slim Fit Chinos', slug: 'slim-fit-chinos', priceWithTax: { __typename: 'SinglePrice', value: 5999 }, currencyCode: 'USD', productAsset: { preview: 'https://images.unsplash.com/photo-1473966968600-fa801b869a1a?w=400&fit=crop' } },
    { id: 'f3', productName: 'Linen Summer Shirt', slug: 'linen-summer-shirt', priceWithTax: { __typename: 'SinglePrice', value: 4499 }, currencyCode: 'USD', productAsset: { preview: 'https://images.unsplash.com/photo-1596755094514-f87e34085b2c?w=400&fit=crop' } },
    { id: 'f4', productName: 'Canvas Sneakers', slug: 'canvas-sneakers', priceWithTax: { __typename: 'SinglePrice', value: 7999 }, currencyCode: 'USD', productAsset: { preview: 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=400&fit=crop' } },
    { id: 'f5', productName: 'Oversized Blazer', slug: 'oversized-blazer', priceWithTax: { __typename: 'SinglePrice', value: 12999 }, currencyCode: 'USD', productAsset: { preview: 'https://images.unsplash.com/photo-1520975954732-35dd22299614?w=400&fit=crop' } },
    { id: 'f6', productName: 'Floral Midi Dress', slug: 'floral-midi-dress', priceWithTax: { __typename: 'SinglePrice', value: 8499 }, currencyCode: 'USD', productAsset: { preview: 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?w=400&fit=crop' } },
    { id: 'f7', productName: 'Leather Belt', slug: 'leather-belt', priceWithTax: { __typename: 'SinglePrice', value: 3499 }, currencyCode: 'USD', productAsset: { preview: 'https://images.unsplash.com/photo-1590874103328-eac38a683ce7?w=400&fit=crop' } },
    { id: 'f8', productName: 'Merino Wool Sweater', slug: 'merino-wool-sweater', priceWithTax: { __typename: 'SinglePrice', value: 9499 }, currencyCode: 'USD', productAsset: { preview: 'https://images.unsplash.com/photo-1576566588028-4147f3842f27?w=400&fit=crop' } },
    { id: 'f9', productName: 'Denim Jacket', slug: 'denim-jacket', priceWithTax: { __typename: 'SinglePrice', value: 10999 }, currencyCode: 'USD', productAsset: { preview: 'https://images.unsplash.com/photo-1551537482-f2075a1d41f2?w=400&fit=crop' } },
    { id: 'f10', productName: 'Wide-Leg Trousers', slug: 'wide-leg-trousers', priceWithTax: { __typename: 'SinglePrice', value: 7499 }, currencyCode: 'USD', productAsset: { preview: 'https://images.unsplash.com/photo-1509631179647-0177331693ae?w=400&fit=crop' } },
    { id: 'f11', productName: 'Silk Scarf', slug: 'silk-scarf', priceWithTax: { __typename: 'SinglePrice', value: 4999 }, currencyCode: 'USD', productAsset: { preview: 'https://images.unsplash.com/photo-1601924994987-69e26d50dc26?w=400&fit=crop' } },
    { id: 'f12', productName: 'Structured Handbag', slug: 'structured-handbag', priceWithTax: { __typename: 'SinglePrice', value: 18999 }, currencyCode: 'USD', productAsset: { preview: 'https://images.unsplash.com/photo-1548036328-c9fa89d128fa?w=400&fit=crop' } },
  ],

  food: [
    { id: 'fd1', productName: 'Signature Espresso', slug: 'signature-espresso', priceWithTax: { __typename: 'SinglePrice', value: 499 }, currencyCode: 'USD', productAsset: { preview: 'https://images.unsplash.com/photo-1510591509098-f4fdc6d0ff04?w=400&fit=crop' } },
    { id: 'fd2', productName: 'Cold Brew Bottle', slug: 'cold-brew-bottle', priceWithTax: { __typename: 'SinglePrice', value: 799 }, currencyCode: 'USD', productAsset: { preview: 'https://images.unsplash.com/photo-1461023058943-07fcbe16d735?w=400&fit=crop' } },
    { id: 'fd3', productName: 'Butter Croissant', slug: 'butter-croissant', priceWithTax: { __typename: 'SinglePrice', value: 399 }, currencyCode: 'USD', productAsset: { preview: 'https://images.unsplash.com/photo-1555507036-ab1f4038808a?w=400&fit=crop' } },
    { id: 'fd4', productName: 'Sourdough Loaf', slug: 'sourdough-loaf', priceWithTax: { __typename: 'SinglePrice', value: 1199 }, currencyCode: 'USD', productAsset: { preview: 'https://images.unsplash.com/photo-1586444248902-2f64eddc13df?w=400&fit=crop' } },
    { id: 'fd5', productName: 'Latte Art', slug: 'latte-art', priceWithTax: { __typename: 'SinglePrice', value: 599 }, currencyCode: 'USD', productAsset: { preview: 'https://images.unsplash.com/photo-1534040385115-33dcb3acba5b?w=400&fit=crop' } },
    { id: 'fd6', productName: 'Almond Tart', slug: 'almond-tart', priceWithTax: { __typename: 'SinglePrice', value: 499 }, currencyCode: 'USD', productAsset: { preview: 'https://images.unsplash.com/photo-1488477181946-6428a0291777?w=400&fit=crop' } },
    { id: 'fd7', productName: 'Pour Over Kit', slug: 'pour-over-kit', priceWithTax: { __typename: 'SinglePrice', value: 2999 }, currencyCode: 'USD', productAsset: { preview: 'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=400&fit=crop' } },
    { id: 'fd8', productName: 'Chocolate Cake Slice', slug: 'chocolate-cake-slice', priceWithTax: { __typename: 'SinglePrice', value: 699 }, currencyCode: 'USD', productAsset: { preview: 'https://images.unsplash.com/photo-1578985545062-69928b1d9587?w=400&fit=crop' } },
    { id: 'fd9', productName: 'Coffee Bean Bag 250g', slug: 'coffee-bean-bag', priceWithTax: { __typename: 'SinglePrice', value: 1599 }, currencyCode: 'USD', productAsset: { preview: 'https://images.unsplash.com/photo-1559056199-641a0ac8b55e?w=400&fit=crop' } },
    { id: 'fd10', productName: 'Blueberry Muffin', slug: 'blueberry-muffin', priceWithTax: { __typename: 'SinglePrice', value: 349 }, currencyCode: 'USD', productAsset: { preview: 'https://images.unsplash.com/photo-1607958996333-41aef7caefaa?w=400&fit=crop' } },
    { id: 'fd11', productName: 'Matcha Latte', slug: 'matcha-latte', priceWithTax: { __typename: 'SinglePrice', value: 649 }, currencyCode: 'USD', productAsset: { preview: 'https://images.unsplash.com/photo-1591156562945-e89e1ef5bf7f?w=400&fit=crop' } },
    { id: 'fd12', productName: 'Cinnamon Roll', slug: 'cinnamon-roll', priceWithTax: { __typename: 'SinglePrice', value: 449 }, currencyCode: 'USD', productAsset: { preview: 'https://images.unsplash.com/photo-1509365390695-33aee754301f?w=400&fit=crop' } },
  ],

  tech: [
    { id: 't1', productName: 'Pro Laptop 14"', slug: 'pro-laptop', priceWithTax: { __typename: 'SinglePrice', value: 149900 }, currencyCode: 'USD', productAsset: { preview: 'https://images.unsplash.com/photo-1496181133206-80ce9b88a853?w=400&fit=crop' } },
    { id: 't2', productName: 'Wireless Earbuds', slug: 'wireless-earbuds', priceWithTax: { __typename: 'SinglePrice', value: 19900 }, currencyCode: 'USD', productAsset: { preview: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=400&fit=crop' } },
    { id: 't3', productName: 'Smart Watch', slug: 'smart-watch', priceWithTax: { __typename: 'SinglePrice', value: 29900 }, currencyCode: 'USD', productAsset: { preview: 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=400&fit=crop' } },
    { id: 't4', productName: 'Mechanical Keyboard', slug: 'mechanical-keyboard', priceWithTax: { __typename: 'SinglePrice', value: 12900 }, currencyCode: 'USD', productAsset: { preview: 'https://images.unsplash.com/photo-1587829741301-dc798b83add3?w=400&fit=crop' } },
    { id: 't5', productName: 'Ultra-Wide Monitor', slug: 'ultra-wide-monitor', priceWithTax: { __typename: 'SinglePrice', value: 59900 }, currencyCode: 'USD', productAsset: { preview: 'https://images.unsplash.com/photo-1527443224154-c4a3942d3acf?w=400&fit=crop' } },
    { id: 't6', productName: 'USB-C Hub', slug: 'usb-c-hub', priceWithTax: { __typename: 'SinglePrice', value: 4900 }, currencyCode: 'USD', productAsset: { preview: 'https://images.unsplash.com/photo-1602143407151-7111542de6e8?w=400&fit=crop' } },
    { id: 't7', productName: 'Smartphone Pro', slug: 'smartphone-pro', priceWithTax: { __typename: 'SinglePrice', value: 99900 }, currencyCode: 'USD', productAsset: { preview: 'https://images.unsplash.com/photo-1512941937669-90a1b58e7e9c?w=400&fit=crop' } },
    { id: 't8', productName: 'Ergonomic Mouse', slug: 'ergonomic-mouse', priceWithTax: { __typename: 'SinglePrice', value: 7900 }, currencyCode: 'USD', productAsset: { preview: 'https://images.unsplash.com/photo-1527864550417-7fd91fc51a46?w=400&fit=crop' } },
    { id: 't9', productName: 'Noise-Cancelling Headphones', slug: 'noise-cancelling-headphones', priceWithTax: { __typename: 'SinglePrice', value: 34900 }, currencyCode: 'USD', productAsset: { preview: 'https://images.unsplash.com/photo-1484704849700-f032a568e944?w=400&fit=crop' } },
    { id: 't10', productName: 'Portable SSD 1TB', slug: 'portable-ssd', priceWithTax: { __typename: 'SinglePrice', value: 9900 }, currencyCode: 'USD', productAsset: { preview: 'https://images.unsplash.com/photo-1597872200969-2b65d56bd16b?w=400&fit=crop' } },
    { id: 't11', productName: 'Tablet Stand', slug: 'tablet-stand', priceWithTax: { __typename: 'SinglePrice', value: 3900 }, currencyCode: 'USD', productAsset: { preview: 'https://images.unsplash.com/photo-1544244015-0df4b3ffc6b0?w=400&fit=crop' } },
    { id: 't12', productName: 'Webcam 4K', slug: 'webcam-4k', priceWithTax: { __typename: 'SinglePrice', value: 8900 }, currencyCode: 'USD', productAsset: { preview: 'https://images.unsplash.com/photo-1585771724684-38269d6639fd?w=400&fit=crop' } },
  ],

  home: [
    { id: 'h1', productName: 'Linen Sofa', slug: 'linen-sofa', priceWithTax: { __typename: 'SinglePrice', value: 129900 }, currencyCode: 'USD', productAsset: { preview: 'https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=400&fit=crop' } },
    { id: 'h2', productName: 'Oak Dining Table', slug: 'oak-dining-table', priceWithTax: { __typename: 'SinglePrice', value: 89900 }, currencyCode: 'USD', productAsset: { preview: 'https://images.unsplash.com/photo-1530018607912-eff2daa1bac4?w=400&fit=crop' } },
    { id: 'h3', productName: 'Ceramic Vase', slug: 'ceramic-vase', priceWithTax: { __typename: 'SinglePrice', value: 4900 }, currencyCode: 'USD', productAsset: { preview: 'https://images.unsplash.com/photo-1581783342308-f792dbdd27c5?w=400&fit=crop' } },
    { id: 'h4', productName: 'Throw Blanket', slug: 'throw-blanket', priceWithTax: { __typename: 'SinglePrice', value: 7900 }, currencyCode: 'USD', productAsset: { preview: 'https://images.unsplash.com/photo-1586023492125-27b2c045efd7?w=400&fit=crop' } },
    { id: 'h5', productName: 'Pendant Light', slug: 'pendant-light', priceWithTax: { __typename: 'SinglePrice', value: 24900 }, currencyCode: 'USD', productAsset: { preview: 'https://images.unsplash.com/photo-1507473885765-e6ed057f782c?w=400&fit=crop' } },
    { id: 'h6', productName: 'Wooden Shelf', slug: 'wooden-shelf', priceWithTax: { __typename: 'SinglePrice', value: 19900 }, currencyCode: 'USD', productAsset: { preview: 'https://images.unsplash.com/photo-1519710164239-da123dc03ef4?w=400&fit=crop' } },
    { id: 'h7', productName: 'Scented Candle', slug: 'scented-candle', priceWithTax: { __typename: 'SinglePrice', value: 2900 }, currencyCode: 'USD', productAsset: { preview: 'https://images.unsplash.com/photo-1602178506400-3f36a9440c0e?w=400&fit=crop' } },
    { id: 'h8', productName: 'Linen Pillow Set', slug: 'linen-pillow-set', priceWithTax: { __typename: 'SinglePrice', value: 5900 }, currencyCode: 'USD', productAsset: { preview: 'https://images.unsplash.com/photo-1631049307264-da0ec9d70304?w=400&fit=crop' } },
    { id: 'h9', productName: 'Marble Tray', slug: 'marble-tray', priceWithTax: { __typename: 'SinglePrice', value: 3900 }, currencyCode: 'USD', productAsset: { preview: 'https://images.unsplash.com/photo-1616046229478-9901c5536a45?w=400&fit=crop' } },
    { id: 'h10', productName: 'Rattan Chair', slug: 'rattan-chair', priceWithTax: { __typename: 'SinglePrice', value: 34900 }, currencyCode: 'USD', productAsset: { preview: 'https://images.unsplash.com/photo-1567538096630-e0c55bd6374c?w=400&fit=crop' } },
    { id: 'h11', productName: 'Knit Ottoman', slug: 'knit-ottoman', priceWithTax: { __typename: 'SinglePrice', value: 18900 }, currencyCode: 'USD', productAsset: { preview: 'https://images.unsplash.com/photo-1556228852-6d35a585d566?w=400&fit=crop' } },
    { id: 'h12', productName: 'Plant Pot Set', slug: 'plant-pot-set', priceWithTax: { __typename: 'SinglePrice', value: 2499 }, currencyCode: 'USD', productAsset: { preview: 'https://images.unsplash.com/photo-1485955900006-10f4d324d411?w=400&fit=crop' } },
  ],

  beauty: [
    { id: 'b1', productName: 'Vitamin C Serum', slug: 'vitamin-c-serum', priceWithTax: { __typename: 'SinglePrice', value: 4900 }, currencyCode: 'USD', productAsset: { preview: 'https://images.unsplash.com/photo-1620916566398-39f1143ab7be?w=400&fit=crop' } },
    { id: 'b2', productName: 'Hydrating Moisturiser', slug: 'hydrating-moisturiser', priceWithTax: { __typename: 'SinglePrice', value: 3900 }, currencyCode: 'USD', productAsset: { preview: 'https://images.unsplash.com/photo-1556228720-195a672e8a03?w=400&fit=crop' } },
    { id: 'b3', productName: 'Rose Face Oil', slug: 'rose-face-oil', priceWithTax: { __typename: 'SinglePrice', value: 5900 }, currencyCode: 'USD', productAsset: { preview: 'https://images.unsplash.com/photo-1612817288484-6f916006741a?w=400&fit=crop' } },
    { id: 'b4', productName: 'Matte Foundation', slug: 'matte-foundation', priceWithTax: { __typename: 'SinglePrice', value: 3400 }, currencyCode: 'USD', productAsset: { preview: 'https://images.unsplash.com/photo-1522335789203-aabd1fc54bc9?w=400&fit=crop' } },
    { id: 'b5', productName: 'Eye Palette', slug: 'eye-palette', priceWithTax: { __typename: 'SinglePrice', value: 4500 }, currencyCode: 'USD', productAsset: { preview: 'https://images.unsplash.com/photo-1512496015851-a90fb38ba796?w=400&fit=crop' } },
    { id: 'b6', productName: 'Hair Growth Oil', slug: 'hair-growth-oil', priceWithTax: { __typename: 'SinglePrice', value: 2900 }, currencyCode: 'USD', productAsset: { preview: 'https://images.unsplash.com/photo-1608248543803-ba4f8c70ae0b?w=400&fit=crop' } },
    { id: 'b7', productName: 'Lip Gloss Set', slug: 'lip-gloss-set', priceWithTax: { __typename: 'SinglePrice', value: 2200 }, currencyCode: 'USD', productAsset: { preview: 'https://images.unsplash.com/photo-1586495777744-4e6232bf2f8c?w=400&fit=crop' } },
    { id: 'b8', productName: 'SPF 50 Sunscreen', slug: 'spf-50-sunscreen', priceWithTax: { __typename: 'SinglePrice', value: 2800 }, currencyCode: 'USD', productAsset: { preview: 'https://images.unsplash.com/photo-1556228578-0d85b1a4d571?w=400&fit=crop' } },
    { id: 'b9', productName: 'Exfoliating Scrub', slug: 'exfoliating-scrub', priceWithTax: { __typename: 'SinglePrice', value: 3200 }, currencyCode: 'USD', productAsset: { preview: 'https://images.unsplash.com/photo-1570194065650-d99fb4bedf0a?w=400&fit=crop' } },
    { id: 'b10', productName: 'Night Repair Cream', slug: 'night-repair-cream', priceWithTax: { __typename: 'SinglePrice', value: 6900 }, currencyCode: 'USD', productAsset: { preview: 'https://images.unsplash.com/photo-1556228994-516d4871b4e7?w=400&fit=crop' } },
    { id: 'b11', productName: 'Micellar Water', slug: 'micellar-water', priceWithTax: { __typename: 'SinglePrice', value: 1900 }, currencyCode: 'USD', productAsset: { preview: 'https://images.unsplash.com/photo-1556228841-a3c527ebefe5?w=400&fit=crop' } },
    { id: 'b12', productName: 'Perfume Eau de Parfum', slug: 'eau-de-parfum', priceWithTax: { __typename: 'SinglePrice', value: 8900 }, currencyCode: 'USD', productAsset: { preview: 'https://images.unsplash.com/photo-1592945403244-b3fbafd7f539?w=400&fit=crop' } },
  ],

  fitness: [
    { id: 'fit1', productName: 'Yoga Mat Pro', slug: 'yoga-mat-pro', priceWithTax: { __typename: 'SinglePrice', value: 7900 }, currencyCode: 'USD', productAsset: { preview: 'https://images.unsplash.com/photo-1601925260368-ae2f83cf8b7f?w=400&fit=crop' } },
    { id: 'fit2', productName: 'Resistance Bands Set', slug: 'resistance-bands', priceWithTax: { __typename: 'SinglePrice', value: 2900 }, currencyCode: 'USD', productAsset: { preview: 'https://images.unsplash.com/photo-1598289431512-b97b0917affc?w=400&fit=crop' } },
    { id: 'fit3', productName: 'Protein Powder 1kg', slug: 'protein-powder', priceWithTax: { __typename: 'SinglePrice', value: 4900 }, currencyCode: 'USD', productAsset: { preview: 'https://images.unsplash.com/photo-1579722821273-0f6c7d44362f?w=400&fit=crop' } },
    { id: 'fit4', productName: 'Foam Roller', slug: 'foam-roller', priceWithTax: { __typename: 'SinglePrice', value: 2500 }, currencyCode: 'USD', productAsset: { preview: 'https://images.unsplash.com/photo-1620188467120-5042ed1eb5da?w=400&fit=crop' } },
    { id: 'fit5', productName: 'Athletic Shorts', slug: 'athletic-shorts', priceWithTax: { __typename: 'SinglePrice', value: 3900 }, currencyCode: 'USD', productAsset: { preview: 'https://images.unsplash.com/photo-1506629082955-511b1aa562c8?w=400&fit=crop' } },
    { id: 'fit6', productName: 'Adjustable Dumbbells', slug: 'adjustable-dumbbells', priceWithTax: { __typename: 'SinglePrice', value: 14900 }, currencyCode: 'USD', productAsset: { preview: 'https://images.unsplash.com/photo-1526401485004-46910ecc8e51?w=400&fit=crop' } },
    { id: 'fit7', productName: 'Sports Water Bottle', slug: 'sports-water-bottle', priceWithTax: { __typename: 'SinglePrice', value: 2900 }, currencyCode: 'USD', productAsset: { preview: 'https://images.unsplash.com/photo-1564419320461-6870880221ad?w=400&fit=crop' } },
    { id: 'fit8', productName: 'Running Shoes', slug: 'running-shoes', priceWithTax: { __typename: 'SinglePrice', value: 11900 }, currencyCode: 'USD', productAsset: { preview: 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=400&fit=crop' } },
    { id: 'fit9', productName: 'Gym Bag', slug: 'gym-bag', priceWithTax: { __typename: 'SinglePrice', value: 5900 }, currencyCode: 'USD', productAsset: { preview: 'https://images.unsplash.com/photo-1553062407-98eeb64c6a62?w=400&fit=crop' } },
    { id: 'fit10', productName: 'Jump Rope', slug: 'jump-rope', priceWithTax: { __typename: 'SinglePrice', value: 1900 }, currencyCode: 'USD', productAsset: { preview: 'https://images.unsplash.com/photo-1434608519344-49d77a124f2c?w=400&fit=crop' } },
    { id: 'fit11', productName: 'Pull-Up Bar', slug: 'pull-up-bar', priceWithTax: { __typename: 'SinglePrice', value: 4900 }, currencyCode: 'USD', productAsset: { preview: 'https://images.unsplash.com/photo-1517836357463-d25dfeac3438?w=400&fit=crop' } },
    { id: 'fit12', productName: 'Compression Leggings', slug: 'compression-leggings', priceWithTax: { __typename: 'SinglePrice', value: 5900 }, currencyCode: 'USD', productAsset: { preview: 'https://images.unsplash.com/photo-1506629082955-511b1aa562c8?w=400&fit=crop' } },
  ],

  jewelry: [
    { id: 'j1', productName: 'Diamond Solitaire Ring', slug: 'diamond-solitaire-ring', priceWithTax: { __typename: 'SinglePrice', value: 189900 }, currencyCode: 'USD', productAsset: { preview: 'https://images.unsplash.com/photo-1605100804763-247f67b3557e?w=400&fit=crop' } },
    { id: 'j2', productName: 'Gold Chain Necklace', slug: 'gold-chain-necklace', priceWithTax: { __typename: 'SinglePrice', value: 49900 }, currencyCode: 'USD', productAsset: { preview: 'https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?w=400&fit=crop' } },
    { id: 'j3', productName: 'Pearl Stud Earrings', slug: 'pearl-stud-earrings', priceWithTax: { __typename: 'SinglePrice', value: 24900 }, currencyCode: 'USD', productAsset: { preview: 'https://images.unsplash.com/photo-1602173574767-37ac01994b2a?w=400&fit=crop' } },
    { id: 'j4', productName: 'Gold Cuff Bracelet', slug: 'gold-cuff-bracelet', priceWithTax: { __typename: 'SinglePrice', value: 34900 }, currencyCode: 'USD', productAsset: { preview: 'https://images.unsplash.com/photo-1611085583191-a3b181a88552?w=400&fit=crop' } },
    { id: 'j5', productName: 'Sapphire Pendant', slug: 'sapphire-pendant', priceWithTax: { __typename: 'SinglePrice', value: 79900 }, currencyCode: 'USD', productAsset: { preview: 'https://images.unsplash.com/photo-1573408301185-9519f94815f4?w=400&fit=crop' } },
    { id: 'j6', productName: 'Hoop Earrings Gold', slug: 'hoop-earrings-gold', priceWithTax: { __typename: 'SinglePrice', value: 19900 }, currencyCode: 'USD', productAsset: { preview: 'https://images.unsplash.com/photo-1630019852942-f89202989a59?w=400&fit=crop' } },
    { id: 'j7', productName: 'Eternity Band', slug: 'eternity-band', priceWithTax: { __typename: 'SinglePrice', value: 89900 }, currencyCode: 'USD', productAsset: { preview: 'https://images.unsplash.com/photo-1589128777073-263566ae5e4d?w=400&fit=crop' } },
    { id: 'j8', productName: 'Rose Gold Watch', slug: 'rose-gold-watch', priceWithTax: { __typename: 'SinglePrice', value: 129900 }, currencyCode: 'USD', productAsset: { preview: 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=400&fit=crop' } },
    { id: 'j9', productName: 'Tennis Bracelet', slug: 'tennis-bracelet', priceWithTax: { __typename: 'SinglePrice', value: 249900 }, currencyCode: 'USD', productAsset: { preview: 'https://images.unsplash.com/photo-1535632066927-ab7c9ab60908?w=400&fit=crop' } },
    { id: 'j10', productName: 'Charm Necklace', slug: 'charm-necklace', priceWithTax: { __typename: 'SinglePrice', value: 29900 }, currencyCode: 'USD', productAsset: { preview: 'https://images.unsplash.com/photo-1599643478518-a784e5dc4c8f?w=400&fit=crop' } },
    { id: 'j11', productName: 'Gemstone Ring', slug: 'gemstone-ring', priceWithTax: { __typename: 'SinglePrice', value: 59900 }, currencyCode: 'USD', productAsset: { preview: 'https://images.unsplash.com/photo-1605100804763-247f67b3557e?w=400&fit=crop' } },
    { id: 'j12', productName: 'Silver Bangle', slug: 'silver-bangle', priceWithTax: { __typename: 'SinglePrice', value: 14900 }, currencyCode: 'USD', productAsset: { preview: 'https://images.unsplash.com/photo-1611085583191-a3b181a88552?w=400&fit=crop' } },
  ],

  generic: [
    { id: 'g1', productName: 'Premium Collection Item', slug: 'premium-item-1', priceWithTax: { __typename: 'SinglePrice', value: 4900 }, currencyCode: 'USD', productAsset: { preview: 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=400&fit=crop' } },
    { id: 'g2', productName: 'Signature Product', slug: 'signature-product', priceWithTax: { __typename: 'SinglePrice', value: 7900 }, currencyCode: 'USD', productAsset: { preview: 'https://images.unsplash.com/photo-1491553895911-0055eca6402d?w=400&fit=crop' } },
    { id: 'g3', productName: 'Best Seller', slug: 'best-seller', priceWithTax: { __typename: 'SinglePrice', value: 5900 }, currencyCode: 'USD', productAsset: { preview: 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=400&fit=crop' } },
    { id: 'g4', productName: 'New Arrival', slug: 'new-arrival', priceWithTax: { __typename: 'SinglePrice', value: 6900 }, currencyCode: 'USD', productAsset: { preview: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=400&fit=crop' } },
    { id: 'g5', productName: 'Limited Edition', slug: 'limited-edition', priceWithTax: { __typename: 'SinglePrice', value: 12900 }, currencyCode: 'USD', productAsset: { preview: 'https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=400&fit=crop' } },
    { id: 'g6', productName: 'Classic Choice', slug: 'classic-choice', priceWithTax: { __typename: 'SinglePrice', value: 3900 }, currencyCode: 'USD', productAsset: { preview: 'https://images.unsplash.com/photo-1496181133206-80ce9b88a853?w=400&fit=crop' } },
    { id: 'g7', productName: 'Popular Pick', slug: 'popular-pick', priceWithTax: { __typename: 'SinglePrice', value: 8900 }, currencyCode: 'USD', productAsset: { preview: 'https://images.unsplash.com/photo-1558769132-cb1aea458c5e?w=400&fit=crop' } },
    { id: 'g8', productName: 'Staff Favourite', slug: 'staff-favourite', priceWithTax: { __typename: 'SinglePrice', value: 4400 }, currencyCode: 'USD', productAsset: { preview: 'https://images.unsplash.com/photo-1490481651871-ab68de25d43d?w=400&fit=crop' } },
    { id: 'g9', productName: 'Essential Item', slug: 'essential-item', priceWithTax: { __typename: 'SinglePrice', value: 2900 }, currencyCode: 'USD', productAsset: { preview: 'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=400&fit=crop' } },
    { id: 'g10', productName: 'Gift Idea', slug: 'gift-idea', priceWithTax: { __typename: 'SinglePrice', value: 5500 }, currencyCode: 'USD', productAsset: { preview: 'https://images.unsplash.com/photo-1578985545062-69928b1d9587?w=400&fit=crop' } },
    { id: 'g11', productName: 'Seasonal Special', slug: 'seasonal-special', priceWithTax: { __typename: 'SinglePrice', value: 7200 }, currencyCode: 'USD', productAsset: { preview: 'https://images.unsplash.com/photo-1486427944299-d1955d23e34d?w=400&fit=crop' } },
    { id: 'g12', productName: 'Value Bundle', slug: 'value-bundle', priceWithTax: { __typename: 'SinglePrice', value: 9900 }, currencyCode: 'USD', productAsset: { preview: 'https://images.unsplash.com/photo-1607082348824-0a96f2a4b9da?w=400&fit=crop' } },
  ],
};

// ─── Categories per industry ──────────────────────────────────────────────────

const CATEGORIES_BY_INDUSTRY: Record<IndustryKey, MockCategory[]> = {
  fashion: [
    { id: 'women', name: 'Women', slug: 'women', imageUrl: 'https://images.unsplash.com/photo-1490481651871-ab68de25d43d?w=600&fit=crop' },
    { id: 'men', name: 'Men', slug: 'men', imageUrl: 'https://images.unsplash.com/photo-1620012253295-c15cc3e65df4?w=600&fit=crop' },
    { id: 'accessories', name: 'Accessories', slug: 'accessories', imageUrl: 'https://images.unsplash.com/photo-1492707892479-7bc8d5a4ee93?w=600&fit=crop' },
    { id: 'shoes', name: 'Shoes', slug: 'shoes', imageUrl: 'https://images.unsplash.com/photo-1543163521-1bf539c55dd2?w=600&fit=crop' },
  ],
  food: [
    { id: 'coffee', name: 'Coffee', slug: 'coffee', imageUrl: 'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=600&fit=crop' },
    { id: 'pastries', name: 'Pastries', slug: 'pastries', imageUrl: 'https://images.unsplash.com/photo-1555507036-ab1f4038808a?w=600&fit=crop' },
    { id: 'breads', name: 'Breads', slug: 'breads', imageUrl: 'https://images.unsplash.com/photo-1586444248902-2f64eddc13df?w=600&fit=crop' },
    { id: 'sweets', name: 'Sweets', slug: 'sweets', imageUrl: 'https://images.unsplash.com/photo-1578985545062-69928b1d9587?w=600&fit=crop' },
  ],
  tech: [
    { id: 'laptops', name: 'Laptops', slug: 'laptops', imageUrl: 'https://images.unsplash.com/photo-1496181133206-80ce9b88a853?w=600&fit=crop' },
    { id: 'audio', name: 'Audio', slug: 'audio', imageUrl: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=600&fit=crop' },
    { id: 'accessories', name: 'Accessories', slug: 'accessories', imageUrl: 'https://images.unsplash.com/photo-1602143407151-7111542de6e8?w=600&fit=crop' },
    { id: 'wearables', name: 'Wearables', slug: 'wearables', imageUrl: 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=600&fit=crop' },
  ],
  home: [
    { id: 'living', name: 'Living Room', slug: 'living-room', imageUrl: 'https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=600&fit=crop' },
    { id: 'bedroom', name: 'Bedroom', slug: 'bedroom', imageUrl: 'https://images.unsplash.com/photo-1631049307264-da0ec9d70304?w=600&fit=crop' },
    { id: 'kitchen', name: 'Kitchen', slug: 'kitchen', imageUrl: 'https://images.unsplash.com/photo-1560185893-a55cbc8c57e8?w=600&fit=crop' },
    { id: 'outdoor', name: 'Outdoor', slug: 'outdoor', imageUrl: 'https://images.unsplash.com/photo-1600210492486-724fe5c67fb0?w=600&fit=crop' },
  ],
  beauty: [
    { id: 'skincare', name: 'Skincare', slug: 'skincare', imageUrl: 'https://images.unsplash.com/photo-1620916566398-39f1143ab7be?w=600&fit=crop' },
    { id: 'makeup', name: 'Makeup', slug: 'makeup', imageUrl: 'https://images.unsplash.com/photo-1522335789203-aabd1fc54bc9?w=600&fit=crop' },
    { id: 'hair', name: 'Hair', slug: 'hair', imageUrl: 'https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?w=600&fit=crop' },
    { id: 'fragrance', name: 'Fragrance', slug: 'fragrance', imageUrl: 'https://images.unsplash.com/photo-1592945403244-b3fbafd7f539?w=600&fit=crop' },
  ],
  fitness: [
    { id: 'equipment', name: 'Equipment', slug: 'equipment', imageUrl: 'https://images.unsplash.com/photo-1517836357463-d25dfeac3438?w=600&fit=crop' },
    { id: 'apparel', name: 'Apparel', slug: 'apparel', imageUrl: 'https://images.unsplash.com/photo-1506629082955-511b1aa562c8?w=600&fit=crop' },
    { id: 'nutrition', name: 'Nutrition', slug: 'nutrition', imageUrl: 'https://images.unsplash.com/photo-1579722821273-0f6c7d44362f?w=600&fit=crop' },
    { id: 'recovery', name: 'Recovery', slug: 'recovery', imageUrl: 'https://images.unsplash.com/photo-1601925260368-ae2f83cf8b7f?w=600&fit=crop' },
  ],
  jewelry: [
    { id: 'rings', name: 'Rings', slug: 'rings', imageUrl: 'https://images.unsplash.com/photo-1605100804763-247f67b3557e?w=600&fit=crop' },
    { id: 'necklaces', name: 'Necklaces', slug: 'necklaces', imageUrl: 'https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?w=600&fit=crop' },
    { id: 'earrings', name: 'Earrings', slug: 'earrings', imageUrl: 'https://images.unsplash.com/photo-1602173574767-37ac01994b2a?w=600&fit=crop' },
    { id: 'bracelets', name: 'Bracelets', slug: 'bracelets', imageUrl: 'https://images.unsplash.com/photo-1611085583191-a3b181a88552?w=600&fit=crop' },
  ],
  generic: [
    { id: 'cat1', name: 'Featured', slug: 'featured', imageUrl: 'https://images.unsplash.com/photo-1558769132-cb1aea458c5e?w=600&fit=crop' },
    { id: 'cat2', name: 'New Arrivals', slug: 'new-arrivals', imageUrl: 'https://images.unsplash.com/photo-1607082348824-0a96f2a4b9da?w=600&fit=crop' },
    { id: 'cat3', name: 'Best Sellers', slug: 'best-sellers', imageUrl: 'https://images.unsplash.com/photo-1483985988355-763728e1935b?w=600&fit=crop' },
    { id: 'cat4', name: 'Sale', slug: 'sale', imageUrl: 'https://images.unsplash.com/photo-1607082349566-187342175e2f?w=600&fit=crop' },
  ],
};

// ─── Hero images per industry ─────────────────────────────────────────────────

const HERO_IMAGES_BY_INDUSTRY: Record<IndustryKey, string[]> = {
  fashion: [
    'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?w=1200&fit=crop',
    'https://images.unsplash.com/photo-1490481651871-ab68de25d43d?w=1200&fit=crop',
    'https://images.unsplash.com/photo-1558769132-cb1aea458c5e?w=1200&fit=crop',
  ],
  food: [
    'https://images.unsplash.com/photo-1447933601403-0c6688de566e?w=1200&fit=crop',
    'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=1200&fit=crop',
    'https://images.unsplash.com/photo-1509042239860-f550ce710b93?w=1200&fit=crop',
  ],
  tech: [
    'https://images.unsplash.com/photo-1518770660439-4636190af475?w=1200&fit=crop',
    'https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?w=1200&fit=crop',
    'https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=1200&fit=crop',
  ],
  home: [
    'https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=1200&fit=crop',
    'https://images.unsplash.com/photo-1586023492125-27b2c045efd7?w=1200&fit=crop',
    'https://images.unsplash.com/photo-1484101403633-562f891dc89a?w=1200&fit=crop',
  ],
  beauty: [
    'https://images.unsplash.com/photo-1522335789203-aabd1fc54bc9?w=1200&fit=crop',
    'https://images.unsplash.com/photo-1620916566398-39f1143ab7be?w=1200&fit=crop',
    'https://images.unsplash.com/photo-1556228578-0d85b1a4d571?w=1200&fit=crop',
  ],
  fitness: [
    'https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=1200&fit=crop',
    'https://images.unsplash.com/photo-1517836357463-d25dfeac3438?w=1200&fit=crop',
    'https://images.unsplash.com/photo-1571019614242-c5c5dee9f50b?w=1200&fit=crop',
  ],
  jewelry: [
    'https://images.unsplash.com/photo-1605100804763-247f67b3557e?w=1200&fit=crop',
    'https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?w=1200&fit=crop',
    'https://images.unsplash.com/photo-1573408301185-9519f94815f4?w=1200&fit=crop',
  ],
  generic: [
    'https://images.unsplash.com/photo-1483985988355-763728e1935b?w=1200&fit=crop',
    'https://images.unsplash.com/photo-1607082348824-0a96f2a4b9da?w=1200&fit=crop',
    'https://images.unsplash.com/photo-1558769132-cb1aea458c5e?w=1200&fit=crop',
  ],
};

// ─── Brand story images per industry ─────────────────────────────────────────

const BRAND_STORY_IMAGES_BY_INDUSTRY: Record<IndustryKey, string[]> = {
  fashion: [
    'https://images.unsplash.com/photo-1558769132-cb1aea458c5e?w=800&fit=crop',
    'https://images.unsplash.com/photo-1567401893414-76b7b1e5a7a5?w=800&fit=crop',
  ],
  food: [
    'https://images.unsplash.com/photo-1554118811-1e0d58224f24?w=800&fit=crop',
    'https://images.unsplash.com/photo-1442512595331-e89e73853f31?w=800&fit=crop',
  ],
  tech: [
    'https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=800&fit=crop',
    'https://images.unsplash.com/photo-1531482615713-2afd69097998?w=800&fit=crop',
  ],
  home: [
    'https://images.unsplash.com/photo-1484101403633-562f891dc89a?w=800&fit=crop',
    'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=800&fit=crop',
  ],
  beauty: [
    'https://images.unsplash.com/photo-1556228720-195a672e8a03?w=800&fit=crop',
    'https://images.unsplash.com/photo-1570194065650-d99fb4bedf0a?w=800&fit=crop',
  ],
  fitness: [
    'https://images.unsplash.com/photo-1571019614242-c5c5dee9f50b?w=800&fit=crop',
    'https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=800&fit=crop',
  ],
  jewelry: [
    'https://images.unsplash.com/photo-1573408301185-9519f94815f4?w=800&fit=crop',
    'https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?w=800&fit=crop',
  ],
  generic: [
    'https://images.unsplash.com/photo-1441984904996-e0b6ba687e04?w=800&fit=crop',
    'https://images.unsplash.com/photo-1562157873-818bc0726f68?w=800&fit=crop',
  ],
};

// ─── Testimonials per industry ────────────────────────────────────────────────

const TESTIMONIALS_BY_INDUSTRY: Record<IndustryKey, MockTestimonial[]> = {
  fashion: [
    { id: 't1', review: 'Absolutely love the quality. The linen shirt is so comfortable and looks incredible — I\'ve received so many compliments.', author: 'Sarah M.', rating: 5, location: 'New York' },
    { id: 't2', review: 'Fast shipping and the fit is perfect. Finally a brand that understands modern proportions. Will definitely order again.', author: 'James K.', rating: 5, location: 'London' },
    { id: 't3', review: 'The cashmere feels incredibly soft and the construction is impeccable. Worth every penny.', author: 'Émilie R.', rating: 5, location: 'Paris' },
  ],
  food: [
    { id: 't1', review: 'Best coffee I\'ve ever had. The single-origin pour over is exceptional — rich, smooth, and perfectly balanced. My morning ritual now.', author: 'Sarah M.', rating: 5, location: 'New York' },
    { id: 't2', review: 'The croissants are flaky and buttery, just like in Paris. The quality and freshness is unmatched. I order every week.', author: 'James K.', rating: 5, location: 'London' },
    { id: 't3', review: 'Discovered this gem and never looked back. The cold brew is incredible and the pastries are divine. Highly recommend!', author: 'Émilie R.', rating: 5, location: 'Paris' },
  ],
  tech: [
    { id: 't1', review: 'The laptop is phenomenal. Battery lasts all day, the display is stunning, and it handles everything I throw at it without breaking a sweat.', author: 'Sarah M.', rating: 5, location: 'San Francisco' },
    { id: 't2', review: 'Outstanding build quality and customer support. My order arrived the next day and setup was effortless. Highly recommend.', author: 'James K.', rating: 5, location: 'London' },
    { id: 't3', review: 'These earbuds changed my focus at work completely. The noise cancellation is world-class and the sound quality is audiophile-grade.', author: 'Émilie R.', rating: 5, location: 'Berlin' },
  ],
  home: [
    { id: 't1', review: 'The sofa transformed my living room. The quality is exceptional — premium fabric and sturdy frame. Well worth the investment.', author: 'Sarah M.', rating: 5, location: 'New York' },
    { id: 't2', review: 'Beautifully crafted furniture that actually arrives looking like the photos. The oak table is stunning and has received endless compliments.', author: 'James K.', rating: 5, location: 'London' },
    { id: 't3', review: 'The candles and ceramics are gorgeous. Great value for quality this high. My home feels like a boutique hotel now.', author: 'Émilie R.', rating: 5, location: 'Paris' },
  ],
  beauty: [
    { id: 't1', review: 'The Vitamin C serum cleared my skin in just two weeks. I\'ve tried countless brands and nothing compares — my skin glows now.', author: 'Sarah M.', rating: 5, location: 'New York' },
    { id: 't2', review: 'Finally found a moisturiser that actually works for my combination skin. Lightweight, non-greasy, and keeps me hydrated all day.', author: 'James K.', rating: 5, location: 'London' },
    { id: 't3', review: 'The packaging is gorgeous and the products deliver real results. I\'ve recommended this brand to every friend I have.', author: 'Émilie R.', rating: 5, location: 'Paris' },
  ],
  fitness: [
    { id: 't1', review: 'The yoga mat is exceptional — perfect grip, great cushioning, and easy to clean. My practice has completely transformed.', author: 'Sarah M.', rating: 5, location: 'New York' },
    { id: 't2', review: 'Best resistance bands I\'ve owned. Durable, versatile, and the quality is way above what you\'d expect at this price.', author: 'James K.', rating: 5, location: 'London' },
    { id: 't3', review: 'The protein powder tastes great and mixes perfectly. My recovery has improved dramatically since switching to this brand.', author: 'Émilie R.', rating: 5, location: 'Paris' },
  ],
  jewelry: [
    { id: 't1', review: 'The diamond ring is breathtaking. The craftsmanship is extraordinary and it arrived in the most beautiful packaging. Absolutely stunning.', author: 'Sarah M.', rating: 5, location: 'New York' },
    { id: 't2', review: 'I bought the gold chain for my partner and she hasn\'t taken it off since. Exceptional quality and a timeless design.', author: 'James K.', rating: 5, location: 'London' },
    { id: 't3', review: 'The pearl earrings are elegant and the quality is impeccable. I\'ve been collecting from this brand for years. Never disappoints.', author: 'Émilie R.', rating: 5, location: 'Paris' },
  ],
  generic: [
    { id: 't1', review: 'Outstanding product quality and service. The attention to detail is clear in every item. Will absolutely be ordering again.', author: 'Sarah M.', rating: 5, location: 'New York' },
    { id: 't2', review: 'Fast delivery, excellent packaging, and the product exceeded my expectations. This brand sets the standard for quality.', author: 'James K.', rating: 5, location: 'London' },
    { id: 't3', review: 'I\'ve tried many brands and this stands above all. Exceptional quality, fair pricing, and responsive customer support.', author: 'Émilie R.', rating: 5, location: 'Paris' },
  ],
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Get N products from the industry-appropriate pool */
export function getProducts(count: number, offset = 0, industryType = ''): MockProduct[] {
  const key = resolveIndustryKey(industryType);
  const pool = PRODUCTS_BY_INDUSTRY[key];
  const start = offset % pool.length;
  const result: MockProduct[] = [];
  for (let i = 0; i < count; i++) {
    result.push(pool[(start + i) % pool.length]);
  }
  return result;
}

/** Get N categories from the industry-appropriate pool */
export function getCategories(count: number, industryType = ''): MockCategory[] {
  const key = resolveIndustryKey(industryType);
  const pool = CATEGORIES_BY_INDUSTRY[key];
  return pool.slice(0, Math.min(count, pool.length));
}

/** Get a hero image URL appropriate to the industry */
export function getHeroImage(index = 0, industryType = ''): string {
  const key = resolveIndustryKey(industryType);
  const pool = HERO_IMAGES_BY_INDUSTRY[key];
  return pool[index % pool.length];
}

/** Get a brand story image URL appropriate to the industry */
export function getBrandStoryImage(index = 0, industryType = ''): string {
  const key = resolveIndustryKey(industryType);
  const pool = BRAND_STORY_IMAGES_BY_INDUSTRY[key];
  return pool[index % pool.length];
}

/** Get N testimonials appropriate to the industry */
export function getTestimonials(count: number, industryType = ''): MockTestimonial[] {
  const key = resolveIndustryKey(industryType);
  const pool = TESTIMONIALS_BY_INDUSTRY[key];
  return pool.slice(0, Math.min(count, pool.length));
}

// ─── New section content ──────────────────────────────────────────────────────

export interface MockHowItWorksStep {
  step: string;
  title: string;
  description: string;
}

export interface MockBlogPost {
  id: string;
  title: string;
  excerpt: string;
  category: string;
  imageUrl: string;
  path: string;
}

export interface MockFounderStory {
  founderName: string;
  bio: string;
  quote: string;
  imageUrl: string;
}

export interface MockLoyaltyTier {
  name: string;
  range: string;
  benefits: string[];
}

const HOW_IT_WORKS_BY_INDUSTRY: Record<IndustryKey, MockHowItWorksStep[]> = {
  fashion: [
    { step: '01', title: 'Browse & Discover', description: 'Explore our curated collections and find pieces that speak to your style.' },
    { step: '02', title: 'Easy Checkout', description: 'Secure checkout with free shipping on all orders over $50.' },
    { step: '03', title: 'Delivered to You', description: 'Premium packaging, carefully wrapped and delivered within 2-3 business days.' },
  ],
  food: [
    { step: '01', title: 'Choose Your Order', description: 'Select from our seasonal menu of freshly crafted items, available daily.' },
    { step: '02', title: 'We Prepare It Fresh', description: 'Every item is made to order using the finest ingredients sourced locally.' },
    { step: '03', title: 'Pick Up or Delivery', description: 'Choose same-day pickup or next-day delivery to your door.' },
  ],
  tech: [
    { step: '01', title: 'Configure Your Setup', description: 'Choose the perfect specs for your workflow — we\'ll help you decide.' },
    { step: '02', title: 'Expert Assembly', description: 'Our technicians build, test, and benchmark every device before shipping.' },
    { step: '03', title: 'Setup Support', description: 'Free setup assistance and 2-year warranty on every purchase.' },
  ],
  home: [
    { step: '01', title: 'Find Your Style', description: 'Browse thousands of pieces across contemporary, minimal, and classic styles.' },
    { step: '02', title: 'Free Delivery', description: 'White-glove delivery to your door, with optional in-home assembly.' },
    { step: '03', title: 'Love It or Return It', description: '30-day hassle-free returns. We want you to love every piece.' },
  ],
  beauty: [
    { step: '01', title: 'Take the Skin Quiz', description: 'Answer a few questions and get a personalized routine tailored to your skin.' },
    { step: '02', title: 'Your Routine Ships', description: 'Carefully formulated products arrive in eco-friendly packaging within 3 days.' },
    { step: '03', title: 'Track Your Results', description: 'Track your skin progress monthly and adjust your routine anytime.' },
  ],
  fitness: [
    { step: '01', title: 'Set Your Goal', description: 'Tell us your fitness goal — we\'ll recommend the right gear and supplements.' },
    { step: '02', title: 'Build Your Kit', description: 'Bundle your essentials and save up to 25% with our starter packs.' },
    { step: '03', title: 'Train & Track', description: 'Access exclusive training plans and track your progress in-app.' },
  ],
  jewelry: [
    { step: '01', title: 'Select Your Piece', description: 'Browse our collection of handcrafted fine jewelry, made to order.' },
    { step: '02', title: 'Personalize It', description: 'Add engravings, choose metals, and customize to make it uniquely yours.' },
    { step: '03', title: 'Crafted & Delivered', description: 'Hand-polished by our artisans and delivered in a premium gift box.' },
  ],
  generic: [
    { step: '01', title: 'Explore', description: 'Browse our curated selection and find exactly what you\'re looking for.' },
    { step: '02', title: 'Order with Confidence', description: 'Secure checkout, free shipping over $50, and 30-day returns.' },
    { step: '03', title: 'Delivered Fast', description: 'Orders shipped within 24 hours, tracked every step of the way.' },
  ],
};

const BLOG_POSTS_BY_INDUSTRY: Record<IndustryKey, MockBlogPost[]> = {
  fashion: [
    { id: 'b1', title: 'The Art of Capsule Wardrobing', excerpt: 'How to build a timeless wardrobe with fewer, better pieces.', category: 'Style Guide', imageUrl: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=600&fit=crop', path: '/blog/capsule-wardrobe' },
    { id: 'b2', title: 'SS26 Trend Report', excerpt: 'The key silhouettes, textures, and colors defining this season.', category: 'Trends', imageUrl: 'https://images.unsplash.com/photo-1509631179647-0177331693ae?w=600&fit=crop', path: '/blog/ss26-trends' },
    { id: 'b3', title: 'How to Style Linen in Summer', excerpt: 'Master the effortless linen look with these styling tips.', category: 'How To', imageUrl: 'https://images.unsplash.com/photo-1596755094514-f87e34085b2c?w=600&fit=crop', path: '/blog/linen-summer' },
  ],
  food: [
    { id: 'b1', title: 'The Perfect Pour Over Guide', excerpt: 'Master the art of pour-over coffee at home with our step-by-step guide.', category: 'Brew Guide', imageUrl: 'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=600&fit=crop', path: '/blog/pour-over' },
    { id: 'b2', title: 'Seasonal Menu: Spring 2026', excerpt: 'Discover what\'s fresh on our spring menu featuring locally sourced ingredients.', category: 'Menu', imageUrl: 'https://images.unsplash.com/photo-1555507036-ab1f4038808a?w=600&fit=crop', path: '/blog/spring-menu' },
    { id: 'b3', title: 'Behind the Bakery', excerpt: 'A morning with our head pastry chef and the stories behind our signature items.', category: 'Behind the Scenes', imageUrl: 'https://images.unsplash.com/photo-1586444248902-2f64eddc13df?w=600&fit=crop', path: '/blog/behind-bakery' },
  ],
  beauty: [
    { id: 'b1', title: 'Build Your Perfect Skincare Routine', excerpt: 'How to layer products correctly for maximum efficacy.', category: 'Skincare 101', imageUrl: 'https://images.unsplash.com/photo-1570194065650-d99fb4ee4e61?w=600&fit=crop', path: '/blog/skincare-routine' },
    { id: 'b2', title: 'The Power of Vitamin C', excerpt: 'Everything you need to know about adding Vitamin C to your routine.', category: 'Ingredients', imageUrl: 'https://images.unsplash.com/photo-1556228720-195a672e8a03?w=600&fit=crop', path: '/blog/vitamin-c' },
    { id: 'b3', title: 'Clean Beauty: What It Really Means', excerpt: 'Cutting through the greenwashing to understand truly clean formulas.', category: 'Education', imageUrl: 'https://images.unsplash.com/photo-1556760544-74068565f05c?w=600&fit=crop', path: '/blog/clean-beauty' },
  ],
  fitness: [
    { id: 'b1', title: 'The 30-Day Challenge That Changed Everything', excerpt: 'Our community shares their transformation stories from the January challenge.', category: 'Community', imageUrl: 'https://images.unsplash.com/photo-1517836357463-d25dfeac3438?w=600&fit=crop', path: '/blog/30-day-challenge' },
    { id: 'b2', title: 'Gear Guide: Setting Up Your Home Gym', excerpt: 'Everything you need for an effective home workout space under $300.', category: 'Gear Guide', imageUrl: 'https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=600&fit=crop', path: '/blog/home-gym' },
    { id: 'b3', title: 'Nutrition Timing for Peak Performance', excerpt: 'When to eat protein, carbs, and fats around your workouts.', category: 'Nutrition', imageUrl: 'https://images.unsplash.com/photo-1571019614242-c5c5dee9f50b?w=600&fit=crop', path: '/blog/nutrition-timing' },
  ],
  tech: [
    { id: 'b1', title: 'M3 Pro vs M4: Which Should You Choose?', excerpt: 'A comprehensive comparison for creative professionals and developers.', category: 'Reviews', imageUrl: 'https://images.unsplash.com/photo-1517336714731-489689fd1ca8?w=600&fit=crop', path: '/blog/m3-vs-m4' },
    { id: 'b2', title: 'Setting Up the Ultimate Desk Setup', excerpt: 'Build a distraction-free, ergonomic workspace for peak productivity.', category: 'Setup Guide', imageUrl: 'https://images.unsplash.com/photo-1593640495253-23196b27a87f?w=600&fit=crop', path: '/blog/desk-setup' },
    { id: 'b3', title: 'Why Storage Speed Matters More Than RAM', excerpt: 'The counterintuitive truth about modern computer performance.', category: 'Deep Dive', imageUrl: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=600&fit=crop', path: '/blog/storage-vs-ram' },
  ],
  home: [
    { id: 'b1', title: 'The Minimal Home Edit', excerpt: 'How to declutter and redesign your space with intention.', category: 'Interior Design', imageUrl: 'https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=600&fit=crop', path: '/blog/minimal-home' },
    { id: 'b2', title: 'Spring Refresh: Easy Decor Updates', excerpt: 'Five affordable ways to refresh your home for the new season.', category: 'Seasonal', imageUrl: 'https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?w=600&fit=crop', path: '/blog/spring-refresh' },
    { id: 'b3', title: 'The Art of Tablescaping', excerpt: 'Create a beautiful dining table for every occasion with these tips.', category: 'Styling', imageUrl: 'https://images.unsplash.com/photo-1490750967868-88df5691cc7e?w=600&fit=crop', path: '/blog/tablescaping' },
  ],
  jewelry: [
    { id: 'b1', title: 'The Jewelry Stacking Guide', excerpt: 'How to layer necklaces, rings, and bracelets like a professional stylist.', category: 'Styling', imageUrl: 'https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?w=600&fit=crop', path: '/blog/stacking-guide' },
    { id: 'b2', title: 'Understanding Diamond Quality', excerpt: 'The 4 C\'s explained simply — what to look for when buying a diamond.', category: 'Education', imageUrl: 'https://images.unsplash.com/photo-1573408301185-9519f94815f4?w=600&fit=crop', path: '/blog/diamonds' },
    { id: 'b3', title: 'How to Care for Fine Jewelry', excerpt: 'Simple habits to keep your pieces sparkling for generations.', category: 'Care Guide', imageUrl: 'https://images.unsplash.com/photo-1602173574767-37ac01994b2a?w=600&fit=crop', path: '/blog/jewelry-care' },
  ],
  generic: [
    { id: 'b1', title: 'The Story Behind Our Brand', excerpt: 'How we started and why quality has always been our north star.', category: 'About Us', imageUrl: 'https://images.unsplash.com/photo-1553877522-43269d4ea984?w=600&fit=crop', path: '/blog/our-story' },
    { id: 'b2', title: 'Customer Spotlight: Real Stories', excerpt: 'How our customers are using our products to improve their daily lives.', category: 'Community', imageUrl: 'https://images.unsplash.com/photo-1516321497487-e288fb19713f?w=600&fit=crop', path: '/blog/customer-stories' },
    { id: 'b3', title: 'What Sets Us Apart', excerpt: 'The materials, processes, and people that make everything we create different.', category: 'Quality', imageUrl: 'https://images.unsplash.com/photo-1562157873-818bc0726f68?w=600&fit=crop', path: '/blog/difference' },
  ],
};

const FOUNDER_STORY_BY_INDUSTRY: Record<IndustryKey, MockFounderStory> = {
  fashion: { founderName: 'Marie Laurent', bio: 'Marie spent 15 years in Parisian fashion houses before founding her own label — driven by a belief that luxury should be sustainable, wearable, and timeless. Every collection reflects her obsession with impeccable craftsmanship and materials that improve with age.', quote: 'I started this brand because I was tired of fashion that was beautiful for a season. I wanted to create pieces people would treasure for a lifetime.', imageUrl: 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=600&fit=crop&q=80' },
  food: { founderName: 'Thomas Moreau', bio: 'Thomas trained as a pastry chef in Lyon before opening his first bakery in a converted warehouse. His philosophy is simple: exceptional ingredients, traditional techniques, and never compromising on quality.', quote: 'Great food is about respect — for the ingredients, for the craft, and for the people who will enjoy it.', imageUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=600&fit=crop&q=80' },
  beauty: { founderName: 'Anya Kim', bio: 'Anya founded the brand after struggling for years to find products that worked for her sensitive, combination skin. She partnered with dermatologists to create a line built on clinical efficacy and complete ingredient transparency.', quote: 'Your skin is the most important outfit you wear. We created this brand to give everyone access to skincare that actually works.', imageUrl: 'https://images.unsplash.com/photo-1494790108755-2616b612b2cc?w=600&fit=crop&q=80' },
  fitness: { founderName: 'Marcus Reid', bio: 'Marcus competed as a professional athlete for 12 years before founding the brand. Frustrated by gear that looked good but failed under real training conditions, he started designing from the inside out — function first, always.', quote: 'I built this brand for athletes who are serious about their craft. Every product is tested in real conditions because average gear produces average results.', imageUrl: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=600&fit=crop&q=80' },
  tech: { founderName: 'Sara Chen', bio: 'Sara built her first computer at age 12. After a decade at leading hardware companies, she founded the brand to bring enterprise-grade performance to independent creators and developers — without the enterprise price tag.', quote: 'Technology should empower you, not hold you back. We exist to give every creator the tools the professionals use.', imageUrl: 'https://images.unsplash.com/photo-1580489944761-15a19d654956?w=600&fit=crop&q=80' },
  home: { founderName: 'Luca Romano', bio: 'Luca grew up in his family\'s furniture workshop in northern Italy. After studying industrial design in Milan, he brought old-world craftsmanship together with contemporary minimalist aesthetics to create pieces built to last generations.', quote: 'A well-made piece of furniture is an act of respect for the future. We build things that your grandchildren will still be using.', imageUrl: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=600&fit=crop&q=80' },
  jewelry: { founderName: 'Isabella Costa', bio: 'Isabella is a third-generation goldsmith who trained under her grandmother in Porto. Combining centuries-old metalworking techniques with modern design sensibility, each piece she creates is a marriage of heritage and contemporary elegance.', quote: 'Fine jewelry should tell a story. I create pieces designed to become heirlooms — things passed down with love, not sold off.', imageUrl: 'https://images.unsplash.com/photo-1487412720507-e7ab37603c6f?w=600&fit=crop&q=80' },
  generic: { founderName: 'Alex Morgan', bio: 'Alex founded the brand after noticing a gap between quality and accessibility in the market. The mission has always been simple: make the best version of every product we create, and make it available to everyone.', quote: 'Quality shouldn\'t be a luxury. We built this brand to prove that great products can be both exceptional and accessible.', imageUrl: 'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?w=600&fit=crop&q=80' },
};

// ─── Helpers (new sections) ───────────────────────────────────────────────────

/** Get how-it-works steps for the industry */
export function getHowItWorksSteps(industryType = ''): MockHowItWorksStep[] {
  return HOW_IT_WORKS_BY_INDUSTRY[resolveIndustryKey(industryType)];
}

/** Get blog posts for the industry */
export function getBlogPosts(count: number, industryType = ''): MockBlogPost[] {
  const key = resolveIndustryKey(industryType);
  return BLOG_POSTS_BY_INDUSTRY[key].slice(0, count);
}

/** Get founder story for the industry */
export function getFounderStory(industryType = ''): MockFounderStory {
  return FOUNDER_STORY_BY_INDUSTRY[resolveIndustryKey(industryType)];
}

// ─── Legacy exports (for backward compat) ────────────────────────────────────
export const FASHION_PRODUCTS = PRODUCTS_BY_INDUSTRY.fashion;
export const CATEGORIES = CATEGORIES_BY_INDUSTRY.fashion;
export const HERO_IMAGES = HERO_IMAGES_BY_INDUSTRY.fashion;
export const BRAND_STORY_IMAGES = BRAND_STORY_IMAGES_BY_INDUSTRY.fashion;
export const TESTIMONIALS = TESTIMONIALS_BY_INDUSTRY.fashion;
