'use client';

import { useMemo } from 'react';
import { useStore } from '@/lib/store';
import { basename, dirname } from '@/lib/utils';
import { Icon } from '@/components/ui/Icon';
import { FileIcon } from '@/components/ui/FileIcon';
import { MenuItem, showContextMenu } from '@/components/ui/ContextMenu';
import { editorManager } from '@/editor/editor-manager';
import { ChangeGroup, groups, lists, listOf, targetPaths, useCommitStore } from './commit-store';
import { addToVcs, createPatch, deleteChangelist, deleteFiles, editChangelist, ignoreFiles, moveTo, newChangelist, openChange, rollback, setActiveChangelist, shelve } from './commit-actions';
import { refreshGitStatus } from './git-status';
import { api } from '@/lib/api';
import { emit } from '@/lib/bus';

const LETTER: Record<string, string> = { modified: 'M', added: 'A', deleted: 'D', untracked: 'U', renamed: 'R', conflict: '!' };

function moveSubmenu(paths: string[]): MenuItem[] {
  const status = useStore.getState().gitStatus;
  return [
    ...lists(status).map((l) => ({ label: l.name + (l.active ? ' (active)' : ''), checked: paths.every((p) => listOf(status, p)?.id === l.id), action: () => moveTo(paths, l.id) })),
    'sep',
    { label: 'New Changelist…', action: () => newChangelist(paths) },
  ];
}

export function backgroundMenu(): MenuItem[] {
  const paths = targetPaths();
  const showTool = useStore.getState().showTool;
  return [
    { label: 'New Changelist…', action: () => newChangelist() },
    { label: 'Create Patch from Local Changes…', disabled: !paths.length, action: () => createPatch(paths, true) },
    { label: 'Copy as Patch to Clipboard', disabled: !paths.length, action: () => createPatch(paths, false) },
    { label: 'Shelve Changes…', disabled: !paths.length, action: () => shelve({ paths }) },
    { label: 'Shelve Silently', disabled: !paths.length, action: () => shelve({ paths, silent: true }) },
    'sep',
    { label: 'Refresh', action: () => refreshGitStatus() },
    { label: 'Git', children: [
      { label: 'Add', disabled: !paths.length, action: () => addToVcs(paths) },
      { label: 'Show History', disabled: !paths.length, action: () => emit('log-filter-path', { path: paths[0] }) },
      { label: 'Open Git Log', action: () => showTool('git') },
    ] },
  ];
}

function fileMenu(path: string, g: ChangeGroup): MenuItem[] {
  const paths = targetPaths();
  const info = useStore.getState().gitStatus.files[path];
  const store = useCommitStore.getState();
  const un = !!g.unversioned;
  return [
    { label: 'Commit File…', hidden: un, action: () => { store.toggleChecked(paths, true); document.querySelector<HTMLTextAreaElement>('#commit-message')?.focus(); } },
    { label: 'Rollback…', key: '⌥⌘Z', hidden: un, action: () => rollback(paths) },
    { label: 'Move to Another Changelist…', key: '⇧⌘M', hidden: un, children: moveSubmenu(paths) },
    { label: 'Show Diff', key: '⌘D', hidden: un || info.status === 'added', action: () => editorManager.openDiff(path) },
    { label: 'Jump to Source', key: '⌘↓', hidden: info.status === 'deleted', action: () => editorManager.openFile(path, { preview: false }) },
    'sep',
    { label: 'Delete…', key: '⌫', hidden: !un, danger: true, action: () => deleteFiles(paths) },
    { label: 'Add to VCS', key: '⌥⌘A', hidden: !un, action: () => addToVcs(paths) },
    { label: 'Unstage', hidden: un || !info.staged, action: async () => { await api('/api/git/unstage', { method: 'POST', body: { paths } }); refreshGitStatus(); } },
    { label: 'Ignore…', hidden: !un, action: () => ignoreFiles(paths) },
    'sep',
    ...backgroundMenu(),
  ];
}

function groupMenu(g: ChangeGroup): MenuItem[] {
  const store = useCommitStore.getState();
  const list = lists().find((l) => l.id === g.id);
  return [
    { label: 'Commit…', hidden: g.unversioned, action: () => { store.toggleChecked(g.files, true); document.querySelector<HTMLTextAreaElement>('#commit-message')?.focus(); } },
    { label: 'Rollback…', hidden: g.unversioned, action: () => rollback(g.files) },
    { label: 'Add to VCS', hidden: !g.unversioned, action: () => addToVcs(g.files) },
    { label: 'Move to Another Changelist…', hidden: g.unversioned || !g.files.length, children: moveSubmenu(g.files) },
    'sep',
    { label: 'Set Active Changelist', key: '^Space', hidden: g.unversioned, checked: !!g.active, action: () => setActiveChangelist(g.id) },
    { label: 'Edit Changelist…', key: 'F2', hidden: g.unversioned, action: () => list && editChangelist(list) },
    { label: 'Delete Changelist', hidden: g.unversioned || g.id === 'default', danger: true, action: () => list && deleteChangelist(list) },
    'sep',
    ...backgroundMenu(),
  ];
}

function Checkbox({ checked, indeterminate, onChange }: { checked: boolean; indeterminate?: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="chk" onClick={(e) => e.stopPropagation()}>
      <input type="checkbox" checked={checked} ref={(el) => { if (el) el.indeterminate = !!indeterminate; }} onChange={(e) => onChange(e.target.checked)} />
      <span />
    </label>
  );
}

