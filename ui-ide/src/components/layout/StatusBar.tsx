'use client';

import { useStore } from '@/lib/store';
import { Icon } from '@/components/ui/Icon';
import { useEditorStatus } from '@/editor/useEditorStatus';
import { editorManager } from '@/editor/editor-manager';
import { promptDialog } from '@/components/ui/dialogs';
import { openSettingsDialog } from '@/components/github/SettingsDialog';
import { openBranchPopup } from '@/components/vcs/BranchPopup';

export function StatusBar() {
  const message = useStore((s) => s.statusMessage);
  const index = useStore((s) => s.indexStatus);
  const git = useStore((s) => s.gitStatus);
  const github = useStore((s) => s.github);
  const { position, eol, indent, usages } = useEditorStatus();
  const gotoLine = async () => {
    const v = await promptDialog({ title: 'Go to Line:Column', label: '[Line] [:column]:', value: position, okText: 'Go' });
    if (!v) return;
    const [l, c] = v.split(':').map((n) => parseInt(n, 10));
    if (l) editorManager.revealLine(l, c || 1);
  };
  const branchLabel = git.repo ? (git.detached ? `HEAD (${git.head})` : git.branch || '') : '—';
  return (
    <footer className="statusbar">
      <div className="sb-left"><span>{message}</span></div>
      <div className="sb-right">
        <span className={`sb-item${index.ready ? ' ready' : ''}`} title="Symbol index">{index.ready ? (index.stats ? `${index.stats.symbols} symbols` : 'Indexed') : 'Indexing…'}</span>
        {usages && <span className="sb-item" title="Usages of the identifier at the caret in this file">{usages}</span>}
        <span className="sb-item sb-pos" title="Go to line" onClick={gotoLine}>{position}</span>
        <span className="sb-item sb-eol">{eol}</span>
        <span className="sb-item">UTF-8</span>
        <span className="sb-item sb-indent">{indent}</span>
        <span className="sb-item" title="GitHub account" onClick={() => openSettingsDialog()}><Icon name="github" /><span>{github.user || 'Log in to GitHub'}</span></span>
        <span className="sb-item" onClick={(e) => openBranchPopup(e.currentTarget)}><Icon name="branch" /><span>{branchLabel}</span></span>
      </div>
    </footer>
  );
}
