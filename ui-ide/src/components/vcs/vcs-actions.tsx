import { api } from '@/lib/api';
import { useStore } from '@/lib/store';
import { emit } from '@/lib/bus';
import { toast } from '@/components/ui/Toasts';
import { confirmDialog, formDialog, promptDialog } from '@/components/ui/dialogs';
import { readLocal, writeLocal } from '@/lib/utils';

export interface Branch {
  name: string;
  hash: string;
  date: number;
  subject: string;
  current: boolean;
  upstream?: string | null;
  ahead?: number;
  behind?: number;
  remote?: string;
  branch?: string;
}

export interface Branches {
  current: string | null;
  detached: boolean;
  local: Branch[];
  remote: Branch[];
  tags: Branch[];
  recent: string[];
  remotes: string[];
}

let cache: Branches | null = null;
let busy = 0;
const favorites = new Set<string>(readLocal<string[]>('ide.favBranches', []));

export const isFavorite = (name: string) => favorites.has(name);
export function toggleFavorite(name: string) {
  favorites.has(name) ? favorites.delete(name) : favorites.add(name);
  writeLocal('ide.favBranches', [...favorites]);
  emit('git-change');
}

export async function loadBranches(force = false): Promise<Branches> {
  if (cache && !force) return cache;
  cache = await api<Branches>('/api/git/branches');
  return cache;
}

export function invalidateBranches() {
  cache = null;
}

const summarize = (out: string) => out.split('\n').map((l) => l.trim()).filter((l) => l && !/^(hint:|warning: redirecting)/.test(l)).slice(-3).join('\n');

export async function runGit<T extends { output?: unknown }>(label: string, fn: () => Promise<T>, { successTitle = label, quiet = false } = {}): Promise<T> {
  const store = useStore.getState();
  busy++;
  store.setProgress(label);
  store.setStatusMessage(label + '…');
  try {
    const res = await fn();
    if (!quiet) toast(successTitle, summarize(typeof res?.output === 'string' ? res.output : ''), 'success', 4500);
    store.setStatusMessage(successTitle);
    return res;
  } catch (err: any) {
    toast(`${label} failed`, err.message, 'error', 12000);
    store.setStatusMessage(`${label} failed`);
    throw err;
  } finally {
    invalidateBranches();
    emit('git-change');
    if (--busy === 0) useStore.getState().setProgress(null);
  }
}

const post = (path: string, body: Record<string, unknown> = {}) => api<{ ok: boolean; output: string }>(path, { method: 'POST', body });
const swallow = () => undefined;

export const updateProject = () => runGit('Update Project', () => post('/api/git/pull', { rebase: useStore.getState().settings.updateRebase }), { successTitle: 'Project updated' }).catch(swallow);
export const fetchAll = () => runGit('Fetch', () => post('/api/git/fetch'), { successTitle: 'Fetched from all remotes' }).catch(swallow);
export const checkout = (ref: string) => runGit(`Checkout ${ref}`, () => post('/api/git/checkout', { ref }), { successTitle: `Checked out ${ref}` });

export function pullBranch(ref: string, rebase: boolean) {
  const [remote, ...rest] = ref.split('/');
  return runGit(`Pull ${ref}`, async () => {
    await post('/api/git/fetch');
    return rebase ? post('/api/git/rebase', { onto: ref }) : post('/api/git/merge', { ref });
  }, { successTitle: `Pulled ${rest.join('/')} from ${remote}` }).catch(swallow);
}

export async function mergeInto(ref: string) {
  const cur = useStore.getState().gitStatus.branch;
  if (await confirmDialog(`Merge "${ref}" into "${cur}"?`, 'Merge')) await runGit(`Merge ${ref}`, () => post('/api/git/merge', { ref }), { successTitle: `Merged ${ref} into ${cur}` }).catch(swallow);
}

export async function rebaseOnto(ref: string) {
  const cur = useStore.getState().gitStatus.branch;
  if (await confirmDialog(`Rebase "${cur}" onto "${ref}"?`, 'Rebase')) await runGit(`Rebase onto ${ref}`, () => post('/api/git/rebase', { onto: ref }), { successTitle: `Rebased ${cur} onto ${ref}` }).catch(swallow);
}

export async function deleteBranch(name: string, remote = false) {
  if (!(await confirmDialog(`Delete ${remote ? 'remote ' : ''}branch "${name}"?`, 'Delete'))) return;
  try {
    await runGit(`Delete ${name}`, () => post('/api/git/branch/delete', { name, remote }), { successTitle: `Deleted ${name}` });
  } catch (err: any) {
    if (!remote && /not fully merged/.test(err.message) && (await confirmDialog(`Branch "${name}" is not fully merged. Delete anyway?`, 'Force Delete'))) await runGit(`Delete ${name}`, () => post('/api/git/branch/delete', { name, force: true }), { successTitle: `Deleted ${name}` }).catch(swallow);
  }
}

