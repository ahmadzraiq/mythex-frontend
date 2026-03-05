import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import dataSourcesJson from '@/config/datasources.json';
import variablesJson from '@/config/variables.json';
import type { NamedDataSourceDef } from '@/config/datasource-types';

/**
 * GET /api/builder/config
 * Returns config that the builder pre-populates from (data sources, variables, folders, etc.)
 */
export async function GET() {
  const dataSources = dataSourcesJson as Record<string, NamedDataSourceDef>;

  // Build a stable map of folder name → folder id from config sources
  const folderNameToId = new Map<string, string>();
  for (const def of Object.values(dataSources)) {
    if (def.folder && !folderNameToId.has(def.folder)) {
      folderNameToId.set(def.folder, `cfg-folder-${def.folder.toLowerCase().replace(/\s+/g, '-')}`);
    }
  }

  // key = UUID (both id and storeIn), def.label = display name
  const dataSourceList = Object.entries(dataSources).map(([uuid, def]) => {
    const folderId = def.folder ? folderNameToId.get(def.folder) : undefined;
    const base = {
      id: uuid,
      storeIn: uuid,
      _fromConfig: true,
      ...(folderId ? { folderId } : {}),
      ...(def.label ? { _label: def.label } : {}),
    };

    if (def.type === 'graphql') {
      const headersArr = def.headers
        ? Object.entries(def.headers).map(([key, value]) => ({ key, value, enabled: true }))
        : [];
      const opMatch = def.query.match(/^\s*(?:query|mutation|subscription)\s+(\w+)/i);
      const operationName = opMatch?.[1] ?? uuid;
      return {
        ...base,
        type: 'graphql' as const,
        url: def.endpoint,
        method: 'POST' as const,
        headers: headersArr,
        responsePath: '',
        proxy: false,
        sendCredentials: false,
        query: def.query,
        variables: def.variables ? JSON.stringify(def.variables, null, 2) : undefined,
        _operationName: operationName,
      };
    }

    // REST
    const headersArr = Array.isArray(def.headers)
      ? def.headers
      : def.headers
        ? Object.entries(def.headers as Record<string, string>).map(([key, value]) => ({ key, value, enabled: true }))
        : [];

    return {
      ...base,
      type: 'rest' as const,
      url: def.url,
      method: def.method ?? 'GET',
      headers: headersArr,
      queryParams: def.queryParams ?? [],
      responsePath: '',
      proxy: def.proxy ?? false,
      sendCredentials: def.sendCredentials ?? false,
    };
  });

  // Build folder list in display order (order of first appearance in datasources.json)
  const dsFolders = Array.from(folderNameToId.entries()).map(([name, id]) => ({
    id,
    name,
    parentId: null as string | null,
  }));

  // Build variables list from config/variables.json
  type VarDef = {
    label?: string;
    type?: string;
    initialValue?: unknown;
    folder?: string;
    fields?: Array<{ name: string; type?: string; initialValue?: unknown; validation?: Record<string, unknown> }>;
  };
  const varsConfig = variablesJson as { variables: Record<string, VarDef>; varFolders: Array<{ id: string; label: string }> };
  const variables = Object.entries(varsConfig.variables ?? {}).map(([uuid, def]) => ({
    id: uuid,
    label: def.label ?? uuid,
    type: def.type ?? 'string',
    initialValue: def.initialValue,
    folder: def.folder,
    fields: def.fields,
    _fromConfig: true,
  }));

  const varFolders = (varsConfig.varFolders ?? []).map(f => ({
    id: f.id,
    label: f.label,
  }));

  return NextResponse.json({ dataSources: dataSourceList, dsFolders, variables, varFolders });
}

/**
 * PATCH /api/builder/config
 * Writes a new variable entry to config/variables.json (used when dropping Form component).
 */
export async function PATCH(req: Request) {
  try {
    const body = await req.json() as {
      action: 'addVariable';
      id: string;
      variable: Record<string, unknown>;
    };

    if (body.action === 'addVariable') {
      const filePath = path.join(process.cwd(), 'config', 'variables.json');
      const raw = await fs.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(raw) as { variables: Record<string, unknown>; varFolders: unknown[] };
      parsed.variables[body.id] = body.variable;
      await fs.writeFile(filePath, JSON.stringify(parsed, null, 2) + '\n', 'utf-8');
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
