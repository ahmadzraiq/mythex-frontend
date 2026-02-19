import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const { email, password, name } = await request.json();
    if (!email || !password || !name) {
      return NextResponse.json(
        { message: 'Email, password and name required' },
        { status: 400 }
      );
    }
    // Mock signup - replace with real DB
    const user = {
      id: String(Date.now()),
      email,
      name,
      token: 'mock-jwt-token',
    };
    return NextResponse.json({ user });
  } catch {
    return NextResponse.json({ message: 'Signup failed' }, { status: 500 });
  }
}
