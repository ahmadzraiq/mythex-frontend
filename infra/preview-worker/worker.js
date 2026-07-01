/**
 * Cloudflare Worker — Preview Subdomain Proxy
 *
 * Routes <projectId>.app.mythex.ai and <projectId>.staging.app.mythex.ai
 * to the main Cloudflare Pages deployment, so the SPA can read the hostname
 * and render the correct project preview.
 *
 * Deploy:
 *   cd infra/preview-worker
 *   npx wrangler deploy
 *
 * Worker routes (set in Cloudflare dashboard or wrangler.toml):
 *   *.app.mythex.ai/*         → this worker
 *   *.staging.app.mythex.ai/* → this worker
 */

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const host = url.hostname;

    let targetHost;
    if (host.endsWith('.staging.app.mythex.ai')) {
      targetHost = 'staging.app.mythex.ai';
    } else if (host.endsWith('.app.mythex.ai')) {
      targetHost = 'app.mythex.ai';
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
