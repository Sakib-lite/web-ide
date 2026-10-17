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
import { buildMergeModel, shiftHunks, type Hunk, type MergeModel } from '@/editor/merge-hunks';
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

interface MergeData {
  base: string | null;
  ours: string | null;
  theirs: string | null;
}

type Choice = 'left' | 'right' | 'both' | 'none';

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
  const widgets = useRef<Monaco.editor.IContentWidget[]>([]);
  const applying = useRef(false);

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
    const mid = editors.current?.mid;
    if (mid) for (const w of widgets.current) mid.removeContentWidget(w);
    widgets.current = [];
  };

  const mkDeco = (monaco: typeof Monaco, a: number, b: number, cls: string, color: string) => ({
    range: new monaco.Range(a, 1, b, 1),
    options: { isWholeLine: true, className: cls, overviewRuler: { color, position: monaco.editor.OverviewRulerLane.Right } },
  });

  const paint = () => {
    const ctx = editors.current;
    const mm = model_.current;
    if (!ctx?.mid || !mm) return;
    const { monaco, mid } = ctx;
    clearWidgets();
    const model = mid.getModel()!;
    const decos: any[] = [];
    for (const h of mm.hunks) {
      if (h.state !== 'pending') continue;
      decos.push(mkDeco(monaco, h.start, h.end, 'mc-block', h.conflict ? '#e0873d' : '#548af7'));
      if (h.conflict) {
        for (const p of h.parts) decos.push(mkDeco(monaco, p.start, p.end, p.side === 'left' ? 'mc-cf-l' : 'mc-cf-r', '#e0873d'));
      } else {
        decos.push(mkDeco(monaco, h.start, h.end, 'mc-pend', '#548af7'));
      }
      const bar = document.createElement('div');
      bar.className = 'mc-actions';
      const btn = (glyph: string, title: string, fn: () => void) => {
        const b = document.createElement('button');
        b.textContent = glyph;
        b.title = title;
        b.onclick = (e) => {
          e.preventDefault();
          e.stopPropagation();
          fn();
        };
        return b;
      };
      if (h.conflict) {
        bar.append(
          btn('»', 'Keep your version', () => resolve(h, 'left')),
          btn('«', 'Keep the incoming version', () => resolve(h, 'right')),
          btn('⧉', 'Keep both versions', () => resolve(h, 'both')),
          btn('✕', 'Keep the base version', () => resolve(h, 'none')),
        );
      } else {
        bar.append(
          btn(h.parts[0].side === 'left' ? '»' : '«', 'Apply this change', () => resolve(h, h.parts[0].side)),
          btn('✕', 'Skip this change', () => resolve(h, 'none')),
        );
      }
      const widget: Monaco.editor.IContentWidget = {
        getId: () => 'md-hunk-' + h.id,
        getDomNode: () => bar,
        getPosition: () => ({ position: { lineNumber: h.start, column: 1 }, preference: [monaco.editor.ContentWidgetPositionPreference.EXACT] }),
      };
      mid.addContentWidget(widget);
      widgets.current.push(widget);
    }
    midDecos.current = model.deltaDecorations(midDecos.current, decos);
    const left = ctx.left, right = ctx.right;
    const leftDs: any[] = [];
    for (const c of mm.leftChanges) leftDs.push(mkDeco(monaco, c.bStart, Math.max(c.bStart, c.bEnd), c.conflict ? 'mc-side-cf' : 'mc-side-ok', c.conflict ? '#e0873d' : '#548af7'));
    if (left?.getModel()) leftDecos.current = left.getModel()!.deltaDecorations(leftDecos.current, leftDs);
    const rightDs: any[] = [];
    for (const c of mm.rightChanges) rightDs.push(mkDeco(monaco, c.bStart, Math.max(c.bStart, c.bEnd), c.conflict ? 'mc-side-cf' : 'mc-side-ok', c.conflict ? '#e0873d' : '#548af7'));
    if (right?.getModel()) rightDecos.current = right.getModel()!.deltaDecorations(rightDecos.current, rightDs);
    force();
  };

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

  const resolve = (h: Hunk, choice: Choice) => {
    const mid = editors.current?.mid;
    if (!mid || h.state !== 'pending') return;
    if (choice === 'both' || (choice === 'left' && h.parts.length === 1 && h.parts[0].side === 'left') || (choice === 'right' && h.parts.length === 1 && h.parts[0].side === 'right')) {
      h.state = 'accepted';
    } else {
      const drop = h.parts.filter((p) => (choice === 'left' ? p.side === 'right' : choice === 'right' ? p.side === 'left' : true));
      const keep = h.parts.filter((p) => !drop.includes(p));
      for (const p of [...drop].sort((a, b) => b.start - a.start)) {
        deleteLines(p.start, p.end, h.id);
        const removed = p.end - p.start + 1;
        if (h.end >= p.start) h.end -= removed;
        h.parts = h.parts.filter((x) => x !== p);
      }
      h.state = choice === 'none' ? 'dismissed' : 'accepted';
      void keep;
    }
    paint();
    mid.focus();
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
          minimap: { enabled: false }, scrollBeyondLastLine: false, renderLineHighlight: 'none', wordWrap: 'off', folding: false, overviewRulerLanes: readOnly ? 2 : 2, scrollbar: { alwaysConsumeMouseWheel: false },
        });
      const left = mk(leftRef.current!, data.ours ?? '', true);
      const right = mk(rightRef.current!, data.theirs ?? '', true);
      const mm = buildMergeModel((data.base ?? '').split('\n'), (data.ours ?? '').split('\n'), (data.theirs ?? '').split('\n'));
      model_.current = mm;
      const mid = mk(midRef.current!, mm.resultLines.join('\n'), false);
      editors.current = { monaco, all: [left, right, mid], mid, left, right };
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
      for (const e of editors.current?.all ?? []) e.dispose();
      editors.current = null;
      model_.current = null;
    };
  }, [data]);

  const hunks = model_.current?.hunks ?? [];
  const pendingConflicts = hunks.filter((h) => h.conflict && h.state === 'pending');
  const pendingSimple = hunks.filter((h) => !h.conflict && h.state === 'pending');
  const magicLeft = pendingSimple.length;

  const magicSolve = () => {
    for (const h of pendingSimple) h.state = 'accepted';
    paint();
    editors.current?.mid?.focus();
  };

  const gotoHunk = (dir: 1 | -1) => {
    const mid = editors.current?.mid;
    if (!mid) return;
    const pending = hunks.filter((h) => h.state === 'pending').sort((a, b) => a.start - b.start);
    if (!pending.length) return;
    const line = mid.getPosition()?.lineNumber ?? 1;
    const target = dir === 1 ? pending.find((h) => h.start > line) ?? pending[0] : [...pending].reverse().find((h) => h.start < line) ?? pending[pending.length - 1];
    mid.setPosition({ lineNumber: target.start, column: 1 });
    mid.revealLinesInCenter(target.start, target.end);
    mid.focus();
  };

  const takeSide = (side: 'left' | 'right') => {
    for (const h of [...pendingConflicts].sort((a, b) => b.start - a.start)) resolve(h, side);
  };

  const apply = async () => {
    const mid = editors.current?.mid;
    if (!mid) return;
    for (const h of pendingSimple) h.state = 'accepted'; // JetBrains auto-applies the rest
    if (pendingConflicts.length) {
      force();
      return toast('Unresolved conflicts', `Accept or merge every conflict first (${pendingConflicts.length} left)`, 'error');
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
        toast('All conflicts resolved', 'Every conflicted file has been merged and staged — complete the merge from the toolbar', 'success');
      }
    } catch (err: any) {
      toast('Apply failed', err.message, 'error');
    }
  };

  const backToList = async () => {
    close();
    const s = await fetchMergeState();
    if (s?.files.length) openMergeConflicts();
  };

  const changes = hunks.length;
  const conflictsLeft = pendingConflicts.length;
  return (
    <DialogFrame
      title={`Merge Revisions for ${path}`}
      width={1150}
      onClose={backToList}
      footer={
        <>
          <button className="btn" onClick={backToList}>Cancel</button>
          <span className="dlg-hint" style={{ marginLeft: 0, marginRight: 'auto' }}>
            {manual ? 'Manually edited' : `${changes} change${changes === 1 ? '' : 's'}. ${conflictsLeft} conflict${conflictsLeft === 1 ? '' : 's'} left`}
          </span>
          <button className="btn" onClick={() => takeSide('left')}>Accept Left</button>
          <button className="btn" onClick={() => takeSide('right')}>Accept Right</button>
          <button className="btn primary" onClick={apply}>Apply</button>
        </>
      }
    >
      <div className="merge-dialog">
        <Pane label={`Changes from ${branches.ours || 'yours'}`} side="left" hostRef={leftRef} />
        <div className="md-pane md-mid">
          <div className="md-pane-label">
            <span>Result</span>
            <span className="md-hunk-nav">
              <button title="Previous change" onClick={() => gotoHunk(-1)}><Icon name="up" /></button>
              <button title="Next change" onClick={() => gotoHunk(1)}><Icon name="down" /></button>
              <button className="md-magic" disabled={!magicLeft} title="Automatically apply all non-conflicting changes" onClick={magicSolve}>
                <Icon name="structure" /> Apply non-conflicting changes ({magicLeft})
              </button>
            </span>
          </div>
          <div ref={midRef} className="md-editor" />
        </div>
        <Pane label={`Changes from ${branches.theirs || 'theirs'}`} side="right" hostRef={rightRef} />
      </div>
    </DialogFrame>
  );
}

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
