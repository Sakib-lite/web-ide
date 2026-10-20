import type * as Monaco from 'monaco-editor';

export interface ConflictBlock {
  start: number;
  baseSep: number | null;
  mid: number;
  end: number;
}

export interface ConflictState {
  path: string;
  conflicts: ConflictBlock[];
}

type Listener = (state: ConflictState | null) => void;

const listeners = new Set<Listener>();

export function onConflicts(listener: Listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const START = /^<{7} ?(.*)$/;
const BASE = /^\|{7}/;
const MID = /^={7}$/;
const END = /^>{7} ?(.*)$/;

export function parseConflicts(lines: string[]): ConflictBlock[] {
  const blocks: ConflictBlock[] = [];
  let cur: ConflictBlock | null = null;
  lines.forEach((line, i) => {
    const n = i + 1;
    if (START.test(line)) cur = { start: n, baseSep: null, mid: 0, end: 0 };
    else if (cur && BASE.test(line) && !cur.mid) cur.baseSep = n;
    else if (cur && MID.test(line) && !cur.mid) cur.mid = n;
    else if (cur && END.test(line) && cur.mid) {
      cur.end = n;
      blocks.push(cur);
      cur = null;
    }
  });
  return blocks;
}

export function registerMergeConflicts(monaco: typeof Monaco, editor: Monaco.editor.IStandaloneCodeEditor) {
  mergeEditorRef.current = editor;
  let decorations: string[] = [];
  let widgets: Monaco.editor.IContentWidget[] = [];
  let state: ConflictState | null = null;
  let scanTimer: ReturnType<typeof setTimeout> | null = null;

  const pathOf = (model: Monaco.editor.ITextModel | null) => (model ? model.uri.path.replace(/^\//, '') : null);

  const clearAll = () => {
    for (const w of widgets) editor.removeContentWidget(w);
    widgets = [];
    const model = editor.getModel();
    if (model) decorations = model.deltaDecorations(decorations, []);
    lastState = null;
    if (state) {
      state = null;
      for (const l of listeners) l(null);
    }
  };

  const button = (label: string, title: string, onClick: () => void) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.title = title;
    b.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      onClick();
    };
    return b;
  };

  const apply = (block: ConflictBlock, strategy: 'ours' | 'theirs' | 'both') => {
    const model = editor.getModel();
    if (!model) return;
    const lines = model.getLinesContent();
    const ours = lines.slice(block.start, block.mid - 1);
    const theirsStart = (block.baseSep ?? block.mid) + 1;
    const theirs = lines.slice(theirsStart - 1, block.end - 1);
    const chosen = strategy === 'ours' ? ours : strategy === 'theirs' ? theirs : [...ours, ...theirs];
    const text = chosen.length ? chosen.join('\n') : '';
    editor.executeEdits('merge-resolve', [
      { range: new monaco.Range(block.start, 1, block.end, model.getLineMaxColumn(block.end)), text },
    ]);
    editor.focus();
  };

  const render = () => {
    const model = editor.getModel();
    const path = pathOf(model);
    clearAll();
    if (!model || !path) return;
    const lines = model.getLinesContent();
    if (!lines.some((l) => START.test(l))) return;
    const conflicts = parseConflicts(lines);
    if (!conflicts.length) return;
    state = { path, conflicts };
    lastState = state;
    const mk = (startLine: number, endLine: number, className: string) => ({
      range: new monaco.Range(startLine, 1, endLine, 1),
      options: { isWholeLine: true, className, linesDecorationsClassName: 'mc-gutter', overviewRuler: { color: '#e0533d', position: monaco.editor.OverviewRulerLane.Right } },
    });
    const decos: any[] = [];
    for (const c of conflicts) {
      decos.push(mk(c.start, c.end, 'mc-block'));
      decos.push(mk(c.start, c.mid - 1, 'mc-ours'));
      if (c.baseSep) decos.push(mk(c.baseSep, c.baseSep, 'mc-base'));
      decos.push(mk(c.mid, c.mid, 'mc-base'));
      decos.push(mk((c.baseSep ?? c.mid) + 1, c.end - 1, 'mc-theirs'));
      const oursLabel = lines[c.start - 1].replace(START, '$1').trim() || 'yours';
      const theirsLabel = lines[c.end - 1].replace(END, '$1').trim() || 'theirs';
      const bar = document.createElement('div');
      bar.className = 'mc-actions';
      bar.append(
        button(`Accept ${oursLabel}`, `Keep your version of this conflict`, () => apply(c, 'ours')),
        button('Accept Both', 'Keep both versions', () => apply(c, 'both')),
        button(`Accept ${theirsLabel}`, `Keep the incoming version of this conflict`, () => apply(c, 'theirs')),
      );
      const widget: Monaco.editor.IContentWidget = {
        getId: () => 'merge-actions-' + c.start,
        getDomNode: () => bar,
        getPosition: () => ({ position: { lineNumber: c.start, column: 1 }, preference: [monaco.editor.ContentWidgetPositionPreference.EXACT] }),
      };
      editor.addContentWidget(widget);
      widgets.push(widget);
    }
    decorations = model.deltaDecorations(decorations, decos);
    for (const l of listeners) l(state);
  };

  const schedule = () => {
    if (scanTimer) clearTimeout(scanTimer);
    scanTimer = setTimeout(render, 200);
  };

  editor.onDidChangeModel(() => {
    decorations = [];
    widgets = [];
    render();
  });
  editor.onDidChangeModelContent(schedule);

  editor.addAction({
    id: 'merge.nextConflict',
    label: 'Merge Conflicts: Go to Next Conflict',
    keybindings: [monaco.KeyCode.F8],
    contextMenuGroupId: 'merge',
    contextMenuOrder: 1,
    run: () => gotoConflict(1),
  });
  editor.addAction({
    id: 'merge.prevConflict',
    label: 'Merge Conflicts: Go to Previous Conflict',
    keybindings: [monaco.KeyMod.Shift | monaco.KeyCode.F8],
    contextMenuGroupId: 'merge',
    contextMenuOrder: 2,
    run: () => gotoConflict(-1),
  });
}

export const mergeEditorRef: { current: Monaco.editor.IStandaloneCodeEditor | null } = { current: null };

let lastState: ConflictState | null = null;

export function currentConflicts(): ConflictState | null {
  return lastState;
}

function gotoConflict(dir: 1 | -1) {
  const editor = mergeEditorRef.current;
  if (!editor || !lastState?.conflicts.length) return;
  const line = editor.getPosition()?.lineNumber ?? 1;
  const sorted = [...lastState.conflicts].sort((a, b) => a.start - b.start);
  const target =
    dir === 1
      ? sorted.find((c) => c.start > line) ?? sorted[0]
      : [...sorted].reverse().find((c) => c.start < line) ?? sorted[sorted.length - 1];
  editor.setPosition({ lineNumber: target.start, column: 1 });
  editor.revealLinesInCenter(target.start, target.end);
  editor.focus();
}

export { gotoConflict };
