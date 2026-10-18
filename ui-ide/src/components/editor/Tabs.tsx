'use client';

import { useStore, TabInfo } from '@/lib/store';
import { editorManager } from '@/editor/editor-manager';
import { FileIcon } from '@/components/ui/FileIcon';
import { Icon } from '@/components/ui/Icon';
import { showContextMenu } from '@/components/ui/ContextMenu';
import { basename, copyText } from '@/lib/utils';
import { locateInTree } from '@/components/project/tree-actions';
import { emit } from '@/lib/bus';

function Tab({ tab, active }: { tab: TabInfo; active: boolean }) {
  const gitStatus = useStore((s) => s.gitStatus.files[tab.path]?.status);
  const menu = (e: React.MouseEvent) => {
    e.preventDefault();
    showContextMenu(e.clientX, e.clientY, [
      { label: 'Close', key: '⌘⇧W', action: () => editorManager.closeTab(tab.key) },
      { label: 'Close Others', action: () => editorManager.closeOthers(tab.key) },
      { label: 'Close All', action: () => editorManager.closeAll() },
      'sep',
      { label: 'Select in Project View', action: () => locateInTree(tab.path) },
      { label: 'Copy Path', action: () => copyText(`${useStore.getState().project?.root}/${tab.path}`) },
      { label: 'Show Diff', hidden: !gitStatus || tab.kind === 'diff', action: () => editorManager.openDiff(tab.path) },
      { label: 'Show History', hidden: tab.kind === 'diff', action: () => emit('log-filter-path', { path: tab.path }) },
      { label: tab.blame ? 'Close Annotations' : 'Annotate with Git Blame', hidden: tab.kind === 'diff', action: () => editorManager.toggleBlame(editorManager.tabs.get(tab.key)) },
    ]);
  };
  return (
    <div
      className={`tab${active ? ' active' : ''}${tab.dirty ? ' dirty' : ''}${tab.preview ? ' preview' : ''}`}
      title={tab.path}
      onClick={() => editorManager.activate(tab.key)}
      onDoubleClick={() => { const t = editorManager.tabs.get(tab.key); if (t) { t.preview = false; editorManager.activate(tab.key); } }}
      onAuxClick={(e) => e.button === 1 && editorManager.closeTab(tab.key)}
      onContextMenu={menu}
    >
      <FileIcon name={basename(tab.path)} />
      <span className={`tab-label${gitStatus && gitStatus !== 'ignored' ? ` git-${gitStatus}` : ''}`}>{tab.title}</span>
      <span className="tab-close" title="Close" onClick={(e) => { e.stopPropagation(); editorManager.closeTab(tab.key); }}><Icon name="close" /></span>
    </div>
  );
}

export function Tabs() {
  const tabs = useStore((s) => s.tabs);
  const active = useStore((s) => s.activeTab);
  return (
    <div className="tabs" onWheel={(e) => { e.currentTarget.scrollLeft += e.deltaY; }}>
      {tabs.map((t) => <Tab key={t.key} tab={t} active={t.key === active} />)}
    </div>
  );
}
