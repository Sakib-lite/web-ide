import type * as Monaco from 'monaco-editor';
import { loader } from '@monaco-editor/react';
import { fsApi, gitApi } from '@/lib/api';
import { useStore, TabInfo } from '@/lib/store';
import { emit, on } from '@/lib/bus';
import { basename, debounce, Debounced, extname, shortAgo } from '@/lib/utils';
import { toast } from '@/components/ui/Toasts';
import { THEME_NAME, configureTypescript, defineTheme, languageFor } from './theme';
import { registerDefinitionProvider } from './definitions';
import { initIntellisense } from './intellisense';
import { registerKeymap } from './keymap';

export interface DiffOptions {
  key?: string;
  title?: string;
  before?: { content: string; label: string };
  after?: { content: string; label: string; readOnly?: boolean };
}

interface OpenOptions {
  line?: number;
  col?: number;
  preview?: boolean;
  activate?: boolean;
}

export interface Tab {
  key: string;
  path: string;
  kind: 'file' | 'diff';
  model: Monaco.editor.ITextModel;
  original?: Monaco.editor.ITextModel;
  viewState?: Monaco.editor.ICodeEditorViewState | null;
  dirty: boolean;
  preview: boolean;
  savedVersion: number;
  saving: boolean;
  decorations: string[];
  blame: any[] | null;
  blameDecorations: string[];
  labels?: { left: string; right: string };
  readOnly?: boolean;
  ownsModel?: boolean;
  title?: string;
  save: Debounced<[]>;
  gutter: Debounced<[]>;
  blameRefresh?: Debounced<[]>;
}

type Listener = () => void;

class EditorManager {
  monaco!: typeof Monaco;
  editor!: Monaco.editor.IStandaloneCodeEditor;
  diffEditor!: Monaco.editor.IStandaloneDiffEditor;
  readonly tabs = new Map<string, Tab>();
  active: Tab | null = null;
  readonly recentFiles: string[] = [];
  private pendingOpens = new Map<string, Promise<Tab | null>>();
  private navHistory: { path: string; line: number; col: number }[] = [];
  private navIndex = -1;
  private navigating = false;
  private readonly listeners = new Set<Listener>();
  private ready = false;

  onChange(listener: Listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    this.publishTabs();
    for (const l of this.listeners) l();
  }

