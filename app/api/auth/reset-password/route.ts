import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const { token, password, confirmPassword } = await request.json();
    if (!token || !password || !confirmPassword) {
      return NextResponse.json(
        { message: 'Token, password and confirm password are required' },
        { status: 400 }
      );
    }
    if (password !== confirmPassword) {
      return NextResponse.json(
        { message: 'Passwords must match' },
        { status: 400 }
      );
    }
    if (password.length < 8) {
      return NextResponse.json(
        { message: 'Password must be at least 8 characters' },
        { status: 400 }
      );
    }
    // Mock: always succeed
    return NextResponse.json({ message: 'Password reset successfully' });
  } catch {
    return NextResponse.json({ message: 'Reset failed' }, { status: 500 });
  }
}
