/**
 * Returns the full section library manifest for the dev browser sidebar.
 * GET /api/dev/section-preview/manifest
 */

import { NextResponse } from 'next/server';
import { sectionLibrary } from '@/lib/ai/section-library';

export async function GET() {
  return NextResponse.json({ manifest: sectionLibrary.getManifest() });
}
