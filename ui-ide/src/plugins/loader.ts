import { api, API_BASE, fsApi, wsUrl } from '@/lib/api';
import { useStore } from '@/lib/store';
import { emit, on } from '@/lib/bus';
import { basename, dirname, fuzzyScore, fmtDate, readLocal, timeAgo, writeLocal } from '@/lib/utils';
import { toast } from '@/components/ui/Toasts';
import { showContextMenu } from '@/components/ui/ContextMenu';
import { confirmDialog, formDialog, promptDialog } from '@/components/ui/dialogs';
import { editorManager } from '@/editor/editor-manager';
import { runInTerminal } from '@/components/terminal/terminal-store';
import { el, escapeHtml, highlightMatch } from './dom';

export interface PluginManifest {
  id: string;
  name: string;
  version?: string;
  description?: string;
  vendor?: string;
  homepage?: string;
  icon?: string;
  client?: string;
  styles?: string;
  toolWindow?: { side?: 'left' | 'bottom' | 'right'; title?: string; shortcut?: string };
  enabled: boolean;
  error?: string | null;
  builtin?: boolean;
  dir?: string;
}

const loaded = new Set<string>();

export async function loadPlugins() {
  let manifests: PluginManifest[];
  try {
    manifests = await api('/api/plugins');
  } catch (err: any) {
    return toast('Plugins', 'Could not load plugin list: ' + err.message, 'error');
  }
  for (const m of manifests) {
    if (!m.enabled || !m.client || loaded.has(m.id)) continue;
    loaded.add(m.id);
    try {
      if (m.styles) {
        const href = `${API_BASE}/plugins/${m.id}/${m.styles}`;
        if (!document.querySelector(`link[href="${href}"]`)) document.head.append(el('link', { rel: 'stylesheet', href }));
      }
      const mod = await import(/* webpackIgnore: true */ `${API_BASE}/plugins/${m.id}/${m.client}?v=${m.version}`);
      await mod.activate(makeApi(m));
    } catch (err: any) {
      toast(`Plugin "${m.name}" failed to load`, err.message, 'error', 8000);
    }
  }
}

function makeApi(manifest: PluginManifest) {
  const ns = `ide.plugin.${manifest.id}.`;
  const store = useStore.getState();
  return {
    id: manifest.id,
    manifest,
    get state() {
      const s = useStore.getState();
      return { root: s.project?.root, name: s.project?.name, project: s.project };
    },
    on,
    emit,
    fetch: (path: string, opts?: Parameters<typeof api>[1]) => api(`/api/plugins/${manifest.id}${path}`, opts),
    ws: (path = '') => new WebSocket(wsUrl(`/ws/plugins/${manifest.id}${path}`)),
    tools: {
      register: (def: { id?: string; side?: 'left' | 'bottom' | 'right'; title?: string; icon?: string; shortcut?: string; render: (el: HTMLElement) => void; onShow?: () => void }) => {
        const id = def.id || manifest.id;
        store.registerTool({ id, side: def.side || manifest.toolWindow?.side || 'right', title: def.title || manifest.toolWindow?.title || manifest.name, icon: def.icon || manifest.icon || 'plugins', shortcut: def.shortcut || manifest.toolWindow?.shortcut, plugin: { render: def.render, onShow: def.onShow } });
        return { show: () => useStore.getState().showTool(id), hide: () => useStore.getState().hideTool(id), toggle: () => useStore.getState().toggleTool(id) };
      },
      show: (id?: string) => useStore.getState().showTool(id || manifest.id),
      hide: (id?: string) => useStore.getState().hideTool(id || manifest.id),
      toggle: (id?: string) => useStore.getState().toggleTool(id || manifest.id),
    },
    openFile: (path: string, opts?: Record<string, unknown>) => editorManager.openFile(path, opts as any),
    openDiff: (path: string, opts?: Record<string, unknown>) => editorManager.openDiff(path, opts as any),
    readFile: async (path: string) => (await fsApi.read(path)).content,
    writeFile: (path: string, content: string) => fsApi.write(path, content),
    files: () => fsApi.files(),
    runInTerminal: (cmd: string, o?: { cwd?: string }) => runInTerminal(cmd, o?.cwd),
    toast,
    showContextMenu,
    formDialog,
    promptDialog,
    confirmDialog,
    el,
    escapeHtml,
    fuzzyScore,
    highlightMatch,
    timeAgo,
    fmtDate,
    basename,
    dirname,
    settings: {
      get: <T,>(key: string, def: T) => readLocal<T>(ns + key, def),
      set: (key: string, val: unknown) => writeLocal(ns + key, val),
    },
  };
}
