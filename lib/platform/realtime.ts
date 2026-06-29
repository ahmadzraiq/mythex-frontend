/**
 * Thin realtime client for the backend WebSocket gateway.
 *
 * The backend exposes a WS endpoint at `/v1/realtime/ws?projectId=...` and
 * broadcasts model row changes on the channel `model:<projectId>:<modelName>`
 * (emitted by the ORM on every create/update/delete). Subscribe to that channel
 * to refresh a data view live.
 *
 * Transport note: the backend base URL is not proxied for WebSockets, so the
 * client connects directly. Configure `NEXT_PUBLIC_BACKEND_WS_URL` in non-local
 * deployments (e.g. wss://api.example.com). In local dev it defaults to the
 * backend dev port (4000).
 */

function resolveWsBase(): string | null {
  const explicit = process.env.NEXT_PUBLIC_BACKEND_WS_URL;
  if (explicit) return explicit.replace(/\/$/, '');
  if (typeof window === 'undefined') return null;
  const { protocol, hostname } = window.location;
  const wsProto = protocol === 'https:' ? 'wss:' : 'ws:';
  // Local dev: backend runs on :4000 alongside the Next dev server.
  if (hostname === 'localhost' || hostname === '127.0.0.1') return `${wsProto}//${hostname}:4000`;
  return null;
}

export interface ChannelMessage {
  channel: string;
  payload: unknown;
}

/**
 * Subscribe to a realtime channel. Returns an unsubscribe function that also
 * closes the socket. `onMessage` is called for each broadcast on `channel`.
 */
export function subscribeToChannel(
  projectId: string,
  channel: string,
  onMessage: (msg: ChannelMessage) => void,
): () => void {
  const base = resolveWsBase();
  if (!base) {
    // No reachable WS endpoint (e.g. unknown prod host without config).
    return () => {};
  }

  let closed = false;
  let ws: WebSocket | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;

  const connect = () => {
    if (closed) return;
    try {
      ws = new WebSocket(`${base}/v1/realtime/ws?projectId=${encodeURIComponent(projectId)}`);
    } catch {
      scheduleRetry();
      return;
    }

    ws.onopen = () => {
      ws?.send(JSON.stringify({ type: 'subscribe', channel }));
    };
    ws.onmessage = (ev) => {
      try {
        const data = JSON.parse(typeof ev.data === 'string' ? ev.data : '') as ChannelMessage;
        if (data && data.channel === channel) onMessage(data);
      } catch { /* ignore non-JSON / control frames */ }
    };
    ws.onclose = () => { if (!closed) scheduleRetry(); };
    ws.onerror = () => { try { ws?.close(); } catch { /* noop */ } };
  };

  const scheduleRetry = () => {
    if (closed || retry) return;
    retry = setTimeout(() => { retry = null; connect(); }, 3000);
  };

  connect();

  return () => {
    closed = true;
    if (retry) clearTimeout(retry);
    try { ws?.send(JSON.stringify({ type: 'unsubscribe', channel })); } catch { /* noop */ }
    try { ws?.close(); } catch { /* noop */ }
  };
}
