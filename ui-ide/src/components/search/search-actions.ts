import { create } from 'zustand';
import { fsApi, symApi } from '@/lib/api';
import { useStore } from '@/lib/store';

export interface SearchHit {
  file: string;
  line: number;
  col: number;
  text: string;
}

interface FindState {
  query: string;
  title: string | null;
  rows: SearchHit[];
  status: string;
  setQuery: (q: string) => void;
  run: (q: string) => Promise<void>;
  usages: (word: string, file?: string) => Promise<void>;
}

export const useFindStore = create<FindState>((set) => ({
  query: '',
  title: null,
  rows: [],
  status: '',
  setQuery: (query) => set({ query }),
  run: async (q) => {
    if (q.length < 2) return set({ status: 'Type at least 2 characters' });
    set({ query: q, title: null, status: 'Searching…', rows: [] });
    try {
      const rows: SearchHit[] = await fsApi.search(q);
      set({ rows, status: `${rows.length}${rows.length >= 300 ? '+' : ''} matches in ${new Set(rows.map((r) => r.file)).size} files` });
    } catch (err: any) {
      set({ status: err.message });
    }
  },
  usages: async (word, file) => {
    set({ query: word, title: `Usages of ${word}`, status: `Usages of ${word}…`, rows: [] });
    try {
      const rows: SearchHit[] = await symApi.usages(word, file);
      set({ rows, status: `Usages of ${word}: ${rows.length} usages in ${new Set(rows.map((r) => r.file)).size} files` });
    } catch (err: any) {
      set({ status: err.message });
    }
  },
}));

export function openFindInFiles(prefill?: string) {
  useStore.getState().showTool('find');
  if (prefill) useFindStore.getState().run(prefill);
  setTimeout(() => {
    const input = document.querySelector<HTMLInputElement>('#find-input');
    input?.focus();
    input?.select();
  }, 60);
}

export function findUsages(word: string, file?: string) {
  useStore.getState().showTool('find');
  useFindStore.getState().usages(word, file);
}
