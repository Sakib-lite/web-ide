'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { on } from '@/lib/bus';
import { basename, dirname, timeAgo } from '@/lib/utils';
import { Icon } from '@/components/ui/Icon';
import { FileIcon } from '@/components/ui/FileIcon';
import { showContextMenu } from '@/components/ui/ContextMenu';
import { confirmDialog } from '@/components/ui/dialogs';
import { unshelve } from './commit-actions';

interface Stash {
  ref: string;
  index: number;
  message: string;
  at: number;
}

function ShelfItem({ s, onChange }: { s: Stash; onChange: () => void }) {
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<{ path: string; status: string }[] | null>(null);
  const toggle = async () => {
    setOpen(!open);
    if (!files) setFiles(await api(`/api/git/stash/${s.index}/files`).catch(() => []));
  };
  const menu = (e: React.MouseEvent) => {
    e.preventDefault();
    showContextMenu(e.clientX, e.clientY, [
      { label: 'Unshelve…', action: () => unshelve(s.index, s.message, true) },
      { label: 'Unshelve Silently (keep on shelf)', action: () => unshelve(s.index, s.message, false) },
      'sep',
      { label: 'Delete', danger: true, action: async () => { if (await confirmDialog(`Delete shelf "${s.message}"?`, 'Delete')) { await api(`/api/git/stash/${s.index}`, { method: 'DELETE' }); onChange(); } } },
    ]);
  };
  return (
    <div className="shelf-item">
      <div className="shelf-head" onClick={toggle} onDoubleClick={() => unshelve(s.index, s.message, true)} onContextMenu={menu}>
        <span className="tree-arrow" style={{ transform: open ? 'rotate(90deg)' : undefined }}><Icon name="chevron-right" /></span>
        <Icon name="shelve" style={{ color: 'var(--text-secondary)' }} />
        <span className="shelf-msg" title={s.ref}>{s.message}</span>
        <span className="shelf-date">{timeAgo(s.at)}</span>
      </div>
      {open && <div className="shelf-files">{files?.map((f) => <div key={f.path} className="change-row"><FileIcon name={basename(f.path)} /><span className={`change-name git-${f.status}`}>{basename(f.path)}</span><span className="change-dir">{dirname(f.path)}</span></div>)}</div>}
    </div>
  );
}

export function ShelfPanel() {
  const [stashes, setStashes] = useState<Stash[]>([]);
  const load = () => api<Stash[]>('/api/git/stash').then(setStashes).catch(() => setStashes([]));
  useEffect(() => {
    load();
    return on('git-change', load);
  }, []);
  return (
    <div className="shelf-view">
      <div className="shelf-list">
        {!stashes.length && <div className="empty-hint">No shelved changes. Use the shelve button in the Commit tab to put changes aside.</div>}
        {stashes.map((s) => <ShelfItem key={s.ref} s={s} onChange={load} />)}
      </div>
    </div>
  );
}
