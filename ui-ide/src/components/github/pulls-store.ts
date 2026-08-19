import { create } from 'zustand';
import { api } from '@/lib/api';

export interface PullSummary {
  number: number;
  title: string;
  state: string;
  merged: boolean;
  draft: boolean;
  author: string;
  avatar: string;
  createdAt: string;
  updatedAt: string;
  url: string;
}

export interface RepoInfo {
  connected: boolean;
  owner?: string;
  repo?: string;
  user?: string | null;
  hasToken?: boolean;
  info?: { defaultBranch: string } | null;
}

interface PullsState {
  repo: RepoInfo | null;
  pulls: PullSummary[];
  authors: string[];
  state: string;
  author: string;
  query: string;
  loading: boolean;
  error: string | null;
  selected: number | null;
  openCount: number;
  setFilters: (patch: Partial<{ state: string; author: string; query: string }>) => void;
  loadRepo: (force?: boolean) => Promise<RepoInfo>;
  refresh: (force?: boolean) => Promise<void>;
  select: (n: number | null) => void;
}

export const usePullsStore = create<PullsState>((set, get) => ({
  repo: null,
  pulls: [],
  authors: [],
  state: 'open',
  author: '',
  query: '',
  loading: false,
  error: null,
  selected: null,
  openCount: 0,
  setFilters: (patch) => {
    set(patch);
    get().refresh();
  },
  loadRepo: async (force = false) => {
    const cached = get().repo;
    if (cached && !force) return cached;
    const repo = await api<RepoInfo>('/api/github/repo').catch(() => ({ connected: false }));
    set({ repo });
    return repo;
  },
  refresh: async (force = false) => {
    const repo = await get().loadRepo(force);
    if (!repo.connected || !repo.hasToken) return set({ pulls: [], error: null });
    set({ loading: true, error: null });
    try {
      if (force || !get().authors.length) set({ authors: await api<string[]>('/api/github/collaborators').catch(() => []) });
      const { state, author, query } = get();
      const data = await api<{ total: number; items: PullSummary[] }>('/api/github/pulls', { query: { state, author, q: query } });
      set({ pulls: data.items, openCount: state === 'open' ? data.total : get().openCount, loading: false });
    } catch (err: any) {
      set({ error: err.message, loading: false, pulls: [] });
    }
  },
  select: (selected) => set({ selected }),
}));
