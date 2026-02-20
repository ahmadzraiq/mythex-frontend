import { NextResponse } from 'next/server';
import { getBestSellers } from '@/lib/mock-data';

function toCardFormat(p: { id: string; slug: string; name: string; brand: string; price: number; compareAtPrice?: number; image: string; isNew?: boolean; isBestSeller?: boolean }) {
  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    brand: p.brand,
    price: `AED ${p.price}`,
    originalPrice: p.compareAtPrice ? `AED ${p.compareAtPrice}` : undefined,
    image: p.image,
    badge: p.isNew ? 'New' : p.compareAtPrice ? 'Sale' : p.isBestSeller ? 'Bestseller' : undefined,
  };
}

export async function GET() {
  const items = getBestSellers().map(toCardFormat);
  return NextResponse.json(items);
}
