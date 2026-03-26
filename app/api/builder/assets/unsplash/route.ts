import { NextRequest, NextResponse } from 'next/server';

const BASE = 'https://api.unsplash.com';
const KEY = process.env.UNSPLASH_ACCESS_KEY ?? '';

export async function GET(req: NextRequest) {
  if (!KEY) return NextResponse.json({ error: 'Unsplash key not configured' }, { status: 500 });

  const { searchParams } = req.nextUrl;
  const q = searchParams.get('q') ?? '';
  const page = searchParams.get('page') ?? '1';
  const perPage = '30';

  const url = q
    ? `${BASE}/search/photos?query=${encodeURIComponent(q)}&page=${page}&per_page=${perPage}&orientation=landscape`
    : `${BASE}/photos?page=${page}&per_page=${perPage}&order_by=popular`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Client-ID ${KEY}`,
      'Accept-Version': 'v1',
    },
    next: { revalidate: 300 },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error('[unsplash]', res.status, body);
    return NextResponse.json({ error: 'Unsplash request failed', detail: body }, { status: res.status });
  }

  const data = await res.json();
  const items = q ? (data.results ?? []) : (data ?? []);

  const results = items.map((p: Record<string, unknown>) => {
    const urls = p.urls as Record<string, string>;
    const user = p.user as Record<string, string>;
    return {
      id: p.id,
      type: 'photo',
      thumbnail: urls.small,
      src: urls.regular,
      full: urls.full,
      alt: (p.alt_description as string) ?? (p.description as string) ?? '',
      width: p.width as number,
      height: p.height as number,
      author: user?.name ?? '',
      authorUrl: `https://unsplash.com/@${user?.username ?? ''}`,
    };
  });

  const total = q ? (data.total ?? results.length) : results.length;
  return NextResponse.json({ results, total, page: Number(page) });
}
