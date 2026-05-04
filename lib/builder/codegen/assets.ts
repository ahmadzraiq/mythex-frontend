/**
 * assets.ts — Discover user-uploaded asset URLs in the node tree.
 *
 * In a browser context we can't fetch external URLs synchronously,
 * so this module identifies which URLs should be localized to public/assets/
 * and returns a mapping for nodes.ts to use when rewriting src props.
 *
 * Actual download in the ZIP step is handled by zip.ts.
 */

import type { SDUINode } from '@/lib/sdui/types/node';
import type { EmittedFile } from './types';

export interface AssetMapping {
  /** Original URL → public path */
  urlToPublic: Map<string, string>;
}

/** Props that may contain asset URLs */
const ASSET_PROP_KEYS = ['src', 'uri', 'lottie', 'source', 'backgroundImage'];

/**
 * Walk the node tree and collect all project-internal asset URLs.
 * External CDN URLs (not on project domains) are left as-is.
 */
export function collectAssetUrls(nodes: SDUINode[]): Map<string, string> {
  const mapping = new Map<string, string>();
  let counter = 0;

  function visit(node: SDUINode & Record<string, unknown>): void {
    for (const key of ASSET_PROP_KEYS) {
      const val = (node.props as Record<string, unknown>)?.[key] as string | undefined;
      if (val && shouldLocalize(val) && !mapping.has(val)) {
        const ext = getExt(val);
        const localPath = `/assets/asset-${counter++}${ext}`;
        mapping.set(val, localPath);
      }
    }
    for (const child of (node.children ?? []) as SDUINode[]) {
      visit(child as SDUINode & Record<string, unknown>);
    }
  }

  for (const n of nodes) {
    visit(n as SDUINode & Record<string, unknown>);
  }

  return mapping;
}

/** Returns true if a URL points to a project-hosted asset that should be localized */
function shouldLocalize(url: string): boolean {
  // Data URLs — only inline small ones
  if (url.startsWith('data:')) return false; // leave data URLs as-is
  // Blob URLs — can't be fetched in exported project
  if (url.startsWith('blob:')) return false;
  // Only localize if it looks like a relative path or supabase/cloudinary upload
  if (url.startsWith('/')) return true;
  // Project CDN domains (common patterns)
  if (/\/(uploads?|assets?|media|files)\//i.test(url)) return true;
  // Skip well-known external CDNs
  if (/\.(unsplash|pexels|cloudflare|picsum|placeholder)\./i.test(url)) return false;
  return false;
}

function getExt(url: string): string {
  const match = url.match(/\.([a-zA-Z0-9]+)(\?.*)?$/);
  if (!match) return '';
  const ext = match[1]!.toLowerCase();
  const known = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'ico', 'mp4', 'webm', 'json', 'lottie']);
  return known.has(ext) ? `.${ext}` : '';
}

/** Build a placeholder public/assets/.gitkeep file */
export function emitAssetsGitkeep(): EmittedFile {
  return {
    path: 'public/assets/.gitkeep',
    content: '# Static assets downloaded during export are placed here\n',
  };
}
