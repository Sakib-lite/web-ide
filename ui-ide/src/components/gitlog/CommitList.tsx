'use client';

import { useMemo } from 'react';
import { api } from '@/lib/api';
import { useStore } from '@/lib/store';
import { fmtDate } from '@/lib/utils';
import { MenuItem, showContextMenu } from '@/components/ui/ContextMenu';
import { confirmDialog, promptDialog } from '@/components/ui/dialogs';
import { toast } from '@/components/ui/Toasts';
import { checkout, newBranchDialog, runGit } from '@/components/vcs/vcs-actions';
import { GraphCell } from './GraphCell';
import { LogCommit, layoutGraph } from './graph-layout';
import { useLogStore } from './log-store';

const post = (path: string, body: Record<string, unknown>) => api(path, { method: 'POST', body });

function commitMenu(c: LogCommit): MenuItem[] {
  const branch = useStore.getState().gitStatus.branch;
  const { filters, setFilter } = useLogStore.getState();
  return [
    { label: 'Copy Revision Number', action: () => navigator.clipboard?.writeText(c.hash).then(() => toast('Copied', c.hash, 'info', 1500)) },
    { label: 'Copy Commit Message', action: () => navigator.clipboard?.writeText(c.subject) },
    'sep',
    { label: 'Checkout Revision', action: () => checkout(c.hash).catch(() => undefined) },
    { label: 'New Branch…', action: () => newBranchDialog(c.short) },
    { label: 'New Tag…', action: async () => { const n = await promptDialog({ title: `New Tag at ${c.short}`, label: 'Tag name:', okText: 'Create Tag' }); if (n) runGit('Create Tag', () => post('/api/git/tag', { name: n, hash: c.hash }), { successTitle: `Tag ${n} created` }).catch(() => undefined); } },
    'sep',
    { label: 'Cherry-Pick', action: () => runGit('Cherry-pick', () => post('/api/git/cherry-pick', { hash: c.hash }), { successTitle: `Cherry-picked ${c.short}` }).catch(() => undefined) },
    { label: 'Revert Commit', action: () => runGit('Revert', () => post('/api/git/revert-commit', { hash: c.hash }), { successTitle: `Reverted ${c.short}` }).catch(() => undefined) },
    { label: 'Reset Current Branch to Here…', children: (['soft', 'mixed', 'hard'] as const).map((mode) => ({ label: `${mode[0].toUpperCase()}${mode.slice(1)}${mode === 'hard' ? ' (discards local changes)' : ''}`, danger: mode === 'hard', action: async () => { if (await confirmDialog(`Reset ${branch} to ${c.short} (${mode})?`, 'Reset')) runGit('Reset', () => post('/api/git/reset', { hash: c.hash, mode }), { successTitle: `Reset to ${c.short}` }).catch(() => undefined); } })) },
    'sep',
    { label: 'Clear File Filter', hidden: !filters.path, action: () => setFilter({ path: '' }) },
  ];
}

export function CommitList() {
  const { commits, hasMore, selected, select, loadMore, filters, error, branches } = useLogStore();
  const rows = useMemo(() => layoutGraph(commits), [commits]);
  const maxLanes = Math.min(12, Math.max(1, ...rows.map((r) => Math.max(r.before.length, r.after.length, r.lane + 1))));
  const remoteNames = useMemo(() => new Set((branches?.remote || []).map((b) => b.name)), [branches]);
  if (error) return <div className="log-list"><div className="empty-hint">{error}</div></div>;
  if (!commits.length) return <div className="log-list"><div className="empty-hint">No commits match the current filters.</div></div>;
  return (
    <div className="log-list" style={{ ['--graph-w' as string]: Math.max(20, maxLanes * 14) + 'px' }} onScroll={(e) => { const el = e.currentTarget; if (hasMore && el.scrollTop + el.clientHeight > el.scrollHeight - 60) loadMore(); }}>
      {commits.map((c, i) => (
        <div key={c.hash} className={`log-row${c.hash === selected ? ' selected' : ''}${c.parents.length > 1 ? ' merge' : ''}`} data-hash={c.hash} onClick={() => select(c.hash)} onContextMenu={(e) => { e.preventDefault(); select(c.hash); showContextMenu(e.clientX, e.clientY, commitMenu(c)); }}>
          <span><GraphCell row={rows[i]} maxLanes={maxLanes} /></span>
          <span className="log-subject">
            {c.head && <span className="ref-chip head">HEAD</span>}
            {c.refs.slice(0, 3).map((r) => <span key={r} className={`ref-chip${r.startsWith('tag: ') ? ' tag' : remoteNames.has(r) ? ' remote' : ''}`} title={r}>{r.replace(/^tag: /, '')}</span>)}
            {c.refs.length > 3 && <span className="ref-chip">+{c.refs.length - 3}</span>}
            <span className="txt" title={c.subject}>{c.subject}</span>
          </span>
          <span className="log-author" title={c.email}>{c.author}</span>
          <span className="log-date" title={new Date(c.at).toLocaleString()}>{fmtDate(c.at)}</span>
          <span className="log-hash">{c.short}</span>
        </div>
      ))}
      {hasMore && <div className="log-more" onClick={loadMore}>Load more…</div>}
      {filters.path && <div className="log-more" onClick={() => useLogStore.getState().setFilter({ path: '' })}>Showing history of {filters.path}. Click to clear.</div>}
    </div>
  );
}
