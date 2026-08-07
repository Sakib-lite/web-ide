export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
export const mod = isMac ? '⌘' : 'Ctrl';

export const basename = (p: string) => p.split('/').pop() || p;
export const dirname = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
export const extname = (p: string) => {
  const b = basename(p);
  const i = b.lastIndexOf('.');
  return i > 0 ? b.slice(i + 1).toLowerCase() : '';
};

export type Debounced<T extends unknown[]> = ((...args: T) => void) & { cancel: () => void; flush: (...args: T) => void };

export function debounce<T extends unknown[]>(fn: (...args: T) => void, ms: number): Debounced<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const d = ((...args: T) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  }) as Debounced<T>;
  d.cancel = () => clearTimeout(timer);
  d.flush = (...args: T) => {
    clearTimeout(timer);
    fn(...args);
  };
  return d;
}

export function fuzzyScore(text: string, query: string): number {
  const t = text.toLowerCase(), q = query.toLowerCase();
  if (!q) return 0;
  const direct = t.indexOf(q);
  if (direct >= 0) return 1000 - direct - (t.length - q.length) * 0.1;
  let qi = 0, score = 0, last = -2;
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] !== q[qi]) continue;
    score += last === i - 1 ? 8 : 3;
    if (i === 0 || '/._-'.includes(t[i - 1])) score += 5;
    last = i;
    qi++;
  }
  return qi === q.length ? score - t.length * 0.05 : -1;
}

export function timeAgo(ts: number): string {
  const d = (Date.now() - ts) / 1000;
  if (d < 60) return 'just now';
  if (d < 3600) return `${Math.floor(d / 60)} min ago`;
  if (d < 86400) return `${Math.floor(d / 3600)} h ago`;
  if (d < 172800) return 'Yesterday';
  if (d < 86400 * 30) return `${Math.floor(d / 86400)} days ago`;
  return new Date(ts).toLocaleDateString();
}

export function fmtDate(ts: number): string {
  const dt = new Date(ts);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const time = dt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (dt.toDateString() === today.toDateString()) return `Today ${time}`;
  if (dt.toDateString() === yesterday.toDateString()) return `Yesterday ${time}`;
  return `${dt.toLocaleDateString([], { day: 'numeric', month: 'numeric', year: '2-digit' })}, ${time}`;
}

export function shortAgo(ts: number): string {
  const d = (Date.now() - ts) / 86400000;
  if (d < 1) return 'today';
  if (d < 30) return `${Math.floor(d)}d`;
  if (d < 365) return `${Math.floor(d / 30)}mo`;
  return `${Math.floor(d / 365)}y`;
}

export const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function readLocal<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
}

export function writeLocal(key: string, value: unknown) {
  localStorage.setItem(key, JSON.stringify(value));
}

export function downloadText(name: string, text: string, type = 'text/plain') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
}

export function badgeHue(name: string): number {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

export function initials(name: string): string {
  const parts = name.replace(/[-_.]+/g, ' ').trim().split(/\s+/);
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : name.slice(0, 2)).toUpperCase();
}
