import { api } from './api';
import { useStore } from './store';
import { emit } from './bus';
import { closeProject, openProject } from './project';
import { editorManager } from '@/editor/editor-manager';
import { toast } from '@/components/ui/Toasts';
import { showContextMenu } from '@/components/ui/ContextMenu';
import { openSearchEverywhere } from '@/components/search/SearchEverywhere';
import { findUsages, openFindInFiles } from '@/components/search/search-actions';
import { focusCommitMessage } from '@/components/git/commit-actions';
import { fetchAll, newBranchDialog, pushDialog, updateProject } from '@/components/vcs/vcs-actions';
import { openBranchPopup } from '@/components/vcs/BranchPopup';
import { createPullRequestDialog } from '@/components/github/CreatePullRequestDialog';
import { openCloneDialog } from '@/components/github/CloneDialog';
import { openSettingsDialog } from '@/components/github/SettingsDialog';
import { openPluginsDialog } from '@/components/plugins/PluginsDialog';
import { openProjectDialog } from '@/components/welcome/OpenProjectDialog';
import { createNode } from '@/components/project/tree-actions';
import { runSelectedConfig } from '@/components/layout/RunWidget';

export interface IdeAction {
  label: string;
  key?: string;
  run: () => void;
}

export function openRecentFiles() {
  const files = editorManager.recentFiles;
  if (!files.length) return toast('No recent files', '', 'info', 1500);
  showContextMenu(Math.max(20, innerWidth / 2 - 220), 90, files.slice(0, 20).map((p) => ({ label: p.split('/').pop()!, key: p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '', action: () => editorManager.openFile(p, { preview: false }) })));
}

export async function rebuildIndex() {
  const store = useStore.getState();
  store.setIndexStatus({ ready: false, stats: null });
  try {
    const r = await api('/api/symbols/rebuild', { method: 'POST', body: {} });
    store.setIndexStatus({ ready: true, stats: r.stats });
    toast('Symbol index rebuilt', `${r.stats.symbols} names in ${r.stats.files} files`, 'success');
  } catch (err: any) {
    toast('Rebuild failed', err.message, 'error');
  }
}

export function ideActions(): IdeAction[] {
  const { showTool, toggleTool, hideAllTools, toolDefs, settings, updateSettings } = useStore.getState();
  const activeFile = editorManager.active?.path;
  const trigger = (cmd: string) => () => editorManager.trigger(cmd);
  return [
    { label: 'Commit…', key: '⌘K', run: focusCommitMessage },
    { label: 'Update Project', key: '⌘T', run: () => updateProject() },
    { label: 'Push…', key: '⌘⇧K', run: () => pushDialog() },
    { label: 'Fetch', run: () => fetchAll() },
    { label: 'Branches…', run: () => openBranchPopup(document.getElementById('btn-branch')!) },
    { label: 'New Branch…', key: '⌥⌘N', run: () => newBranchDialog() },
    { label: 'Show Git Log', key: '⌘9', run: () => showTool('git') },
    { label: 'Annotate with Git Blame', run: () => editorManager.toggleBlame() },
    { label: 'Show History for Current File', run: () => activeFile && emit('log-filter-path', { path: activeFile }) },
    { label: 'Pull Requests', run: () => showTool('pulls') },
    { label: 'Create Pull Request…', run: () => createPullRequestDialog() },
    { label: 'Get from Version Control…', run: () => openCloneDialog(openProject) },
    { label: 'Open Project…', run: async () => { const p = await openProjectDialog(); if (p) openProject(p); } },
    { label: 'New File…', key: '⌘N', run: () => createNode(null, 'file') },
    { label: 'New Directory…', run: () => createNode(null, 'dir') },
    { label: 'Save All', key: '⌘S', run: () => editorManager.saveAll() },
    { label: 'Reformat Code', key: '⌘⌥L', run: trigger('editor.action.formatDocument') },
    { label: 'Go to Declaration or Usages', key: '⌘B', run: trigger('jb.goto') },
    { label: 'Find Usages', key: '⌥F7', run: () => { const w = editorManager.currentWord(); if (w) findUsages(w, activeFile); } },
    { label: 'Show Usages', key: '⌥⌘F7', run: trigger('editor.action.referenceSearch.trigger') },
    { label: 'Rename…', key: '⇧F6', run: trigger('editor.action.rename') },
    { label: 'Show Intention Actions', key: '⌥⏎', run: trigger('editor.action.quickFix') },
    { label: 'Recent Files', key: '⌘E', run: openRecentFiles },
    { label: 'Back', key: '⌘⌥←', run: () => editorManager.navigate(-1) },
    { label: 'Forward', key: '⌘⌥→', run: () => editorManager.navigate(1) },
    { label: 'Hide All Tool Windows', key: '⌘⇧F12', run: hideAllTools },
    { label: 'Go to Class…', key: '⌘O', run: () => openSearchEverywhere('symbols') },
    { label: 'Duplicate Line', key: '⌘D', run: trigger('editor.action.copyLinesDownAction') },
    { label: 'Delete Line', key: '⌘⌫', run: trigger('editor.action.deleteLines') },
    { label: 'Comment with Line Comment', key: '⌘/', run: trigger('editor.action.commentLine') },
    { label: 'Find in Files…', key: '⌘⇧F', run: () => openFindInFiles() },
    { label: 'Go to File…', key: '⌘⇧O', run: () => openSearchEverywhere('files') },
    { label: 'Go to Symbol…', key: '⌘⌥O', run: () => openSearchEverywhere('symbols') },
    { label: 'Terminal', key: '⌥F12', run: () => showTool('terminal') },
    { label: 'Project Tool Window', key: '⌘1', run: () => toggleTool('project') },
    { label: 'Structure Tool Window', key: '⌘7', run: () => toggleTool('structure') },
    { label: 'Run', run: runSelectedConfig },
    { label: 'Settings…', key: '⌘,', run: () => openSettingsDialog() },
    { label: 'Plugins…', run: () => openPluginsDialog() },
    { label: 'Increase Font Size', run: () => editorManager.changeFontSize(1) },
    { label: 'Decrease Font Size', run: () => editorManager.changeFontSize(-1) },
    { label: 'Toggle Soft-Wrap', run: () => updateSettings({ wordWrap: settings.wordWrap === 'on' ? 'off' : 'on' }) },
    { label: 'Toggle Minimap', run: () => updateSettings({ minimap: !settings.minimap }) },
    { label: 'Rebuild Symbol Index', run: rebuildIndex },
    { label: 'Close Project', run: closeProject },
    ...toolDefs.filter((t) => t.plugin).map((t) => ({ label: `${t.title} Tool Window`, key: t.shortcut, run: () => toggleTool(t.id) })),
  ];
}
