/**
 * auth.ts — Emit lib/auth.ts and middleware.ts when authConfig is present.
 */

import type { CodegenCtx, EmittedFile } from './types';
import type { AuthConfig } from '@/app/dev/builder/_store-types';

export function emitAuthFiles(ctx: CodegenCtx): EmittedFile[] {
  if (!ctx.flags.hasAuth || !ctx.store.authConfig) return [];

  const files: EmittedFile[] = [];
  const ac = ctx.store.authConfig;

  files.push(emitAuthTs(ac));
  if (ac.unauthenticatedRedirect || ac.unauthorizedRedirect) {
    files.push(emitMiddleware(ac));
  }

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

function emitMiddleware(ac: AuthConfig): EmittedFile {
  const unauthRedirect = ac.unauthenticatedRedirect ?? '/login';
  const authRedirect = ac.authenticatedRedirect ?? '/';

  const content = `import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { AUTH_TOKEN_KEY } from './lib/auth';

export function middleware(request: NextRequest) {
  const token = request.cookies.get(${JSON.stringify(ac.tokenStorageKey ?? 'auth_token')})?.value
    ?? request.headers.get('authorization')?.replace('Bearer ', '');

  const isAuthenticated = !!token;
  const { pathname } = request.nextUrl;

  // Pages that require auth
  const protectedPaths = ${JSON.stringify(
    // Derive from page access settings — hardcode as we emit per-page metadata
    ['/dashboard', '/profile', '/account'],
  )};
  const guestOnlyPaths = ${JSON.stringify([unauthRedirect])};

  if (protectedPaths.some(p => pathname.startsWith(p)) && !isAuthenticated) {
    return NextResponse.redirect(new URL(${JSON.stringify(unauthRedirect)}, request.url));
  }

  if (guestOnlyPaths.some(p => pathname.startsWith(p)) && isAuthenticated) {
    return NextResponse.redirect(new URL(${JSON.stringify(authRedirect)}, request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
`;
  return { path: 'middleware.ts', content };
}
