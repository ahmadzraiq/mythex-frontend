/**
 * GET /api/ai-responses
 * Reads logged AI responses from the latest lib/ai/eval/ai-responses*.jsonl file.
 * Query: ?generator=navbar-overrides|layout|palettes|font-pairings|variant-suggestions
 * For layout entries, adds screen (schemaToScreen) for preview.
 */

import { NextResponse } from 'next/server';
import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { schemaToScreen } from '@/lib/ai/schema-to-screen';

const EVAL_DIR = join(process.cwd(), 'lib', 'ai', 'eval');

function listResponseFiles(): { name: string; mtime: number }[] {
  if (!existsSync(EVAL_DIR)) return [];
  return readdirSync(EVAL_DIR)
    .filter((f) => f.startsWith('ai-responses') && f.endsWith('.jsonl'))
    .map((f) => ({ name: f, mtime: statSync(join(EVAL_DIR, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
}

function getResponsesFile(requestedFile?: string | null): string | null {
  const files = listResponseFiles();
  if (files.length === 0) return null;
  if (requestedFile && files.some((f) => f.name === requestedFile)) {
    return join(EVAL_DIR, requestedFile);
  }
  return join(EVAL_DIR, files[0].name);
}

type LogEntry = {
  timestamp: string;
  generator: string;
  input: Record<string, unknown>;
  output: unknown;
  source: 'api' | 'eval';
  evalResult?: 'PASS' | 'FAIL' | null;
  error?: string;
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const generator = searchParams.get('generator');
  const file = searchParams.get('file');

  const files = listResponseFiles();
  const logFile = getResponsesFile(file);
  if (!logFile || !existsSync(logFile)) {
    return NextResponse.json({ entries: [], file: null, files: files.map((f) => ({ name: f.name, mtime: f.mtime })) });
  }

  try {
    const raw = readFileSync(logFile, 'utf8');
    const lines = raw.trim().split('\n').filter(Boolean);
    const entries: LogEntry[] = [];

    const navbarGenerators = new Set(['navbar', 'navbar-structure']);
    const matchesGenerator = (gen: string, entryGen: string) =>
      !gen || entryGen === gen || (navbarGenerators.has(gen) && navbarGenerators.has(entryGen));

    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as LogEntry;
        if (generator && !matchesGenerator(generator, entry.generator)) continue;
        if (entry.evalResult === 'FAIL') continue;
        entries.push(entry);
      } catch {
        // skip malformed lines
      }
    }

    // For layout entries, add screen for preview
    const enriched = entries.map((e) => {
      if (e.generator === 'layout' && e.output && typeof e.output === 'object') {
        const out = e.output as { layout?: unknown; theme?: unknown };
        if (out.layout && typeof out.layout === 'object') {
          try {
            const screen = schemaToScreen(out.layout as Parameters<typeof schemaToScreen>[0]);
            return { ...e, screen };
          } catch {
            return e;
          }
        }
      }
      return e;
    });

    const fileName = logFile.split('/').pop() ?? logFile;
    return NextResponse.json({
      entries: enriched,
      file: fileName,
      files: files.map((f) => ({ name: f.name, mtime: f.mtime })),
    });
  } catch (err) {
    console.error('[ai-responses]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to read log' },
      { status: 500 }
    );
  }
}
