import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const { email } = await request.json();
    if (!email) {
      return NextResponse.json(
        { message: 'Email is required' },
        { status: 400 }
      );
    }
    // Mock: always succeed, send reset link (no real email)
    return NextResponse.json({
      message: 'If an account exists, you will receive a reset link.',
    });
  } catch {
    return NextResponse.json({ message: 'Request failed' }, { status: 500 });
  }
}
