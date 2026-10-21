'use client';

import { useEffect, useReducer, useRef, useState } from 'react';
import { loader } from '@monaco-editor/react';
import type * as Monaco from 'monaco-editor';
import { fsApi, gitApi } from '@/lib/api';
import { useStore } from '@/lib/store';
import { toast } from '@/components/ui/Toasts';
import { DialogFrame, openDialog } from '@/components/ui/dialogs';
import { Icon } from '@/components/ui/Icon';
import { THEME_NAME, languageFor } from '@/editor/theme';
import { buildMergeModel, shiftHunks, isHunkPending, type Hunk, type MergeModel, type Part } from '@/editor/merge-hunks';
import { GutterChips } from './md-gutter';
import { refreshGitStatus } from '@/components/git/git-status';

type Side = 'modified' | 'added' | 'deleted';
interface MergeState {
  operation: string | null;
  ours: string | null;
  theirs: string | null;
  files: { path: string; ours: Side; theirs: Side }[];
}

async function fetchMergeState(): Promise<MergeState | null> {
  try {
    return await gitApi.mergeState();
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Conflicts list — JetBrains' first dialog: file table + quick resolve */
/* ------------------------------------------------------------------ */

function ConflictsListView({ close }: { close: () => void }) {
  const [state, setState] = useState<MergeState | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = async () => {
    const s = await fetchMergeState();
    setState(s);
    if (s && !s.files.some((f) => f.path === selected)) setSelected(s.files[0]?.path ?? null);
    return s;
  };
  useEffect(() => {
    refresh();
  }, []);
  const rows = state?.files ?? [];
  const sel = rows.find((f) => f.path === selected) ?? null;
  const label = (s: Side) => s[0].toUpperCase() + s.slice(1);
  const resolveWhole = async (strategy: 'ours' | 'theirs') => {
    if (!sel || busy) return;
    setBusy(true);
    try {
      await gitApi.resolveConflict(sel.path, strategy);
      refreshGitStatus();
      toast('Resolved', `${sel.path} — took ${strategy === 'ours' ? state?.ours || 'yours' : state?.theirs || 'theirs'}`, 'success');
      const s = await refresh();
      if (!s?.files.length) close();
    } catch (err: any) {
      toast('Resolve failed', err.message, 'error');
    } finally {
      setBusy(false);
    }
  };
  const merge = () => {
    if (!sel) return;
    close(); // the 3-pane replaces the list, JetBrains-style
    openMergeRevisions(sel.path);
  };
  return (
    <DialogFrame
      title="Conflicts"
      width={560}
      onClose={close}
      footer={
        <>
          <button className="btn" onClick={() => close()}>Close</button>
          <span className="dlg-hint" style={{ marginLeft: 'auto' }}>{rows.length} file{rows.length === 1 ? '' : 's'} with conflicts</span>
          <button className="btn" disabled={!sel || busy} onClick={() => resolveWhole('ours')}>Accept Yours</button>
          <button className="btn" disabled={!sel || busy} onClick={() => resolveWhole('theirs')}>Accept Theirs</button>
          <button className="btn primary" disabled={!sel} onClick={merge}>Merge…</button>
        </>
      }
    >
      <div className="mc-list">
        <div className="mc-list-sub">
          {state?.operation === 'merge' && state.theirs ? <>Merging branch <strong>{state.theirs}</strong> into branch <strong>{state.ours}</strong></> : state?.operation ? <strong style={{ textTransform: 'capitalize' }}>{state.operation}</strong> : 'Unresolved conflicts'}
        </div>
        <div className="mc-list-table">
          <div className="mc-list-head">
            <span>Name</span>
            <span>Yours{state?.ours ? ` (${state.ours})` : ''}</span>
            <span>Theirs{state?.theirs ? ` (${state.theirs})` : ''}</span>
          </div>
          {rows.map((f) => (
            <button key={f.path} className={`mc-list-row${f.path === selected ? ' sel' : ''}`} onClick={() => { setSelected(f.path); merge(); }} onDoubleClick={merge}>
              <span className="mc-name"><Icon name="edit" />{f.path}</span>
              <span className={`mc-side ${f.ours}`}>{label(f.ours)}</span>
              <span className={`mc-side ${f.theirs}`}>{label(f.theirs)}</span>
            </button>
          ))}
          {!rows.length && <div className="mc-empty">Loading…</div>}
        </div>
      </div>
    </DialogFrame>
  );
}

/* ------------------------------------------------------------------ */
/* Merge revisions — IntelliJ's per-part model: every side of a change  */
/* is applied/ignored independently (model.resolveChange/ignoreChange). */
/* ------------------------------------------------------------------ */

interface MergeData {
  base: string | null;
  ours: string | null;
  theirs: string | null;
}

function Pane({ label, side, hostRef }: { label: string; side: string; hostRef: React.RefObject<HTMLDivElement | null> }) {
  return (
    <div className={`md-pane md-${side}`}>
      <div className="md-pane-label">{label}</div>
      <div ref={hostRef} className="md-editor" />
    </div>
  );
}

function MergeRevisionsView({ path, branches, close }: { path: string; branches: { ours: string | null; theirs: string | null }; close: () => void }) {
  const [data, setData] = useState<MergeData | null>(null);
  const [manual, setManual] = useState(false);
  const [, force] = useReducer((x: number) => x + 1, 0);
  const leftRef = useRef<HTMLDivElement>(null);
  const midRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const editors = useRef<{ monaco: typeof Monaco; all: Monaco.editor.IStandaloneCodeEditor[]; mid?: Monaco.editor.IStandaloneCodeEditor; left?: Monaco.editor.IStandaloneCodeEditor; right?: Monaco.editor.IStandaloneCodeEditor } | null>(null);
  const model_ = useRef<MergeModel | null>(null);
  const midDecos = useRef<string[]>([]);
  const leftDecos = useRef<string[]>([]);
  const rightDecos = useRef<string[]>([]);
  const gutters = useRef<{ midLeft?: GutterChips; midRight?: GutterChips }>({});
  const applying = useRef(false);
  /**
   * Ctrl+Z history: Monaco's own undo only restores text, not the per-part
   * model — every merge action snapshots (hunks + text) so undo/redo can
   * restore both together, like the IntelliJ merge dialog.
   */
  const undoStack = useRef<{ hunks: string; text: string }[]>([]);
  const redoStack = useRef<{ hunks: string; text: string }[]>([]);
  const [, forceHistory] = useReducer((x: number) => x + 1, 0);

  const pushSnapshot = () => {
    const mid = editors.current?.mid;
    if (!mid || !model_.current) return;
    undoStack.current.push({ hunks: JSON.stringify(model_.current.hunks), text: mid.getModel()!.getValue() });
    if (undoStack.current.length > 100) undoStack.current.shift();
    redoStack.current = [];
  };

  const restore = (snap: { hunks: string; text: string }) => {
    const mid = editors.current?.mid;
    if (!mid || !model_.current) return;
    model_.current.hunks = JSON.parse(snap.hunks);
    applying.current = true;
    try {
      mid.getModel().setValue(snap.text);
    } finally {
      applying.current = false;
    }
    paint();
  };

  const undo = () => {
    const snap = undoStack.current.pop();
    if (!snap) return;
    const mid = editors.current!.mid!;
    redoStack.current.push({ hunks: JSON.stringify(model_.current!.hunks), text: mid.getModel()!.getValue() });
    restore(snap);
    forceHistory();
    mid.focus();
  };

  const redo = () => {
    const snap = redoStack.current.pop();
    if (!snap) return;
    const mid = editors.current!.mid!;
    undoStack.current.push({ hunks: JSON.stringify(model_.current!.hunks), text: mid.getModel()!.getValue() });
    restore(snap);
    forceHistory();
    mid.focus();
  };

  useEffect(() => {
    let disposed = false;
    gitApi.mergeView(path).then((d) => !disposed && setData(d)).catch((err) => {
      toast('Merge view failed', err.message, 'error');
      close();
    });
    return () => {
      disposed = true;
    };
  }, [path]);

  const clearWidgets = () => {
    for (const g of Object.values(gutters.current)) g?.clear();
  };

  /** JetBrains-style broad arrow chips (SVG glyphs, wide rounded buttons). */
  const ICONS: Record<string, string> = {
    '»': '<svg viewBox="0 0 18 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 1.5L9 6l-5 4.5"/><path d="M10 1.5L15 6l-5 4.5"/></svg>',
    '«': '<svg viewBox="0 0 18 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 1.5L9 6l5 4.5"/><path d="M8 1.5L3 6l5 4.5"/></svg>',
    '✕': '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7"/></svg>',
  };

  const chip = (glyph: string, title: string, fn: () => void, tone: 'blue' | 'orange' | 'gray') => {
    const b = document.createElement('button');
    b.className = 'md-chip ' + tone;
    b.title = title;
    b.innerHTML = ICONS[glyph] ?? glyph;
    b.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      fn();
    };
    return b;
  };

  const mkDeco = (monaco: typeof Monaco, a: number, b: number, cls: string, color: string) => ({
    range: new monaco.Range(a, 1, b, 1),
    options: { isWholeLine: true, className: cls, overviewRuler: { color, position: monaco.editor.OverviewRulerLane.Right } },
  });

  const hunkOf = (mm: MergeModel, part: Part) => mm.hunks.find((h) => h.parts.includes(part));

  const paint = () => {
    const ctx = editors.current;
    const mm = model_.current;
    if (!ctx?.mid || !mm) return;
    const { monaco, mid } = ctx;
    clearWidgets();
    const model = mid.getModel()!;
    const decos: any[] = [];
    for (const h of mm.hunks) {
      for (const p of h.parts) {
        if (p.state !== 'pending') continue;
        if (h.conflict) decos.push(mkDeco(monaco, p.start, p.end, p.side === 'left' ? 'mc-cf-l' : 'mc-cf-r', '#e0873d'));
        else decos.push(mkDeco(monaco, p.start, p.end, 'mc-pend', '#548af7'));
      }
    }
    midDecos.current = model.deltaDecorations(midDecos.current, decos);
    const left = ctx.left, right = ctx.right;
    const leftDs: any[] = [];
    for (const c of mm.leftChanges) leftDs.push(mkDeco(monaco, c.bStart, Math.max(c.bStart, c.bEnd), c.conflict ? 'mc-side-cf' : 'mc-side-ok', c.conflict ? '#e0873d' : '#548af7'));
    if (left?.getModel()) leftDecos.current = left.getModel()!.deltaDecorations(leftDecos.current, leftDs);
    const rightDs: any[] = [];
    for (const c of mm.rightChanges) rightDs.push(mkDeco(monaco, c.bStart, Math.max(c.bStart, c.bEnd), c.conflict ? 'mc-side-cf' : 'mc-side-ok', c.conflict ? '#e0873d' : '#548af7'));
    if (right?.getModel()) rightDecos.current = right.getModel()!.deltaDecorations(rightDecos.current, rightDs);

    // JetBrains layout: BOTH icon columns flank the Result pane — left-side
    // changes get »/✕ in the Result's LEFT gutter, right-side changes get
    // «/✕ in its RIGHT gutter. The two side panes show colors only.
    for (const h of mm.hunks) {
      for (const p of h.parts) {
        const tone = h.conflict ? 'orange' : 'blue';
        const applyChip = chip(p.side === 'left' ? '»' : '«', `Apply changes from the ${p.side} side${h.conflict ? ' (the other side stays for you to decide)' : ''}`, () => applyPart(h, p), tone);
        const cluster = p.side === 'left' ? [applyChip, chip('✕', `Ignore changes from the left side`, () => ignorePart(h, p), 'gray')] : [chip('✕', `Ignore changes from the right side`, () => ignorePart(h, p), 'gray'), applyChip];
        if (p.state === 'pending') {
          (p.side === 'left' ? gutters.current.midLeft : gutters.current.midRight)?.add(p.start, cluster);
        } else {
          // Applied → revert ✕ in the same gutter.
          (p.side === 'left' ? gutters.current.midLeft : gutters.current.midRight)?.add(p.start, [chip('✕', 'Revert conflict resolution', () => {
            if (isHunkPending(h)) p.state = 'pending';
            else resetHunk(h);
            paint();
          }, 'gray')]);
        }
      }
    }
    force();
  };

  /** Delete Result lines [s..e] newline-safely and shift other hunks. */
  const deleteLines = (s: number, e: number, exceptId?: number) => {
    const mid = editors.current!.mid!;
    const model = mid.getModel()!;
    const count = model.getLineCount();
    let range: Monaco.Range;
    if (e < count) range = new editors.current!.monaco.Range(s, 1, e + 1, 1);
    else if (s > 1) range = new editors.current!.monaco.Range(s - 1, model.getLineMaxColumn(s - 1), e, model.getLineMaxColumn(e));
    else range = new editors.current!.monaco.Range(1, 1, 1, model.getLineMaxColumn(1));
    applying.current = true;
    try {
      mid.executeEdits('merge', [{ range, text: '' }]);
    } finally {
      applying.current = false;
    }
    shiftHunks(model_.current!.hunks, s, e - s + 1, exceptId);
  };

  const withEditor = (fn: () => void) => {
    fn();
    paint();
    editors.current?.mid?.focus();
  };

  /** model.resolveChange(side): keep this part's lines in the result. */
  const applyPart = (h: Hunk, p: Part) => {
    if (p.state !== 'pending') return;
    withEditor(() => {
      p.state = 'applied';
    });
  };

  /** model.ignoreChange(side): drop this part's lines. */
  const ignorePart = (h: Hunk, p: Part) => {
    if (p.state !== 'pending') return;
    withEditor(() => {
      const len = p.end - p.start + 1;
      deleteLines(p.start, p.end, h.id);
      for (const q of h.parts) if (q !== p && q.start > p.start) {
        q.start -= len;
        q.end -= len;
      }
      if (h.end >= p.start) h.end -= len;
      p.state = 'ignored';
      // IntelliJ: ignoring BOTH sides of a change leaves the base version.
      const anyApplied = h.parts.some((q) => q.state === 'applied');
      const anyPending = h.parts.some((q) => q.state === 'pending');
      if (!anyApplied && !anyPending && h.baseLines.length) {
        const mid = editors.current!.mid!;
        applying.current = true;
        try {
          const at = Math.min(h.start, mid.getModel()!.getLineCount() || 1);
          mid.executeEdits('merge', [{ range: new editors.current!.monaco.Range(at, 1, at, 1), text: h.baseLines.join('\n') + '\n' }]);
        } finally {
          applying.current = false;
        }
        shiftHunks(model_.current!.hunks, h.start, -h.baseLines.length, h.id);
        h.end = h.start + h.baseLines.length - 1;
      }
    });
  };

  /** model.resetResolvedChange: the whole change goes back to pending. */
  const resetHunk = (h: Hunk) => {
    if (isHunkPending(h)) return;
    withEditor(() => {
      const mid = editors.current!.mid!;
      const model = mid.getModel()!;
      const all = h.parts.flatMap((p) => p.lines);
      applying.current = true;
      try {
        if (h.end >= h.start) {
          mid.executeEdits('merge', [{ range: new editors.current!.monaco.Range(h.start, 1, h.end, model.getLineMaxColumn(h.end)), text: all.join('\n') }]);
        } else {
          // Nothing left of the block — re-insert it before the current line.
          const at = Math.min(h.start, model.getLineCount() || 1);
          mid.executeEdits('merge', [{ range: new editors.current!.monaco.Range(at, 1, at, 1), text: all.join('\n') + (all.length ? '\n' : '') }]);
        }
      } finally {
        applying.current = false;
      }
      const delta = all.length - Math.max(0, h.end - h.start + 1);
      shiftHunks(model_.current!.hunks, h.start, -delta, h.id);
      let line = h.start;
      for (const p of h.parts) {
        p.start = line;
        p.end = line + p.lines.length - 1;
        line += p.lines.length;
        p.state = 'pending';
      }
      h.end = line - 1;
    });
  };

  useEffect(() => {
    if (!data || !midRef.current || !leftRef.current || !rightRef.current) return;
    let cancelled = false;
    loader.init().then((monacoAny) => {
      if (cancelled) return;
      const monaco = monacoAny as typeof Monaco;
      const mk = (el: HTMLDivElement, value: string, readOnly: boolean) =>
        monaco.editor.create(el, {
          value, readOnly, theme: THEME_NAME, language: languageFor(path), automaticLayout: true, fontSize: 12.5, lineHeight: 19,
          minimap: { enabled: false }, scrollBeyondLastLine: false, renderLineHighlight: 'none', wordWrap: 'off', folding: false, overviewRulerLanes: 2, scrollbar: { alwaysConsumeMouseWheel: false },
        });
      const left = mk(leftRef.current!, data.ours ?? '', true);
      const right = mk(rightRef.current!, data.theirs ?? '', true);
      // Center starts from the common base (IntelliJ: "initially, the contents
      // of this pane are the same as the base revision").
      const mm = buildMergeModel((data.base ?? '').split('\n'), (data.ours ?? '').split('\n'), (data.theirs ?? '').split('\n'));
      model_.current = mm;
      const mid = mk(midRef.current!, mm.resultLines.join('\n'), false);
      editors.current = { monaco, all: [left, right, mid], mid, left, right };
      gutters.current = { midLeft: new GutterChips(mid, 'left'), midRight: new GutterChips(mid, 'right') };
      mid.onDidChangeModelContent(() => {
        if (applying.current) return;
        if (!manual) {
          setManual(true);
          clearWidgets();
          midDecos.current = mid.getModel()!.deltaDecorations(midDecos.current, []);
        }
      });
      paint();
    });
    return () => {
      cancelled = true;
      clearWidgets();
      for (const g of Object.values(gutters.current)) g?.dispose();
      gutters.current = {};
      for (const e of editors.current?.all ?? []) e.dispose();
      editors.current = null;
      model_.current = null;
    };
  }, [data]);

  const hunks = model_.current?.hunks ?? [];
  const pendingParts = hunks.flatMap((h) => h.parts.filter((p) => p.state === 'pending').map((p) => ({ h, p })));
  const pendingConflicts = hunks.filter((h) => h.conflict && isHunkPending(h));
  const simplePending = pendingParts.filter(({ h }) => !h.conflict);
  const changes = hunks.length;
  const conflictsLeft = pendingConflicts.length;

  /** ApplyNonConflictsAction(BASE) — the magic wand. */
  const magicSolve = () => {
    for (const { p } of simplePending) p.state = 'applied';
    paint();
    editors.current?.mid?.focus();
  };

  /** ApplyNonConflictsAction(LEFT/RIGHT) — only non-conflicting changes from one side. */
  const applySideSimple = (side: 'left' | 'right') => {
    for (const { h, p } of simplePending) if (p.side === side) p.state = 'applied';
    paint();
    editors.current?.mid?.focus();
  };

  const gotoPart = (dir: 1 | -1) => {
    const mid = editors.current?.mid;
    if (!mid) return;
    const pending = pendingParts.map(({ p }) => p).sort((a, b) => a.start - b.start);
    if (!pending.length) return;
    const line = mid.getPosition()?.lineNumber ?? 1;
    const target = dir === 1 ? pending.find((p) => p.start > line) ?? pending[0] : [...pending].reverse().find((p) => p.start < line) ?? pending[pending.length - 1];
    mid.setPosition({ lineNumber: target.start, column: 1 });
    mid.revealLinesInCenter(target.start, target.end);
    mid.focus();
  };

  /** "Resolve using Left/Right": apply that side of every pending conflict, ignore the other. */
  const resolveUsingSide = (side: 'left' | 'right') => {
    for (const h of [...pendingConflicts].sort((a, b) => b.start - a.start)) {
      for (const p of [...h.parts].sort((a, b) => b.start - a.start)) {
        if (p.state !== 'pending') continue;
        if (p.side === side) p.state = 'applied';
        else ignorePart(h, p);
      }
    }
    paint();
  };

  const backToList = async () => {
    close();
    const s = await fetchMergeState();
    if (s?.files.length) openMergeConflicts();
  };

  const apply = async () => {
    const mid = editors.current?.mid;
    if (!mid) return;
    // The center pane is literal (IntelliJ semantics): anything still pending
    // is treated as ignored — its lines are dropped from the result.
    for (const { h, p } of [...pendingParts].sort((a, b) => b.p.start - a.p.start)) ignorePart(h, p);
    if (conflictsLeft) {
      force();
      return toast('Unresolved conflicts', `Resolve every conflict first (${conflictsLeft} left)`, 'error');
    }
    const content = mid.getModel()!.getValue();
    try {
      await fsApi.write(path, content);
      await gitApi.stage([path]);
      refreshGitStatus();
      const s = await fetchMergeState();
      const remaining = s?.files ?? [];
      close();
      if (remaining.length) {
        toast('Resolved', `${path} merged — ${remaining.length} file${remaining.length > 1 ? 's' : ''} left`, 'success');
        openMergeConflicts();
      } else {
        toast('All changes processed', 'Every conflicted file has been merged and staged — complete the merge from the toolbar', 'success');
      }
    } catch (err: any) {
      toast('Apply failed', err.message, 'error');
    }
  };

  return (
    <DialogFrame
      title={`Merge Revisions for ${path}`}
      width={1150}
      onClose={backToList}
      footer={
        <>
          <button className="btn" onClick={backToList}>Cancel</button>
          <span className="dlg-hint" style={{ marginLeft: 0, marginRight: 'auto' }}>
            {manual ? 'Manually edited' : `${changes} change${changes === 1 ? '' : 's'}. ${conflictsLeft} conflict${conflictsLeft === 1 ? '' : 's'}`}
          </span>
          <button className="btn" onClick={() => resolveUsingSide('left')}>Accept Left</button>
          <button className="btn" onClick={() => resolveUsingSide('right')}>Accept Right</button>
          <button className="btn primary" onClick={apply}>Apply</button>
        </>
      }
    >
      <div className="md-toolbar">
        <button title="Previous change" onClick={() => gotoPart(-1)}><Icon name="up" /></button>
        <button title="Next change" onClick={() => gotoPart(1)}><Icon name="down" /></button>
        <span className="md-count">{manual ? 'Manually edited' : `${changes} change${changes === 1 ? '' : 's'}. ${conflictsLeft} conflict${conflictsLeft === 1 ? '' : 's'}`}</span>
        <span className="mb-sep" />
        <button className="md-magic" disabled={!simplePending.length} title={`Apply All Non-Conflicting Changes (${simplePending.length})`} onClick={magicSolve}>
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><path d="M3 13L11 5" /><path d="M9.5 3.5l1 1M12.5 2.5l1 1M13.5 6.5l-1-1M12 11.5l1.5 1.5" /></svg>
          <span>Apply All Non-Conflicting Changes</span>
          {simplePending.length > 0 && <b>{simplePending.length}</b>}
        </button>
        <button title="Apply Non-Conflicting Changes from the Left Side" onClick={() => applySideSimple('left')}>«</button>
        <button title="Apply Non-Conflicting Changes from the Right Side" onClick={() => applySideSimple('right')}>»</button>
      </div>
      <div className="merge-dialog">
        <Pane label={`Changes from ${branches.ours || 'yours'}`} side="left" hostRef={leftRef} />
        <div className="md-pane md-mid">
          <div className="md-pane-label"><span>Result</span></div>
          <div ref={midRef} className="md-editor" />
        </div>
        <Pane label={`Changes from ${branches.theirs || 'theirs'}`} side="right" hostRef={rightRef} />
      </div>
    </DialogFrame>
  );
}

/* ------------------------------------------------------------------ */
/* Entry points                                                         */
/* ------------------------------------------------------------------ */

export async function openMergeConflicts() {
  const s = await fetchMergeState();
  if (!s) return toast('Cannot list conflicts', 'Backend did not answer merge-state', 'error');
  if (!s.files.length) return toast('No conflicts', 'This repository has no unresolved conflicts', 'info');
  openDialog((close) => <ConflictsListView close={() => close()} />);
}

export async function openMergeRevisions(path: string) {
  const s = await fetchMergeState();
  openDialog((close) => <MergeRevisionsView path={path} branches={{ ours: s?.ours ?? null, theirs: s?.theirs ?? null }} close={() => close()} />);
}

let conflictsWereOpen = false;
if (typeof window !== 'undefined') {
  // Like JetBrains, pop the conflicts list the moment a merge produces conflicts.
  // prev.repo guard: skip the initial gitStatus load after a page reload.
  useStore.subscribe((s, prev) => {
    const now = Object.values(s.gitStatus.files).filter((f: any) => f.status === 'conflict').length;
    const before = Object.values(prev.gitStatus.files).filter((f: any) => f.status === 'conflict').length;
    if (now > 0 && before === 0 && prev.gitStatus.repo && !conflictsWereOpen) {
      conflictsWereOpen = true;
      openMergeConflicts();
    } else if (now === 0) {
      conflictsWereOpen = false;
    }
  });
}
