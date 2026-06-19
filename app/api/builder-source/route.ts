import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

/**
 * GET /api/builder-source
 * Returns the content of lib/dsl/builder/index.ts so client-side components
 * (Monaco IntelliSense, file viewer Library tab) can load it without bundling
 * the file into the client chunk.
 */
export async function GET() {
  const filePath = path.join(process.cwd(), 'lib', 'dsl', 'builder', 'index.ts');
  const source = fs.readFileSync(filePath, 'utf-8');
  return new NextResponse(source, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
