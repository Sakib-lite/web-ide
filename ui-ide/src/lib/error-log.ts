import { API_BASE } from './api';

export function reportError(message: string, stack?: string) {
  fetch(API_BASE + '/api/logs/frontend-error', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message, stack, url: typeof window !== 'undefined' ? window.location.href : undefined }),
  }).catch(() => {});
}

export function installGlobalErrorLogging() {
  window.addEventListener('error', (e) => reportError(e.error?.message || e.message, e.error?.stack));
  window.addEventListener('unhandledrejection', (e) => {
    const reason = e.reason;
    reportError(reason?.message || String(reason), reason?.stack);
  });
  // Libraries (e.g. Monaco) report real problems via console.error without throwing,
  // so mirror those into the error log too.
  const original = console.error.bind(console);
  let reporting = false;
  console.error = (...args: unknown[]) => {
    original(...args);
    if (reporting) return;
    reporting = true;
    try {
      const message = args.map((a) => (a instanceof Error ? a.message : typeof a === 'string' ? a : JSON.stringify(a))).join(' ').slice(0, 2000);
      const stack = args.find((a): a is Error => a instanceof Error)?.stack;
      reportError('console.error: ' + message, stack);
    } catch {} finally {
      reporting = false;
    }
  };
}
