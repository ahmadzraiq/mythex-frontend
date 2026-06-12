/**
 * Next.js Edge Middleware — Subdomain routing + platform path guard
 *
 * ── Subdomains ───────────────────────────────────────────────────────────────
 *
 * builder-dev.localhost:3001  [DEV ONLY — blocked in production]
 *   → rewritten to /dev/builder (admin mode, no auth, no projectId).
 *   Used by E2E tests and local development without a backend project.
 *
 * preview-dev.localhost:3001/*  [DEV ONLY — blocked in production]
 *   → passes directly through to app/[[...slug]]/page.tsx (the static SDUI app).
 *   No auth, no project ID needed — serves the static config/app.ts SDUI config.
 *   Used by E2E tests and development previewing without a backend project.
 *
 * {projectId}-dev.localhost:3001/*  [DEV ONLY — blocked in production]
 *   → passes through to app/[[...slug]]/page.tsx with preview_project_id cookie set.
 *   Each project gets its own subdomain origin → localStorage is isolated per project
 *   with no code-level namespacing required.
 *
 * {projectId}.localhost:3001/*
 *   → rewritten internally to /app-preview/*
 *   The SDUI app renders in complete isolation so project routes like /login,
 *   /collection/electronics etc. never conflict with platform routes.
 *   projectId is read from the subdomain itself — no query param or cookie needed.
 *
 * preview.localhost:3001/*  (legacy — kept for backward compat)
 *   → same as {projectId}.localhost but projectId comes from cookie/query param.
 *
 * ── Main domain (localhost:3001) ─────────────────────────────────────────────
 *
 * /                    → /login  (no auth)  |  /workspaces  (authenticated)
 * /login, /signup      → public (always accessible)
 * /workspaces/**       → protected — redirects to /login if no auth_token cookie
 * /builder/[projectId] → protected — auth check + internal rewrite to /dev/builder
 * /builder             → /login  (no auth)  |  /workspaces  (authenticated)
 * /api/**              → pass through (each handler does its own auth)
 * anything else        → redirected to /workspaces (project SDUI routes blocked)
 *
 * ── Internal rewrite targets (never directly accessible) ─────────────────────
 * /dev/builder         → served only via builder-dev rewrite or /builder/[id] rewrite
 * /app-preview/**      → served only via project preview rewrite
 */

import { NextRequest, NextResponse } from 'next/server';

const PREVIEW_COOKIE       = 'preview_project_id';
const PREVIEW_TOKEN_COOKIE = 'preview_token';
const BACKEND_URL          = (process.env.BACKEND_URL ?? 'http://localhost:4000');

/** Returns true when the host is a bare IPv4 address (with optional port). */
function isIpHost(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}(:\d+)?$/.test(host);
}

/**
 * APP_DOMAIN — the base domain for this deployment (port stripped).
 * When set (e.g. "zraiq.xyz" for staging/prod), subdomain detection uses it
 * instead of the fallback localhost/IP heuristic.
 * Set via APP_DOMAIN env var (e.g. "zraiq.xyz" or "staging.zraiq.xyz").
 */
const APP_DOMAIN_ENV = (process.env.APP_DOMAIN ?? '').split(':')[0].toLowerCase();

/**
 * Extract the first subdomain label for a given host, or empty string if this
 * request is for the base/main domain.
 *
 * With APP_DOMAIN set:
 *   "abc.zraiq.xyz:3000" → "abc"
 *   "zraiq.xyz:3000"     → ""   (main domain)
 *
 * Without APP_DOMAIN (legacy fallback):
 *   "localhost:3000"     → ""
 *   "1.2.3.4:3000"       → ""
 *   "abc.localhost:3000" → "abc"
 */
function getFirstLabel(host: string): string {
  const h = host.split(':')[0].toLowerCase();
  if (APP_DOMAIN_ENV) {
    if (h === APP_DOMAIN_ENV) return '';
    if (h.endsWith('.' + APP_DOMAIN_ENV)) return h.slice(0, -(APP_DOMAIN_ENV.length + 1));
    return '';
  }
  // Legacy fallback
  if (h === 'localhost' || /^\d+(\.\d+){3}$/.test(h)) return '';
  return h.split('.')[0] ?? '';
}

/** Well-known subdomain prefixes that are NOT project IDs. */
const RESERVED_SUBDOMAINS = ['builder-dev', 'preview-dev', 'preview', 'www'];

/** Check if a project is published by calling the backend API. */
async function isProjectPublished(projectId: string): Promise<boolean> {
  try {
    const res = await fetch(`${BACKEND_URL}/v1/projects/${projectId}/published`, { cache: 'no-store' });
    if (!res.ok) return false;
    const data = await res.json() as { project?: { published?: boolean } };
    return data.project?.published === true;
  } catch {
    return false;
  }
}

