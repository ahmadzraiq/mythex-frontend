import { NextResponse } from 'next/server';
import {
  products,
  categories,
  collections,
  getNewArrivals,
  getBestSellers,
  getFlashSaleProducts,
} from '@/lib/mock-data';

export async function GET() {
  const newArrivals = getNewArrivals().map((p) => ({
    id: p.id,
    slug: p.slug,
    name: p.name,
    brand: p.brand,
    price: `AED ${p.price}`,
    originalPrice: p.compareAtPrice ? `AED ${p.compareAtPrice}` : undefined,
    image: p.image,
    badge: p.isNew ? 'New' : p.compareAtPrice ? 'Sale' : p.isBestSeller ? 'Bestseller' : undefined,
  }));
  const bestSellers = getBestSellers().map((p) => ({
    id: p.id,
    slug: p.slug,
    name: p.name,
    brand: p.brand,
    price: `AED ${p.price}`,
    originalPrice: p.compareAtPrice ? `AED ${p.compareAtPrice}` : undefined,
    image: p.image,
    badge: p.isNew ? 'New' : p.compareAtPrice ? 'Sale' : p.isBestSeller ? 'Bestseller' : undefined,
  }));
  const flashSale = getFlashSaleProducts().map((p) => ({
    id: p.id,
    slug: p.slug,
    name: p.name,
    brand: p.brand,
    price: `AED ${p.price}`,
    originalPrice: p.compareAtPrice ? `AED ${p.compareAtPrice}` : undefined,
    image: p.image,
    badge: p.isNew ? 'New' : p.compareAtPrice ? 'Sale' : undefined,
  }));
  return NextResponse.json({
    products,
    categories,
    collections,
    newArrivals,
    bestSellers,
    flashSale,
  });
}
