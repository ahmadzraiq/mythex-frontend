import { NextRequest, NextResponse } from 'next/server';
import { getProductBySlug } from '@/lib/mock-data';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const p = getProductBySlug(slug);
  if (!p) {
    return NextResponse.json({ error: 'Product not found' }, { status: 404 });
  }
  const product = {
    id: p.id,
    slug: p.slug,
    name: p.name,
    brand: p.brand,
    price: `AED ${p.price}`,
    originalPrice: p.compareAtPrice ? `AED ${p.compareAtPrice}` : undefined,
    description: 'Crafted from premium materials with attention to detail. Perfect for the modern wardrobe.',
    image: p.image,
    images: [p.image],
    variants: { size: ['XS', 'S', 'M', 'L', 'XL'], color: ['Black', 'Navy', 'White'] },
    selectedSize: 'M',
    selectedColor: 'Black',
    stock: 'in_stock',
    stockCount: 15,
    sku: `${p.id.toUpperCase().replace('-', '-')}-001`,
    material: 'Premium materials',
    care: 'Machine wash cold. Tumble dry low.',
  };
  return NextResponse.json(product);
}