/** Look up project by custom domain. Returns projectId if found and published, null otherwise. */
async function resolveCustomDomain(host: string): Promise<string | null> {
  try {
    const res = await fetch(`${BACKEND_URL}/v1/projects/by-domain?domain=${encodeURIComponent(host)}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const data = await res.json() as { projectId?: string };
    return data.projectId ?? null;
  } catch {
    return null;
  }
}

/** Paths allowed on the main domain without further auth checking. */
const PLATFORM_PREFIXES = [
  '/login',
  '/signup',
  '/invitations/',
  '/api/',
  '/_next/',
];

function isAllowedOnMainDomain(pathname: string): boolean {
  return PLATFORM_PREFIXES.some(
    prefix => pathname === prefix.replace(/\/$/, '') || pathname.startsWith(prefix),
  );
}

export async function middleware(req: NextRequest): Promise<NextResponse> {
  const host = req.headers.get('host') ?? '';
  const { pathname } = req.nextUrl;

  // ── IP-address access — treat as main domain, skip subdomain routing ────────
  if (isIpHost(host)) {
    const authToken = req.cookies.get('auth_token')?.value;
    if (pathname === '/') {
      const url = req.nextUrl.clone();
      url.pathname = authToken ? '/workspaces' : '/login';
      return NextResponse.redirect(url);
    }
    if (pathname.startsWith('/workspaces') && !authToken) {
      const url = req.nextUrl.clone();
      url.pathname = '/login';
      return NextResponse.redirect(url);
    }
    if (pathname.startsWith('/builder')) {
      const segments  = pathname.split('/').filter(Boolean);
      const projectId = segments[1] ?? '';
      if (!projectId || !authToken) {
        const url = req.nextUrl.clone();
        url.pathname = authToken ? '/workspaces' : '/login';
        return NextResponse.redirect(url);
      }
      const url = req.nextUrl.clone();
      url.pathname = '/dev/builder';
      url.search   = `?projectId=${projectId}`;
      return NextResponse.rewrite(url);
    }
    return NextResponse.next();
  }

  // ── Subdomains — checked first, most-specific to least-specific ────────────

  const isBuilderDev = host.startsWith('builder-dev.');
  const isPreviewDev = host.startsWith('preview-dev.');
  const isLegacyPreview = !isPreviewDev && host.startsWith('preview.');

  const isDev = process.env.NODE_ENV === 'development';

  // Extract the first subdomain label relative to the base domain
  const firstLabel = getFirstLabel(host);
  const isReserved = RESERVED_SUBDOMAINS.includes(firstLabel);

  // {projectId}-dev.* — project-specific dev preview
  const isProjectDev = !isReserved && !isBuilderDev && !isPreviewDev && firstLabel.endsWith('-dev');
  const projectDevId = isProjectDev ? firstLabel.slice(0, -'-dev'.length) : '';

  // {projectId}-preview.* — authenticated builder preview (production pattern)
  const isProjectPreview = !isReserved && !isBuilderDev && !isPreviewDev && !isProjectDev
    && firstLabel.endsWith('-preview');
  const projectPreviewId = isProjectPreview ? firstLabel.slice(0, -'-preview'.length) : '';

  // {projectId}.* — project public deploy (any non-reserved, non -dev, non -preview subdomain)
  const isProjectProd = !isReserved && !isBuilderDev && !isPreviewDev && !isLegacyPreview && !isProjectDev && !isProjectPreview
    && firstLabel.length > 0 && !host.startsWith('localhost');

  const projectProdId = isProjectProd ? firstLabel : '';

  // builder-dev / preview-dev — only available in development.
  // In production these subdomains are blocked and redirected to the main domain.
  if (isBuilderDev || isPreviewDev) {
    if (!isDev) {
      // Redirect to the main domain root in production
      const url = req.nextUrl.clone();
      url.host     = host.replace(/^(builder-dev|preview-dev)\./, '');
      url.pathname = '/';
      url.search   = '';
      return NextResponse.redirect(url);
    }

    // ── builder-dev (dev only) ────────────────────────────────────────────────
    // Only / serves the builder. Any other path redirects back to / so the
    // builder always loads instead of showing a 404 or SDUI app route.
    if (isBuilderDev) {
      if (pathname.startsWith('/_next/') || pathname.startsWith('/api/')) {
        return NextResponse.next();
      }
      if (pathname !== '/') {
        const url = req.nextUrl.clone();
        url.pathname = '/';
        url.search   = '';
        return NextResponse.redirect(url);
      }
      const url = req.nextUrl.clone();
      url.pathname = '/dev/builder';
      url.search   = '';
      return NextResponse.rewrite(url);
    }

    // ── preview-dev (dev only) ────────────────────────────────────────────────
    // Passes through to app/[[...slug]]/page.tsx (static SDUI app, no auth).
    return NextResponse.next();
  }

  // ── {projectId}-dev.* (dev only) — project-specific dev preview ────────────
  if (isProjectDev) {
    if (!isDev) {
      const url = req.nextUrl.clone();
      url.host     = host.replace(`${firstLabel}.`, '');
      url.pathname = '/';
      url.search   = '';
      return NextResponse.redirect(url);
    }

    if (pathname.startsWith('/_next/') || pathname.startsWith('/api/')) {
      return NextResponse.next();
    }

    // Set the project cookie so app-preview can load the right config,
    // then pass through to the SDUI app (app/app-preview or [[...slug]]).
    const url = req.nextUrl.clone();
    url.pathname = `/app-preview${pathname === '/' ? '' : pathname}`;
    const res = NextResponse.rewrite(url);
    res.cookies.set(PREVIEW_COOKIE, projectDevId, {
      path: '/', httpOnly: false, sameSite: 'lax', maxAge: 60 * 60 * 24,
    });
    return res;
  }

  // ── {projectId}-preview.* — authenticated builder preview (requires auth) ────
  if (isProjectPreview) {
    if (pathname.startsWith('/_next/') || pathname.startsWith('/api/')) {
      return NextResponse.next();
    }

    const previewToken = req.cookies.get(PREVIEW_TOKEN_COOKIE)?.value
      ?? req.cookies.get('auth_token')?.value;

    // Handle token in query string (from builder "Preview" button)
    const tokenFromQuery = req.nextUrl.searchParams.get('token');
    if (tokenFromQuery) {
      const clean = req.nextUrl.clone();
      clean.searchParams.delete('token');
      const res = NextResponse.redirect(clean);
      res.cookies.set(PREVIEW_TOKEN_COOKIE, tokenFromQuery, {
        path: '/', httpOnly: false, sameSite: 'lax', maxAge: 60 * 60,
      });
      return res;
    }

    if (!previewToken) {
      // Redirect to login with a return path
      const loginUrl = req.nextUrl.clone();
      loginUrl.host = APP_DOMAIN_ENV || 'localhost:3001';
      loginUrl.pathname = '/login';
      loginUrl.search = `?redirect=${encodeURIComponent(req.url)}`;
      return NextResponse.redirect(loginUrl);
    }

    const url = req.nextUrl.clone();
    url.pathname = `/app-preview${pathname === '/' ? '' : pathname}`;
    const res = NextResponse.rewrite(url);
    res.cookies.set(PREVIEW_COOKIE, projectPreviewId, {
      path: '/', httpOnly: false, sameSite: 'lax', maxAge: 60 * 60 * 24,
    });
    return res;
  }

  // ── {projectId}.* — project public deploy ────────────────────────────────────
  if (isProjectProd) {
    if (pathname.startsWith('/_next/') || pathname.startsWith('/api/')) {
      return NextResponse.next();
    }

    // Check published flag — return 404 directly if not published.
    // We return an HTML response instead of rewriting to avoid the
    // [[...slug]] catch-all rendering the static SDUI template.
    const published = await isProjectPublished(projectProdId);
    if (!published) {
      return new NextResponse(
        `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Not Found</title><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:system-ui,sans-serif;background:#f8f9fa;display:flex;align-items:center;justify-content:center;min-height:100vh;color:#111}.card{text-align:center;padding:48px 32px;background:#fff;border-radius:16px;box-shadow:0 2px 16px rgba(0,0,0,.08);max-width:400px;width:100%}h1{font-size:4rem;font-weight:700;color:#e5e7eb;margin-bottom:8px}h2{font-size:1.25rem;font-weight:600;margin-bottom:12px}p{color:#6b7280;font-size:.95rem}</style></head><body><div class="card"><h1>404</h1><h2>Project not deployed</h2><p>This project hasn&rsquo;t been published yet.</p></div></body></html>`,
        { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
      );
    }

    const url = req.nextUrl.clone();
    url.pathname = `/app-preview${pathname === '/' ? '' : pathname}`;
    const res = NextResponse.rewrite(url);
    res.cookies.set(PREVIEW_COOKIE, projectProdId, {
      path: '/', httpOnly: false, sameSite: 'lax', maxAge: 60 * 60 * 24,
    });
    return res;
  }

  // ── Legacy preview.* — kept for backward compat ────────────────────────────
  if (isLegacyPreview) {
    if (pathname.startsWith('/_next/') || pathname.startsWith('/api/')) {
      return NextResponse.next();
    }

    const url              = req.nextUrl.clone();
    const projectIdFromQuery = url.searchParams.get('projectId');
    const tokenFromQuery     = url.searchParams.get('token');
    const projectId          = projectIdFromQuery
      ?? req.cookies.get(PREVIEW_COOKIE)?.value
      ?? null;

    // Strip projectId/token from URL and set cookies, then redirect to clean URL
    if (projectIdFromQuery || tokenFromQuery) {
      const clean = req.nextUrl.clone();
      clean.searchParams.delete('projectId');
      clean.searchParams.delete('token');
      const res = NextResponse.redirect(clean);
      if (projectIdFromQuery) {
        res.cookies.set(PREVIEW_COOKIE, projectIdFromQuery, {
          path: '/', httpOnly: false, sameSite: 'lax', maxAge: 60 * 60 * 24,
        });
      }
      if (tokenFromQuery) {
        res.cookies.set(PREVIEW_TOKEN_COOKIE, tokenFromQuery, {
          path: '/', httpOnly: false, sameSite: 'lax',
          maxAge: 60 * 60, // 1 hour — matches token lifetime
        });
      }
      return res;
    }

    url.pathname = `/app-preview${pathname === '/' ? '' : pathname}`;
    const res = NextResponse.rewrite(url);
    if (projectId) {
      res.cookies.set(PREVIEW_COOKIE, projectId, {
        path: '/', httpOnly: false, sameSite: 'lax', maxAge: 60 * 60 * 24,
      });
    }
    return res;
  }

  // ── Custom domain routing ─────────────────────────────────────────────────
  // If APP_DOMAIN is set and the host doesn't match the base domain or any known
  // subdomain pattern, try to look it up as a custom project domain.
  if (APP_DOMAIN_ENV && firstLabel === '' && !host.includes('localhost') && !isIpHost(host)) {
    const bareHost = host.split(':')[0];
    if (bareHost !== APP_DOMAIN_ENV) {
      // Not the main domain — could be a custom domain
      if (!pathname.startsWith('/_next/') && !pathname.startsWith('/api/')) {
        const customProjectId = await resolveCustomDomain(bareHost);
        if (customProjectId) {
          const url = req.nextUrl.clone();
          url.pathname = `/app-preview${pathname === '/' ? '' : pathname}`;
          const res = NextResponse.rewrite(url);
          res.cookies.set(PREVIEW_COOKIE, customProjectId, {
            path: '/', httpOnly: false, sameSite: 'lax', maxAge: 60 * 60 * 24,
          });
          return res;
        }
      }
    }
  }

  // ── Main domain ────────────────────────────────────────────────────────────

  const authToken = req.cookies.get('auth_token')?.value;

  // / — auth-aware root redirect
  if (pathname === '/') {
    const url = req.nextUrl.clone();
    url.pathname = authToken ? '/workspaces' : '/login';
    return NextResponse.redirect(url);
  }

  // /builder/[projectId] — protected real builder
  if (pathname.startsWith('/builder')) {
    const segments  = pathname.split('/').filter(Boolean);
    const projectId = segments[1] ?? '';

    if (!projectId) {
      // /builder with no ID
      const url = req.nextUrl.clone();
      url.pathname = authToken ? '/workspaces' : '/login';
      return NextResponse.redirect(url);
    }

    if (!authToken) {
      const url = req.nextUrl.clone();
      url.pathname = '/login';
      return NextResponse.redirect(url);
    }

    // Internal rewrite — browser still sees /builder/[projectId]
    const url = req.nextUrl.clone();
    url.pathname = '/dev/builder';
    url.search   = `?projectId=${projectId}`;
    return NextResponse.rewrite(url);
  }

  // /workspaces/** — protected platform home
  if (pathname.startsWith('/workspaces')) {
    if (!authToken) {
      const url = req.nextUrl.clone();
      url.pathname = '/login';
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  // /login, /signup, /api/**, /_next/** — always allowed
  if (isAllowedOnMainDomain(pathname)) {
    return NextResponse.next();
  }

  // Everything else (SDUI app routes, /dev/builder, /app-preview, etc.) —
  // blocked on the main domain; redirect to workspaces (or login if not authed)
  const url = req.nextUrl.clone();
  url.pathname = authToken ? '/workspaces' : '/login';
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon\\.ico).*)',
  ],
};
