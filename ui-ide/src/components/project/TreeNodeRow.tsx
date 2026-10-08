'use client';

import { useStore } from '@/lib/store';
import { FileIcon } from '@/components/ui/FileIcon';
import { Icon } from '@/components/ui/Icon';
import { TreeNode, TreeApi } from './useTree';

interface Props {
  node: TreeNode;
  tree: TreeApi;
  onOpen: (path: string, pinned: boolean) => void;
  onMenu: (e: React.MouseEvent, node: TreeNode) => void;
}

function gitClass(node: TreeNode, files: Record<string, { status: string }>, dirs: Record<string, string>): string {
  if (!node.path) return '';
  const status = node.type === 'file' ? files[node.path]?.status : dirs[node.path] || files[node.path + '/']?.status;
  return status ? ` git-${status}` : '';
}

export function TreeNodeRow({ node, tree, onOpen, onMenu }: Props) {
  const files = useStore((s) => s.gitStatus.files);
  const dirs = useStore((s) => s.gitStatus.dirs);
  const selected = tree.selected === node.path;
  const isDir = node.type === 'dir';
  return (
    <div className={`tree-node${node.open ? ' open settled' : ''}`}>
      <div
        className={`tree-row${selected ? ' selected' : ''}${node.ignored ? ' ignored' : ''}${gitClass(node, files, dirs)}`}
        style={{ ['--depth' as string]: node.depth, fontWeight: node.path === '' ? 600 : undefined }}
        data-path={node.path}
        onClick={() => {
          tree.select(node.path);
          isDir ? tree.toggle(node) : onOpen(node.path, false);
        }}
        onDoubleClick={() => !isDir && onOpen(node.path, true)}
        onContextMenu={(e) => onMenu(e, node)}
      >
        <span className={`tree-arrow${isDir ? '' : ' spacer'}`}><Icon name="chevron-right" /></span>
        <FileIcon name={node.name} dir={isDir} ignored={node.ignored} />
        <span className="tree-label">{node.name}</span>
      </div>
      {isDir && (
        <div className="tree-children">
          <div>
            {node.loading && <div className="tree-loading" style={{ ['--depth' as string]: node.depth + 1 }}>loading…</div>}
            {node.open && node.children?.map((c) => <TreeNodeRow key={c.path} node={c} tree={tree} onOpen={onOpen} onMenu={onMenu} />)}
          </div>
        </div>
      )}
    </div>
  );
}
