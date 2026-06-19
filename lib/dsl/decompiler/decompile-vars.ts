/**
 * decompile-vars
 *
 * Converts builder store variables back to source files matching Claude's style:
 *   - One file per variable at `src/store/<name>.ts`
 *   - `import { defineVar } from 'builder';`
 *   - `export default defineVar('string', '0');`
 */

import type { CustomVar } from '@/app/dev/builder/_store-types';

function serializeInitialValue(value: unknown): string {
  if (value === undefined || value === null) return 'null';
  return JSON.stringify(value, null, 2)
    .split('\n')
    .map((line, i) => (i === 0 ? line : '  ' + line))
    .join('\n');
}

function defaultForType(type: CustomVar['type']): unknown {
  switch (type) {
    case 'string':  return '';
    case 'number':  return 0;
    case 'boolean': return false;
    case 'array':   return [];
    case 'object':  return {};
    case 'form':    return {};
    default:        return null;
  }
}

function toSafeFilename(name: string): string {
  // Convert camelCase or any valid name to a safe filename (preserve as-is mostly)
  return name.replace(/[^a-zA-Z0-9_-]/g, '_');
}

/**
 * Convert CustomVar[] to a map of { filePath → source }.
 * Returns an empty object if there are no variables to emit.
 *
 * Each variable gets its own file:
 *   src/store/display.ts  → import { defineVar } from 'builder';\nexport default defineVar('string', '0');\n
 */
export function decompileVars(vars: CustomVar[]): Record<string, string> {
  const exportable = vars.filter(v => v.name && !v.name.startsWith('_'));
  const files: Record<string, string> = {};

  for (const v of exportable) {
    const varType  = v.type ?? 'string';
    const initVal  = serializeInitialValue(v.initialValue ?? defaultForType(v.type));
    const filename = toSafeFilename(v.label ?? v.name);
    const filePath = `src/store/${filename}.ts`;

    let code = `import { defineVar } from 'builder';\n\nexport default defineVar('${varType}', ${initVal});\n`;

    files[filePath] = code;
  }

  return files;
}
