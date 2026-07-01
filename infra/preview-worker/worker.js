/**
 * Cloudflare Worker — Preview & Deployed App Subdomain Proxy
 *
 * All patterns use single-level subdomains under mythex.ai — covered by
 * Cloudflare Universal SSL (*.mythex.ai).
 *
 * Builder preview (temporary, auth-gated):
 *   <projectId>-preview.mythex.ai         → mythex-frontend.pages.dev
 *   <projectId>-staging-preview.mythex.ai → mythex-frontend-staging.pages.dev
 *
 * Deployed live URL (public):
 *   <projectId>-app.mythex.ai             → mythex-frontend.pages.dev
 *   <projectId>-staging.mythex.ai         → mythex-frontend-staging.pages.dev
 *
 * Deploy:
 *   cd infra/preview-worker
 *   npx wrangler deploy
 */

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const host = url.hostname;

    // Pass known infrastructure hosts straight to origin (EC2 backend, builder)
    const PASSTHROUGH_HOSTS = [
      'api-staging.mythex.ai',
      'api.mythex.ai',
      'app.mythex.ai',
      'staging.app.mythex.ai',
      'mythex.ai',
    ];
    if (PASSTHROUGH_HOSTS.includes(host)) {
      return fetch(request);
    }

    let targetHost;
    if (host.endsWith('-staging-preview.mythex.ai') || host.endsWith('-staging.mythex.ai')) {
      // Staging (preview or deployed) → staging Pages project
      targetHost = 'mythex-frontend-staging.pages.dev';
    } else if (host.endsWith('-preview.mythex.ai') || host.endsWith('-app.mythex.ai')) {
      // Production (preview or deployed) → production Pages project
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

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  },
};
