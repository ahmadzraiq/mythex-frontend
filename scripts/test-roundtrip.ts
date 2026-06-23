/**
 * Round-trip test: build chat page, then edit it.
 * Verifies that deResolveNodeTree correctly converts className → SxProps
 * so the AI always sees SxProps on subsequent turns.
 *
 * Run with: npx tsx scripts/test-roundtrip.ts
 */
import * as fs from 'fs';
import * as http from 'http';
import { deResolveNodeTree } from '../lib/sdui/deresolve-sx';

function postAgent(projectId: string, prompt: string, vfsFiles: Record<string, string>): Promise<Record<string, string>> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ prompt, projectId, vfsFiles });
    const opts = {
      hostname: 'localhost', port: 3001,
      path: '/api/ai/json-agent', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    };
    const writtenFiles: Record<string, string> = {};
    const req = http.request(opts, res => {
      let buf = '';
      res.on('data', (chunk: Buffer) => {
        buf += chunk.toString();
        const lines = buf.split('\n\n');
        buf = lines.pop()!;
        for (const block of lines) {
          const dataLine = block.split('\n').find(l => l.startsWith('data:'));
          if (!dataLine) continue;
          try {
            const obj = JSON.parse(dataLine.slice(5)) as Record<string, unknown>;
            if (obj.type === 'file') writtenFiles[obj.path as string] = obj.content as string;
            if (obj.type === 'result') {
              const u = obj.usage as { output_tokens?: number } | undefined;
              console.log('  [agent done] tokens out:', u?.output_tokens);
            }
          } catch { /* skip */ }
        }
      });
      res.on('end', () => resolve(writtenFiles));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function countMatches(str: string, pattern: string | RegExp): number {
  return (str.match(new RegExp(pattern, 'g')) || []).length;
}

const SX_SAMPLE_KEYS = ['bg', 'col', 'row', 'px', 'py', 'w', 'h', 'gap', 'radius', 'border', 'items', 'justify', 'textColor', 'weight'];

function countSxProps(str: string): number {
  return SX_SAMPLE_KEYS.reduce((n, k) => n + countMatches(str, `"${k}"`), 0);
}

async function main() {
  const pid = 'rr-' + Date.now();
  const routes = JSON.stringify({ routes: [{ path: '/chat', config: 'chat', name: 'chat' }] });

  // ── Turn 1: build the chat page ──────────────────────────────────────────
  console.log('\n=== TURN 1: build chat page ===');
  const files1 = await postAgent(
    pid,
    'Build a chat page with 3 messages (2 mine right-aligned indigo bubble, 1 theirs left-aligned white bubble). Input bar at the bottom.',
    { routes },
  );

  const pageContent = files1['pages/chat/page'];
  if (!pageContent) {
    console.error('FAIL: no page written in turn 1');
    process.exit(1);
  }

  const resolved = JSON.parse(pageContent) as { ui: unknown[]; meta: unknown };
  const resolvedStr = JSON.stringify(resolved);
  const cnBefore = countMatches(resolvedStr, '"className"');
  const sxBefore = countSxProps(resolvedStr);

  console.log(`  SSE content (post-resolver):  className=${cnBefore}  SxProps=${sxBefore}`);
  console.log('  Root node className:', (resolved.ui?.[0] as Record<string, unknown>)?.props);

  // Apply de-resolver (simulates serializeVirtualFiles on turn 2)
  const deresolved = { ...resolved, ui: deResolveNodeTree(resolved.ui) };
  const drStr = JSON.stringify(deresolved);
  const cnAfter = countMatches(drStr, '"className"');
  const sxAfter = countSxProps(drStr);

  console.log(`  After deResolveNodeTree:      className=${cnAfter}  SxProps=${sxAfter}`);
  console.log('  Root node SxProps:', JSON.stringify((deresolved.ui?.[0] as Record<string, unknown>)?.props).slice(0, 120));

  const pass1 = cnAfter === 0 && sxAfter > 0;
  console.log(`  Result: ${pass1 ? 'PASS ✓' : 'FAIL ✗'} (className=0, SxProps>0)`);
  fs.writeFileSync('/tmp/rr-turn1.json', JSON.stringify(deresolved, null, 2));

  // ── Turn 2: edit — send de-resolved VFS as context ───────────────────────
  console.log('\n=== TURN 2: edit (change bubble to green) ===');
  const files2 = await postAgent(
    pid,
    'Change the message bubble colors to green instead of indigo.',
    {
      routes,
      'pages/chat/page': JSON.stringify(deresolved),
    },
  );

  const page2 = files2['pages/chat/page'];
  if (!page2) {
    console.log('  Agent did not re-write the page (possible: already done)');
    process.exit(0);
  }

  const resolved2 = JSON.parse(page2) as { ui: unknown[] };
  const deresolved2 = { ...resolved2, ui: deResolveNodeTree(resolved2.ui) };
  const s2 = JSON.stringify(deresolved2);
  const cn2 = countMatches(s2, '"className"');
  const sx2 = countSxProps(s2);
  const hasGreen = /green|#22c55e|#16a34a|#4ade80|#15803d/i.test(s2);

  console.log(`  After deResolveNodeTree: className=${cn2}  SxProps=${sx2}  hasGreen=${hasGreen}`);
  const pass2 = cn2 === 0 && sx2 > 0 && hasGreen;
  console.log(`  Result: ${pass2 ? 'PASS ✓' : 'FAIL ✗'}`);
  fs.writeFileSync('/tmp/rr-turn2.json', JSON.stringify(deresolved2, null, 2));

  console.log('\n=== SUMMARY ===');
  console.log(`  Turn 1 de-resolve: ${pass1 ? 'PASS ✓' : 'FAIL ✗'}`);
  console.log(`  Turn 2 edit + de-resolve: ${pass2 ? 'PASS ✓' : 'FAIL ✗'}`);
  console.log('  Files saved to /tmp/rr-turn1.json and /tmp/rr-turn2.json');

  process.exit(pass1 && pass2 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