export async function renameBranch(name: string) {
  const newName = await promptDialog({ title: `Rename branch ${name}`, label: 'New name:', value: name, okText: 'Rename' });
  if (newName && newName !== name) await runGit('Rename Branch', () => post('/api/git/branch/rename', { name, newName }), { successTitle: `Renamed to ${newName}` }).catch(swallow);
}

export async function compareWith(ref: string) {
  const cur = useStore.getState().gitStatus.branch;
  try {
    const r = await api<{ left: number; right: number }>('/api/git/compare', { query: { a: 'HEAD', b: ref } });
    toast(`Compare ${cur} with ${ref}`, `${r.right} commit(s) in ${ref} not in ${cur}\n${r.left} commit(s) in ${cur} not in ${ref}`, 'info', 8000);
  } catch (err: any) {
    toast('Compare failed', err.message, 'error');
  }
}

export async function newBranchDialog(from?: string) {
  const br = await loadBranches();
  return formDialog({
    title: `Create New Branch${from ? ` from ${from}` : ''}`,
    okText: 'Create',
    fields: [
      { name: 'name', label: 'New branch name:', mono: true, placeholder: 'feature/my-change' },
      { type: 'checkbox', name: 'checkout', label: 'Checkout branch', value: true },
    ],
    validate: (v) => {
      const name = String(v.name).trim();
      if (!name) return 'Name is required';
      if (/\s|\.\.|^-|[~^:?*\[\\]/.test(name)) return 'Invalid branch name';
      if (br.local.some((b) => b.name === name)) return 'Branch already exists';
    },
    onSubmit: (v) => runGit('Create Branch', () => post('/api/git/branch', { name: String(v.name).trim(), from, checkout: v.checkout }), { successTitle: `Branch ${String(v.name).trim()} created` }),
  });
}

export async function checkoutRevisionDialog() {
  const br = await loadBranches();
  return formDialog({
    title: 'Checkout Tag or Revision',
    okText: 'Checkout',
    fields: [
      { name: 'ref', label: 'Tag, branch or commit hash:', mono: true, placeholder: br.tags[0]?.name || 'v1.0.0' },
      { type: 'static', content: 'Checking out a tag or commit puts the repository in detached HEAD state.' },
    ],
    validate: (v) => (!String(v.ref).trim() ? 'Enter a revision' : undefined),
    onSubmit: (v) => checkout(String(v.ref).trim()),
  });
}

export async function pushDialog() {
  const status = useStore.getState().gitStatus;
  if (!status.repo) return toast('Not a Git repository', '', 'info');
  const [outgoing, remotes, br] = await Promise.all([api<any[]>('/api/git/outgoing').catch(() => []), api<{ name: string }[]>('/api/git/remotes').catch(() => []), loadBranches(true)]);
  if (!remotes.length) {
    const { openPublishDialog } = await import('@/components/github/PublishDialog');
    const result = await openPublishDialog();
    if (result === 'remote-added') return pushDialog();
    return;
  }
  const current = br.local.find((b) => b.current);
  const branch = status.branch || '';
  const target = current?.upstream || `${remotes[0].name}/${branch}`;
  return formDialog({
    title: 'Push Commits',
    okText: 'Push',
    width: 560,
    fields: [
      { type: 'static', content: <span><b>{branch}</b> → <b>{target}</b>{current?.behind ? <span style={{ color: 'var(--warning)' }}> · {current.behind} commit(s) behind, pull first or force push</span> : null}</span> },
      { type: 'static', content: <div className="outgoing-list">{outgoing.length ? outgoing.map((c) => <div key={c.short}><span className="h">{c.short}</span><span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.subject}</span><span style={{ color: 'var(--text-muted)' }}>{c.date}</span></div>) : <div style={{ color: 'var(--text-muted)' }}>{current?.upstream ? 'Everything is up to date.' : 'No upstream yet, all local commits will be pushed.'}</div>}</div> },
      { type: 'row', fields: [
        { type: 'select', name: 'remote', label: 'Remote:', options: remotes.map((r) => r.name), value: current?.upstream?.split('/')[0] || remotes[0].name },
        { name: 'branch', label: 'Remote branch:', value: current?.upstream?.split('/').slice(1).join('/') || branch, mono: true },
      ] },
      { type: 'row', fields: [
        { type: 'checkbox', name: 'force', label: 'Force push (with lease)' },
        { type: 'checkbox', name: 'tags', label: 'Push tags' },
      ] },
    ],
    onSubmit: (v) => runGit('Push', () => post('/api/git/push', { remote: v.remote, branch: v.branch !== branch ? `${branch}:${v.branch}` : branch, force: v.force, tags: v.tags }), { successTitle: `Pushed to ${v.remote}/${v.branch}` }),
  });
}
