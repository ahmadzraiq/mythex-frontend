import { NextRequest, NextResponse } from 'next/server';

export async function GET() {
  // Mock: return current user from auth header or session
  const user = {
    id: '1',
    name: 'John Doe',
    email: 'john@example.com',
    avatar: null,
  };
  return NextResponse.json(user);
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, email, avatar } = body;
    if (!name || !email) {
      return NextResponse.json(
        { message: 'Name and email are required' },
        { status: 400 }
      );
    }
    const user = {
      id: '1',
      name: String(name),
      email: String(email),
      avatar: avatar ?? null,
    };
    return NextResponse.json(user);
  } catch {
    return NextResponse.json({ message: 'Update failed' }, { status: 500 });
  }
}
