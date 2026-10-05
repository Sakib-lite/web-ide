import { api } from './api';
import { ProjectInfo, useStore } from './store';

export async function openProject(path: string): Promise<ProjectInfo> {
  const current = useStore.getState().project;
  if (current && current.root !== path) {
    location.href = `${location.pathname}?root=${encodeURIComponent(path)}`;
    return current;
  }
  const info = await api<ProjectInfo>('/api/project/open', { method: 'POST', body: { path } });
  useStore.getState().setProject(info);
  useStore.getState().setIndexStatus({ ready: info.indexReady, stats: null });
  history.replaceState(null, '', `${location.pathname}?root=${encodeURIComponent(info.root)}`);
  document.title = `${info.name} – Web IDE`;
  return info;
}

export function closeProject() {
  location.href = location.pathname;
}

export function rootFromUrl(): string | null {
  return new URLSearchParams(location.search).get('root');
}
