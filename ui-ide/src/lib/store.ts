import { create } from 'zustand';
import { readLocal, writeLocal } from './utils';

export interface ProjectInfo {
  root: string;
  name: string;
  git: { repo: boolean; branch: string | null };
  indexReady: boolean;
  python: { interpreter: string; venv: string | null } | null;
  runConfigs: { id: string; label: string; command: string }[];
}

export interface GitStatus {
  repo: boolean;
  branch?: string | null;
  detached?: boolean;
  head?: string | null;
  files: Record<string, { status: string; staged: boolean; from: string | null }>;
  dirs: Record<string, string>;
  upstream?: string | null;
  ahead?: number;
  behind?: number;
  operation?: string | null;
  changelists?: { id: string; name: string; comment: string; active: boolean; files: string[] }[];
}

export interface EditorSettings {
  fontSize: number;
  wordWrap: 'on' | 'off';
  minimap: boolean;
  diffSideBySide: boolean;
  diffIgnoreWs: boolean;
  updateRebase: boolean;
}

export interface TabInfo {
  key: string;
  path: string;
  kind: 'file' | 'diff';
  title: string;
  dirty: boolean;
  preview: boolean;
  blame: boolean;
}

export type Side = 'left' | 'bottom' | 'right';

export interface ToolDef {
  id: string;
  side: Side;
  title: string;
  icon: string;
  shortcut?: string;
  plugin?: { render: (el: HTMLElement) => void; onShow?: () => void };
}

interface ToolLayout {
  active: Record<Side, string | null>;
  open: Record<Side, boolean>;
  saved: Record<Side, boolean> | null;
}

const DEFAULT_SETTINGS: EditorSettings = { fontSize: 13, wordWrap: 'off', minimap: true, diffSideBySide: true, diffIgnoreWs: false, updateRebase: false };

interface State {
  project: ProjectInfo | null;
  gitStatus: GitStatus;
  indexStatus: { ready: boolean; stats: { files: number; symbols: number; ms: number } | null };
  settings: EditorSettings;
  files: string[] | null;
  tabs: TabInfo[];
  activeTab: string | null;
  tools: ToolLayout;
  toolDefs: ToolDef[];
  github: { user: string | null; hasToken: boolean };
  statusMessage: string;
  progress: string | null;
  setProject: (p: ProjectInfo | null) => void;
  setGitStatus: (s: GitStatus) => void;
  setIndexStatus: (s: State['indexStatus']) => void;
  updateSettings: (patch: Partial<EditorSettings>) => void;
  setFiles: (files: string[] | null) => void;
  setTabs: (tabs: TabInfo[], activeTab: string | null) => void;
  registerTool: (def: ToolDef) => void;
  showTool: (id: string) => void;
  hideTool: (id: string) => void;
  toggleTool: (id: string) => void;
  hideAllTools: () => void;
  setGithub: (g: State['github']) => void;
  setStatusMessage: (m: string) => void;
  setProgress: (p: string | null) => void;
}

const sideOf = (defs: ToolDef[], id: string): Side => defs.find((d) => d.id === id)?.side || 'right';

export const useStore = create<State>((set, get) => ({
  project: null,
  gitStatus: { repo: false, files: {}, dirs: {} },
  indexStatus: { ready: false, stats: null },
  settings: typeof window === 'undefined' ? DEFAULT_SETTINGS : { ...DEFAULT_SETTINGS, ...readLocal('ide.settings', {}) },
  files: null,
  tabs: [],
  activeTab: null,
  tools: { active: { left: 'project', bottom: null, right: null }, open: { left: true, bottom: false, right: false }, saved: null },
  toolDefs: [],
  github: { user: null, hasToken: false },
  statusMessage: 'Ready',
  progress: null,
  setProject: (project) => set({ project }),
  setGitStatus: (gitStatus) => set({ gitStatus }),
  setIndexStatus: (indexStatus) => set({ indexStatus }),
  updateSettings: (patch) => {
    const settings = { ...get().settings, ...patch };
    writeLocal('ide.settings', settings);
    set({ settings });
  },
  setFiles: (files) => set({ files }),
  setTabs: (tabs, activeTab) => set({ tabs, activeTab }),
  registerTool: (def) => set((s) => ({ toolDefs: s.toolDefs.some((d) => d.id === def.id) ? s.toolDefs.map((d) => (d.id === def.id ? def : d)) : [...s.toolDefs, def] })),
  showTool: (id) => {
    const side = sideOf(get().toolDefs, id);
    set((s) => ({ tools: { ...s.tools, active: { ...s.tools.active, [side]: id }, open: { ...s.tools.open, [side]: true } } }));
  },
  hideTool: (id) => {
    const side = sideOf(get().toolDefs, id);
    if (get().tools.active[side] !== id) return;
    set((s) => ({ tools: { ...s.tools, open: { ...s.tools.open, [side]: false } } }));
  },
  toggleTool: (id) => {
    const { tools, toolDefs } = get();
    const side = sideOf(toolDefs, id);
    tools.active[side] === id && tools.open[side] ? get().hideTool(id) : get().showTool(id);
  },
  hideAllTools: () =>
    set((s) => {
      if (s.tools.saved) return { tools: { ...s.tools, open: s.tools.saved, saved: null } };
      return { tools: { ...s.tools, saved: s.tools.open, open: { left: false, bottom: false, right: false } } };
    }),
  setGithub: (github) => set({ github }),
  setStatusMessage: (statusMessage) => set({ statusMessage }),
  setProgress: (progress) => set({ progress }),
}));

export const isToolVisible = (s: State, id: string): boolean => {
  const side = sideOf(s.toolDefs, id);
  return s.tools.active[side] === id && s.tools.open[side];
};
