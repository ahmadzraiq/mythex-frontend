import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { email, shippingAddress, shippingMethod, paymentMethod, orderNotes, items } = body;

    const orderId = `ORD-${Date.now()}`;
    const placedAt = new Date().toISOString();

    return NextResponse.json({
      id: orderId,
      placedAt,
      email: email ?? '',
      shippingAddress: shippingAddress ?? {},
      shippingMethod: shippingMethod ?? 'standard',
      paymentMethod: paymentMethod ?? 'card',
      orderNotes: orderNotes ?? '',
      items: Array.isArray(items) ? items : [],
    });
  } catch {
    return NextResponse.json({ message: 'Failed to create order' }, { status: 500 });
  }
}
