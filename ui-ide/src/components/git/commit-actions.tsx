import { api, API_BASE, gitApi } from '@/lib/api';
import { useStore } from '@/lib/store';
import { emit } from '@/lib/bus';
import { downloadText, readLocal, writeLocal } from '@/lib/utils';
import { confirmDialog, formDialog, promptDialog } from '@/components/ui/dialogs';
import { toast } from '@/components/ui/Toasts';
import { editorManager } from '@/editor/editor-manager';
import { refreshGitStatus } from './git-status';
import { useCommitStore, activeList, groups, targetPaths } from './commit-store';
import { pushDialog } from '@/components/vcs/vcs-actions';

export function focusCommitMessage() {
  useStore.getState().showTool('commit');
  useCommitStore.getState().setTab('commit');
  setTimeout(() => document.querySelector<HTMLTextAreaElement>('#commit-message')?.focus(), 300);
}

export function openChange(path: string) {
  const info = useStore.getState().gitStatus.files[path];
  if (!info || path.endsWith('/')) return;
  if (info.status === 'untracked' || info.status === 'added') editorManager.openFile(path, { preview: false });
  else if (info.status !== 'deleted') editorManager.openDiff(path);
}

export async function undoLastCommit() {
  const head = useStore.getState().gitStatus.head;
  if (!(await confirmDialog(`Undo the last commit${head ? ` (${head})` : ''}? This soft-resets HEAD to the previous commit — your changes stay staged, nothing is lost.`, 'Undo Last Commit'))) return;
  try {
    await api('/api/git/reset', { method: 'POST', body: { hash: 'HEAD~1', mode: 'soft' } });
    toast('Last commit undone', 'Changes are staged and ready to recommit.', 'success');
    emit('git-change');
    await refreshGitStatus();
  } catch (err: any) {
    toast('Undo failed', err.message, 'error');
  }
}

export async function rollback(paths: string[]) {
  if (!paths.length) return;
  if (!(await confirmDialog(`Rollback changes in ${paths.length === 1 ? `"${paths[0]}"` : paths.length + ' files'}? This cannot be undone.`, 'Rollback'))) return;
  try {
    await gitApi.revert(paths);
    toast('Rolled back', paths.length === 1 ? paths[0] : `${paths.length} files`, 'success');
    emit('fs-change', { changes: paths.map((p) => ({ event: 'change', path: p })) });
    emit('git-change');
  } catch (err: any) {
    toast('Rollback failed', err.message, 'error');
  }
}

export async function addToVcs(paths: string[]) {
  try {
    await gitApi.stage(paths);
    useCommitStore.getState().toggleChecked(paths, true);
    emit('git-change');
  } catch (err: any) {
    toast('Add failed', err.message, 'error');
  }
}

export async function deleteFiles(paths: string[]) {
  if (!(await confirmDialog(`Delete ${paths.length === 1 ? `"${paths[0]}"` : paths.length + ' files'}?`, 'Delete'))) return;
  for (const p of paths) {
    try {
      await api('/api/fs/delete', { method: 'POST', body: { path: p.replace(/\/$/, '') } });
      editorManager.handleDeleted(p, p.endsWith('/'));
    } catch (err: any) {
      toast('Delete failed', err.message, 'error');
    }
  }
  emit('fs-local-change');
}

export async function ignoreFiles(paths: string[]) {
  const pattern = await promptDialog({ title: 'Add to .gitignore', label: 'Pattern:', value: paths[0], okText: 'Ignore' });
  if (!pattern) return;
  const existing = (await api('/api/fs/read', { query: { path: '.gitignore' } }).catch(() => ({ content: '' }))).content;
  await api('/api/fs/write', { method: 'POST', body: { path: '.gitignore', content: existing.replace(/\n?$/, '\n') + pattern + '\n' } });
  emit('git-change');
}

export async function moveTo(paths: string[], id: string) {
  try {
    await api('/api/changelists/move', { method: 'POST', body: { paths, id } });
    useCommitStore.getState().toggleChecked(paths, id === activeList()?.id);
    refreshGitStatus();
  } catch (err: any) {
    toast('Cannot move', err.message, 'error');
  }
}

export async function setActiveChangelist(id: string) {
  await api(`/api/changelists/${id}/active`, { method: 'POST', body: {} });
  await refreshGitStatus();
  const store = useCommitStore.getState();
  store.setChecked(groups().filter((g) => g.active).flatMap((g) => g.files));
}

export async function newChangelist(moveAfter?: string[]) {
  const v = await formDialog({ title: 'New Changelist', okText: 'Create', fields: [
    { name: 'name', label: 'Name:', placeholder: 'e.g. dont commit' },
    { type: 'textarea', name: 'comment', label: 'Comment:', rows: 3 },
    { type: 'checkbox', name: 'active', label: 'Make this changelist active', value: !moveAfter },
  ], validate: (x) => (!String(x.name).trim() ? 'Name is required' : undefined) });
  if (!v) return;
  try {
    const list = await api('/api/changelists', { method: 'POST', body: v });
    if (moveAfter?.length) await moveTo(moveAfter, list.id);
    else refreshGitStatus();
  } catch (err: any) {
    toast('Cannot create changelist', err.message, 'error');
  }
}

