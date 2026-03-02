'use client';

/**
 * Data Tab — left panel "Data" tab.
 *
 * Three sections (all editing via SlidePanel, no modals):
 *   A. Data Sources  — named REST/GraphQL sources with Postman-style editor
 *   B. Variables     — named typed variables (CustomVars)
 *   C. Preview Data  — key-value tree editor for mock data (App / Page scoped)
 */

import React, { useState, useCallback, useEffect } from 'react';
import { useBuilderStore, persistPreviewData, type DataSourceConfig, type DataSourceParam, type DataSourceAuth, type CustomVar } from './_store';
import { useSduiStore } from '@/store/sdui-store';
import { SP_BTN_PRIMARY, SP_BTN_SECONDARY, SP_INPUT, SP_LABEL, SP_SECTION } from './_slide-panel';

// ─── Shared styles ────────────────────────────────────────────────────────────

const SECTION_HDR: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  padding: '8px 12px', borderBottom: '1px solid #1f2937',
};
const SEC_LABEL: React.CSSProperties = {
  fontSize: 10, fontWeight: 700, color: '#9ca3af',
  textTransform: 'uppercase', letterSpacing: '0.08em',
};
const EMPTY: React.CSSProperties = {
  fontSize: 11, color: '#4b5563', fontStyle: 'italic',
  padding: '8px 12px',
};
const ADD_BTN: React.CSSProperties = {
  padding: '3px 10px', background: '#1d4ed8', border: 'none',
  borderRadius: 4, color: '#fff', fontSize: 10, cursor: 'pointer',
};
const TYPE_COLOR: Record<string, string> = { rest: '#34d399', graphql: '#f59e0b' };

// ─── Utility ──────────────────────────────────────────────────────────────────


// ─── A. Data Sources ──────────────────────────────────────────────────────────

interface DataSourceSlidePanelProps {
  initial: Partial<DataSourceConfig>;
  onSave: (cfg: DataSourceConfig) => void;
  onClose: () => void;
}

