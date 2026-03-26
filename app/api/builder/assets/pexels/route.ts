import { NextRequest, NextResponse } from 'next/server';

const BASE = 'https://api.pexels.com';
const KEY = process.env.PEXELS_API_KEY ?? '';

export async function GET(req: NextRequest) {
  if (!KEY) return NextResponse.json({ error: 'Pexels key not configured' }, { status: 500 });

  const { searchParams } = req.nextUrl;
  const q = searchParams.get('q') ?? '';
  const page = searchParams.get('page') ?? '1';
  const type = (searchParams.get('type') ?? 'photo') as 'photo' | 'video';
  const perPage = '30';

  let url: string;
  if (type === 'video') {
    url = q
      ? `${BASE}/videos/search?query=${encodeURIComponent(q)}&page=${page}&per_page=${perPage}`
      : `${BASE}/videos/popular?page=${page}&per_page=${perPage}`;
  } else {
    url = q
      ? `${BASE}/v1/search?query=${encodeURIComponent(q)}&page=${page}&per_page=${perPage}&orientation=landscape`
      : `${BASE}/v1/curated?page=${page}&per_page=${perPage}`;
  }

  const res = await fetch(url, {
    headers: { Authorization: KEY },
    next: { revalidate: 300 },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error('[pexels]', res.status, body);
    return NextResponse.json({ error: 'Pexels request failed', detail: body }, { status: res.status });
  }

  const data = await res.json();

  let results: unknown[];
  let total: number;

  if (type === 'video') {
    const videos = (data.videos ?? []) as Record<string, unknown>[];
    total = (data.total_results as number) ?? videos.length;
    results = videos.map(v => {
      const files = (v.video_files as Record<string, unknown>[]) ?? [];
      const sd = files.find(f => f.quality === 'sd') ?? files[0] ?? {};
      const thumb = v.image as string;
      return {
        id: v.id,
        type: 'video',
        thumbnail: thumb,
        src: sd.link as string,
        full: sd.link as string,
        alt: '',
        width: v.width as number,
        height: v.height as number,
        author: (v.user as Record<string, string>)?.name ?? '',
        authorUrl: (v.user as Record<string, string>)?.url ?? '',
      };
    });
  } else {
    const photos = (data.photos ?? []) as Record<string, unknown>[];
    total = (data.total_results as number) ?? photos.length;
    results = photos.map(p => {
      const src = p.src as Record<string, string>;
      return {
        id: p.id,
        type: 'photo',
        thumbnail: src.medium,
        src: src.large,
        full: src.original,
        alt: (p.alt as string) ?? '',
        width: p.width as number,
        height: p.height as number,
        author: (p.photographer as string) ?? '',
        authorUrl: (p.photographer_url as string) ?? '',
      };
    });
  }

  return NextResponse.json({ results, total, page: Number(page) });
}
