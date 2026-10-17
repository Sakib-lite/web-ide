import { useStore } from './store';

export const API_BASE = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4099').replace(/\/$/, '');

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
  }
}

interface Options {
  method?: string;
  body?: Record<string, unknown>;
  query?: Record<string, string | number | boolean | null | undefined>;
  raw?: boolean;
}

export async function api<T = any>(path: string, { method = 'GET', body, query, raw }: Options = {}): Promise<T> {
  const url = new URL(API_BASE + path);
  const root = useStore.getState().project?.root;
  if (root && !url.searchParams.has('root')) url.searchParams.set('root', root);
  if (query) for (const [k, v] of Object.entries(query)) if (v != null && v !== '') url.searchParams.set(k, String(v));
  const res = await fetch(url, {
    method,
    credentials: 'include',
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify({ root, ...body }) : undefined,
  });
  if (raw) return (await res.text()) as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error || res.statusText, res.status, data.code);
  return data as T;
}

export const favoritesApi = {
  list: () => api<string[]>('/api/favorites'),
  add: (path: string) => api<string[]>('/api/favorites', { method: 'POST', body: { path } }),
  remove: (path: string) => api<string[]>('/api/favorites', { method: 'DELETE', query: { path } }),
};

export function wsUrl(path: string): string {
  const url = new URL(API_BASE + path);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  const root = useStore.getState().project?.root;
  if (root) url.searchParams.set('root', root);
  return url.toString();
}

export const fsApi = {
  list: (path: string) => api('/api/fs/list', { query: { path } }),
  read: (path: string) => api<{ content: string; mtime: number }>('/api/fs/read', { query: { path } }),
  write: (path: string, content: string) => api<{ mtime: number }>('/api/fs/write', { method: 'POST', body: { path, content } }),
  create: (path: string, type: 'dir' | 'file') => api('/api/fs/create', { method: 'POST', body: { path, type } }),
  rename: (path: string, newPath: string) => api('/api/fs/rename', { method: 'POST', body: { path, newPath } }),
  remove: (path: string) => api('/api/fs/delete', { method: 'POST', body: { path } }),
  resolve: (from: string, spec: string, dirRelative = false, python = false) => api<{ path: string | null }>('/api/fs/resolve', { query: { from, spec, dirRelative: dirRelative ? '1' : '0', python: python ? '1' : '0' } }),
  files: async () => {
    const cached = useStore.getState().files;
    if (cached) return cached;
    const files = await api<string[]>('/api/files');
    useStore.getState().setFiles(files);
    return files;
  },
  search: (q: string) => api('/api/search', { query: { q } }),
};

export const gitApi = {
  status: () => api('/api/git/status'),
  log: (query: Record<string, string | number | undefined>) => api('/api/git/log', { query }),
  head: (path: string) => api<{ content: string | null }>('/api/git/head', { query: { path } }),
  fileAt: (rev: string, path: string) => api<{ content: string | null }>('/api/git/file-at', { query: { rev, path } }),
  changes: (path: string, content: string) => api('/api/git/changes', { method: 'POST', body: { path, content } }),
  stage: (paths: string[]) => api('/api/git/stage', { method: 'POST', body: { paths } }),
  unstage: (paths: string[]) => api('/api/git/unstage', { method: 'POST', body: { paths } }),
  revert: (paths: string[]) => api('/api/git/revert', { method: 'POST', body: { paths } }),
  commit: (message: string, paths: string[], amend: boolean) => api('/api/git/commit', { method: 'POST', body: { message, paths, amend } }),
  blame: (path: string) => api('/api/git/blame', { query: { path } }),
  branches: () => api('/api/git/branches'),
  config: () => api<{ name: string; email: string }>('/api/git/config'),
};

export const symApi = {
  status: () => api('/api/symbols/status'),
  lookup: (params: Record<string, string | undefined>) => api('/api/symbols/lookup', { query: params }),
  search: (q: string) => api('/api/symbols/search', { query: { q } }),
  file: (path: string) => api('/api/symbols/file', { query: { path } }),
  members: (cls: string, file?: string) => api('/api/symbols/members', { query: { class: cls, file } }),
  complete: (q: string, file?: string, kinds?: string) => api('/api/symbols/complete', { query: { q, file, kinds } }),
  phpNames: (q: string) => api<{ classes: { fqn: string; file: string }[]; namespaces: string[] }>('/api/symbols/php-names', { query: { q } }),
  pyModules: (q: string) => api<string[]>('/api/symbols/py-modules', { query: { q } }),
  usages: (word: string, file?: string) => api('/api/usages', { query: { word, file } }),
};