function ChangeRow({ path, group, order }: { path: string; group: ChangeGroup; order: string[] }) {
  const info = useStore((s) => s.gitStatus.files[path]);
  const checked = useCommitStore((s) => s.checked.has(path));
  const selected = useCommitStore((s) => s.selection.has(path));
  const store = useCommitStore.getState();
  if (!info) return null;
  const isDir = path.endsWith('/');
  const name = basename(isDir ? path.slice(0, -1) : path);
  return (
    <div
      className={`change-row${selected ? ' selected' : ''}${info.staged && !group.unversioned ? ' staged' : ''}`}
      title={path + (info.from ? `  (was ${info.from})` : '')}
      data-path={path}
      onClick={(e) => store.select(path, e, order)}
      onDoubleClick={() => openChange(path)}
      onContextMenu={(e) => { e.preventDefault(); if (!selected) store.select(path, { shiftKey: false, metaKey: false, ctrlKey: false }, order); showContextMenu(e.clientX, e.clientY, fileMenu(path, group)); }}
    >
      <Checkbox checked={checked} onChange={(v) => store.toggleChecked([path], v)} />
      <FileIcon name={name} dir={isDir} />
      <span className={`change-name git-${info.status}`}>{name}</span>
      <span className="change-dir">{dirname(path)}</span>
      <span className="change-status" title={info.status}>{LETTER[info.status] || '?'}</span>
    </div>
  );
}

function GroupView({ g, order }: { g: ChangeGroup; order: string[] }) {
  const collapsed = useCommitStore((s) => s.collapsed.has(g.id));
  const selected = useCommitStore((s) => s.selection.has('group:' + g.id));
  const checkedCount = useCommitStore((s) => g.files.filter((p) => s.checked.has(p)).length);
  const store = useCommitStore.getState();
  const all = g.files.length > 0 && checkedCount === g.files.length;
  const manyLists = lists().length > 1;
  return (
    <div className={`cl-group${collapsed ? ' collapsed' : ''}`}>
      <div
        className={`cl-header${selected ? ' selected' : ''}${g.active ? ' active-list' : ''}`}
        data-group={g.id}
        onClick={(e) => ((e.target as HTMLElement).closest('.tree-arrow') ? store.toggleCollapsed(g.id) : store.select('group:' + g.id, e, order))}
        onDoubleClick={(e) => !(e.target as HTMLElement).closest('.chk') && store.toggleCollapsed(g.id)}
        onContextMenu={(e) => { e.preventDefault(); if (!selected) store.select('group:' + g.id, { shiftKey: false, metaKey: false, ctrlKey: false }, order); showContextMenu(e.clientX, e.clientY, groupMenu(g)); }}
      >
        <span className="tree-arrow"><Icon name="chevron-right" /></span>
        <Checkbox checked={all} indeterminate={checkedCount > 0 && !all} onChange={(v) => store.toggleChecked(g.files, v)} />
        <span className="cl-name">{g.name}</span>
        <span className="cl-count">{g.files.length} file{g.files.length === 1 ? '' : 's'}</span>
        {g.comment && <span className="cl-comment" title={g.comment}>{g.comment}</span>}
        {g.active && manyLists && <span className="cl-active-badge">active</span>}
      </div>
      <div className="cl-body"><div>{g.files.map((p) => <ChangeRow key={p} path={p} group={g} order={order} />)}</div></div>
    </div>
  );
}

export function ChangesTree() {
  const status = useStore((s) => s.gitStatus);
  const all = useMemo(() => groups(status), [status]);
  const order = useMemo(() => all.flatMap((g) => ['group:' + g.id, ...g.files]), [all]);
  const total = all.reduce((n, g) => n + g.files.length, 0);
  const store = useCommitStore.getState();
  const onKey = (e: React.KeyboardEvent) => {
    const cmd = e.metaKey || e.ctrlKey;
    const paths = targetPaths();
    const first = [...useCommitStore.getState().selection].find((s) => !s.startsWith('group:'));
    if (cmd && e.code === 'KeyD') (e.preventDefault(), first && openChange(first));
    else if (cmd && e.altKey && e.code === 'KeyZ') (e.preventDefault(), rollback(paths));
    else if (e.key === ' ') (e.preventDefault(), store.toggleChecked(paths, !paths.every((p) => useCommitStore.getState().checked.has(p))));
    else if (e.key === 'Enter') (e.preventDefault(), first && openChange(first));
    else if (e.key === 'Escape') store.clearSelection();
  };
  if (!status.repo) return <div className="changes-tree"><div className="empty-hint">This project is not under Git version control. <button className="btn" style={{ marginTop: 8 }} onClick={async () => { await api('/api/git/init', { method: 'POST', body: {} }); emit('git-change'); }}>Create Git Repository</button></div></div>;
  if (!total) return <div className="changes-tree"><div className="empty-hint">No changes. Your working tree is clean.</div></div>;
  return (
    <div className="changes-tree" tabIndex={0} onKeyDown={onKey} onContextMenu={(e) => { if (e.target === e.currentTarget) { e.preventDefault(); showContextMenu(e.clientX, e.clientY, backgroundMenu()); } }}>
      {all.filter((g) => !g.unversioned || g.files.length).map((g) => <GroupView key={g.id} g={g} order={order} />)}
    </div>
  );
}
