import { NextResponse } from 'next/server';
import { products } from '@/lib/mock-data';

function toCardFormat(p: (typeof products)[0]) {
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
  return NextResponse.json(products.map(toCardFormat));
}
