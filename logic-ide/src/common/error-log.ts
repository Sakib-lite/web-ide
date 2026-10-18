import fs from 'node:fs/promises';
import path from 'node:path';
import { LOG_DIR } from '../config/paths';

export type LogSource = 'backend' | 'frontend';

export interface ErrorLogEntry {
  message: string;
  context?: string;
  stack?: string;
}

const FILES: Record<LogSource, string> = {
  backend: path.join(LOG_DIR, 'backend-error.log'),
  frontend: path.join(LOG_DIR, 'frontend-error.log'),
};

export async function logError(source: LogSource, entry: ErrorLogEntry): Promise<void> {
  const lines = [`[${new Date().toISOString()}]${entry.context ? ' ' + entry.context : ''} ${entry.message}`];
  if (entry.stack) lines.push(entry.stack);
  lines.push('');
  try {
    await fs.mkdir(LOG_DIR, { recursive: true });
    await fs.appendFile(FILES[source], lines.join('\n') + '\n');
  } catch {}
}
