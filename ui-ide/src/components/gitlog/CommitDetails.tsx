'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { basename, dirname } from '@/lib/utils';
import { Icon } from '@/components/ui/Icon';
import { FileIcon } from '@/components/ui/FileIcon';
import { showContextMenu } from '@/components/ui/ContextMenu';
import { toast } from '@/components/ui/Toasts';
import { editorManager } from '@/editor/editor-manager';
import { useLogStore } from './log-store';

interface Detail {
  hash: string;
  short: string;
  parents: string[];
  author: string;
  email: string;
  at: number;
  committer: string;
  committedAt: number;
  refs: string[];
  message: string;
  files: { path: string; from?: string; status: string }[];
  stat: string;
}

async function openCommitDiff(d: Detail, f: Detail['files'][number]) {
  try {
    const r = await api(`/api/git/commit/${d.hash}/file`, { query: { path: f.path, from: f.from } });
    const parent = d.parents[0]?.slice(0, 7) || 'empty';
    editorManager.openDiff(f.path, { key: `diff:${d.short}:${f.path}`, title: `${basename(f.path)} @ ${d.short}`, before: { content: r.before ?? '', label: `${parent} ${f.from || f.path}` }, after: { content: r.after ?? '', label: `${d.short} ${f.path}`, readOnly: true } });
  } catch (err: any) {
    toast('Cannot load diff', err.message, 'error');
  }
}

export function CommitDetails() {
  const hash = useLogStore((s) => s.selected);
  const setFilter = useLogStore((s) => s.setFilter);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  useEffect(() => {
    if (!hash) return setDetail(null);
    let alive = true;
    setDetail(null);
    api<Detail>(`/api/git/commit/${hash}`).then((d) => alive && setDetail(d)).catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [hash]);
  if (!hash) return <aside className="log-details"><div className="empty-hint">Select a commit to see its changes.</div></aside>;
  if (!detail) return <aside className="log-details"><div className="empty-hint">{error || 'Loading…'}</div></aside>;
  const byDir = new Map<string, Detail['files']>();
  for (const f of detail.files) (byDir.get(dirname(f.path)) || byDir.set(dirname(f.path), []).get(dirname(f.path)))!.push(f);
  return (
    <aside className="log-details">
      <div className="ld-files">
        {!detail.files.length && <div className="empty-hint">No file changes (empty or merge commit).</div>}
        {[...byDir.entries()].sort().map(([dir, files]) => (
          <div key={dir}>
            <div className="ld-dir"><Icon name="folder" /><span>{dir || '/'}</span><span style={{ color: 'var(--text-muted)' }}>{files.length} file{files.length === 1 ? '' : 's'}</span></div>
            {files.map((f) => (
              <div key={f.path} className={`ld-file${picked === f.path ? ' selected' : ''}`} title={f.from ? `${f.from} → ${f.path}` : f.path} onClick={() => setPicked(f.path)} onDoubleClick={() => openCommitDiff(detail, f)} onContextMenu={(e) => { e.preventDefault(); showContextMenu(e.clientX, e.clientY, [{ label: 'Show Diff', key: '⌘D', action: () => openCommitDiff(detail, f) }, { label: 'Open Current Version', action: () => editorManager.openFile(f.path, { preview: false }) }, { label: 'Show History', action: () => setFilter({ path: f.path }) }]); }}>
                <FileIcon name={basename(f.path)} /><span className={`git-${f.status}`}>{basename(f.path)}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="ld-meta">
        <div className="ld-msg">{detail.message}</div>
        <div className="ld-who"><b>{detail.short}</b> {detail.author} <a href={`mailto:${detail.email}`}>&lt;{detail.email}&gt;</a> on {new Date(detail.at).toLocaleString()}</div>
        {detail.committer !== detail.author && <div className="ld-who">committed by {detail.committer} on {new Date(detail.committedAt).toLocaleString()}</div>}
        {detail.stat && <div className="ld-who" style={{ marginTop: 4 }}>{detail.stat}</div>}
        {detail.refs.length > 0 && <div style={{ marginTop: 6, display: 'flex', gap: 4, flexWrap: 'wrap' }}>{detail.refs.map((r) => <span key={r} className="ref-chip">{r}</span>)}</div>}
      </div>
    </aside>
  );
}
