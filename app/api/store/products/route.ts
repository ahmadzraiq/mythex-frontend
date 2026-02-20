import { NextRequest, NextResponse } from 'next/server';
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

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const category = searchParams.get('category');
  const sort = searchParams.get('sort');
  const size = searchParams.get('size');
  const q = searchParams.get('q');

  let filtered = [...products];

  if (q) {
    const lower = q.toLowerCase();
    filtered = filtered.filter(
      (p) =>
        p.name.toLowerCase().includes(lower) ||
        p.brand.toLowerCase().includes(lower) ||
        p.category.toLowerCase().includes(lower)
    );
  }

  if (category) {
    filtered = filtered.filter((p) => p.category === category);
  }

  if (size) {
    filtered = filtered.filter((p) => {
      const pAny = p as { sizes?: string[] };
      return pAny.sizes?.includes(size) ?? true;
    });
  }

  if (sort === 'price-asc') {
    filtered.sort((a, b) => a.price - b.price);
  } else if (sort === 'price-desc') {
    filtered.sort((a, b) => b.price - a.price);
  } else {
    filtered.sort((a, b) => {
      const aNew = (a as { isNew?: boolean }).isNew ? 1 : 0;
      const bNew = (b as { isNew?: boolean }).isNew ? 1 : 0;
      return bNew - aNew || 0;
    });
  }

  return NextResponse.json(filtered.map(toCardFormat));
}
