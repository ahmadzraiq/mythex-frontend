/**
 * Cloudflare Pages Function — White-label API Proxy
 *
 * Intercepts every request to <customDomain>/api/* and reverse-proxies it to
 * the Mythex backend, stripping the /api prefix before forwarding.
 *
 * This makes all API traffic appear to originate from the customer's own domain
 * (e.g. zraiq.xyz/api/v1/run/...) — api.mythex.ai is never visible to end-users.
 *
 * The target backend is controlled by the BACKEND_URL Pages environment variable:
 *   mythex-frontend         → BACKEND_URL = https://api.mythex.ai
 *   mythex-frontend-staging → BACKEND_URL = https://api-staging.mythex.ai
 *
 * Pure streaming passthrough — no buffering, no JSON parsing. Overhead: ~1–3 ms.
 */

interface PagesContext {
  request: Request;
  env: { BACKEND_URL?: string };
  [key: string]: unknown;
}

export async function onRequest(context: PagesContext): Promise<Response> {
  const backendBase = context.env.BACKEND_URL ?? 'https://api.mythex.ai';
  const url = new URL(context.request.url);
  const targetUrl = `${backendBase}${url.pathname.replace(/^\/api/, '')}${url.search}`;
  return fetch(new Request(targetUrl, context.request));
}
