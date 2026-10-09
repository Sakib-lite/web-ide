import { create } from 'zustand';
import { useStore, GitStatus } from '@/lib/store';
import { changedPaths } from './git-status';

export interface ChangeGroup {
  id: string;
  name: string;
  comment?: string;
  active?: boolean;
  unversioned?: boolean;
  files: string[];
}

interface CommitState {
  checked: Set<string>;
  known: Set<string>;
  selection: Set<string>;
  collapsed: Set<string>;
  lastClicked: string | null;
  tab: 'commit' | 'shelf';
  message: string;
  amend: boolean;
  setTab: (tab: 'commit' | 'shelf') => void;
  setMessage: (m: string) => void;
  setAmend: (a: boolean) => void;
  toggleChecked: (paths: string[], on: boolean) => void;
  setChecked: (paths: string[]) => void;
  uncheck: (paths: string[]) => void;
  select: (id: string, e: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }, order: string[]) => void;
  clearSelection: () => void;
  toggleCollapsed: (id: string) => void;
  setCollapsedAll: (ids: string[]) => void;
  syncWithStatus: (status: GitStatus) => void;
}

export const useCommitStore = create<CommitState>((set, get) => ({
  checked: new Set(),
  known: new Set(),
  selection: new Set(),
  collapsed: new Set(),
  lastClicked: null,
  tab: 'commit',
  message: '',
  amend: false,
  setTab: (tab) => set({ tab }),
  setMessage: (message) => set({ message }),
  setAmend: (amend) => set({ amend }),
  toggleChecked: (paths, on) => {
    const checked = new Set(get().checked);
    for (const p of paths) on ? checked.add(p) : checked.delete(p);
    set({ checked });
  },
  setChecked: (paths) => set({ checked: new Set(paths) }),
  uncheck: (paths) => {
    const checked = new Set(get().checked);
    for (const p of paths) checked.delete(p);
    set({ checked });
  },
  select: (id, e, order) => {
    const { selection, lastClicked } = get();
    let next: Set<string>;
    if (e.shiftKey && lastClicked) {
      const a = order.indexOf(lastClicked), b = order.indexOf(id);
      next = new Set(order.slice(Math.min(a, b), Math.max(a, b) + 1));
    } else if (e.metaKey || e.ctrlKey) {
      next = new Set(selection);
      next.has(id) ? next.delete(id) : next.add(id);
    } else next = new Set([id]);
    set({ selection: next, lastClicked: id });
  },
  clearSelection: () => set({ selection: new Set() }),
  toggleCollapsed: (id) => {
    const collapsed = new Set(get().collapsed);
    collapsed.has(id) ? collapsed.delete(id) : collapsed.add(id);
    set({ collapsed });
  },
  setCollapsedAll: (ids) => set({ collapsed: new Set(ids) }),
  syncWithStatus: (status) => {
    const { checked, known } = get();
    const nextChecked = new Set(checked), nextKnown = new Set(known);
    const active = activeList(status);
    for (const p of changedPaths(status)) {
      if (nextKnown.has(p)) continue;
      nextKnown.add(p);
      if (listOf(status, p)?.id === active?.id && status.files[p].status !== 'untracked') nextChecked.add(p);
    }
    for (const p of nextChecked) if (!status.files[p]) nextChecked.delete(p);
    set({ checked: nextChecked, known: nextKnown });
  },
}));

export const lists = (status: GitStatus = useStore.getState().gitStatus) => status.changelists || [{ id: 'default', name: 'Changes', comment: '', active: true, files: [] }];
export const activeList = (status?: GitStatus) => lists(status).find((l) => l.active) || lists(status)[0];

export function listOf(status: GitStatus, path: string) {
  const st = status.files[path];
  if (!st || st.status === 'untracked') return null;
  return lists(status).find((l) => l.id !== 'default' && l.files.includes(path)) || lists(status).find((l) => l.id === 'default');
}

export function groups(status: GitStatus = useStore.getState().gitStatus): ChangeGroup[] {
  const paths = changedPaths(status);
  const out: ChangeGroup[] = lists(status).map((l) => ({ id: l.id, name: l.name, comment: l.comment, active: l.active, files: paths.filter((p) => listOf(status, p)?.id === l.id) }));
  out.push({ id: 'unversioned', name: 'Unversioned Files', unversioned: true, files: paths.filter((p) => status.files[p].status === 'untracked') });
  return out;
}

export function targetPaths(): string[] {
  const { selection, checked } = useCommitStore.getState();
  const paths = new Set<string>();
  for (const s of selection) {
    if (s.startsWith('group:')) for (const p of groups().find((g) => g.id === s.slice(6))?.files || []) paths.add(p);
    else paths.add(s);
  }
  if (!paths.size) for (const p of checked) paths.add(p);
  return [...paths];
}
