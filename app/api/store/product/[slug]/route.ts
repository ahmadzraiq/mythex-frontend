import { NextRequest, NextResponse } from 'next/server';
import { getProductBySlug, getRelatedProducts, getFrequentlyBoughtTogether, getRecentlyViewed } from '@/lib/mock-data';

function formatProductForCard(p: { id: string; slug: string; name: string; brand: string; price: number; compareAtPrice?: number; image: string; rating?: number; reviewCount?: number }) {
  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    brand: p.brand,
    price: `AED ${p.price}`,
    originalPrice: p.compareAtPrice ? `AED ${p.compareAtPrice}` : undefined,
    image: p.image,
    rating: p.rating,
    reviewCount: p.reviewCount,
  };
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const p = getProductBySlug(slug);
  if (!p) {
    return NextResponse.json({ error: 'Product not found' }, { status: 404 });
  }
  const images =
    p.images?.map((i) => (typeof i === 'string' ? i : (i as { src: string }).src)) ?? [p.image];
  const rating = p.rating ?? 4.5;
  const reviewCount = p.reviewCount ?? 0;
  const reviews = [
    { id: 'rev-1', author: 'Sarah M.', rating: 5, date: '2024-01-15', title: 'Perfect fit and quality', body: 'Absolutely love this piece. The quality is outstanding and it fits true to size.' },
    { id: 'rev-2', author: 'Alex K.', rating: 4, date: '2024-01-10', title: 'Great value', body: 'Good quality for the price. Would recommend to friends.' },
    { id: 'rev-3', author: 'Jordan L.', rating: 5, date: '2024-01-05', title: 'Exceeded expectations', body: 'Better than I expected. Fast shipping too!' },
  ];
  const breakdownCounts = [
    { stars: 5, count: 12 },
    { stars: 4, count: 8 },
    { stars: 3, count: 2 },
    { stars: 2, count: 1 },
    { stars: 1, count: 0 },
  ];
  const total = breakdownCounts.reduce((s, r) => s + r.count, 0);
  const ratingBreakdown = breakdownCounts.map((r) => ({
    ...r,
    pct: total > 0 ? Math.round((r.count / total) * 100) : 0,
  }));
  const product = {
    selectedImage: images[0],
    id: p.id,
    slug: p.slug,
    name: p.name,
    brand: p.brand,
    price: `AED ${p.price}`,
    originalPrice: p.compareAtPrice ? `AED ${p.compareAtPrice}` : undefined,
    description: 'Crafted from premium materials with attention to detail. Perfect for the modern wardrobe.',
    image: p.image,
    images,
    variants: { size: ['XS', 'S', 'M', 'L', 'XL'], color: ['Black', 'Navy', 'White'] },
    selectedSize: 'M',
    selectedColor: 'Black',
    stock: 'in_stock',
    stockCount: 15,
    sku: `${p.id.toUpperCase().replace('-', '-')}-001`,
    material: 'Premium materials',
    care: 'Machine wash cold. Tumble dry low.',
    rating,
    reviewCount,
    reviews,
    ratingBreakdown,
    relatedProducts: getRelatedProducts(p.category, p.id).map(formatProductForCard),
    frequentlyBoughtTogether: getFrequentlyBoughtTogether(p.id).map(formatProductForCard),
    recentlyViewed: getRecentlyViewed(p.id, p.category).map(formatProductForCard),
  };
  return NextResponse.json(product);
}
