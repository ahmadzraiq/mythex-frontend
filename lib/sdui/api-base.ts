/**
 * Runtime API base URL resolver.
 *
 * When running on a customer's custom domain (e.g. zraiq.xyz), all API calls
 * are routed through the local /api/* path which is reverse-proxied by the
 * Cloudflare Pages Function at functions/api/[[path]].ts. This keeps
 * api.mythex.ai invisible to end-users (white-label).
 *
 * On native Mythex domains (*.mythex.ai, localhost) the absolute backend URL
 * from VITE_BACKEND_URL is used directly — no proxy involved.
 */

const MYTHEX_HOSTS = ['.mythex.ai', '.localhost', 'localhost', '127.0.0.1'];

export function getApiBase(): string {
  if (typeof window === 'undefined') {
    return import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:4000';
  }
  const host = window.location.hostname;
  const isNative = MYTHEX_HOSTS.some((h) => host === h || host.endsWith(h));
  if (isNative) {
    return import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:4000';
  }
  return window.location.origin + '/api';
}
