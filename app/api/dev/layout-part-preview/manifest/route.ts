import { NextResponse } from 'next/server';
import { LAYOUT_PARTS_LIST } from '../route';

export async function GET() {
  return NextResponse.json({ parts: LAYOUT_PARTS_LIST });
}
