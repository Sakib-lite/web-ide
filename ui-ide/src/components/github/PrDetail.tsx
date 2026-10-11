'use client';

import { useEffect, useState } from 'react';
import { api, gitApi } from '@/lib/api';
import { useStore } from '@/lib/store';
import { basename, dirname, timeAgo } from '@/lib/utils';
import { Icon } from '@/components/ui/Icon';
import { FileIcon } from '@/components/ui/FileIcon';
import { confirmDialog, formDialog } from '@/components/ui/dialogs';
import { toast } from '@/components/ui/Toasts';
import { editorManager } from '@/editor/editor-manager';
import { runGit } from '@/components/vcs/vcs-actions';
import { usePullsStore } from './pulls-store';

interface Pull {
  number: number;
  title: string;
  body: string;
  state: string;
  merged: boolean;
  draft: boolean;
  mergeable: boolean | null;
  author: string;
  avatar: string;
  updatedAt: string;
  url: string;
  head: { ref: string; repo?: string; label?: string };
  base: { ref: string };
  additions: number;
  deletions: number;
  changedFiles: number;
  commits: number;
  reviewComments: number;
  labels: { name: string; color: string }[];
  files: { path: string; status: string; additions: number; deletions: number; previous?: string }[];
  timeline: { type: string; state?: string; author: string; avatar: string; body: string; at: string }[];
  checks: { name: string; status: string; conclusion: string | null; url: string }[];
}

const stateOf = (p: { merged: boolean; draft: boolean; state: string }) => (p.merged ? 'merged' : p.draft ? 'draft' : p.state);

async function mergeDialog(p: Pull) {
  return formDialog({
    title: `Merge pull request #${p.number}`,
    okText: 'Merge',
    fields: [
      { type: 'static', content: <span><b>{p.head.ref}</b> → <b>{p.base.ref}</b>{p.mergeable === false && <><br /><span style={{ color: 'var(--danger)' }}>GitHub reports this PR has conflicts.</span></>}</span> },
      { type: 'select', name: 'method', label: 'Merge method:', options: [{ value: 'merge', label: 'Create a merge commit' }, { value: 'squash', label: 'Squash and merge' }, { value: 'rebase', label: 'Rebase and merge' }] },
      { name: 'title', label: 'Commit title:', value: `${p.title} (#${p.number})` },
      { type: 'textarea', name: 'message', label: 'Commit message:', rows: 3 },
    ],
    onSubmit: async (v) => {
      const r = await api(`/api/github/pulls/${p.number}/merge`, { method: 'POST', body: v });
      toast('Merged', r.message || `#${p.number} merged`, 'success');
      usePullsStore.getState().refresh(true);
    },
  });
}

