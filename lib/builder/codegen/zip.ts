/**
 * zip.ts — Collect EmittedFile[] into a JSZip blob and trigger download.
 */

import JSZip from 'jszip';
import type { EmittedFile } from './types';

export async function createZip(
  files: EmittedFile[],
  appName: string,
  onProgress?: (done: number, total: number) => void,
): Promise<Blob> {
  const zip = new JSZip();
  const folder = zip.folder(appName) ?? zip;

  for (let i = 0; i < files.length; i++) {
    const file = files[i]!;
    if (file.binary) {
      folder.file(file.path, file.binary);
    } else {
      folder.file(file.path, file.content);
    }
    onProgress?.(i + 1, files.length);
  }

  return zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
}

/** Trigger a browser download of the given blob */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
