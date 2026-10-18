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
}
