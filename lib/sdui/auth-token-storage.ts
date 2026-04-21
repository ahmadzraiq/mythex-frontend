/**
 * Auth token storage helpers.
 *
 * The bearer token and auth snapshot are stored in localStorage under fixed
 * keys. Isolation between projects is handled at the origin level — each
 * project preview runs on its own subdomain ({projectId}.localhost:PORT),
 * so the browser automatically scopes localStorage per project.
 */

import type { AuthConfig } from './engine-types';

const TOKEN_KEY    = 'authToken';
const SNAPSHOT_KEY = 'sdui_auth_snapshot';

// ── Token ─────────────────────────────────────────────────────────────────────

export function getStoredToken(): string | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem(TOKEN_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw) as string; } catch { return raw; }
}

export function setStoredToken(token: string): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(TOKEN_KEY, JSON.stringify(token));
}

export function clearStoredToken(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(TOKEN_KEY);
}

// ── Auth snapshot (persists user across page refreshes) ───────────────────────

export interface AuthSnapshot {
  user: unknown;
  accessToken: unknown;
  refreshToken: unknown;
}

export function getStoredAuthSnapshot(): AuthSnapshot | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem(SNAPSHOT_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw) as AuthSnapshot; } catch { return null; }
}

export function setStoredAuthSnapshot(snapshot: AuthSnapshot): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshot));
}

export function clearStoredAuthSnapshot(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(SNAPSHOT_KEY);
}

// ── Build outgoing auth headers ───────────────────────────────────────────────

/**
 * Returns the Authorization header to inject into outgoing requests.
 * Returns {} when no token is in localStorage.
 */
export function buildAuthHeaders(authConfig: AuthConfig | undefined): Record<string, string> {
  const token = getStoredToken();
  if (!token) return {};
  const header = authConfig?.tokenSend?.header ?? 'Authorization';
  const prefix = authConfig?.tokenSend?.prefix ?? 'Bearer ';
  return { [header]: `${prefix}${token}` };
}
