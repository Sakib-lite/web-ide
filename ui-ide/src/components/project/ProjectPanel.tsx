'use client';

import { useStore } from '@/lib/store';
import { Icon } from '@/components/ui/Icon';
import { showContextMenu } from '@/components/ui/ContextMenu';
import { editorManager } from '@/editor/editor-manager';
import { emit } from '@/lib/bus';
import { dirname, isMac } from '@/lib/utils';
import { ToolHeader } from '@/components/layout/ToolPanel';
import { TreeNodeRow } from './TreeNodeRow';
import { useTree, TreeNode } from './useTree';
import { deleteNode, nodeMenu, renameNode } from './tree-actions';

export function ProjectPanel() {
  const tree = useTree();
  const activeTab = useStore((s) => s.activeTab);
  const open = (path: string, pinned: boolean) => editorManager.openFile(path, { preview: !pinned });
  const menu = (e: React.MouseEvent, node: TreeNode) => {
    e.preventDefault();
    e.stopPropagation();
    tree.select(node.path);
    showContextMenu(e.clientX, e.clientY, nodeMenu(node));
  };
  const onKey = (e: React.KeyboardEvent) => {
    const selected = tree.selected !== null ? tree.find(tree.selected) : null;
    if (!selected) return;
    const list = tree.visible();
    const i = list.indexOf(selected);
    const go = (n?: TreeNode) => n && tree.select(n.path);
    const jump = () => selected.type === 'file' && (open(selected.path, true), emit('focus-editor'));
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); e.metaKey ? jump() : go(list[i + 1]); break;
      case 'ArrowUp': e.preventDefault(); go(list[i - 1]); break;
      case 'ArrowRight': e.preventDefault(); if (selected.type === 'dir') selected.open ? go(selected.children?.[0]) : tree.expand(selected); break;
      case 'ArrowLeft': e.preventDefault(); selected.type === 'dir' && selected.open ? tree.collapse(selected) : go(tree.find(dirname(selected.path))); break;
      case 'Enter': e.preventDefault(); selected.type === 'dir' ? tree.toggle(selected) : open(selected.path, true); break;
      case 'F4': e.preventDefault(); jump(); break;
      case 'F2': e.preventDefault(); if (selected.path) renameNode(selected); break;
      case 'Delete': case 'Backspace': if ((isMac ? e.metaKey : true) && selected.path) { e.preventDefault(); deleteNode(selected); } break;
    }
  };
  return (
    <>
      <ToolHeader id="project" title="Project">
        <button className="tb-icon sm" title="Select opened file" onClick={() => { const t = editorManager.tabs.get(activeTab || ''); if (t) tree.locate(t.path); }}><Icon name="locate" /></button>
        <button className="tb-icon sm" title="Collapse all" onClick={tree.collapseAll}><Icon name="collapse" /></button>
        <button className="tb-icon sm" title="Reload from disk" onClick={() => tree.reload('')}><Icon name="refresh" /></button>
      </ToolHeader>
      <div className="tree" tabIndex={0} onKeyDown={onKey} onContextMenu={(e) => { if (e.target === e.currentTarget) { e.preventDefault(); showContextMenu(e.clientX, e.clientY, nodeMenu(tree.root)); } }}>
        <TreeNodeRow key={tree.version && 'root'} node={tree.root} tree={tree} onOpen={open} onMenu={menu} />
      </div>
    </>
  );
}
