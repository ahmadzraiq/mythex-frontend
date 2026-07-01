/**
 * Cloudflare Worker — Preview Subdomain Proxy
 *
 * Routes <projectId>-preview.mythex.ai (production) and
 * <projectId>-staging-preview.mythex.ai (staging) to the appropriate
 * Cloudflare Pages deployment so the SPA can render the correct project.
 *
 * Both patterns are covered by Cloudflare Universal SSL (*.mythex.ai).
 *
 * Deploy:
 *   cd infra/preview-worker
 *   npx wrangler deploy
 *
 * Worker routes (managed via wrangler.toml):
 *   *-preview.mythex.ai/*         → this worker (production previews)
 *   *-staging-preview.mythex.ai/* → this worker (staging previews)
 */

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const host = url.hostname;

    let targetHost;
    if (host.endsWith('-staging-preview.mythex.ai')) {
      // Staging previews → staging Pages project
      targetHost = 'mythex-frontend-staging.pages.dev';
    } else if (host.endsWith('-preview.mythex.ai')) {
      // Production previews → production Pages project
      targetHost = 'mythex-frontend.pages.dev';
    } else {
      return new Response('Not found', { status: 404 });
    }

    const targetUrl = `https://${targetHost}${url.pathname}${url.search}`;

    const response = await fetch(targetUrl, {
      method: request.method,
      headers: request.headers,
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
      redirect: 'follow',
    });

    // Pass response through with original headers
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  },
};
