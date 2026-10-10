import { create } from 'zustand';
import { api, gitApi } from '@/lib/api';
import { useStore } from '@/lib/store';
import { Branches, loadBranches } from '@/components/vcs/vcs-actions';
import { LogCommit } from './graph-layout';

export interface LogFilters {
  ref: string;
  author: string;
  grep: string;
  since: string;
  path: string;
}

interface LogState {
  tab: 'log' | 'console';
  filters: LogFilters;
  commits: LogCommit[];
  hasMore: boolean;
  branches: Branches | null;
  authors: { name: string; email: string }[];
  selected: string | null;
  error: string | null;
  setTab: (t: 'log' | 'console') => void;
  setFilter: (patch: Partial<LogFilters>) => void;
  refresh: (force?: boolean) => Promise<void>;
  loadMore: () => Promise<void>;
  select: (hash: string | null) => void;
}

const LIMIT = 150;

export const useLogStore = create<LogState>((set, get) => ({
  tab: 'log',
  filters: { ref: 'all', author: '', grep: '', since: '', path: '' },
  commits: [],
  hasMore: false,
  branches: null,
  authors: [],
  selected: null,
  error: null,
  setTab: (tab) => set({ tab }),
  setFilter: (patch) => {
    set((s) => ({ filters: { ...s.filters, ...patch } }));
    get().refresh();
  },
  refresh: async (force = false) => {
    if (!useStore.getState().gitStatus.repo) return set({ commits: [], error: null });
    try {
      const { filters } = get();
      const [log, branches, authors] = await Promise.all([gitApi.log({ ...filters, limit: LIMIT }), loadBranches(force), api('/api/git/authors').catch(() => [])]);
      set({ commits: log.commits, hasMore: log.hasMore, branches, authors, error: null });
    } catch (err: any) {
      set({ error: err.message });
    }
  },
  loadMore: async () => {
    const { hasMore, filters, commits } = get();
    if (!hasMore) return;
    set({ hasMore: false });
    const log = await gitApi.log({ ...filters, limit: LIMIT, skip: commits.length }).catch(() => ({ commits: [], hasMore: false }));
    set({ commits: [...commits, ...log.commits], hasMore: log.hasMore });
  },
  select: (selected) => set({ selected }),
}));