  async init(editorHost: HTMLElement, diffHost: HTMLElement) {
    if (this.ready) return;
    loader.config({ paths: { vs: '/monaco/vs' } });
    this.monaco = (await loader.init()) as typeof Monaco;
    const monaco = this.monaco;
    defineTheme(monaco);
    configureTypescript(monaco);
    const settings = useStore.getState().settings;
    this.editor = monaco.editor.create(editorHost, {
      model: null, theme: THEME_NAME, automaticLayout: true, fontFamily: '"JetBrains Mono", "Fira Code", Menlo, Monaco, monospace', fontSize: settings.fontSize, fontLigatures: true, lineHeight: 22,
      minimap: { enabled: settings.minimap, renderCharacters: false, maxColumn: 80 }, wordWrap: settings.wordWrap, renderLineHighlight: 'all', scrollBeyondLastLine: true, smoothScrolling: true,
      cursorBlinking: 'smooth', cursorSmoothCaretAnimation: 'on', padding: { top: 6 }, bracketPairColorization: { enabled: true }, guides: { bracketPairs: true, indentation: true }, tabSize: 4,
      lineDecorationsWidth: 14, folding: true, showFoldingControls: 'mouseover', renderWhitespace: 'selection', quickSuggestions: { other: true, comments: false, strings: true }, stickyScroll: { enabled: true },
      unicodeHighlight: { ambiguousCharacters: false },
    });
    this.diffEditor = monaco.editor.createDiffEditor(diffHost, { theme: THEME_NAME, automaticLayout: true, originalEditable: false, renderSideBySide: settings.diffSideBySide, ignoreTrimWhitespace: settings.diffIgnoreWs, fontFamily: '"JetBrains Mono", "Fira Code", Menlo, Monaco, monospace', fontSize: settings.fontSize, lineHeight: 22, minimap: { enabled: false }, scrollBeyondLastLine: false, renderMarginRevertIcon: true, diffAlgorithm: 'advanced' });
    this.editor.onDidChangeModel(() => this.syncActiveWithModel());
    monaco.editor.registerEditorOpener({
      openCodeEditor: (_source, resource, selection: any) => {
        if (resource.scheme !== 'file') return false;
        this.openFile(resource.path.replace(/^\//, ''), { line: selection?.startLineNumber ?? selection?.lineNumber, col: selection?.startColumn ?? selection?.column, preview: true });
        return true;
      },
    });
    registerDefinitionProvider(monaco, this);
    initIntellisense(monaco, this.editor);
    registerKeymap(monaco, this);
    this.editor.onDidChangeCursorPosition((e) => (e.source === 'mouse' || e.source === 'keyboard') && this.noteLocation(true));
    on('fs-change', ({ changes }: any) => this.onFsChange(changes));
    on('git-status', () => this.active?.kind === 'file' && this.refreshGutter(this.active));
    on('focus-editor', () => this.editor.focus());
    useStore.subscribe((s, prev) => s.settings !== prev.settings && this.applySettings());
    this.ready = true;
    this.notify();
  }

  private publishTabs() {
    const tabs: TabInfo[] = [...this.tabs.values()].map((t) => ({ key: t.key, path: t.path, kind: t.kind, title: t.title || (t.kind === 'diff' ? `${basename(t.path)} (Diff)` : basename(t.path)), dirty: t.dirty, preview: t.preview, blame: !!t.blame }));
    useStore.getState().setTabs(tabs, this.active?.key || null);
  }

  applySettings() {
    const s = useStore.getState().settings;
    this.editor.updateOptions({ fontSize: s.fontSize, wordWrap: s.wordWrap, minimap: { enabled: s.minimap } });
    this.diffEditor.updateOptions({ fontSize: s.fontSize, renderSideBySide: s.diffSideBySide, ignoreTrimWhitespace: s.diffIgnoreWs });
  }

  changeFontSize(delta: number) {
    const { settings, updateSettings } = useStore.getState();
    updateSettings({ fontSize: Math.max(9, Math.min(28, settings.fontSize + delta)) });
  }

  async openFile(path: string, opts: OpenOptions = {}): Promise<Tab | null> {
    const pending = this.pendingOpens.get(path);
    if (pending) {
      await pending.catch(() => undefined);
      return this.openFile(path, opts);
    }
    const p = this.doOpen(path, opts);
    this.pendingOpens.set(path, p);
    try {
      return await p;
    } finally {
      this.pendingOpens.delete(path);
    }
  }

  private async doOpen(path: string, { line, col, preview = false, activate = true }: OpenOptions): Promise<Tab | null> {
    const existing = this.tabs.get(path);
    if (existing) {
      if (!preview) existing.preview = false;
      if (activate) this.activate(path);
      if (line) this.revealLine(line, col);
      this.notify();
      return existing;
    }
    try {
      const data = await fsApi.read(path);
      return this.openWithContent(path, data.content, { line, col, preview, activate });
    } catch (err: any) {
      toast(basename(path), err.message, 'error');
      return null;
    }
  }

  private openWithContent(path: string, content: string, { line, col, preview = false, activate = true }: OpenOptions): Tab {
    if (preview) {
      const prev = [...this.tabs.values()].find((t) => t.preview && !t.dirty);
      if (prev) this.closeTab(prev.key, true);
    }
    const uri = this.monaco.Uri.file('/' + path);
    let model = this.monaco.editor.getModel(uri);
    if (!model) model = this.monaco.editor.createModel(content, languageFor(path), uri);
    else if (model.getValue() !== content) model.setValue(content);
    const tab: Tab = { key: path, path, kind: 'file', model, dirty: false, preview, savedVersion: model.getAlternativeVersionId(), saving: false, decorations: [], blame: null, blameDecorations: [], save: debounce(() => this.save(tab), 900), gutter: debounce(() => this.refreshGutter(tab), 500) };
    model.onDidChangeContent(() => {
      const dirty = model!.getAlternativeVersionId() !== tab.savedVersion;
      if (dirty) {
        tab.preview = false;
        tab.save();
      }
      if (dirty !== tab.dirty) {
        tab.dirty = dirty;
        this.notify();
      }
      tab.gutter();
    });
    this.tabs.set(path, tab);
    if (activate) this.activate(path);
    if (line) this.revealLine(line, col);
    this.refreshGutter(tab);
    this.notify();
    return tab;
  }

  activate(key: string, setModel = true) {
    const tab = this.tabs.get(key);
    if (!tab) return;
    if (this.active && this.active !== tab && this.active.kind === 'file') this.active.viewState = this.editor.saveViewState();
    this.active = tab;
    if (tab.kind === 'diff') this.diffEditor.setModel({ original: tab.original!, modified: tab.model });
    else {
      if (setModel && this.editor.getModel() !== tab.model) this.editor.setModel(tab.model);
      if (tab.viewState) this.editor.restoreViewState(tab.viewState);
      this.editor.focus();
      this.rememberRecent(tab.path);
      this.noteLocation();
    }
    this.diffEditor.updateOptions({ readOnly: !!tab.readOnly });
    this.notify();
    emit('active-tab', tab);
  }

  private syncActiveWithModel() {
    const model = this.editor.getModel();
    if (!model) return;
    const tab = [...this.tabs.values()].find((t) => t.kind === 'file' && t.model === model);
    if (tab && tab !== this.active) this.activate(tab.key, false);
  }

  private rememberRecent(path: string) {
    const i = this.recentFiles.indexOf(path);
    if (i >= 0) this.recentFiles.splice(i, 1);
    this.recentFiles.unshift(path);
    if (this.recentFiles.length > 30) this.recentFiles.pop();
  }

  closeTab(key: string, force = false) {
    const tab = this.tabs.get(key);
    if (!tab) return;
    if (tab.dirty && !force) tab.save.flush();
    const keys = [...this.tabs.keys()];
    const index = keys.indexOf(key);
    this.tabs.delete(key);
    tab.save.cancel();
    tab.gutter.cancel();
    const stillUsed = [...this.tabs.values()].some((t) => t.model === tab.model);
    if (tab.kind === 'diff') {
      tab.original?.dispose();
      if ((tab.ownsModel || !stillUsed) && !this.tabs.get(tab.path)) tab.model.dispose();
    } else if (!stillUsed) tab.model.dispose();
    if (this.active === tab) {
      this.active = null;
      const remaining = [...this.tabs.keys()];
      if (remaining.length) this.activate(remaining[Math.min(index, remaining.length - 1)]);
      else this.showEmpty();
    }
    this.notify();
  }

  closeAll() {
    for (const k of [...this.tabs.keys()]) this.closeTab(k);
  }

  closeOthers(key: string) {
    for (const k of [...this.tabs.keys()]) if (k !== key) this.closeTab(k);
  }

  private showEmpty() {
    this.active = null;
    this.editor.setModel(null);
    emit('active-tab', null);
  }

  nextTab(dir: 1 | -1) {
    const keys = [...this.tabs.keys()];
    if (!keys.length || !this.active) return;
    const i = keys.indexOf(this.active.key);
    this.activate(keys[(i + dir + keys.length) % keys.length]);
  }

  async save(tab: Tab) {
    if (tab.kind !== 'file' || tab.saving) return;
    const version = tab.model.getAlternativeVersionId();
    if (version === tab.savedVersion) return;
    tab.saving = true;
    try {
      await fsApi.write(tab.path, tab.model.getValue());
      tab.savedVersion = version;
      if (tab.model.getAlternativeVersionId() === version) tab.dirty = false;
      useStore.getState().setStatusMessage(`Saved ${basename(tab.path)}`);
      emit('file-saved', { path: tab.path });
      this.refreshGutter(tab);
      tab.blameRefresh?.();
      this.notify();
    } catch (err: any) {
      toast('Save failed', err.message, 'error');
    } finally {
      tab.saving = false;
      if (tab.model.getAlternativeVersionId() !== tab.savedVersion) tab.save();
    }
  }

  saveActive() {
    if (this.active?.kind === 'file') {
      this.active.save.cancel();
      return this.save(this.active);
    }
  }

  async saveAll() {
    for (const t of this.tabs.values()) if (t.kind === 'file' && t.dirty) {
      t.save.cancel();
      await this.save(t);
    }
  }

  private async onFsChange(changes: { event: string; path: string }[]) {
    for (const c of changes) {
      if (c.event === 'change') await this.reloadIfClean(c.path);
      if (c.event === 'unlink') {
        const t = this.tabs.get(c.path);
        if (t && !t.dirty) this.closeTab(c.path, true);
      }
    }
  }

  private async reloadIfClean(path: string) {
    const tab = this.tabs.get(path);
    if (!tab || tab.kind !== 'file' || tab.dirty || tab.saving) return;
    try {
      const data = await fsApi.read(path);
      if (data.content === tab.model.getValue()) return;
      const vs = tab === this.active ? this.editor.saveViewState() : tab.viewState;
      tab.model.setValue(data.content);
      tab.savedVersion = tab.model.getAlternativeVersionId();
      tab.dirty = false;
      if (tab === this.active && vs) this.editor.restoreViewState(vs);
      this.refreshGutter(tab);
      this.notify();
    } catch {}
  }

  handleDeleted(path: string, isDir: boolean) {
    for (const t of [...this.tabs.values()]) if (t.path === path || (isDir && t.path.startsWith(path + '/'))) this.closeTab(t.key, true);
  }

  handleRenamed(from: string, to: string, isDir: boolean) {
    for (const t of [...this.tabs.values()]) {
      if (t.kind !== 'file' || !(t.path === from || (isDir && t.path.startsWith(from + '/')))) continue;
      const newPath = t.path === from ? to : to + t.path.slice(from.length);
      const wasActive = t === this.active;
      const content = t.model.getValue();
      this.closeTab(t.key, true);
      this.openWithContent(newPath, content, { preview: false, activate: wasActive });
    }
  }

  async refreshGutter(tab: Tab) {
    if (tab.kind !== 'file' || !useStore.getState().gitStatus.repo || !this.tabs.has(tab.key)) return;
    const status = useStore.getState().gitStatus.files[tab.path]?.status;
    if (status === 'untracked' || status === 'added' || status === 'ignored') {
      tab.decorations = tab.model.deltaDecorations(tab.decorations, []);
      return;
    }
    try {
      const changes = await gitApi.changes(tab.path, tab.model.getValue());
      if (!this.tabs.has(tab.key)) return;
      const colors: Record<string, string> = { added: '#549159', modified: '#3d7fb8', deleted: '#6c707e' };
      tab.decorations = tab.model.deltaDecorations(tab.decorations, changes.map((c: any) => ({ range: new this.monaco.Range(c.start, 1, c.end, 1), options: { linesDecorationsClassName: 'gutter-' + c.type, overviewRuler: { color: colors[c.type], position: this.monaco.editor.OverviewRulerLane.Left } } })));
    } catch {}
  }

  revealLine(line: number, col = 1) {
    if (!this.editor.getModel()) return;
    this.noteLocation();
    this.editor.setPosition({ lineNumber: line, column: col || 1 });
    this.editor.revealLineInCenterIfOutsideViewport(line, this.monaco.editor.ScrollType.Smooth);
    this.editor.focus();
    const ids = this.editor.deltaDecorations([], [{ range: new this.monaco.Range(line, 1, line, 1), options: { isWholeLine: true, className: 'line-highlight-flash' } }]);
    setTimeout(() => this.editor.deltaDecorations(ids, []), 900);
  }

  async openDiff(path: string, opts: DiffOptions = {}) {
    const key = opts.key || 'diff:' + path;
    if (this.tabs.has(key)) return this.activate(key);
    const monaco = this.monaco;
    let original: Monaco.editor.ITextModel, model: Monaco.editor.ITextModel, labels: { left: string; right: string }, readOnly = false, ownsModel = false;
    if (opts.before || opts.after) {
      original = monaco.editor.createModel(opts.before?.content ?? '', languageFor(path));
      model = monaco.editor.createModel(opts.after?.content ?? '', languageFor(path));
      labels = { left: opts.before?.label || '', right: opts.after?.label || '' };
      readOnly = opts.after?.readOnly !== false;
      ownsModel = true;
    } else {
      const head = (await gitApi.head(path).catch(() => ({ content: null }))).content;
      const fileTab = this.tabs.get(path);
      if (fileTab) model = fileTab.model;
      else {
        const content = (await fsApi.read(path).catch(() => ({ content: '' }))).content;
        const uri = monaco.Uri.file('/' + path);
        model = monaco.editor.getModel(uri) || monaco.editor.createModel(content, languageFor(path), uri);
      }
      original = monaco.editor.createModel(head ?? '', languageFor(path));
      const headShort = useStore.getState().gitStatus.head;
      labels = { left: headShort ? `${headShort} ${path}` : path, right: 'Current version' };
    }
    const tab: Tab = { key, path, kind: 'diff', model, original, dirty: false, preview: false, savedVersion: 0, saving: false, decorations: [], blame: null, blameDecorations: [], labels, readOnly, ownsModel, title: opts.title, save: debounce(() => undefined, 0), gutter: debounce(() => undefined, 0) };
    this.tabs.set(key, tab);
    this.activate(key);
  }

  diffCount(): number {
    return (this.diffEditor.getLineChanges() || []).length;
  }

  async toggleBlame(tab: Tab | null = this.active) {
    if (!tab || tab.kind !== 'file') return;
    if (tab.blame) {
      tab.blameDecorations = tab.model.deltaDecorations(tab.blameDecorations, []);
      tab.blame = null;
      return this.notify();
    }
    if (!useStore.getState().gitStatus.repo) return toast('Not a Git repository', '', 'info');
    try {
      tab.blame = await gitApi.blame(tab.path);
    } catch (err: any) {
      return toast('Annotate failed', err.message, 'error');
    }
    this.renderBlame(tab);
    tab.blameRefresh = debounce(async () => {
      if (!tab.blame) return;
      tab.blame = await gitApi.blame(tab.path).catch(() => tab.blame);
      this.renderBlame(tab);
    }, 800);
    this.notify();
  }

  private renderBlame(tab: Tab) {
    const lines = tab.blame!;
    const label = (l: any) => (l.uncommitted ? 'Not committed yet' : `${l.author} ${shortAgo(l.time)}`);
    const width = Math.min(28, Math.max(10, ...lines.map((l: any) => label(l).length)));
    let prev: any = null;
    const decos = lines.map((l: any, i: number) => {
      const text = prev && prev.hash === l.hash ? '' : label(l);
      prev = l;
      return { range: new this.monaco.Range(i + 1, 1, i + 1, 1), options: { showIfCollapsed: true, before: { content: text.padEnd(width, ' '), inlineClassName: `blame-inline${l.uncommitted ? ' uncommitted' : ''}`, cursorStops: this.monaco.editor.InjectedTextCursorStops.None }, hoverMessage: l.uncommitted ? { value: 'Not committed yet' } : { value: `**${l.short}** ${l.summary}\n\n${l.author} · ${new Date(l.time).toLocaleString()}` } } };
    });
    tab.blameDecorations = tab.model.deltaDecorations(tab.blameDecorations, decos);
  }

  noteLocation(soft = false) {
    if (this.navigating || !this.active || this.active.kind !== 'file') return;
    const pos = this.editor.getPosition();
    if (!pos) return;
    const loc = { path: this.active.path, line: pos.lineNumber, col: pos.column };
    const last = this.navHistory[this.navIndex];
    if (last && last.path === loc.path && Math.abs(last.line - loc.line) < 10) {
      if (soft) Object.assign(last, { line: loc.line, col: loc.col });
      return;
    }
    this.navHistory.splice(this.navIndex + 1);
    this.navHistory.push(loc);
    if (this.navHistory.length > 100) this.navHistory.shift();
    this.navIndex = this.navHistory.length - 1;
  }

  async navigate(dir: 1 | -1) {
    const target = this.navHistory[this.navIndex + dir];
    if (!target) return;
    this.navIndex += dir;
    this.navigating = true;
    try {
      await this.openFile(target.path, { line: target.line, col: target.col, preview: false });
    } finally {
      this.navigating = false;
    }
  }

  runCommandForActive(): string | null {
    if (!this.active || this.active.kind !== 'file') return null;
    const ext = extname(this.active.path);
    const quoted = JSON.stringify(this.active.path);
    if (['js', 'mjs', 'cjs'].includes(ext)) return `node ${quoted}`;
    if (ext === 'ts') return `npx tsx ${quoted}`;
    if (['php', 'phtml'].includes(ext)) return `php ${quoted}`;
    if (['py', 'pyw'].includes(ext)) return `${JSON.stringify(useStore.getState().project?.python?.interpreter || 'python3')} ${quoted}`;
    if (['sh', 'bash', 'zsh'].includes(ext)) return `bash ${quoted}`;
    return null;
  }

  currentWord(): string | null {
    const model = this.editor.getModel();
    const pos = this.editor.getPosition();
    return model && pos ? model.getWordAtPosition(pos)?.word || null : null;
  }

  selectedText(): string {
    const sel = this.editor.getSelection();
    return sel && !sel.isEmpty() ? this.editor.getModel()!.getValueInRange(sel) : '';
  }

  trigger(command: string) {
    this.editor.trigger('ide', command, null);
  }
}

export const editorManager = new EditorManager();
