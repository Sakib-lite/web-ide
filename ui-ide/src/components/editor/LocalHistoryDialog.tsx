'use client';

import { useEffect, useState } from 'react';
import { api, fsApi } from '@/lib/api';
import { DialogFrame, confirmDialog, openDialog } from '@/components/ui/dialogs';
import { toast } from '@/components/ui/Toasts';
import { editorManager } from '@/editor/editor-manager';
import { basename, fmtDate, timeAgo } from '@/lib/utils';

interface Snap {
  ts: number;
  event: 'save' | 'delete';
  size: number;
}

function LocalHistoryView({ path, close }: { path: string; close: () => void }) {
  const [snaps, setSnaps] = useState<Snap[] | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  useEffect(() => {
    api<Snap[]>('/api/history', { query: { path } })
      .then((s) => {
        setSnaps(s);
        setSelected(s[0]?.ts ?? null);
      })
      .catch((err: any) => {
        toast('Local History', err.message, 'error');
        close();
      });
  }, [path]);
  const snap = snaps?.find((s) => s.ts === selected);
  const showDiff = async () => {
    if (!snap) return;
    try {
      const { content } = await api<{ content: string }>('/api/history/content', { query: { path, ts: snap.ts } });
      const current = await fsApi.read(path).then((r) => r.content).catch(() => '');
      close();
      editorManager.openDiff(path, {
        key: `history:${path}@${snap.ts}`,
        title: `${basename(path)} · ${timeAgo(snap.ts)}`,
        before: { content, label: `Local history — ${fmtDate(snap.ts)}` },
        after: { content: current, label: 'Current', readOnly: true },
      });
    } catch (err: any) {
      toast('Local History', err.message, 'error');
    }
  };
  const restore = async () => {
    if (!snap) return;
    if (!(await confirmDialog(`Restore "${basename(path)}" to the snapshot from ${fmtDate(snap.ts)}? The current content is snapshotted first, so this can be undone.`, 'Restore'))) return;
    try {
      const { content } = await api<{ content: string }>('/api/history/content', { query: { path, ts: snap.ts } });
      await fsApi.write(path, content);
      const tab = editorManager.tabs.get(path);
      if (tab?.kind === 'file') tab.model.setValue(content);
      toast('Restored', `${basename(path)} ← ${fmtDate(snap.ts)}`, 'success');
      close();
    } catch (err: any) {
      toast('Restore failed', err.message, 'error');
    }
  };
  return (
    <DialogFrame
      title={`Local History — ${basename(path)}`}
      width={540}
      hint="Snapshots are recorded automatically before each save and delete."
      onClose={close}
      footer={
        <>
          <button className="btn" onClick={close}>Close</button>
          <button className="btn" disabled={!snap} onClick={showDiff}>Show Diff</button>
          <button className="btn primary" disabled={!snap} onClick={restore}>Restore</button>
        </>
      }
    >
      <div className="lh-list">
        {snaps === null && <div className="empty-hint">Loading…</div>}
        {snaps?.length === 0 && <div className="empty-hint">No local history for this file yet. Edit and save it to start recording snapshots.</div>}
        {snaps?.map((s) => (
          <div key={s.ts} className={`lh-row${s.ts === selected ? ' selected' : ''}`} onClick={() => setSelected(s.ts)} onDoubleClick={showDiff}>
            <span className="lh-when">{timeAgo(s.ts)}</span>
            <span className="lh-date">{fmtDate(s.ts)}</span>
            <span className={`tag${s.event === 'delete' ? ' git' : ''}`}>{s.event === 'delete' ? 'before delete' : 'before save'}</span>
            <span className="lh-size">{s.size < 1024 ? `${s.size} B` : `${(s.size / 1024).toFixed(1)} KB`}</span>
          </div>
        ))}
      </div>
    </DialogFrame>
  );
}

export function openLocalHistory(path: string) {
  return openDialog((close) => <LocalHistoryView path={path} close={() => close()} />);
}
