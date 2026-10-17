'use client';

import { useStore } from '@/lib/store';
import { Icon } from '@/components/ui/Icon';
import { badgeHue } from '@/lib/utils';
import { ProjectSwitcher } from './ProjectSwitcher';
import { RunWidget } from './RunWidget';
import { MainMenu } from './MainMenu';
import { openBranchPopup } from '@/components/vcs/BranchPopup';
import { pushDialog, updateProject } from '@/components/vcs/vcs-actions';
import { gitApi } from '@/lib/api';
import { refreshGitStatus } from '@/components/git/git-status';
import { toast } from '@/components/ui/Toasts';
import { focusCommitMessage } from '@/components/git/commit-actions';
import { openSearchEverywhere } from '@/components/search/SearchEverywhere';
import { openFindInFiles } from '@/components/search/search-actions';
import { openSettingsMenu } from './SettingsMenu';

export function TitleBar() {
  const project = useStore((s) => s.project)!;
  const git = useStore((s) => s.gitStatus);
  const progress = useStore((s) => s.progress);
  const branchLabel = git.repo ? (git.detached ? `HEAD (${git.head})` : git.branch || '') : 'no vcs';
  const sync = git.repo && (git.ahead || git.behind) ? `${git.ahead ? '↑' + git.ahead : ''}${git.behind ? ' ↓' + git.behind : ''}`.trim() : '';
  return (
    <header className="titlebar">
      <div className="tb-left">
        <button className="tb-icon" title="Main Menu" onClick={(e) => MainMenu.open(e.currentTarget)}><Icon name="menu" /></button>
        <button className="tb-project" title="Switch project" onClick={(e) => ProjectSwitcher.open(e.currentTarget)}>
          <span className="project-badge" style={{ background: `hsl(${badgeHue(project.name)} 55% 45%)` }}>{project.name.slice(0, 1).toUpperCase()}</span>
          <span>{project.name}</span>
          <Icon name="chevron-down" />
        </button>
        <button className="tb-branch" id="btn-branch" title="Git branches" onClick={(e) => openBranchPopup(e.currentTarget)}>
          <Icon name="branch" />
          <span>{branchLabel}</span>
          {sync && <span className="branch-sync">{sync}</span>}
          <Icon name="chevron-down" />
        </button>
        {git.repo && git.operation === 'merge' && (
          <span className="tb-merging" id="merge-state">
            <Icon name="git" />
            <span>Merging {branchLabel}</span>
            <button
              title="Complete merge (commit)"
              onClick={async () => {
                try {
                  await gitApi.completeMerge();
                  await refreshGitStatus();
                  toast('Merge completed', 'Merge commit created', 'success');
                } catch (err: any) {
                  toast('Cannot complete merge', err.message, 'error');
                }
              }}
            >
              <Icon name="check" />
            </button>
            <button
              title="Abort merge"
              onClick={async () => {
                try {
                  await gitApi.abortOp('merge');
                  await refreshGitStatus();
                  toast('Merge aborted', 'Working tree restored', 'info');
                } catch (err: any) {
                  toast('Abort failed', err.message, 'error');
                }
              }}
            >
              <Icon name="close" />
            </button>
          </span>
        )}
        <div className="vcs-quick">
          <button className="tb-icon" title="Update Project (⌘T)" onClick={() => updateProject()}><Icon name="update" /></button>
          <button className="tb-icon" title="Commit (⌘K)" onClick={focusCommitMessage}><Icon name="commit" /></button>
          <button className="tb-icon" title="Push (⌘⇧K)" onClick={() => pushDialog()}><Icon name="push" /></button>
        </div>
      </div>
      <div className="tb-center"><RunWidget /></div>
      <div className="tb-right">
        {progress && <span className="tb-progress"><span className="spinner" /><span>{progress}…</span></span>}
        <button className="tb-icon" title="Search Everywhere (Double Shift)" onClick={() => openSearchEverywhere('all')}><Icon name="search" /></button>
        <button className="tb-icon" title="Find in Files (⌘⇧F)" onClick={() => openFindInFiles()}><Icon name="find-files" /></button>
        <button className="tb-icon" title="Settings (⌘,)" onClick={(e) => openSettingsMenu(e.currentTarget)}><Icon name="settings" /></button>
      </div>
    </header>
  );
}
