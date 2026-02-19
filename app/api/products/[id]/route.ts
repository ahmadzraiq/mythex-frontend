import { NextRequest, NextResponse } from 'next/server';
import { products } from '../store';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const product = products.find((p) => p.id === id);
  if (!product) {
    return NextResponse.json({ message: 'Product not found' }, { status: 404 });
  }
  return NextResponse.json(product);
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const index = products.findIndex((p) => p.id === id);
  if (index === -1) {
    return NextResponse.json({ message: 'Product not found' }, { status: 404 });
  }
  try {
    const body = await request.json();
    const { name, price, category, description } = body;
    const updated = {
      id: products[index].id,
      name: name != null ? String(name) : products[index].name,
      price: price != null ? Number(price) : products[index].price,
      category: category != null ? String(category) : products[index].category,
      description: description !== undefined ? (description ? String(description) : undefined) : products[index].description,
    };
    products[index] = updated;
    return NextResponse.json(updated);
  } catch {
    return NextResponse.json({ message: 'Update failed' }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const index = products.findIndex((p) => p.id === id);
  if (index === -1) {
    return NextResponse.json({ message: 'Product not found' }, { status: 404 });
  }
  products.splice(index, 1);
  return NextResponse.json({ success: true });
}
