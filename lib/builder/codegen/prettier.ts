/**
 * prettier.ts — In-browser prettier formatting for emitted .ts/.tsx files.
 *
 * Uses prettier/standalone (no Node.js required) with the babel parser.
 * Silently returns the original content if formatting fails.
 */

import type { EmittedFile } from './types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyModule = any;

let _prettier: AnyModule = null;
let _plugins: unknown[] = [];

async function loadPrettier(): Promise<boolean> {
  if (_prettier) return true;
  try {
    // Dynamic imports: prettier is a devDependency; falls back gracefully if unavailable
    const [standalone, babel, ts, postcss] = await Promise.all([
      import('prettier').catch(() => null),
      // @ts-ignore — prettier v3 standalone plugin path varies
      import('prettier/plugins/babel').catch(() => null),
      // @ts-ignore — prettier v3 standalone plugin path varies
      import('prettier/plugins/typescript').catch(() => null),
      // @ts-ignore — prettier v3 standalone plugin path varies
      import('prettier/plugins/postcss').catch(() => null),
    ]);
    if (!standalone) return false;
    _prettier = standalone;
    _plugins = [babel?.default ?? babel, ts?.default ?? ts, postcss?.default ?? postcss].filter(Boolean);
    return true;
  } catch {
    return false;
  }
}

const PRETTIER_CONFIG = {
  semi: true,
  singleQuote: true,
  trailingComma: 'all' as const,
  tabWidth: 2,
  printWidth: 100,
  jsxSingleQuote: false,
};

async function formatFile(file: EmittedFile): Promise<EmittedFile> {
  if (file.binary) return file; // skip binary

  const ext = file.path.split('.').pop() ?? '';
  const isTs = ext === 'ts' || ext === 'tsx';
  const isCss = ext === 'css';
  const isJson = ext === 'json';

  if (isJson) {
    try {
      const parsed = JSON.parse(file.content);
      return { ...file, content: JSON.stringify(parsed, null, 2) + '\n' };
    } catch {
      return file;
    }
  }

  if (!_prettier || (!isTs && !isCss)) return file;

  try {
    const formatted = await _prettier.format(file.content, {
      ...PRETTIER_CONFIG,
      parser: isCss ? 'css' : 'typescript',
      plugins: _plugins,
    });
    return { ...file, content: formatted };
  } catch {
    // If prettier fails, return original — do not fail the whole export
    return file;
  }
}

/**
 * Format all emitted files in-place.
 * Returns a new array with formatted contents.
 */
export async function formatAllFiles(files: EmittedFile[]): Promise<EmittedFile[]> {
  const loaded = await loadPrettier();
  if (!loaded) return files; // prettier not available, skip formatting

  return Promise.all(files.map(formatFile));
}