function DataSourceSlideContent({ initial, onSave, onClose }: DataSourceSlidePanelProps) {
  const [name, setName] = useState(initial.name ?? '');
  const [type, setType] = useState<'rest' | 'graphql'>(initial.type ?? 'rest');
  const [innerTab, setInnerTab] = useState<string>('params');

  // REST fields
  const [url, setUrl] = useState(initial.url ?? '');
  const [method, setMethod] = useState<DataSourceConfig['method']>(initial.method ?? 'GET');
  const [queryParams, setQueryParams] = useState<DataSourceParam[]>(initial.queryParams ?? []);
  const [headers, setHeaders] = useState<Array<{ key: string; value: string; enabled: boolean }>>(
    (initial.headers ?? []).map(h => ({ key: h.key, value: h.value, enabled: h.enabled ?? true }))
  );
  const [body, setBody] = useState(initial.body ?? '');
  const [bodyType, setBodyType] = useState<'none' | 'json' | 'raw'>('none');

  // GraphQL fields — pre-fill endpoint with the global convention if the action has none
  const globalEndpoint = useBuilderStore(s => s.engineConventions?.graphqlEndpoint ?? '');
  // Must NOT use ?? {} inside the selector — that returns a new object every render → infinite loop
  const rawGlobalGqlHeaders = useBuilderStore(s => s.engineConventions?.graphqlHeaders);
  const globalGqlHeaders = rawGlobalGqlHeaders ?? {};
  const [endpoint, setEndpoint] = useState(initial.endpoint?.trim() ? initial.endpoint : '');
  // When globalEndpoint loads (async, from loadFromConfig) and endpoint is still empty, adopt it
  useEffect(() => {
    setEndpoint(prev => prev.trim() ? prev : globalEndpoint);
  }, [globalEndpoint]);
  const [gqlQuery, setGqlQuery] = useState(initial.query ?? '');
  const [gqlVars, setGqlVars] = useState(initial.variables ?? '');
  // Separate test-time values — only used for the Run button, never saved to config
  const [testVars, setTestVars] = useState('');

  // Auth
  const [auth, setAuth] = useState<DataSourceAuth>(initial.auth ?? { type: 'none' });

  // Common
  const [storeIn, setStoreIn] = useState(initial.storeIn ?? '');
  const [responsePath, setResponsePath] = useState(initial.responsePath ?? '');
  const [trigger, setTrigger] = useState<'mount' | 'action'>(initial.trigger ?? 'mount');
  const [triggerActionName, setTriggerActionName] = useState(initial.triggerActionName ?? '');

  // Execute state
  const [execStatus, setExecStatus] = useState<null | 'loading' | 'ok' | 'error'>(null);
  const [execCode, setExecCode] = useState<number | null>(null);
  const [execBody, setExecBody] = useState('');        // display (truncated)
  const execFullBodyRef = React.useRef('');            // full body for JSON.parse in saveExecToPreview
  const [execMs, setExecMs] = useState(0);
  const [execSaved, setExecSaved] = useState(false);
  const [execSavedKey, setExecSavedKey] = useState('');

  // Which page is currently active in the builder canvas (so we can show page-mismatch hints)
  const builderPages = useBuilderStore(s => s.pages);
  const builderCurrentPageId = useBuilderStore(s => s.currentPageId);
  const switchPage = useBuilderStore(s => s.switchPage);
  const currentBuilderPageName = builderPages.find(p => p.id === builderCurrentPageId)?.name ?? '';

  // Switch inner tab when type changes
  useEffect(() => {
    setInnerTab(type === 'rest' ? 'params' : 'query');
  }, [type]);

  const builtUrl = (() => {
    if (type !== 'rest' || !url) return url;
    const enabled = queryParams.filter(p => p.enabled && p.key.trim());
    if (!enabled.length) return url;
    const qs = enabled.map(p => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value)}`).join('&');
    return `${url}${url.includes('?') ? '&' : '?'}${qs}`;
  })();

  const addParam = () => setQueryParams(p => [...p, { key: '', value: '', enabled: true }]);
  const updateParam = (i: number, field: keyof DataSourceParam, val: string | boolean) =>
    setQueryParams(p => p.map((x, xi) => xi === i ? { ...x, [field]: val } : x));
  const removeParam = (i: number) => setQueryParams(p => p.filter((_, xi) => xi !== i));

  const addHeader = () => setHeaders(h => [...h, { key: '', value: '', enabled: true }]);
  const updateHeader = (i: number, field: 'key' | 'value' | 'enabled', val: string | boolean) =>
    setHeaders(h => h.map((x, xi) => xi === i ? { ...x, [field]: val } : x));
  const removeHeader = (i: number) => setHeaders(h => h.filter((_, xi) => xi !== i));

  const canSave = name.trim().length > 0;

  const save = () => {
    if (!canSave) return;
    onSave({
      id: initial.id ?? `ds-${Date.now()}`,
      name: name.trim(),
      type,
      url: type === 'rest' ? url : undefined,
      method: type === 'rest' ? method : undefined,
      queryParams: type === 'rest' ? queryParams.filter(p => p.key.trim()) : undefined,
      headers: headers.filter(h => h.key.trim()),
      body: type === 'rest' && body ? body : undefined,
      auth: auth.type !== 'none' ? auth : undefined,
      endpoint: type === 'graphql' ? endpoint : undefined,
      query: type === 'graphql' ? gqlQuery : undefined,
      variables: type === 'graphql' && gqlVars ? gqlVars : undefined,
      responsePath: responsePath || undefined,
      storeIn: storeIn || undefined,
      trigger,
      triggerActionName: trigger === 'action' ? triggerActionName : undefined,
    });
  };

  /** Recursively strip JSON Logic expressions { "var": ... }, replacing them with null or preview data value */
  function resolveVarsForExec(obj: unknown, previewData: Record<string, unknown>): unknown {
    if (obj === null || obj === undefined) return obj;
    if (Array.isArray(obj)) return obj.map(v => resolveVarsForExec(v, previewData));
    if (typeof obj === 'object') {
      const o = obj as Record<string, unknown>;
      // JSON Logic { "var": "path" } or { "var": ["path", default] }
      if ('var' in o) {
        const varPath = Array.isArray(o.var) ? String(o.var[0]) : String(o.var);
        const defaultVal = Array.isArray(o.var) ? o.var[1] : null;
        // Try to resolve from appPreviewData
        const resolved = previewData[varPath];
        return resolved !== undefined ? resolved : defaultVal;
      }
      // Recurse into other objects
      const result: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(o)) {
        result[k] = resolveVarsForExec(v, previewData);
      }
      return result;
    }
    return obj;
  }

  /** Walk the parsed variables and collect every unresolved {"var":...} path as a flat path → "" map */
  function collectUnresolvedVarPaths(obj: unknown, prefix = ''): Record<string, string> {
    const result: Record<string, string> = {};
    if (obj === null || obj === undefined) return result;
    if (Array.isArray(obj)) {
      obj.forEach((v, i) => Object.assign(result, collectUnresolvedVarPaths(v, `${prefix}[${i}]`)));
      return result;
    }
    if (typeof obj === 'object') {
      const o = obj as Record<string, unknown>;
      if ('var' in o) {
        const varPath = Array.isArray(o.var) ? String(o.var[0]) : String(o.var);
        const previewData = useBuilderStore.getState().appPreviewData;
        const resolved = previewData[varPath];
        if (resolved === undefined || resolved === null) {
          result[prefix || varPath] = varPath;
        }
        return result;
      }
      for (const [k, v] of Object.entries(o)) {
        const childPrefix = prefix ? `${prefix}.${k}` : k;
        Object.assign(result, collectUnresolvedVarPaths(v, childPrefix));
      }
    }
    return result;
  }

  /** Build a test-friendly JSON from gqlVars: replace {"var":...} refs with resolved value or "" placeholder */
  function buildTestVarsTemplate(): string {
    let parsed: unknown = {};
    try { parsed = JSON.parse(gqlVars); } catch { return '{}'; }
    const previewData = useBuilderStore.getState().appPreviewData;
    function replace(obj: unknown): unknown {
      if (obj === null || obj === undefined) return obj;
      if (Array.isArray(obj)) return obj.map(replace);
      if (typeof obj === 'object') {
        const o = obj as Record<string, unknown>;
        if ('var' in o) {
          const varPath = Array.isArray(o.var) ? String(o.var[0]) : String(o.var);
          const resolved = previewData[varPath];
          // If we have a real value use it, otherwise leave an empty string as placeholder
          return resolved !== undefined && resolved !== null ? resolved : '';
        }
        const result: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(o)) result[k] = replace(v);
        return result;
      }
      return obj;
    }
    return JSON.stringify(replace(parsed), null, 2);
  }

  const executeDataSource = async () => {
    setExecStatus('loading');
    setExecSaved(false);
    execFullBodyRef.current = '';   // clear previous full response
    const t0 = Date.now();

    try {
      const conventions = useBuilderStore.getState().engineConventions;
      const previewData = useBuilderStore.getState().appPreviewData;
      const resolvedEndpoint = endpoint.trim() || globalEndpoint.trim() || conventions.graphqlEndpoint || '';

      if (!resolvedEndpoint && type === 'graphql') {
        setExecCode(null);
        setExecMs(0);
        setExecBody('No endpoint configured. Set an endpoint in the Query tab or configure graphqlEndpoint in store.json engineConventions.');
        setExecStatus('error');
        return;
      }
      if (!url.trim() && type === 'rest') {
        setExecCode(null);
        setExecMs(0);
        setExecBody('No URL configured.');
        setExecStatus('error');
        return;
      }
      const globalHdrs: Record<string, string> = { ...(globalGqlHeaders ?? {}), ...(conventions.graphqlHeaders ?? {}) };

      // Build auth headers
      const authHeaders: Record<string, string> = {};
      if (auth.type === 'bearer' && auth.token) {
        authHeaders['Authorization'] = `Bearer ${auth.token}`;
      } else if (auth.type === 'basic' && auth.username) {
        authHeaders['Authorization'] = `Basic ${btoa(`${auth.username}:${auth.password ?? ''}`)}`;
      } else if (auth.type === 'apikey' && auth.apiKey) {
        authHeaders[auth.apiKeyHeader ?? 'X-API-Key'] = auth.apiKey;
      }

      // Build user headers (editor header rows override global headers)
      const userHeaders: Record<string, string> = {};
      headers.filter(h => h.enabled && h.key.trim()).forEach(h => { userHeaders[h.key] = h.value; });

      let res: Response;

      if (type === 'graphql') {
        let vars: unknown = {};
        // Prefer explicit test variables if the user filled them in
        const rawVarsSrc = testVars.trim() ? testVars : gqlVars;
        try { vars = JSON.parse(rawVarsSrc); } catch { /* keep empty */ }
        // Resolve any remaining JSON Logic { "var": ... } expressions using preview data
        vars = resolveVarsForExec(vars, previewData);
        const gqlHeaders: Record<string, string> = {
          'Content-Type': 'application/json',
          ...globalHdrs,
          ...authHeaders,
          ...userHeaders,
        };
        const fetchInit: RequestInit = {
          method: 'POST',
          headers: gqlHeaders,
          body: JSON.stringify({ query: gqlQuery, variables: vars }),
        };
        if (conventions.graphqlCredentials) {
          fetchInit.credentials = conventions.graphqlCredentials as RequestCredentials;
        }
        res = await fetch(resolvedEndpoint, fetchInit);
      } else {
        let finalUrl = url;
        const enabledParams = queryParams.filter(p => p.enabled && p.key.trim());
        if (enabledParams.length) {
          const qs = enabledParams.map(p => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value)}`).join('&');
          finalUrl = `${url}${url.includes('?') ? '&' : '?'}${qs}`;
        }
        const fetchOpts: RequestInit = {
          method: method ?? 'GET',
          headers: { ...authHeaders, ...userHeaders },
        };
        if (body && bodyType !== 'none' && method !== 'GET') {
          fetchOpts.body = body;
          if (bodyType === 'json') {
            (fetchOpts.headers as Record<string, string>)['Content-Type'] = 'application/json';
          }
        }
        res = await fetch(finalUrl, fetchOpts);
      }

      const ms = Date.now() - t0;
      const text = await res.text();
      setExecCode(res.status);
      setExecMs(ms);
      execFullBodyRef.current = text;           // keep full response for saving
      setExecBody(text.slice(0, 4000));         // display truncated
      const isOk = res.ok && !text.includes('"errors"');
      setExecStatus(isOk ? 'ok' : 'error');
      // Populate Normal state immediately on Run (so canvas shows data without "Use as preview")
      if (isOk && storeIn.trim()) {
        try {
          let parsed: unknown = JSON.parse(text);
          if (responsePath.trim()) {
            const parts = responsePath.trim().split('.');
            for (const p of parts) parsed = (parsed as Record<string, unknown>)?.[p];
          }
          const key = storeIn.trim();
          useSduiStore.getState().setData(key, parsed);
          persistPreviewData(key, parsed);
        } catch { /* not JSON */ }
      }
      // If response contains null-variable errors, switch to Variables tab so user sees the fix
      if (!isOk && type === 'graphql' && text.includes('must not be null')) {
        setInnerTab('variables');
        // Auto-fill test vars if empty so user just has to fill in the blanks
        setTestVars(prev => prev.trim() ? prev : buildTestVarsTemplate());
      }
    } catch (err) {
      setExecMs(Date.now() - t0);
      setExecCode(null);
      setExecBody(String(err));
      setExecStatus('error');
    }
  };

  /** Flatten a nested object into dot-notation flat keys, e.g. { a: { b: 1 } } → { "a.b": 1 } */
  function flattenObject(obj: unknown, prefix = ''): Record<string, unknown> {
    if (obj === null || obj === undefined || typeof obj !== 'object' || Array.isArray(obj)) {
      return prefix ? { [prefix]: obj } : {};
    }
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      const key = prefix ? `${prefix}.${k}` : k;
      if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
        Object.assign(result, flattenObject(v, key));
      } else {
        result[key] = v;
      }
    }
    return result;
  }

  const saveExecToPreview = () => {
    // Use full body for parsing (execBody is truncated to 4000 chars for display only)
    const bodyToSave = execFullBodyRef.current || execBody;
    if (!bodyToSave || !storeIn.trim()) return;
    try {
      let parsed: unknown = JSON.parse(bodyToSave);
      // Walk the response path to get the actual data value
      if (responsePath.trim()) {
        const parts = responsePath.trim().split('.');
        for (const p of parts) {
          parsed = (parsed as Record<string, unknown>)?.[p];
        }
      }

      const targetKey = storeIn.trim();
      const current = useBuilderStore.getState().appPreviewData;

      // Store two ways:
      // 1. The top-level key (e.g. "search") for direct access
      // 2. Flattened dot-notation keys (e.g. "search.items", "search.totalItems")
      //    so {{search.items}} interpolation works in the page renderer
      const updates: Record<string, unknown> = { [targetKey]: parsed };
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const flat = flattenObject(parsed, targetKey);
        Object.assign(updates, flat);
      }

      useBuilderStore.getState().setAppPreviewData({ ...current, ...updates });
      persistPreviewData(targetKey, parsed);
      setExecSaved(true);
      setExecSavedKey(targetKey);
    } catch { /* response not JSON */ }
  };

  const restTabs = ['params', 'auth', 'headers', 'body'] as const;
  const gqlTabs  = ['query', 'variables', 'auth', 'headers'] as const;
  const tabs = type === 'rest' ? restTabs : gqlTabs;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Name + type toggle */}
      <div style={SP_SECTION}>
        <label style={SP_LABEL}>Name *</label>
        <input
          data-testid="ds-name"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="fetchProducts"
          style={SP_INPUT}
        />
        <div style={{ display: 'flex', gap: 4, marginTop: 8 }}>
          {(['rest', 'graphql'] as const).map(t => (
            <button
              key={t}
              data-testid={`ds-type-${t}`}
              onClick={() => setType(t)}
      style={{
                flex: 1, padding: '5px 0',
                background: type === t ? '#1d4ed8' : '#1f2937',
                border: `1px solid ${type === t ? '#3b82f6' : '#374151'}`,
                borderRadius: 5, color: type === t ? '#fff' : '#9ca3af',
                fontSize: 11, cursor: 'pointer', fontWeight: type === t ? 600 : 400,
              }}
            >
                  {t === 'rest' ? 'REST' : 'GraphQL'}
                </button>
              ))}
            </div>
          </div>

      {/* Inner tab bar */}
      <div style={{ display: 'flex', borderBottom: '1px solid #1f2937', flexShrink: 0 }}>
        {tabs.map(t => (
          <button
            key={t}
            data-testid={`ds-tab-${t}`}
            onClick={() => setInnerTab(t)}
            style={{
              flex: 1, padding: '7px 0',
              background: 'none', border: 'none',
              borderBottom: innerTab === t ? '2px solid #3b82f6' : '2px solid transparent',
              color: innerTab === t ? '#f3f4f6' : '#6b7280',
              fontSize: 10, cursor: 'pointer',
              textTransform: 'capitalize', marginBottom: -1,
            }}
          >
            {t}
          </button>
        ))}
              </div>

      {/* Tab content */}
      <div style={{ flex: 1, overflowY: 'auto' }}>

        {/* ── Params ── */}
        {innerTab === 'params' && type === 'rest' && (
          <div style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
            {/* URL + method */}
            <div style={{ display: 'flex', gap: 6 }}>
              <div style={{ width: 80 }}>
                <label style={SP_LABEL}>Method</label>
                <select
                  data-testid="ds-method"
                  value={method}
                  onChange={e => setMethod(e.target.value as DataSourceConfig['method'])}
                  style={{ ...SP_INPUT, cursor: 'pointer' }}
                >
                  {['GET', 'POST', 'PUT', 'DELETE', 'PATCH'].map(m => <option key={m}>{m}</option>)}
                </select>
              </div>
              <div style={{ flex: 1 }}>
                <label style={SP_LABEL}>URL</label>
                <input
                  data-testid="ds-url"
                  value={url}
                  onChange={e => setUrl(e.target.value)}
                  placeholder="https://api.example.com/products"
                  style={SP_INPUT}
                />
              </div>
            </div>

            {/* Live URL preview */}
            {builtUrl && builtUrl !== url && (
              <div data-testid="ds-url-preview" style={{ fontSize: 9, color: '#6b7280', fontFamily: 'monospace', background: '#0f172a', padding: '4px 6px', borderRadius: 3, wordBreak: 'break-all' }}>
                {builtUrl}
              </div>
            )}

            {/* Query params table */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
              <span style={SP_LABEL}>Query Params</span>
              <button data-testid="ds-add-param" onClick={addParam} style={{ background: 'none', border: '1px dashed #374151', borderRadius: 3, color: '#6b7280', fontSize: 10, padding: '1px 6px', cursor: 'pointer' }}>+ Add</button>
            </div>
            {queryParams.length === 0 && (
              <div style={EMPTY}>No params — click + Add</div>
            )}
            {queryParams.map((p, i) => (
              <div key={i} style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <input
                  type="checkbox"
                  checked={p.enabled}
                  onChange={e => updateParam(i, 'enabled', e.target.checked)}
                  style={{ flexShrink: 0, accentColor: '#3b82f6' }}
                />
                <input
                  data-testid={`ds-param-key-${i}`}
                  value={p.key}
                  onChange={e => updateParam(i, 'key', e.target.value)}
                  placeholder="key"
                  style={{ ...SP_INPUT, flex: 1 }}
                />
                <input
                  data-testid={`ds-param-value-${i}`}
                  value={p.value}
                  onChange={e => updateParam(i, 'value', e.target.value)}
                  placeholder="value"
                  style={{ ...SP_INPUT, flex: 1 }}
                />
                <button onClick={() => removeParam(i)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#f87171', fontSize: 14 }}>×</button>
              </div>
            ))}
          </div>
        )}

        {/* ── Auth ── */}
        {innerTab === 'auth' && (
          <div style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div>
              <label style={SP_LABEL}>Auth Type</label>
              <select
                data-testid="ds-auth-type"
                value={auth.type}
                onChange={e => setAuth({ type: e.target.value as DataSourceAuth['type'] })}
                style={{ ...SP_INPUT, cursor: 'pointer' }}
              >
                <option value="none">None</option>
                <option value="bearer">Bearer Token</option>
                <option value="basic">Basic Auth</option>
                <option value="apikey">API Key</option>
              </select>
            </div>
            {auth.type === 'bearer' && (
              <div>
                <label style={SP_LABEL}>Token</label>
                <input
                  data-testid="ds-auth-token"
                  value={auth.token ?? ''}
                  onChange={e => setAuth(a => ({ ...a, token: e.target.value }))}
                  placeholder="Bearer token…"
                  style={SP_INPUT}
                />
              </div>
            )}
            {auth.type === 'basic' && (
              <>
                <div>
                  <label style={SP_LABEL}>Username</label>
                  <input
                    data-testid="ds-auth-username"
                    value={auth.username ?? ''}
                    onChange={e => setAuth(a => ({ ...a, username: e.target.value }))}
                    placeholder="username"
                    style={SP_INPUT}
                  />
                </div>
                <div>
                  <label style={SP_LABEL}>Password</label>
                  <input
                    data-testid="ds-auth-password"
                    type="password"
                    value={auth.password ?? ''}
                    onChange={e => setAuth(a => ({ ...a, password: e.target.value }))}
                    placeholder="password"
                    style={SP_INPUT}
                  />
              </div>
            </>
          )}
            {auth.type === 'apikey' && (
              <>
                <div>
                  <label style={SP_LABEL}>API Key</label>
                  <input
                    data-testid="ds-auth-apikey"
                    value={auth.apiKey ?? ''}
                    onChange={e => setAuth(a => ({ ...a, apiKey: e.target.value }))}
                    placeholder="your-api-key"
                    style={SP_INPUT}
                  />
                </div>
          <div>
                  <label style={SP_LABEL}>Header Name</label>
                  <input
                    data-testid="ds-auth-apikey-header"
                    value={auth.apiKeyHeader ?? ''}
                    onChange={e => setAuth(a => ({ ...a, apiKeyHeader: e.target.value }))}
                    placeholder="X-API-Key"
                    style={SP_INPUT}
                  />
                </div>
              </>
            )}
            {auth.type === 'none' && (
              <div style={EMPTY}>No authentication</div>
            )}
          </div>
        )}

        {/* ── Headers ── */}
        {innerTab === 'headers' && (
          <div style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={SP_LABEL}>Headers</span>
              <button onClick={addHeader} style={{ background: 'none', border: '1px dashed #374151', borderRadius: 3, color: '#6b7280', fontSize: 10, padding: '1px 6px', cursor: 'pointer' }}>+ Add</button>
            </div>
            {headers.length === 0 && <div style={EMPTY}>No headers — click + Add</div>}
            {headers.map((h, i) => (
              <div key={i} style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <input
                  type="checkbox"
                  checked={h.enabled}
                  onChange={e => updateHeader(i, 'enabled', e.target.checked)}
                  style={{ flexShrink: 0, accentColor: '#3b82f6' }}
                />
                <input
                  data-testid={`ds-header-key-${i}`}
                  value={h.key}
                  onChange={e => updateHeader(i, 'key', e.target.value)}
                  placeholder="Content-Type"
                  style={{ ...SP_INPUT, flex: 1 }}
                />
                <input
                  data-testid={`ds-header-value-${i}`}
                  value={h.value}
                  onChange={e => updateHeader(i, 'value', e.target.value)}
                  placeholder="application/json"
                  style={{ ...SP_INPUT, flex: 2 }}
                />
                <button onClick={() => removeHeader(i)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#f87171', fontSize: 14 }}>×</button>
              </div>
            ))}
          </div>
        )}

        {/* ── Body (REST only) ── */}
        {innerTab === 'body' && type === 'rest' && (
          <div style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div>
              <label style={SP_LABEL}>Content Type</label>
              <div style={{ display: 'flex', gap: 4 }}>
                {(['none', 'json', 'raw'] as const).map(t => (
                  <button
                    key={t}
                    onClick={() => setBodyType(t)}
                    style={{
                      flex: 1, padding: '4px 0',
                      background: bodyType === t ? '#1f2937' : 'transparent',
                      border: `1px solid ${bodyType === t ? '#6b7280' : '#374151'}`,
                      borderRadius: 4, color: bodyType === t ? '#f3f4f6' : '#6b7280',
                      fontSize: 10, cursor: 'pointer', textTransform: 'capitalize',
                    }}
                  >
                    {t === 'none' ? 'None' : t === 'json' ? 'JSON' : 'Raw'}
                  </button>
                ))}
              </div>
            </div>
            {bodyType !== 'none' && (
              <textarea
                value={body}
                onChange={e => setBody(e.target.value)}
                rows={8}
                placeholder={bodyType === 'json' ? '{\n  "key": "value"\n}' : 'Raw body…'}
                style={{ ...SP_INPUT, resize: 'vertical', fontFamily: 'monospace', lineHeight: 1.6 }}
              />
            )}
          </div>
        )}

        {/* ── GraphQL Query ── */}
        {innerTab === 'query' && type === 'graphql' && (
          <div style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
                <label style={SP_LABEL}>Endpoint</label>
                {!endpoint.trim() && globalEndpoint && (
                  <span style={{ fontSize: 9, color: '#6b7280' }}>using global: {globalEndpoint.slice(0, 36)}{globalEndpoint.length > 36 ? '…' : ''}</span>
                )}
              </div>
              <input
                data-testid="ds-endpoint"
                value={endpoint}
                onChange={e => setEndpoint(e.target.value)}
                placeholder={globalEndpoint || 'https://api.example.com/graphql'}
                style={SP_INPUT}
              />
            </div>
            <div>
              <label style={SP_LABEL}>Query</label>
              <textarea
                data-testid="ds-query"
                value={gqlQuery}
                onChange={e => setGqlQuery(e.target.value)}
                rows={8}
                placeholder={'query GetProducts {\n  products { id name price }\n}'}
                style={{ ...SP_INPUT, resize: 'vertical', fontFamily: 'monospace', lineHeight: 1.6 }}
              />
            </div>
          </div>
        )}

        {/* ── GraphQL Variables ── */}
        {innerTab === 'variables' && type === 'graphql' && (
          <div style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 10, overflowY: 'auto' }}>
            {/* Config variables (source of truth, saved to config) */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <label style={SP_LABEL}>Variables (config)</label>
                <span style={{ fontSize: 9, color: '#4b5563' }}>saved to config file</span>
              </div>
              <textarea
                data-testid="ds-gql-vars"
                value={gqlVars}
                onChange={e => setGqlVars(e.target.value)}
                rows={5}
                placeholder={'{\n  "input": {\n    "term": { "var": "route.q" },\n    "take": 12\n  }\n}'}
                style={{ ...SP_INPUT, resize: 'vertical', fontFamily: 'monospace', lineHeight: 1.5, fontSize: 10 }}
              />
            </div>

            {/* Test values — only used for Run, never saved */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <label style={{ ...SP_LABEL, color: '#fbbf24' }}>Test values <span style={{ color: '#6b7280', fontWeight: 400 }}>(Run only)</span></label>
                <button
                  data-testid="ds-gen-test-vars"
                  onClick={() => setTestVars(buildTestVarsTemplate())}
                  style={{ fontSize: 9, padding: '2px 7px', background: '#1f2937', border: '1px solid #374151', borderRadius: 3, color: '#9ca3af', cursor: 'pointer' }}
                >
                  ↺ Auto-fill from config
                </button>
              </div>
              <textarea
                data-testid="ds-test-vars"
                value={testVars}
                onChange={e => setTestVars(e.target.value)}
                rows={5}
                placeholder={'Leave empty to use config variables above.\nOr fill in literal values to override {"var":...} references:\n{\n  "slug": "my-product"\n}'}
                style={{ ...SP_INPUT, resize: 'vertical', fontFamily: 'monospace', lineHeight: 1.5, fontSize: 10, borderColor: testVars.trim() ? '#f59e0b' : undefined }}
              />
              {testVars.trim() && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 9, color: '#f59e0b' }}>▶ Run will use these test values instead of config</span>
                  <button
                    onClick={() => setTestVars('')}
                    style={{ fontSize: 9, padding: '1px 6px', background: 'transparent', border: '1px solid #374151', borderRadius: 3, color: '#6b7280', cursor: 'pointer' }}
                  >
                    clear
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Common settings (always shown at bottom) ── */}
        <div style={{ padding: '8px 12px', borderTop: '1px solid #1f2937', display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
          <div style={{ fontSize: 10, color: '#4b5563', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Settings</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1 }}>
              <label style={SP_LABEL}>Store in</label>
              <input
                data-testid="ds-store-in"
                value={storeIn}
                onChange={e => setStoreIn(e.target.value)}
                placeholder="store.products"
                style={SP_INPUT}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label style={SP_LABEL}>Response path</label>
              <input
                data-testid="ds-response-path"
                value={responsePath}
                onChange={e => setResponsePath(e.target.value)}
                placeholder="data.products"
                style={SP_INPUT}
              />
            </div>
          </div>
          <div>
            <label style={SP_LABEL}>Trigger</label>
            <div style={{ display: 'flex', gap: 4 }}>
              {(['mount', 'action'] as const).map(t => (
                <button key={t} onClick={() => setTrigger(t)}
                  style={{
                    flex: 1, padding: '4px 0',
                    background: trigger === t ? '#1f2937' : 'transparent',
                    border: `1px solid ${trigger === t ? '#6b7280' : '#374151'}`,
                    borderRadius: 4, color: trigger === t ? '#f3f4f6' : '#6b7280',
                    fontSize: 10, cursor: 'pointer',
                  }}
                >
                  {t === 'mount' ? 'On mount' : 'On action'}
                </button>
              ))}
            </div>
            {trigger === 'action' && (
              <input
                value={triggerActionName}
                onChange={e => setTriggerActionName(e.target.value)}
                placeholder="action name"
                style={{ ...SP_INPUT, marginTop: 6 }}
              />
            )}
          </div>
          </div>
        </div>

        {/* Response panel */}
        {execStatus && (
          <div style={{ margin: '0 12px 8px', border: '1px solid #1f2937', borderRadius: 5, overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: '#0f172a', borderBottom: execStatus !== 'loading' ? '1px solid #1f2937' : 'none' }}>
              {execStatus === 'loading' ? (
                <span style={{ fontSize: 11, color: '#9ca3af' }}>Sending…</span>
              ) : (
                <>
                  <span
                    data-testid="ds-exec-status"
                    style={{ fontSize: 11, fontWeight: 700, color: execStatus === 'ok' ? '#4ade80' : '#f87171' }}
                  >
                    {execCode ?? 'ERR'}
                  </span>
                  <span style={{ fontSize: 10, color: '#6b7280' }}>{execMs}ms</span>
                  {execStatus === 'ok' && storeIn.trim() && (
                    <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
                      <button
                        data-testid={execSaved ? 'ds-exec-saved' : 'ds-save-to-preview'}
                        onClick={saveExecToPreview}
                        style={{ padding: '2px 8px', background: execSaved ? '#065f46' : '#1d4ed8', border: 'none', borderRadius: 3, color: '#fff', fontSize: 10, cursor: 'pointer' }}
                      >
                        {execSaved ? '↺ Re-save' : '↓ Use as preview'}
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
            {execStatus !== 'loading' && (
              <pre style={{ margin: 0, padding: '8px 10px', background: '#0f172a', color: execStatus === 'ok' ? '#86efac' : '#fca5a5', fontSize: 10, fontFamily: 'monospace', maxHeight: 140, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                {execBody || '(empty response)'}
              </pre>
            )}
            {/* Page-switch hint after saving */}
            {execSaved && storeIn.trim() && (() => {
              // Find pages that have this storeIn key referenced in their name or try to match by convention
              // Simple heuristic: if currentBuilderPageName !== storeIn root key suggest switching
              const savedKey = storeIn.trim().split('.')[0];
              const matchingPage = builderPages.find(p =>
                p.name === savedKey ||
                p.name?.includes(savedKey) ||
                p.route?.includes(savedKey)
              );
              const isOnMatchingPage = matchingPage ? matchingPage.id === builderCurrentPageId : false;
              if (isOnMatchingPage) return null;
              return (
                <div style={{ padding: '6px 10px', background: '#1e1b4b', borderTop: '1px solid #312e81', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 9, color: '#a5b4fc', flex: 1 }}>
                    {matchingPage
                      ? <>Canvas is on &quot;<strong style={{ color: '#c7d2fe' }}>{currentBuilderPageName}</strong>&quot;. Switch to &quot;<strong style={{ color: '#c7d2fe' }}>{matchingPage.name}</strong>&quot; to see &apos;{savedKey}&apos; data.</>
                      : <>Canvas is on &quot;<strong style={{ color: '#c7d2fe' }}>{currentBuilderPageName}</strong>&quot;. Make sure you&apos;re viewing a page that uses &apos;{savedKey}&apos; data.</>
                    }
                  </span>
                  {matchingPage && (
                    <button
                      type="button"
                      data-testid="ds-switch-to-matching-page"
                      onClick={() => switchPage(matchingPage.id)}
                      style={{ padding: '2px 8px', background: '#4338ca', border: 'none', borderRadius: 3, color: '#fff', fontSize: 9, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}
                    >
                      Switch →
                    </button>
                  )}
                </div>
              );
            })()}
          </div>
        )}

        {/* Footer */}
      <div style={{ padding: '10px 12px', borderTop: '1px solid #1f2937', display: 'flex', gap: 8, justifyContent: 'flex-end', flexShrink: 0 }}>
        <button
          data-testid="ds-execute"
          onClick={executeDataSource}
          disabled={execStatus === 'loading' || (type === 'rest' ? !url.trim() : (!endpoint.trim() && !globalEndpoint.trim()))}
          style={{
            marginRight: 'auto',
            padding: '5px 12px',
            background: execStatus === 'loading' ? '#374151' : '#065f46',
            border: 'none', borderRadius: 4,
            color: '#fff', fontSize: 11, cursor: execStatus === 'loading' ? 'default' : 'pointer',
            display: 'flex', alignItems: 'center', gap: 5,
          }}
        >
          {execStatus === 'loading' ? '…' : '▶ Run'}
        </button>
        <button onClick={onClose} style={SP_BTN_SECONDARY}>Cancel</button>
        <button
          data-testid="ds-save"
          onClick={save}
          disabled={!canSave}
          style={{ ...SP_BTN_PRIMARY, opacity: canSave ? 1 : 0.4, cursor: canSave ? 'pointer' : 'default' }}
        >
          Save
        </button>
      </div>
    </div>
  );
}

// ─── B. Variables ─────────────────────────────────────────────────────────────

interface VarSlidePanelProps {
  initial: Partial<CustomVar> & { isNew?: boolean };
  onSave: (v: CustomVar) => void;
  onClose: () => void;
}

function VariableSlideContent({ initial, onSave, onClose }: VarSlidePanelProps) {
  const [varName, setVarName] = useState(initial.name ?? '');
  const [varType, setVarType] = useState<CustomVar['type']>(initial.type ?? 'string');
  const [varValue, setVarValue] = useState(() => {
    if (initial.initialValue === undefined) return '';
    return typeof initial.initialValue === 'string'
      ? initial.initialValue
      : JSON.stringify(initial.initialValue, null, 2);
  });
  const [jsonErr, setJsonErr] = useState<string | null>(null);

  const canSave = varName.trim().length > 0;

  const save = () => {
    if (!canSave) return;
    let parsed: unknown = varValue;
    if (varType === 'number') parsed = Number(varValue);
    else if (varType === 'boolean') parsed = varValue === 'true';
    else if (varType === 'object' || varType === 'array') {
      try { parsed = JSON.parse(varValue); setJsonErr(null); }
      catch (e) { setJsonErr((e as Error).message); return; }
    }
    onSave({ name: varName.trim(), type: varType, initialValue: parsed });
  };

  return (
    <div style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: 10, height: '100%' }}>
      <div>
        <label style={SP_LABEL}>Name *</label>
        <input
          data-testid="var-name"
          value={varName}
          onChange={e => setVarName(e.target.value)}
          placeholder="myVariable"
          style={SP_INPUT}
          disabled={!initial.isNew && !!initial.name}
        />
      </div>
      <div>
        <label style={SP_LABEL}>Type</label>
        <select
          data-testid="var-type"
          value={varType}
          onChange={e => setVarType(e.target.value as CustomVar['type'])}
          style={{ ...SP_INPUT, cursor: 'pointer' }}
        >
          <option value="string">String</option>
          <option value="number">Number</option>
          <option value="boolean">Boolean</option>
          <option value="object">Object</option>
          <option value="array">Array</option>
        </select>
      </div>
      <div style={{ flex: 1 }}>
        <label style={SP_LABEL}>Value</label>
        {varType === 'boolean' ? (
          <select
            data-testid="var-value-bool"
            value={varValue === 'true' ? 'true' : 'false'}
            onChange={e => setVarValue(e.target.value)}
            style={{ ...SP_INPUT, cursor: 'pointer' }}
          >
            <option value="false">false</option>
            <option value="true">true</option>
          </select>
        ) : varType === 'object' || varType === 'array' ? (
          <>
            <textarea
              data-testid="var-value"
              value={varValue}
              onChange={e => { setVarValue(e.target.value); setJsonErr(null); }}
              rows={6}
              style={{ ...SP_INPUT, resize: 'vertical', fontFamily: 'monospace', lineHeight: 1.5, border: `1px solid ${jsonErr ? '#f87171' : '#374151'}` }}
            />
            {jsonErr && <span style={{ fontSize: 10, color: '#f87171', marginTop: 3, display: 'block' }}>{jsonErr}</span>}
          </>
        ) : (
          <input
            data-testid="var-value"
            type={varType === 'number' ? 'number' : 'text'}
            value={varValue}
            onChange={e => setVarValue(e.target.value)}
            style={SP_INPUT}
          />
        )}
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 'auto' }}>
        <button onClick={onClose} style={SP_BTN_SECONDARY}>Cancel</button>
        <button
          data-testid="var-save"
          onClick={save}
          disabled={!canSave}
          style={{ ...SP_BTN_PRIMARY, opacity: canSave ? 1 : 0.4, cursor: canSave ? 'pointer' : 'default' }}
        >
          Save
        </button>
      </div>
    </div>
  );
}

const TYPE_BADGE_COLORS: Record<string, string> = {
  string: '#818cf8', number: '#34d399', boolean: '#f59e0b',
  object: '#f87171', array: '#c084fc',
};

// ─── Slide state types ────────────────────────────────────────────────────────

export type DataTabSlideState =
  | { kind: 'dataSource'; editingId: string | null }
  | { kind: 'variable'; editingName: string | null }
  | null;

// ─── DataSlidePanelContent — rendered inside page.tsx's SlidePanel ────────────

interface DataSlidePanelContentProps {
  slideState: DataTabSlideState;
  onClose: () => void;
}

export function DataSlidePanelContent({ slideState, onClose }: DataSlidePanelContentProps) {
  const store = useBuilderStore();

  const handleDsSave = useCallback((cfg: DataSourceConfig) => {
    const existing = store.pageDataSources.find(s => s.id === cfg.id);
    if (existing) store.updatePageDataSource(cfg.id, cfg);
    else store.addPageDataSource(cfg);
    onClose();
  }, [store, onClose]);

  const handleVarSave = useCallback((v: CustomVar) => {
    const existing = store.customVars.find(c => c.name === v.name);
    if (existing) store.updateCustomVar(v.name, { type: v.type, initialValue: v.initialValue });
    else store.addCustomVar(v);
    onClose();
  }, [store, onClose]);

  if (!slideState) return null;

  if (slideState.kind === 'dataSource') {
    const existing = slideState.editingId
      ? store.pageDataSources.find(s => s.id === slideState.editingId) ?? {}
      : {};
    return <DataSourceSlideContent initial={existing} onSave={handleDsSave} onClose={onClose} />;
  }

  if (slideState.kind === 'variable') {
    const existing = slideState.editingName
      ? store.customVars.find(v => v.name === slideState.editingName) ?? { isNew: false }
      : { isNew: true };
    return <VariableSlideContent initial={existing} onSave={handleVarSave} onClose={onClose} />;
  }

  return null;
}

export function getDataSlideTitle(slideState: DataTabSlideState): string {
  if (!slideState) return '';
  if (slideState.kind === 'dataSource') return slideState.editingId ? 'Edit Data Source' : 'Add Data Source';
  if (slideState.kind === 'variable') return slideState.editingName ? 'Edit Variable' : 'Add Variable';
  return '';
}

// ─── Main DataTab — 50/50 split layout ────────────────────────────────────────

const SEARCH_INPUT: React.CSSProperties = {
  width: '100%',
  background: '#111827',
  border: '1px solid #374151',
  borderRadius: 4,
  padding: '4px 8px',
  fontSize: 10,
  color: '#d1d5db',
  outline: 'none',
  boxSizing: 'border-box',
};

const SUB_HDR: React.CSSProperties = {
  fontSize: 9,
  fontWeight: 700,
  color: '#4b5563',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.07em',
  padding: '4px 12px 2px',
  background: '#0f172a',
};

interface DataTabProps {
  onSetSlide: (s: DataTabSlideState) => void;
}

export function DataTab({ onSetSlide }: DataTabProps) {
  const [dsSearch, setDsSearch] = useState('');
  const [varSearch, setVarSearch] = useState('');
  const [dsOpen, setDsOpen] = useState(true);
  const [varOpen, setVarOpen] = useState(true);
  const { pageDataSources, removePageDataSource, customVars } = useBuilderStore();

  const filteredDs = pageDataSources.filter(s =>
    s.name?.toLowerCase().includes(dsSearch.toLowerCase())
  );
  const restSources = filteredDs.filter(s => s.type === 'rest');
  const graphqlSources = filteredDs.filter(s => s.type === 'graphql');

  const filteredVars = customVars.filter(v =>
    v.name?.toLowerCase().includes(varSearch.toLowerCase())
  );
  const varsByType: Record<string, typeof customVars> = {};
  for (const v of filteredVars) {
    if (!varsByType[v.type]) varsByType[v.type] = [];
    varsByType[v.type].push(v);
  }

  return (
    <div data-testid="data-tab-split" style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
      {/* ── Top: Data Sources ── */}
      <div
        data-testid="data-sources-column"
        style={{ flex: dsOpen ? '1 1 0' : '0 0 auto', minWidth: 0, minHeight: 0, borderBottom: '2px solid #1f2937', display: 'flex', flexDirection: 'column', overflow: 'hidden', transition: 'flex 0.2s' }}
      >
        <div style={{ ...SECTION_HDR, flexShrink: 0, cursor: 'pointer' }} onClick={() => setDsOpen(o => !o)}>
          <span style={{ ...SEC_LABEL, display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ fontSize: 8, color: '#6b7280', transition: 'transform 0.15s', transform: dsOpen ? 'rotate(90deg)' : 'rotate(0deg)', display: 'inline-block' }}>▶</span>
            Data Sources
          </span>
          <button
            data-testid="add-datasource-btn"
            onClick={e => { e.stopPropagation(); onSetSlide({ kind: 'dataSource', editingId: null }); }}
            style={ADD_BTN}
          >
            + Add
          </button>
        </div>
        {dsOpen && (
          <>
            <div style={{ padding: '6px 10px', flexShrink: 0 }}>
              <input
                data-testid="ds-search"
                value={dsSearch}
                onChange={e => setDsSearch(e.target.value)}
                placeholder="Search sources…"
                style={SEARCH_INPUT}
              />
            </div>
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {filteredDs.length === 0 && (
                <div style={EMPTY}>No sources yet — add a REST or GraphQL source.</div>
              )}
              {restSources.length > 0 && (
                <>
                  <div style={SUB_HDR}>REST</div>
                  {restSources.map(src => (
                    <DataSourceCard
                      key={src.id}
                      src={src}
                      onEdit={() => onSetSlide({ kind: 'dataSource', editingId: src.id })}
                      onDelete={() => removePageDataSource(src.id)}
                    />
                  ))}
                </>
              )}
              {graphqlSources.length > 0 && (
                <>
                  <div style={SUB_HDR}>GraphQL</div>
                  {graphqlSources.map(src => (
                    <DataSourceCard
                      key={src.id}
                      src={src}
                      onEdit={() => onSetSlide({ kind: 'dataSource', editingId: src.id })}
                      onDelete={() => removePageDataSource(src.id)}
                    />
                  ))}
                </>
              )}
            </div>
          </>
        )}
      </div>

      {/* ── Bottom: Variables ── */}
      <div
        data-testid="variables-column"
        style={{ flex: varOpen ? '1 1 0' : '0 0 auto', minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', transition: 'flex 0.2s' }}
      >
        <div style={{ ...SECTION_HDR, flexShrink: 0, cursor: 'pointer' }} onClick={() => setVarOpen(o => !o)}>
          <span style={{ ...SEC_LABEL, display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ fontSize: 8, color: '#6b7280', transition: 'transform 0.15s', transform: varOpen ? 'rotate(90deg)' : 'rotate(0deg)', display: 'inline-block' }}>▶</span>
            Variables
          </span>
          <button
            data-testid="add-variable-btn"
            onClick={e => { e.stopPropagation(); onSetSlide({ kind: 'variable', editingName: null }); }}
            style={ADD_BTN}
          >
            + Add
          </button>
        </div>
        {varOpen && (
          <>
            <div style={{ padding: '6px 10px', flexShrink: 0 }}>
              <input
                data-testid="var-search"
                value={varSearch}
                onChange={e => setVarSearch(e.target.value)}
                placeholder="Search variables…"
                style={SEARCH_INPUT}
              />
            </div>
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {filteredVars.length === 0 && (
                <div style={EMPTY}>No variables yet — add one.</div>
              )}
              {Object.entries(varsByType).map(([type, vars]) => (
                <React.Fragment key={type}>
                  <div style={SUB_HDR}>{type}</div>
                  {vars.map(v => {
                    const col = TYPE_BADGE_COLORS[v.type] ?? '#6b7280';
                    return (
                      <div
                        key={v.name}
                        data-testid={`var-row-${v.name}`}
                        style={{ padding: '6px 12px', borderBottom: '1px solid #1f2937', display: 'flex', alignItems: 'center', gap: 5 }}
                      >
                        <span style={{ fontSize: 9, padding: '1px 4px', borderRadius: 3, background: `${col}22`, color: col, border: `1px solid ${col}44`, flexShrink: 0 }}>
                          {v.type.slice(0, 3)}
                        </span>
                        <span style={{ fontSize: 10, color: '#c084fc', fontFamily: 'monospace', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {v.name}
                        </span>
                        <button
                          data-testid={`edit-var-${v.name}`}
                          onClick={() => onSetSlide({ kind: 'variable', editingName: v.name })}
                          style={{ background: 'none', border: '1px solid #374151', borderRadius: 3, color: '#9ca3af', fontSize: 10, padding: '1px 5px', cursor: 'pointer', flexShrink: 0 }}
                        >
                          ✎
                        </button>
                      </div>
                    );
                  })}
                </React.Fragment>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function DataSourceCard({
  src,
  onEdit,
  onDelete,
}: { src: DataSourceConfig; onEdit: () => void; onDelete: () => void }) {
  return (
    <div
      style={{ padding: '7px 12px', borderBottom: '1px solid #1f2937', display: 'flex', alignItems: 'flex-start', gap: 6 }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
          <span style={{
            fontSize: 8, padding: '1px 4px', borderRadius: 3,
            background: `${TYPE_COLOR[src.type]}22`,
            color: TYPE_COLOR[src.type],
            border: `1px solid ${TYPE_COLOR[src.type]}44`,
            textTransform: 'uppercase', letterSpacing: '0.06em', flexShrink: 0,
          }}>
            {src.type}
          </span>
          <span style={{ fontSize: 10, fontWeight: 600, color: '#f3f4f6', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {src.name}
          </span>
        </div>
        <div style={{ fontSize: 9, color: '#6b7280', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {src.url ?? src.endpoint ?? ''}
        </div>
        {src.storeIn && (
          <div style={{ fontSize: 8, color: '#818cf8', marginTop: 1 }}>→ {src.storeIn}</div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
        <button
          data-testid={`edit-datasource-${src.id}`}
          onClick={onEdit}
          style={{ padding: '2px 6px', background: 'none', border: '1px solid #374151', borderRadius: 3, color: '#9ca3af', fontSize: 9, cursor: 'pointer' }}
        >
          Edit
        </button>
        <button
          data-testid={`delete-datasource-${src.id}`}
          onClick={onDelete}
          style={{ padding: '2px 6px', background: 'none', border: '1px solid #374151', borderRadius: 3, color: '#f87171', fontSize: 9, cursor: 'pointer' }}
        >
          ×
        </button>
      </div>
    </div>
  );
}
