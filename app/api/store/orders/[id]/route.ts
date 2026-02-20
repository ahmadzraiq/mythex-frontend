import { NextResponse } from 'next/server';

const MOCK_ORDERS: Record<string, { id: string; date: string; status: string; total: string; subtotal: string; shipping: string; items: { product: { name: string; image: string; price: string }; quantity: number; variant: string }[]; shippingAddress: string }> = {
  'ORD-2847': {
    id: 'ORD-2847',
    date: 'Feb 15, 2025',
    status: 'Delivered',
    total: 'AED 597',
    subtotal: 'AED 569',
    shipping: 'AED 28',
    items: [
      { product: { name: 'Silk Blouse', image: 'https://images.unsplash.com/photo-1564257631407-4deb1f99d992?w=400', price: 'AED 299' }, quantity: 1, variant: 'Size M' },
      { product: { name: 'Wool Trousers', image: 'https://images.unsplash.com/photo-1594938298603-c8148c4dae35?w=400', price: 'AED 298' }, quantity: 1, variant: 'Size 32' },
    ],
    shippingAddress: 'Villa 12, Palm Jumeirah, Dubai',
  },
  'ORD-2841': {
    id: 'ORD-2841',
    date: 'Feb 10, 2025',
    status: 'Shipped',
    total: 'AED 429',
    subtotal: 'AED 401',
    shipping: 'AED 28',
    items: [
      { product: { name: 'Cotton Shirt', image: 'https://images.unsplash.com/photo-1596755094514-f87e34085b2c?w=400', price: 'AED 429' }, quantity: 1, variant: 'Size L' },
    ],
    shippingAddress: 'Level 5, DIFC Gate Avenue, Dubai',
  },
  'ORD-2835': {
    id: 'ORD-2835',
    date: 'Feb 5, 2025',
    status: 'Delivered',
    total: 'AED 898',
    subtotal: 'AED 870',
    shipping: 'AED 28',
    items: [
      { product: { name: 'Leather Jacket', image: 'https://images.unsplash.com/photo-1551028719-00167b16eac5?w=400', price: 'AED 599' }, quantity: 1, variant: 'Size M' },
      { product: { name: 'Denim Jeans', image: 'https://images.unsplash.com/photo-1541099649105-f69ad21f3246?w=400', price: 'AED 299' }, quantity: 1, variant: 'Size 32' },
    ],
    shippingAddress: 'Villa 12, Palm Jumeirah, Dubai',
  },
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const order = MOCK_ORDERS[id];
  if (!order) {
    return NextResponse.json({ message: 'Order not found' }, { status: 404 });
  }
  return NextResponse.json(order);
}
