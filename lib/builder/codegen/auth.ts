/**
 * auth.ts — Emit lib/auth.ts and middleware.ts when authConfig is present.
 */

import type { CodegenCtx, EmittedFile } from './types';
import type { AuthConfig } from '@/app/dev/builder/_store-types';

export function emitAuthFiles(ctx: CodegenCtx): EmittedFile[] {
  if (!ctx.flags.hasAuth) return [];

  const files: EmittedFile[] = [];
  const ac = ctx.store.authConfig ?? { unauthenticatedRedirect: '/sign-in' };

  files.push(emitAuthTs(ac));

  // Collect protected paths from page meta (set by config-to-state from routes.json auth: true)
  const protectedPaths = (ctx.store.pages ?? [])
    .filter(p => (p as unknown as Record<string, unknown>).meta && ((p as unknown as Record<string, unknown>).meta as Record<string, unknown>)?.isProtected)
    .map(p => (p as unknown as Record<string, unknown>).route as string)
    .filter(Boolean);

  files.push(emitMiddleware(ac, protectedPaths));

  return files;
}

function emitAuthTs(ac: AuthConfig): EmittedFile {
  const storageKey = JSON.stringify(ac.tokenStorageKey ?? 'auth_token');
  const content = `/**
 * lib/auth.ts — Auth token storage and user state.
 * Configure endpoints in .env.local
 */
import { useStore } from './store';

export const AUTH_TOKEN_KEY = ${storageKey};

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(AUTH_TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(AUTH_TOKEN_KEY, token);
  useStore.setState(s => ({ ...s, auth: { ...s.auth, token } }));
}

export function clearToken(): void {
  localStorage.removeItem(AUTH_TOKEN_KEY);
  useStore.setState(s => ({ ...s, auth: { ...s.auth, token: null, user: null } }));
}

export async function fetchCurrentUser(): Promise<unknown> {
  const token = getToken();
  if (!token) return null;
  const endpoint = process.env.NEXT_PUBLIC_AUTH_USER_ENDPOINT ?? '${ac.userEndpoint ?? ''}';
  if (!endpoint) return null;
  const res = await fetch(endpoint, {
    headers: { Authorization: \`Bearer \${token}\` },
  });
  if (!res.ok) return null;
  return res.json();
}
`;
  return { path: 'lib/auth.ts', content };
}

function emitMiddleware(ac: AuthConfig, protectedPaths: string[] = []): EmittedFile {
  const unauthRedirect = ac.unauthenticatedRedirect ?? '/sign-in';
  const tokenKey = ac.tokenStorageKey ?? 'auth_token';

  // Middleware can only read cookies, not localStorage. The client-side AuthSync component
  // handles localStorage-based session restoration. Middleware protects SSR for cookie-based auth.
  // Note: since this app stores tokens in localStorage (not cookies), middleware protection is a
  // best-effort guard — the real auth guard is the useAuthGuard() hook in each protected page.
  const pathsExpr = JSON.stringify(protectedPaths.length > 0 ? protectedPaths : []);

  const content = `import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const token = request.cookies.get(${JSON.stringify(tokenKey)})?.value
    ?? request.headers.get('authorization')?.replace('Bearer ', '');

  const isAuthenticated = !!token;
  const { pathname } = request.nextUrl;

  // Pages that require auth — redirect to sign-in if no token cookie is present.
  // Note: token is primarily in localStorage; this covers cookie-based sessions.
  const protectedPaths = ${pathsExpr};

  if (protectedPaths.some((p: string) => pathname.startsWith(p)) && !isAuthenticated) {
    return NextResponse.redirect(new URL(${JSON.stringify(unauthRedirect)}, request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
`;
  return { path: 'middleware.ts', content };
}
