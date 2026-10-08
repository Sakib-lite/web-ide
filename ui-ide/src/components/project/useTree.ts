import { useCallback, useEffect, useReducer, useRef } from 'react';
import { fsApi } from '@/lib/api';
import { on } from '@/lib/bus';
import { useStore } from '@/lib/store';
import { dirname } from '@/lib/utils';
import { toast } from '@/components/ui/Toasts';

export interface TreeNode {
  path: string;
  name: string;
  type: 'dir' | 'file';
  ignored: boolean;
  depth: number;
  open: boolean;
  loading: boolean;
  children: TreeNode[] | null;
}

export interface TreeApi {
  root: TreeNode;
  selected: string | null;
  version: number;
  select: (path: string | null) => void;
  toggle: (node: TreeNode) => void;
  expand: (node: TreeNode) => Promise<void>;
  collapse: (node: TreeNode) => void;
  reload: (dirPath: string) => Promise<void>;
  collapseAll: () => void;
  locate: (path: string) => Promise<void>;
  find: (path: string) => TreeNode | undefined;
  visible: () => TreeNode[];
}

const treeRegistry: { api: TreeApi | null } = { api: null };
export const getTreeApi = () => treeRegistry.api;

export function useTree(): TreeApi {
  const name = useStore((s) => s.project?.name || '');
  const nodes = useRef(new Map<string, TreeNode>());
  const rootRef = useRef<TreeNode>({ path: '', name, type: 'dir', ignored: false, depth: 0, open: false, loading: false, children: null });
  const selectedRef = useRef<string | null>(null);
  const [version, bump] = useReducer((n: number) => n + 1, 0);

  const loadChildren = useCallback(async (node: TreeNode) => {
    const entries: Omit<TreeNode, 'depth' | 'open' | 'loading' | 'children'>[] = await fsApi.list(node.path);
    const prev = new Map((node.children || []).map((c) => [c.path, c]));
    node.children = entries.map((e) => {
      const existing = prev.get(e.path);
      if (existing && existing.type === e.type) return existing;
      const child: TreeNode = { ...e, depth: node.depth + 1, open: false, loading: false, children: null };
      return child;
    });
    for (const c of node.children) nodes.current.set(c.path, c);
    for (const c of prev.values()) if (!node.children.includes(c)) forget(c, nodes.current);
  }, []);

  const expand = useCallback(async (node: TreeNode) => {
    if (node.type !== 'dir' || node.open) return;
    node.open = true;
    if (node.children === null) {
      node.loading = true;
      bump();
      try {
        await loadChildren(node);
      } catch (err: any) {
        toast('Cannot read folder', err.message, 'error');
      }
      node.loading = false;
    }
    bump();
  }, [loadChildren]);

  const collapse = useCallback((node: TreeNode) => {
    if (!node.open) return;
    node.open = false;
    bump();
  }, []);

  const reload = useCallback(async (dirPath: string) => {
    const node = dirPath === '' ? rootRef.current : nodes.current.get(dirPath);
    if (!node || node.type !== 'dir' || node.children === null) return;
    try {
      await loadChildren(node);
      bump();
    } catch {}
  }, [loadChildren]);

  const api: TreeApi = {
    root: rootRef.current,
    selected: selectedRef.current,
    version,
    select: (path) => {
      selectedRef.current = path;
      bump();
    },
    toggle: (node) => (node.open ? collapse(node) : expand(node)),
    expand,
    collapse,
    reload,
    collapseAll: () => {
      for (const n of nodes.current.values()) n.open = false;
      bump();
    },
    locate: async (path) => {
      await expand(rootRef.current);
      const segs = path.split('/');
      for (let i = 0; i < segs.length - 1; i++) {
        const n = nodes.current.get(segs.slice(0, i + 1).join('/'));
        if (!n) return;
        await expand(n);
      }
      selectedRef.current = path;
      bump();
      setTimeout(() => document.querySelector<HTMLElement>(`.tree-row[data-path="${CSS.escape(path)}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 50);
    },
    find: (path) => (path === '' ? rootRef.current : nodes.current.get(path)),
    visible: () => {
      const out: TreeNode[] = [];
      const walk = (n: TreeNode) => {
        out.push(n);
        if (n.open && n.children) n.children.forEach(walk);
      };
      walk(rootRef.current);
      return out;
    },
  };
  treeRegistry.api = api;

  useEffect(() => {
    rootRef.current.name = name;
    expand(rootRef.current);
  }, [name, expand]);

  useEffect(() => on<{ changes: { path: string }[] }>('fs-change', ({ changes }) => {
    const dirs = new Set(changes.map((c) => dirname(c.path)));
    for (const d of dirs) reload(d);
  }), [reload]);

  return api;
}

function forget(node: TreeNode, map: Map<string, TreeNode>) {
  map.delete(node.path);
  node.children?.forEach((c) => forget(c, map));
}
