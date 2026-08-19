import { api } from '@/lib/api';
import { useStore } from '@/lib/store';

export interface PublicSettings {
  githubToken: string;
  hasGithubToken: boolean;
  githubUser: string | null;
}

export async function loadGithubUser(): Promise<PublicSettings> {
  const s = await api<PublicSettings>('/api/settings').catch(() => ({ githubToken: '', hasGithubToken: false, githubUser: null }));
  useStore.getState().setGithub({ user: s.githubUser, hasToken: s.hasGithubToken });
  return s;
}
