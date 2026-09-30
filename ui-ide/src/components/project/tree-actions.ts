import { fsApi } from '@/lib/api';
import { useStore } from '@/lib/store';
import { emit } from '@/lib/bus';
import { copyText, dirname } from '@/lib/utils';
import { confirmDialog, promptDialog } from '@/components/ui/dialogs';
import { toast } from '@/components/ui/Toasts';
import { MenuItem } from '@/components/ui/ContextMenu';
import { editorManager } from '@/editor/editor-manager';
import { openTerminalAt } from '@/components/terminal/terminal-store';
import { getTreeApi, TreeNode } from './useTree';

export async function locateInTree(path: string) {
  useStore.getState().showTool('project');
  await getTreeApi()?.locate(path);
}

function targetDir(node?: TreeNode | null): TreeNode {
  const tree = getTreeApi()!;
  const selected = node || (tree.selected ? tree.find(tree.selected) : null);
  if (!selected) return tree.root;
  return selected.type === 'dir' ? selected : tree.find(dirname(selected.path)) || tree.root;
}

export async function createNode(node: TreeNode | null, type: 'dir' | 'file') {
  const tree = getTreeApi();
  if (!tree) return;
  const dir = targetDir(node);
  const name = await promptDialog({ title: type === 'dir' ? 'New Directory' : 'New File', label: 'Name:', okText: 'Create', validate: (v) => (!v ? 'Name is required' : v.includes('..') ? 'Invalid name' : undefined) });
  if (!name) return;
  const path = dir.path ? `${dir.path}/${name}` : name;
  try {
    await fsApi.create(path, type);
    await tree.expand(dir);
    await tree.reload(dir.path);
    if (type === 'file') editorManager.openFile(path, { preview: false });
    tree.select(path);
    emit('fs-local-change');
  } catch (err: any) {
    toast('Cannot create', err.message, 'error');
  }
}

export async function renameNode(node: TreeNode) {
  const tree = getTreeApi()!;
  const newName = await promptDialog({ title: `Rename ${node.type === 'dir' ? 'directory' : 'file'}`, label: 'Rename to:', value: node.name, okText: 'Rename', validate: (v) => (!v ? 'Name is required' : undefined) });
  if (!newName || newName === node.name) return;
  const newPath = dirname(node.path) ? `${dirname(node.path)}/${newName}` : newName;
  try {
    await fsApi.rename(node.path, newPath);
    editorManager.handleRenamed(node.path, newPath, node.type === 'dir');
    await tree.reload(dirname(node.path));
    emit('fs-local-change');
  } catch (err: any) {
    toast('Cannot rename', err.message, 'error');
  }
}

export async function deleteNode(node: TreeNode) {
  const tree = getTreeApi()!;
  if (!(await confirmDialog(`Delete ${node.type === 'dir' ? 'directory' : 'file'} "${node.name}"?`, 'Delete'))) return;
  try {
    await fsApi.remove(node.path);
    editorManager.handleDeleted(node.path, node.type === 'dir');
    await tree.reload(dirname(node.path));
    emit('fs-local-change');
  } catch (err: any) {
    toast('Cannot delete', err.message, 'error');
  }
}

const copy = async (text: string) => (await copyText(text)) && toast('Copied', text, 'info', 1800);

export function nodeMenu(node: TreeNode): MenuItem[] {
  const tree = getTreeApi()!;
  const root = useStore.getState().project!.root;
  const dir = targetDir(node);
  const isRoot = node.path === '';
  return [
    { label: 'New File…', key: '⌘N', action: () => createNode(dir, 'file') },
    { label: 'New Directory…', action: () => createNode(dir, 'dir') },
    'sep',
    { label: 'Open', hidden: node.type !== 'file', action: () => editorManager.openFile(node.path, { preview: false }) },
    { label: 'Rename…', key: 'F2', hidden: isRoot, action: () => renameNode(node) },
    { label: 'Copy Path', action: () => copy(`${root}/${node.path}`) },
    { label: 'Copy Relative Path', action: () => copy(node.path) },
    'sep',
    { label: 'Open in Terminal', action: () => openTerminalAt(dir.path ? `${root}/${dir.path}` : root) },
    { label: 'Reload from Disk', hidden: node.type !== 'dir', action: () => tree.reload(node.path) },
    'sep',
    { label: 'Delete…', key: '⌫', danger: true, hidden: isRoot, action: () => deleteNode(node) },
  ];
}
