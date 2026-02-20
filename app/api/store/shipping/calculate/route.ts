import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const { zip, area } = await request.json();
    const location = String(zip || area || '').trim().toUpperCase();

    if (!location) {
      return NextResponse.json({ cost: 0, label: 'Free', message: 'Enter your area for an estimate' });
    }

    // Mock: Dubai/Abu Dhabi = Free, other UAE = AED 25, international = AED 50
    const isDubai = /^(DUBAI|DXB|00|01)/.test(location) || location.length <= 3;
    const isUAE = /^(AE|UAE|ABU|SHJ|AJM|RAK|Fuj|ALN)/.test(location) || location.length <= 5;

    if (isDubai) {
      return NextResponse.json({ cost: 0, label: 'Free', message: 'Free delivery to your area' });
    }
    if (isUAE) {
      return NextResponse.json({ cost: 25, label: 'AED 25', message: 'Standard delivery (5-7 days)' });
    }
    return NextResponse.json({ cost: 50, label: 'AED 50', message: 'International delivery' });
  } catch {
    return NextResponse.json({ cost: 0, label: 'Free', message: 'Unable to calculate' }, { status: 400 });
  }
}
