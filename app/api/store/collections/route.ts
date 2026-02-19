import { NextResponse } from 'next/server';
import { collections } from '@/lib/mock-data';

export async function GET() {
  return NextResponse.json(collections);
}
