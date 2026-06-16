/**
 * Shared media search helpers used by both the legacy builder-chat route
 * and the file-based builder agent.
 *
 * All functions return empty arrays on error so callers never throw.
 */

function randPage(max = 4): number {
  return Math.ceil(Math.random() * max);
}

export async function searchUnsplash(
  query: string,
  count = 5,
  signal?: AbortSignal,
): Promise<Array<{ url: string; alt: string }>> {
  try {
    const apiKey = process.env.UNSPLASH_ACCESS_KEY;
    if (!apiKey || !query) return [];
    const page = randPage(4);
    const r = await fetch(
      `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=${count}&page=${page}&client_id=${apiKey}`,
      { signal },
    );
    if (!r.ok) return [];
    const d = await r.json() as {
      results?: Array<{ urls: { regular: string }; alt_description: string }>;
    };
    return (d.results ?? []).map(p => ({ url: p.urls.regular, alt: p.alt_description ?? '' }));
  } catch {
    return [];
  }
}

export async function searchPexelsPhotos(
  query: string,
  count = 5,
  signal?: AbortSignal,
): Promise<Array<{ url: string; alt: string }>> {
  try {
    const apiKey = process.env.PEXELS_API_KEY;
    if (!apiKey || !query) return [];
    const q = encodeURIComponent(query);
    const page = randPage(4);
    const r = await fetch(
      `https://api.pexels.com/v1/search?query=${q}&page=${page}&per_page=${count}`,
      { headers: { Authorization: apiKey }, signal },
    );
    if (!r.ok) return [];
    const d = await r.json() as { photos?: Array<{ src: { large: string }; alt: string }> };
    return (d.photos ?? []).map(p => ({ url: p.src.large, alt: p.alt ?? '' }));
  } catch {
    return [];
  }
}

export async function searchPexelsVideos(
  query: string,
  count = 4,
  signal?: AbortSignal,
): Promise<Array<{ src: string; poster: string }>> {
  try {
    const apiKey = process.env.PEXELS_API_KEY;
    if (!apiKey || !query) return [];
    const q = encodeURIComponent(query);
    const page = randPage(3);
    const r = await fetch(
      `https://api.pexels.com/videos/search?query=${q}&page=${page}&per_page=${count}`,
      { headers: { Authorization: apiKey }, signal },
    );
    if (!r.ok) return [];
    const d = await r.json() as {
      videos?: Array<{
        image: string;
        video_files: Array<{ quality: string; link: string }>;
      }>;
    };
    return (d.videos ?? [])
      .map(v => {
        const file =
          v.video_files.find(f => f.quality === 'hd') ??
          v.video_files.find(f => f.quality === 'sd') ??
          v.video_files[0];
        return { src: file?.link ?? '', poster: v.image };
      })
      .filter(v => v.src);
  } catch {
    return [];
  }
}

export async function searchIconify(
  query: string,
  prefix?: string,
  count = 10,
  signal?: AbortSignal,
): Promise<string[]> {
  try {
    const q = encodeURIComponent(query);
    const prefixParam = prefix ? `&prefix=${encodeURIComponent(prefix)}` : '';
    const r = await fetch(
      `https://api.iconify.design/search?query=${q}&limit=${count}${prefixParam}`,
      { signal },
    );
    if (!r.ok) return [];
    const d = await r.json() as { icons?: string[] };
    return d.icons ?? [];
  } catch {
    return [];
  }
}

/**
 * Search for images — tries Unsplash first, falls back to Pexels.
 */
export async function searchImages(
  query: string,
  count = 4,
  signal?: AbortSignal,
): Promise<Array<{ url: string; alt: string }>> {
  let results = await searchUnsplash(query, count, signal);
  if (!results.length) results = await searchPexelsPhotos(query, count, signal);
  return results;
}
