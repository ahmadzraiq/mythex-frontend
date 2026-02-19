import { NextRequest, NextResponse } from 'next/server';
import { products } from './store';

export async function GET() {
  return NextResponse.json(products);
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, price, category, description } = body;
    if (!name || price == null || !category) {
      return NextResponse.json(
        { message: 'Name, price and category are required' },
        { status: 400 }
      );
    }
    const product = {
      id: String(Date.now()),
      name: String(name),
      price: Number(price),
      category: String(category),
      description: description ? String(description) : undefined,
    };
    products.push(product);
    return NextResponse.json(product);
  } catch {
    return NextResponse.json({ message: 'Create failed' }, { status: 500 });
  }
}
