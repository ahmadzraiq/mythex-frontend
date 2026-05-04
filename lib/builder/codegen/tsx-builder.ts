/**
 * tsx-builder.ts — Simple in-memory file emitter with import tracking.
 *
 * Each call to emit() adds a file to the in-memory FS.
 * The ImportsTracker collects what needs to be imported per file
 * and renders them at the top.
 */

export class ImportsTracker {
  private named = new Map<string, Set<string>>();
  private defaults = new Map<string, string>();
  private sideEffects = new Set<string>();

  addNamed(pkg: string, ...idents: string[]): void {
    if (!this.named.has(pkg)) this.named.set(pkg, new Set());
    for (const id of idents) this.named.get(pkg)!.add(id);
  }

  addDefault(pkg: string, ident: string): void {
    this.defaults.set(pkg, ident);
  }

  addSideEffect(pkg: string): void {
    this.sideEffects.add(pkg);
  }

  render(): string {
    const lines: string[] = [];
    for (const pkg of this.sideEffects) {
      lines.push(`import '${pkg}';`);
    }
    for (const [pkg, ident] of this.defaults) {
      const named = this.named.get(pkg);
      if (named && named.size > 0) {
        lines.push(`import ${ident}, { ${[...named].sort().join(', ')} } from '${pkg}';`);
      } else {
        lines.push(`import ${ident} from '${pkg}';`);
      }
    }
    for (const [pkg, idents] of this.named) {
      if (this.defaults.has(pkg)) continue; // already handled above
      lines.push(`import { ${[...idents].sort().join(', ')} } from '${pkg}';`);
    }
    return lines.join('\n');
  }
}

/** Escape a string for inclusion in a JSX attribute or string literal */
export function jsxStr(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r');
}

/** Indent a multiline string by n spaces */
export function indent(s: string, n = 2): string {
  const pad = ' '.repeat(n);
  return s.split('\n').map(l => (l.trim() ? pad + l : l)).join('\n');
}

/** Wrap content in a 'use client' directive + imports header + body */
export function clientComponent(imports: ImportsTracker, body: string): string {
  const imp = imports.render();
  return `'use client';\n\n${imp}\n\n${body}`;
}

/** Build a server page (no 'use client') with metadata export */
export function serverPage(imports: ImportsTracker, metadata: string | null, body: string): string {
  const imp = imports.render();
  const meta = metadata ? `\n${metadata}\n` : '';
  return `${imp}\n${meta}\n${body}`;
}
