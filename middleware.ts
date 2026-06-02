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

/** Paths allowed on the main domain without further auth checking. */
const PLATFORM_PREFIXES = [
  '/login',
  '/signup',
  '/api/',
  '/_next/',
];

function isAllowedOnMainDomain(pathname: string): boolean {
  return PLATFORM_PREFIXES.some(
    prefix => pathname === prefix.replace(/\/$/, '') || pathname.startsWith(prefix),
  );
}

export function middleware(req: NextRequest): NextResponse {
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

  // {projectId}.* — project-specific production preview (any non-reserved, non -dev subdomain)
  const isProjectProd = !isReserved && !isBuilderDev && !isPreviewDev && !isLegacyPreview && !isProjectDev
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

  // ── {projectId}.* — project-specific production preview ────────────────────
  if (isProjectProd) {
    if (pathname.startsWith('/_next/') || pathname.startsWith('/api/')) {
      return NextResponse.next();
    }

    const url = req.nextUrl.clone();

    // Strip legacy query params if somehow present
    const tokenFromQuery = url.searchParams.get('token');
    if (tokenFromQuery) {
      const clean = req.nextUrl.clone();
      clean.searchParams.delete('token');
      const res = NextResponse.redirect(clean);
      res.cookies.set(PREVIEW_TOKEN_COOKIE, tokenFromQuery, {
        path: '/', httpOnly: false, sameSite: 'lax', maxAge: 60 * 60,
      });
      return res;
    }

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
