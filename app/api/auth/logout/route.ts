import { NextResponse } from 'next/server';

export async function POST() {
  // Client-side clears auth state; this is for server-side session invalidation if needed
  return NextResponse.json({ success: true });
}
