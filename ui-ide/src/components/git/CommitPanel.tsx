'use client';

import { useEffect } from 'react';
import { useStore } from '@/lib/store';
import { on } from '@/lib/bus';
import { Icon } from '@/components/ui/Icon';
import { ChangesTree } from './ChangesTree';
import { CommitForm } from './CommitForm';
import { ShelfPanel } from './ShelfPanel';
import { groups, targetPaths, useCommitStore } from './commit-store';
import { newChangelist, openChange, rollback, shelve, undoLastCommit } from './commit-actions';
import { refreshGitStatus } from './git-status';

export function CommitPanel() {
  const { tab, setTab, setCollapsedAll } = useCommitStore();
  const hide = useStore((s) => s.hideTool);
  useEffect(() => on('git-status', (status: any) => useCommitStore.getState().syncWithStatus(status)), []);
  useEffect(() => {
    const status = useStore.getState().gitStatus;
    if (status.repo) useCommitStore.getState().syncWithStatus(status);
  }, []);
  const showDiff = () => {
    const p = [...useCommitStore.getState().selection].find((s) => !s.startsWith('group:'));
    if (p) openChange(p);
  };
  return (
    <>
      <header className="tool-header tabs-header">
        <button className={`subtab${tab === 'commit' ? ' active' : ''}`} onClick={() => setTab('commit')}>Commit</button>
        <button className={`subtab${tab === 'shelf' ? ' active' : ''}`} onClick={() => setTab('shelf')}>Shelf</button>
        <div className="tool-header-actions"><button className="tb-icon sm" title="Hide" onClick={() => hide('commit')}><Icon name="minimize" /></button></div>
      </header>
      <div className="commit-toolbar">
        <button className="tb-icon sm" title="Refresh" onClick={() => refreshGitStatus()}><Icon name="refresh" /></button>
        <button className="tb-icon sm" title="Rollback… (⌥⌘Z)" onClick={() => rollback(targetPaths())}><Icon name="rollback" /></button>
        <button className="tb-icon sm" title="Shelve Silently" onClick={() => shelve({ silent: true })}><Icon name="shelve" /></button>
        <button className="tb-icon sm" title="Show Diff (⌘D)" onClick={showDiff}><Icon name="diff" /></button>
        <button className="tb-icon sm" title="Undo Last Commit (soft reset)" onClick={undoLastCommit}><Icon name="history" /></button>
        <span className="toolbar-sep" />
        {tab === 'commit' && <button className="tb-icon sm" title="New Changelist…" onClick={() => newChangelist()}><Icon name="plus" /></button>}
        <button className="tb-icon sm" title="Expand all" onClick={() => setCollapsedAll([])}><Icon name="expand" /></button>
        <button className="tb-icon sm" title="Collapse all" onClick={() => setCollapsedAll(groups().map((g) => g.id))}><Icon name="collapse" /></button>
      </div>
      {tab === 'commit' ? (
        <div className="commit-view">
          <ChangesTree />
          <CommitForm />
        </div>
      ) : (
        <ShelfPanel />
      )}
    </>
  );
}
