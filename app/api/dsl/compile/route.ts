/**
 * POST /api/dsl/compile
 *
 * Server-side DSL → JSON compilation for a single file.
 * Called by the browser WebContainer hook after each Write/Edit tool call.
 *
 * Body: {
 *   path:       string                        // e.g. "src/calculator/page.tsx"
 *   content:    string                        // updated file content
 *   projectId?: string
 *   allSources: Record<string, string>        // current full VFS snapshot for UUID resolution
 * }
 *
 * Response: { events: CompiledEvent[] }
 * where CompiledEvent = { type, path, content } (same shape as dsl-chat NDJSON events)
 */

import { NextRequest, NextResponse } from 'next/server';
import { compileVarsToJson } from '@/lib/dsl/compiler/compile-var';
import { compileAllWorkflowsToJson } from '@/lib/dsl/compiler/compile-workflow';
import { compilePageToJson } from '@/lib/dsl/compiler/compile-page';

type CompiledEvent = {
  type: 'var_written' | 'workflow_written' | 'page_written' | 'routes_written';
  path: string;
  content: string;
};

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: {
    path?: string;
    content?: string;
    projectId?: string;
    allSources?: Record<string, string>;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { path: filePath, content, projectId = 'dsl', allSources = {} } = body;

  if (!filePath || content == null) {
    return NextResponse.json({ error: 'path and content are required' }, { status: 400 });
  }

  const events: CompiledEvent[] = [];

  try {
    // Build pathToId from all other sources so cross-file references resolve correctly
    const pathToId = new Map<string, string>();

    // Pass 1 — compile all var files in the snapshot
    for (const [src_path, src_content] of Object.entries(allSources)) {
      if (!src_path.endsWith('.ts') || src_path.endsWith('page.tsx')) continue;
      try {
        const compiledVars = compileVarsToJson(src_content, projectId);
        for (const v of compiledVars) {
          pathToId.set(`store/${v.varName}`, v.uuid);
          pathToId.set(v.varName, v.uuid);
        }
      } catch { /* skip malformed */ }
    }

    // Also compile the incoming file itself if it's a var file
    if (filePath.endsWith('.ts') && !filePath.endsWith('page.tsx')) {
      try {
        const compiledVars = compileVarsToJson(content, projectId);
        for (const v of compiledVars) {
          pathToId.set(`store/${v.varName}`, v.uuid);
          pathToId.set(v.varName, v.uuid);
          events.push({
            type: 'var_written',
            path: `store/${v.varName}`,
            content: JSON.stringify(v.entry),
          });
        }
      } catch { /* skip malformed */ }
    }

    // Pass 1.5 — pre-compute workflow UUIDs
    const allSourcesWithNew = { ...allSources, [filePath]: content };
    for (const [, src_content] of Object.entries(allSourcesWithNew)) {
      if (!src_content.includes('defineWorkflow')) continue;
      try {
        const compiled = compileAllWorkflowsToJson(src_content, pathToId, projectId);
        for (const wf of compiled) {
          pathToId.set(wf.wfPath, wf.uuid);
          pathToId.set(`workflows/${wf.wfName}`, wf.uuid);
        }
      } catch { /* skip malformed */ }
    }

    // Pass 2 — compile the changed file
    if (filePath.endsWith('page.tsx')) {
      try {
        const compiled = compilePageToJson(content, pathToId);
        if (compiled) {
          events.push({
            type: 'page_written',
            path: `pages/${compiled.pageName}/page`,
            content: JSON.stringify({ meta: { title: compiled.title }, ui: [compiled.content] }),
          });
          events.push({
            type: 'routes_written',
            path: 'routes',
            content: JSON.stringify({
              routes: [{
                path: `/${compiled.pageName.toLowerCase()}`,
                config: compiled.pageName,
                name: compiled.title || compiled.pageName,
              }],
            }),
          });
        }
      } catch { /* skip malformed page */ }
    } else if (content.includes('defineWorkflow')) {
      try {
        const compiled = compileAllWorkflowsToJson(content, pathToId, projectId);
        for (const wf of compiled) {
          events.push({
            type: 'workflow_written',
            path: `workflows/${wf.wfName}`,
            content: JSON.stringify(wf.config),
          });
        }
      } catch { /* skip malformed workflow */ }
    }

    return NextResponse.json({ events });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