export async function editChangelist(list: { id: string; name: string; comment?: string }) {
  const v = await formDialog({ title: 'Edit Changelist', okText: 'Save', fields: [{ name: 'name', label: 'Name:', value: list.name }, { type: 'textarea', name: 'comment', label: 'Comment:', rows: 3, value: list.comment }] });
  if (!v) return;
  await api(`/api/changelists/${list.id}`, { method: 'PUT', body: v });
  refreshGitStatus();
}

export async function deleteChangelist(list: { id: string; name: string; files: string[] }) {
  if (list.files.length && !(await confirmDialog(`Delete changelist "${list.name}"? Its ${list.files.length} files move to the default changelist.`, 'Delete'))) return;
  await api(`/api/changelists/${list.id}`, { method: 'DELETE' });
  refreshGitStatus();
}

export async function createPatch(paths: string[], download: boolean) {
  const root = useStore.getState().project!;
  const text = await fetch(`${API_BASE}/api/git/patch?root=${encodeURIComponent(root.root)}&paths=${encodeURIComponent(paths.join('\n'))}`, { credentials: 'include' }).then((r) => r.text());
  if (!text.trim()) return toast('Nothing to patch', 'Selected files have no diff against HEAD.', 'info');
  if (download) return downloadText(`${root.name}-changes.patch`, text);
  await navigator.clipboard?.writeText(text);
  toast('Patch copied', `${paths.length} file${paths.length === 1 ? '' : 's'}`, 'success', 2000);
}

export async function shelve({ paths, silent = false }: { paths?: string[]; silent?: boolean } = {}) {
  const store = useCommitStore.getState();
  paths = paths || targetPaths();
  if (!paths.length) return toast('Nothing to shelve', 'Select or check files first.', 'info');
  let message = store.message.trim() || `Shelved ${new Date().toLocaleString()}`;
  if (!silent) {
    const v = await formDialog({ title: 'Shelve Changes', okText: 'Shelve Changes', fields: [{ name: 'message', label: 'Shelf name:', value: message }, { type: 'static', content: <span><b>{paths.length}</b> file{paths.length === 1 ? '' : 's'} will be shelved and removed from the working tree.</span> }], validate: (x) => (!String(x.message).trim() ? 'Name is required' : undefined) });
    if (!v) return;
    message = String(v.message).trim();
  }
  try {
    await api('/api/git/stash', { method: 'POST', body: { message, paths } });
    toast('Shelved', message, 'success');
    store.uncheck(paths);
    emit('fs-change', { changes: paths.map((p) => ({ event: 'change', path: p })) });
    emit('git-change');
    store.setTab('shelf');
  } catch (err: any) {
    toast('Shelve failed', err.message, 'error');
  }
}

export async function unshelve(index: number, message: string, pop: boolean) {
  try {
    await api(`/api/git/stash/${index}/apply`, { method: 'POST', body: { pop } });
    toast('Unshelved', message, 'success');
    emit('git-change');
    emit('fs-change', { changes: [] });
    useCommitStore.getState().setTab('commit');
  } catch (err: any) {
    toast('Unshelve failed', err.message, 'error', 8000);
  }
}

export const commitHistory = () => readLocal<string[]>('ide.commitHistory', []);

export async function commit({ push = false } = {}) {
  const store = useCommitStore.getState();
  const message = store.message.trim();
  const paths = [...store.checked];
  if (!message) {
    toast('Commit message is empty', 'Specify a commit message first.', 'error');
    return document.querySelector<HTMLTextAreaElement>('#commit-message')?.focus();
  }
  if (!paths.length && !store.amend) return toast('Nothing to commit', 'Check at least one changed file.', 'error');
  try {
    const res = await gitApi.commit(message, paths, store.amend);
    writeLocal('ide.commitHistory', [message, ...commitHistory().filter((m) => m !== message)].slice(0, 20));
    store.setMessage('');
    store.setAmend(false);
    store.uncheck(paths);
    toast(store.amend ? 'Commit amended' : 'Committed', String(res.output).split('\n')[0], 'success');
    emit('git-change');
    await refreshGitStatus();
    if (push) pushDialog();
  } catch (err: any) {
    toast('Commit failed', err.message, 'error', 10000);
  }
}

export async function generateCommitMessage() {
  const store = useCommitStore.getState();
  const paths = [...store.checked];
  if (!paths.length) return toast('Nothing selected', 'Check the files to commit first.', 'info');
  try {
    const r = await api('/api/ai/commit-message', { method: 'POST', body: { paths } });
    store.setMessage(r.message);
    document.querySelector<HTMLTextAreaElement>('#commit-message')?.focus();
  } catch (err: any) {
    toast('Could not generate message', err.message, 'error', 8000);
  }
}
