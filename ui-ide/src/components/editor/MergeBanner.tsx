'use client';

import { useEffect, useState } from 'react';
import { gitApi } from '@/lib/api';
import { useStore } from '@/lib/store';
import { toast } from '@/components/ui/Toasts';
import { Icon } from '@/components/ui/Icon';
import { currentConflicts, gotoConflict, mergeEditorRef, onConflicts, parseConflicts } from '@/editor/merge-conflicts';
import { openMergeConflicts } from '@/components/vcs/MergeDialog';

export function MergeBanner() {
  const [state, setState] = useState(currentConflicts());
  useEffect(() => { const off = onConflicts(() => setState(currentConflicts())); return () => { off(); }; }, []);
  const tabs = useStore((s) => s.tabs);
  const activeKey = useStore((s) => s.activeTab);
  const gitFiles = useStore((s) => s.gitStatus.files);
  const active = tabs.find((t) => t.key === activeKey);
  const unmerged = !!active && active.kind === 'file' && gitFiles[active.path]?.status === 'conflict';
  if (!unmerged || !active || active.kind !== 'file') return null;
  const path = active.path;
  const markers = state?.path === path ? state : null;
  const editor = mergeEditorRef.current;
  const model = editor?.getModel();

  const takeAll = (strategy: 'ours' | 'theirs') => {
    if (!editor || !model || !markers) return;
    const blocks = parseConflicts(model.getLinesContent());
    const edits = blocks.map((c) => {
      const lines = model.getLinesContent();
      const ours = lines.slice(c.start, c.mid - 1);
      const theirs = lines.slice(c.baseSep ?? c.mid, c.end - 1);
      const chosen = strategy === 'ours' ? ours : theirs;
      return { range: { startLineNumber: c.start, startColumn: 1, endLineNumber: c.end, endColumn: model.getLineMaxColumn(c.end) }, text: chosen.length ? chosen.join('\n') : '' };
    });
    editor.executeEdits('merge-resolve-all', edits as any);
    editor.focus();
  };

  const markResolved = async () => {
    try {
      await editorManager_save();
      await gitApi.stage([path]);
      useStore.getState().setStatusMessage(`Marked ${path} resolved`);
      toast('Conflict resolved', `${path} staged as resolved`, 'success');
    } catch (err: any) {
      toast('Resolve failed', err.message, 'error');
    }
  };

  return (
    <div className="merge-banner">
      <Icon name="git" />
      <span className="mb-text">
        <strong>{path}</strong>
        {markers ? <> has {markers.conflicts.length} conflict{markers.conflicts.length > 1 ? 's' : ''}</> : ' — all conflicts resolved in the editor'}
      </span>
      {markers && (
        <>
          <button title="Previous conflict (Shift+F8)" onClick={() => gotoConflict(-1)}><Icon name="up" /></button>
          <button title="Next conflict (F8)" onClick={() => gotoConflict(1)}><Icon name="down" /></button>
          <span className="mb-sep" />
          <button onClick={() => takeAll('ours')}>All yours</button>
          <button onClick={() => takeAll('theirs')}>All theirs</button>
        </>
      )}
      <span className="mb-sep" />
      <button onClick={() => openMergeConflicts()}>Resolve in dialog…</button>
      <button className="mb-primary" onClick={markResolved}>Mark resolved (git add)</button>
    </div>
  );
}

async function editorManager_save() {
  const { editorManager } = await import('@/editor/editor-manager');
  editorManager.saveActive();
  await new Promise((r) => setTimeout(r, 1200));
}
