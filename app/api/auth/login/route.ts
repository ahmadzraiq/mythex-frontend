import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const { email, password } = await request.json();
    if (!email || !password) {
      return NextResponse.json(
        { message: 'Email and password required' },
        { status: 400 }
      );
    }
    // Mock auth - replace with real DB/validation
    const user = {
      id: '1',
      email,
      name: email.split('@')[0],
      token: 'mock-jwt-token',
    };
    return NextResponse.json({ user });
  } catch {
    return NextResponse.json({ message: 'Login failed' }, { status: 500 });
  }
}
