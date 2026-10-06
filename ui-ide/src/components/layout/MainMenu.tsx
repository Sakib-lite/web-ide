import { showContextMenu } from '@/components/ui/ContextMenu';
import { useStore } from '@/lib/store';
import { openProjectDialog } from '@/components/welcome/OpenProjectDialog';
import { openProject, closeProject } from '@/lib/project';
import { openCloneDialog } from '@/components/github/CloneDialog';
import { openSettingsDialog } from '@/components/github/SettingsDialog';
import { openPluginsDialog } from '@/components/plugins/PluginsDialog';
import { createNode } from '@/components/project/tree-actions';
import { editorManager } from '@/editor/editor-manager';
import { openSearchEverywhere } from '@/components/search/SearchEverywhere';
import { openFindInFiles } from '@/components/search/search-actions';
import { focusCommitMessage } from '@/components/git/commit-actions';
import { fetchAll, newBranchDialog, pushDialog, updateProject } from '@/components/vcs/vcs-actions';
import { openBranchPopup } from '@/components/vcs/BranchPopup';
import { createPullRequestDialog } from '@/components/github/CreatePullRequestDialog';
import { emit } from '@/lib/bus';

export const MainMenu = {
  open(anchor: HTMLElement) {
    const r = anchor.getBoundingClientRect();
    const { showTool, toggleTool, project } = useStore.getState();
    const activeFile = useStore.getState().tabs.find((t) => t.key === useStore.getState().activeTab)?.path;
    showContextMenu(r.left, r.bottom + 4, [
      { label: 'File', children: [
        { label: 'New File…', key: '⌘N', action: () => createNode(null, 'file') },
        { label: 'New Directory…', action: () => createNode(null, 'dir') },
        'sep',
        { label: 'Open Project…', action: async () => { const p = await openProjectDialog(); if (p) openProject(p); } },
        { label: 'New Project from Version Control…', action: () => openCloneDialog(openProject) },
        { label: 'Save All', key: '⌘S', action: () => editorManager.saveAll() },
        'sep',
        { label: 'Settings…', key: '⌘,', action: () => openSettingsDialog() },
        { label: 'Plugins…', action: () => openPluginsDialog() },
        { label: 'Close Project', action: closeProject },
      ] },
      { label: 'Navigate', children: [
        { label: 'Search Everywhere', key: '⇧⇧', action: () => openSearchEverywhere('all') },
        { label: 'Go to File…', key: '⌘⇧O', action: () => openSearchEverywhere('files') },
        { label: 'Go to Symbol…', key: '⌘⌥O', action: () => openSearchEverywhere('symbols') },
        { label: 'Find Action…', key: '⌘⇧A', action: () => openSearchEverywhere('actions') },
        { label: 'Find in Files…', key: '⌘⇧F', action: () => openFindInFiles() },
      ] },
      { label: 'Git', children: [
        { label: 'Commit…', key: '⌘K', action: focusCommitMessage },
        { label: 'Update Project…', key: '⌘T', action: () => updateProject() },
        { label: 'Push…', key: '⌘⇧K', action: () => pushDialog() },
        { label: 'Fetch', action: () => fetchAll() },
        'sep',
        { label: 'Branches…', action: () => openBranchPopup(document.getElementById('btn-branch')!) },
        { label: 'New Branch…', key: '⌥⌘N', action: () => newBranchDialog() },
        'sep',
        { label: 'Show Git Log', key: '⌘9', action: () => showTool('git') },
        { label: 'Annotate with Git Blame', action: () => editorManager.toggleBlame() },
        { label: 'Show History for Current File', disabled: !activeFile, action: () => activeFile && emit('log-filter-path', { path: activeFile }) },
        { label: 'Pull Requests', action: () => showTool('pulls') },
        { label: 'Create Pull Request…', action: () => createPullRequestDialog() },
        'sep',
        { label: 'Clone…', action: () => openCloneDialog(openProject) },
      ] },
      { label: 'View', children: [
        { label: 'Project', key: '⌘1', action: () => toggleTool('project') },
        { label: 'Commit', key: '⌘0', action: () => toggleTool('commit') },
        { label: 'Structure', key: '⌘7', action: () => toggleTool('structure') },
        { label: 'Terminal', key: '⌥F12', action: () => toggleTool('terminal') },
        { label: 'Git', key: '⌘9', action: () => toggleTool('git') },
      ] },
      { label: `Project: ${project?.name}`, disabled: true },
    ]);
  },
};