export function PrDetail({ number }: { number: number }) {
  const [p, setP] = useState<Pull | null>(null);
  const [error, setError] = useState('');
  const [fetched, setFetched] = useState(false);
  const [tick, setTick] = useState(0);
  const { select, repo } = usePullsStore();
  const setProgress = useStore((s) => s.setProgress);
  useEffect(() => {
    let alive = true;
    api<Pull>(`/api/github/pulls/${number}`).then((d) => alive && setP(d)).catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [number, tick]);
  const back = <div className="prd-back" onClick={() => select(null)}><Icon name="back" />Pull requests</div>;
  if (error) return <div className="pr-detail"><div className="prd-head">{back}</div><div className="empty-hint">{error}</div></div>;
  if (!p) return <div className="pr-detail"><div className="prd-head">{back}</div><div className="empty-hint">Loading…</div></div>;
  const st = stateOf(p);
  const openDiff = async (f: Pull['files'][number]) => {
    try {
      if (!fetched) {
        setProgress(`Fetching PR #${p.number}`);
        try {
          await api(`/api/github/pulls/${p.number}/fetch`, { method: 'POST', body: { base: p.base.ref } });
          setFetched(true);
        } finally {
          setProgress(null);
        }
      }
      const [before, after] = await Promise.all([gitApi.fileAt(`origin/${p.base.ref}`, f.previous || f.path).then((r) => r.content).catch(() => null), gitApi.fileAt(`pr/${p.number}`, f.path).then((r) => r.content).catch(() => null)]);
      editorManager.openDiff(f.path, { key: `diff:pr${p.number}:${f.path}`, title: `${basename(f.path)} (PR #${p.number})`, before: { content: before ?? '', label: `${p.base.ref} ${f.previous || f.path}` }, after: { content: after ?? '', label: `${p.head.ref} ${f.path}`, readOnly: true } });
    } catch (err: any) {
      toast('Cannot show diff', err.message, 'error');
    }
  };
  const checkout = () => runGit(`Checkout PR #${p.number}`, () => api(`/api/github/pulls/${p.number}/checkout`, { method: 'POST', body: { branch: p.head.repo === `${repo?.owner}/${repo?.repo}` ? p.head.ref : `pr-${p.number}` } }), { successTitle: `Checked out #${p.number}` }).catch(() => undefined);
  const closePr = async () => {
    if (!(await confirmDialog(`Close pull request #${p.number} without merging?`, 'Close PR'))) return;
    await api(`/api/github/pulls/${p.number}/close`, { method: 'POST', body: {} }).catch((e) => toast('Close failed', e.message, 'error'));
    setTick((n) => n + 1);
    usePullsStore.getState().refresh(true);
  };
  const passed = p.checks.filter((c) => c.conclusion === 'success').length;
  return (
    <div className="pr-detail">
      <div className="prd-head">
        {back}
        <div className="prd-title">{p.title} <span className="num">#{p.number}</span></div>
        <div className="prd-meta"><span className={`pr-badge ${st}`}>{st.toUpperCase()}</span><img className="pr-avatar" src={p.avatar} alt="" /><span>{p.author} wants to merge {p.commits} commit{p.commits === 1 ? '' : 's'} into</span><span className="prd-branch">{p.base.ref}</span><span>from</span><span className="prd-branch">{p.head.label || p.head.ref}</span></div>
        {p.labels.length > 0 && <div className="prd-meta">{p.labels.map((l) => <span key={l.name} className="label-chip" style={{ borderColor: '#' + l.color, color: '#' + l.color }}>{l.name}</span>)}</div>}
        <div className="prd-meta">{p.changedFiles} files · <span className="pf-stat"><span className="add">+{p.additions}</span> <span className="del">−{p.deletions}</span></span> · {p.reviewComments} review comments · updated {timeAgo(new Date(p.updatedAt).getTime())}</div>
      </div>
      <div className="prd-actions">
        <button className="btn" onClick={checkout}>Checkout</button>
        <button className="btn" onClick={() => window.open(p.url, '_blank')}>Open on GitHub</button>
        {!p.merged && p.state === 'open' && <button className="btn primary" onClick={() => mergeDialog(p)}>Merge…</button>}
        {!p.merged && p.state === 'open' && <button className="btn" onClick={closePr}>Close</button>}
      </div>
      <div className="prd-section"><h4>Description</h4><div className="prd-body">{p.body || 'No description provided.'}</div></div>
      {p.checks.length > 0 && (
        <div className="prd-section"><h4>Checks ({passed}/{p.checks.length} passed)</h4>
          {p.checks.map((c) => <div key={c.name} className="prd-check"><span className={`dot ${c.conclusion || (c.status === 'completed' ? '' : 'pending')}`} /><a href={c.url} target="_blank" rel="noreferrer" style={{ color: 'inherit', textDecoration: 'none' }}>{c.name}</a><span style={{ color: 'var(--text-muted)', marginLeft: 'auto' }}>{c.conclusion || c.status}</span></div>)}
        </div>
      )}
      <div className="prd-section"><h4>Files ({p.files.length})</h4>
        {p.files.map((f) => <div key={f.path} className="prd-file" title={f.path} onClick={() => openDiff(f)}><FileIcon name={basename(f.path)} /><span className={`pf-name git-${f.status === 'removed' ? 'deleted' : f.status === 'added' ? 'added' : 'modified'}`}>{basename(f.path)}</span><span className="pf-dir">{dirname(f.path)}</span><span className="pf-stat"><span className="add">+{f.additions}</span> <span className="del">−{f.deletions}</span></span></div>)}
      </div>
      <div className="prd-section"><h4>Conversation ({p.timeline.length})</h4>
        {!p.timeline.length && <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>No comments yet.</div>}
        {p.timeline.map((t, i) => <div key={i} className="prd-comment"><div className="who"><img className="pr-avatar" src={t.avatar} alt="" /><b>{t.author}</b>{t.type === 'review' && <span className={`pr-badge ${t.state === 'APPROVED' ? 'open' : t.state === 'CHANGES_REQUESTED' ? 'closed' : ''}`}>{t.state?.replace('_', ' ')}</span>}<span>{timeAgo(new Date(t.at).getTime())}</span></div><div className="body">{t.body}</div></div>)}
      </div>
    </div>
  );
}
