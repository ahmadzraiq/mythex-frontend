/**
 * Mock store data - NOIR & AURA fashion store
 */

export const categories = [
  { id: "cat-women", slug: "women", name: "Women", image: "https://images.unsplash.com/photo-1487412720507-e7ab37603c6f?w=600&h=800&fit=crop", productCount: 42 },
  { id: "cat-men", slug: "men", name: "Men", image: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=600&h=800&fit=crop", productCount: 38 },
  { id: "cat-kids", slug: "kids", name: "Kids", image: "https://images.unsplash.com/photo-1503944583220-79d8926ad5e2?w=600&h=800&fit=crop", productCount: 25 },
  { id: "cat-accessories", slug: "accessories", name: "Accessories", image: "https://images.unsplash.com/photo-1606760227091-3dd870d97f1d?w=600&h=800&fit=crop", productCount: 30 },
];

export const collections = [
  { id: "col-summer", slug: "summer-essentials", name: "Summer Essentials", description: "Stay cool and stylish", image: "https://images.unsplash.com/photo-1469334031218-e382a71b716b?w=800&h=600&fit=crop" },
  { id: "col-formal", slug: "formal-wear", name: "Formal Wear", description: "Dress to impress", image: "https://images.unsplash.com/photo-1594938298603-c8148c4dae35?w=800&h=600&fit=crop" },
  { id: "col-active", slug: "activewear", name: "Activewear", description: "Performance meets style", image: "https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?w=800&h=600&fit=crop" },
  { id: "col-modest", slug: "modest-fashion", name: "Modest Fashion", description: "Elegance redefined", image: "https://images.unsplash.com/photo-1590330297626-d7aff25a0431?w=800&h=600&fit=crop" },
];

export interface StoreProduct {
  id: string;
  slug: string;
  name: string;
  brand: string;
  price: number;
  compareAtPrice?: number;
  category: string;
  image: string;
  images?: { src: string; alt: string }[];
  isNew?: boolean;
  isBestSeller?: boolean;
  rating?: number;
  reviewCount?: number;
}

export const products: StoreProduct[] = [
  { id: "prod-1", slug: "linen-blend-blazer", name: "Linen Blend Blazer", brand: "NOIR", price: 459, compareAtPrice: 599, category: "men", image: "https://images.unsplash.com/photo-1594938298603-c8148c4dae35?w=800&h=1000&fit=crop", isBestSeller: true, rating: 4.5, reviewCount: 23 },
  { id: "prod-2", slug: "flowing-maxi-dress", name: "Flowing Maxi Dress", brand: "AURA", price: 349, category: "women", image: "https://images.unsplash.com/photo-1496747611176-843222e1e57c?w=800&h=1000&fit=crop", isNew: true, isBestSeller: true, rating: 4.8, reviewCount: 45 },
  { id: "prod-3", slug: "classic-leather-sneakers", name: "Classic Leather Sneakers", brand: "STRIDE", price: 289, category: "men", image: "https://images.unsplash.com/photo-1549298916-b41d501d3772?w=800&h=1000&fit=crop", isBestSeller: true, rating: 4.6, reviewCount: 67 },
  { id: "prod-4", slug: "silk-scarf-paisley", name: "Silk Scarf - Paisley Print", brand: "LUXE", price: 199, compareAtPrice: 279, category: "accessories", image: "https://images.unsplash.com/photo-1606760227091-3dd870d97f1d?w=800&h=1000&fit=crop", isNew: true, rating: 4.9, reviewCount: 31 },
  { id: "prod-5", slug: "tailored-chinos", name: "Tailored Chinos", brand: "NOIR", price: 219, category: "men", image: "https://images.unsplash.com/photo-1473966968600-fa801b869a1a?w=800&h=1000&fit=crop", isBestSeller: true, rating: 4.4, reviewCount: 52 },
  { id: "prod-6", slug: "oversized-cotton-tee", name: "Oversized Cotton Tee", brand: "AURA", price: 129, category: "women", image: "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=800&h=1000&fit=crop", isBestSeller: true, rating: 4.7, reviewCount: 89 },
  { id: "prod-7", slug: "structured-tote-bag", name: "Structured Tote Bag", brand: "LUXE", price: 389, category: "accessories", image: "https://images.unsplash.com/photo-1584917865442-de89df76afd3?w=800&h=1000&fit=crop", isNew: true, rating: 4.8, reviewCount: 28 },
  { id: "prod-8", slug: "ribbed-knit-cardigan", name: "Ribbed Knit Cardigan", brand: "AURA", price: 269, category: "women", image: "https://images.unsplash.com/photo-1434389677669-e08b4cda3a73?w=800&h=1000&fit=crop", isNew: true, rating: 4.6, reviewCount: 34 },
];

export const flashSale = { id: "fs-1", title: "Weekend Flash Sale", endsAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(), productIds: ["prod-1", "prod-4", "prod-6"] };

export function getProductBySlug(slug: string): StoreProduct | undefined {
  return products.find((p) => p.slug === slug);
}

export function getNewArrivals() {
  return products.filter((p) => p.isNew).slice(0, 4);
}

export function getBestSellers() {
  return products.filter((p) => p.isBestSeller).slice(0, 4);
}

export function getFlashSaleProducts() {
  return products.filter((p) => flashSale.productIds.includes(p.id));
}
