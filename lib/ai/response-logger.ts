/**
 * Logs all AI responses for reference — auditing, debugging, corpus building.
 * Writes to lib/ai/eval/ai-responses.jsonl (append-only JSONL).
 */

import { appendFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

export type AiResponseLogEntry = {
  timestamp: string;
  generator: string;
  input: Record<string, unknown>;
  output: unknown;
  source: 'api' | 'eval';
  evalResult?: 'PASS' | 'FAIL' | null;
  error?: string;
};

const LOG_DIR = join(process.cwd(), 'lib', 'ai', 'eval');

function getDefaultLogFile(): string {
  const date = new Date().toISOString().slice(0, 10);
  return join(LOG_DIR, `ai-responses-${date}.jsonl`);
}

function getLogFile(): string {
  return process.env.AI_RESPONSES_FILE ?? getDefaultLogFile();
}

const ENABLED = process.env.AI_RESPONSE_LOG_ENABLED !== 'false';

function ensureLogDir(): void {
  if (!existsSync(LOG_DIR)) {
    mkdirSync(LOG_DIR, { recursive: true });
  }
}

/**
 * Append one AI response to the log file.
 * Safe to call from API routes and eval script.
 */
export function logAiResponse(
  generator: string,
  input: Record<string, unknown>,
  output: unknown,
  options?: { source?: 'api' | 'eval'; evalResult?: 'PASS' | 'FAIL'; error?: string }
): void {
  if (!ENABLED) return;

  try {
    ensureLogDir();
    const entry: AiResponseLogEntry = {
      timestamp: new Date().toISOString(),
      generator,
      input,
      output,
      source: options?.source ?? 'api',
      evalResult: options?.evalResult ?? null,
      error: options?.error,
    };
    appendFileSync(getLogFile(), JSON.stringify(entry) + '\n', 'utf8');
  } catch (e) {
    console.error('[ai-response-logger] Failed to write log:', e);
  }
}
