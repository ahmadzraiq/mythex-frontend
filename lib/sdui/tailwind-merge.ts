/**
 * Merge Tailwind classes, replacing conflicting utilities.
 * Uses tailwind-merge for correct conflict resolution across all Tailwind utilities.
 */

import { twMerge } from 'tailwind-merge';

export function mergeTailwindClasses(
  base: string | undefined,
  override: string
): string {
  return twMerge(base ?? '', override).trim().replace(/\s+/g, ' ');
}
