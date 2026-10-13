'use client';

import { useEffect, useRef, useState } from 'react';
import { fsApi, symApi } from '@/lib/api';
import { basename, dirname, fuzzyScore } from '@/lib/utils';
import { openPopup } from '@/components/ui/dialogs';
import { Icon } from '@/components/ui/Icon';
import { FileIcon } from '@/components/ui/FileIcon';
import { editorManager } from '@/editor/editor-manager';
import { ideActions } from '@/lib/actions';

type Scope = 'all' | 'files' | 'symbols' | 'text' | 'actions';
const SCOPES: Scope[] = ['all', 'files', 'symbols', 'text', 'actions'];
const PLACEHOLDER: Record<Scope, string> = { all: 'Search files, symbols and actions…', files: 'Type a file name (fuzzy)', symbols: 'Type a class, function or method name', text: 'Find text in project files', actions: 'Type an action name, e.g. "commit", "push", "blame"' };

type Result =
  | { group: string }
  | { type: 'file' | 'symbol' | 'text'; path: string; line?: number; col?: number; label: string; sub: string; kind?: string; container?: string }
  | { type: 'action'; label: string; sub: string; run: () => void };

function Highlight({ text, q }: { text: string; q: string }) {
  if (!q) return <span className="se-name">{text}</span>;
  const t = text.toLowerCase(), needle = q.toLowerCase();
  const idx = t.indexOf(needle);
  if (idx >= 0) return <span className="se-name">{text.slice(0, idx)}<mark>{text.slice(idx, idx + q.length)}</mark>{text.slice(idx + q.length)}</span>;
  let qi = 0;
  return <span className="se-name">{[...text].map((c, i) => (qi < needle.length && t[i] === needle[qi] ? (qi++, <mark key={i}>{c}</mark>) : c))}</span>;
}

async function search(scope: Scope, q: string): Promise<Result[]> {
  if (!q) return [];
  const wantFiles = scope === 'all' || scope === 'files';
  const wantSymbols = scope === 'all' || scope === 'symbols';
  const wantActions = scope === 'all' || scope === 'actions';
  const [files, symbols, text] = await Promise.all([
    wantFiles ? fsApi.files().catch(() => [] as string[]) : [],
    wantSymbols ? symApi.search(q).catch(() => []) : [],
    scope === 'text' && q.length >= 2 ? fsApi.search(q).catch(() => []) : [],
  ]);
  const groups: [string, Result[]][] = [];
  if (wantFiles) {
    const scored = files.map((f) => ({ f, s: Math.max(fuzzyScore(basename(f), q) * 2, fuzzyScore(f, q)) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s);
    groups.push(['Files', scored.slice(0, scope === 'files' ? 60 : 12).map(({ f }) => ({ type: 'file', path: f, label: basename(f), sub: dirname(f) }))]);
  }
  if (wantSymbols) {
    const sorted = symbols.map((s: any) => ({ ...s, score: fuzzyScore(s.name, q) })).sort((a: any, b: any) => b.score - a.score);
    groups.push(['Symbols', sorted.slice(0, scope === 'symbols' ? 60 : 12).map((s: any) => ({ type: 'symbol', path: s.file, line: s.line, col: s.col, label: s.name, kind: s.kind, container: s.container, sub: s.file }))]);
  }
  if (scope === 'text') groups.push(['Text', text.map((r: any) => ({ type: 'text', path: r.file, line: r.line, col: r.col, label: r.text, sub: `${r.file}:${r.line}` }))]);
  if (wantActions) {
    const acts = ideActions().map((a) => ({ ...a, score: fuzzyScore(a.label, q) })).filter((a) => a.score >= 0).sort((a, b) => b.score - a.score);
    groups.push(['Actions', acts.slice(0, scope === 'actions' ? 60 : 6).map((a) => ({ type: 'action', label: a.label, sub: a.key || '', run: a.run }))]);
  }
  const out: Result[] = [];
  for (const [title, items] of groups) if (items.length) out.push({ group: title }, ...items);
  return out;
}

function SearchEverywhereView({ initialScope, prefill, close }: { initialScope: Scope; prefill: string; close: () => void }) {
  const [scope, setScope] = useState<Scope>(initialScope);
  const [q, setQ] = useState(prefill);
  const [results, setResults] = useState<Result[]>([]);
  const [cursor, setCursor] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const seq = useRef(0);
  useEffect(() => {
    setTimeout(() => input.current?.select(), 20);
  }, []);
  useEffect(() => {
    const id = ++seq.current;
    const t = setTimeout(async () => {
      const r = await search(scope, q.trim());
      if (id !== seq.current) return;
      setResults(r);
      setCursor(r.findIndex((x) => !('group' in x)));
    }, 120);
    return () => clearTimeout(t);
  }, [scope, q]);
  const choose = (r: Result | undefined) => {
    if (!r || 'group' in r) return;
    close();
    if (r.type === 'action') return setTimeout(r.run, 50);
    editorManager.openFile(r.path, { line: r.line, col: r.col, preview: false });
  };
  const move = (d: number) => {
    if (!results.length) return;
    let i = cursor;
    do i = (i + d + results.length) % results.length;
    while ('group' in results[i]);
    setCursor(i);
    document.querySelectorAll('.se-item')[results.slice(0, i + 1).filter((r) => !('group' in r)).length - 1]?.scrollIntoView({ block: 'nearest' });
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') (e.preventDefault(), move(1));
    else if (e.key === 'ArrowUp') (e.preventDefault(), move(-1));
    else if (e.key === 'Enter') (e.preventDefault(), choose(results[cursor]));
    else if (e.key === 'Tab') (e.preventDefault(), setScope(SCOPES[(SCOPES.indexOf(scope) + (e.shiftKey ? 4 : 1)) % 5]));
  };
  return (
    <div className="popup" onMouseDown={(e) => e.stopPropagation()}>
      <div className="se-tabs">{SCOPES.map((s) => <button key={s} className={s === scope ? 'active' : ''} onClick={() => setScope(s)}>{s[0].toUpperCase() + s.slice(1)}</button>)}</div>
      <div className="se-input"><Icon name="search" /><input ref={input} value={q} placeholder={PLACEHOLDER[scope]} autoComplete="off" onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} /></div>
      <div className="se-results">
        {!results.length && <div className="se-empty">{q ? 'Nothing found' : 'Start typing to search files, classes, functions, methods and actions'}</div>}
        {results.map((r, i) =>
          'group' in r ? (
            <div key={i} className="se-group">{r.group}</div>
          ) : (
            <div key={i} className={`se-item${i === cursor ? ' active' : ''}`} onMouseEnter={() => setCursor(i)} onClick={() => choose(r)}>
              {r.type === 'symbol' ? <span className={`struct-kind ${r.kind}`}>{r.kind![0].toUpperCase()}</span> : r.type === 'action' ? <Icon name="run" style={{ color: 'var(--text-secondary)' }} /> : <FileIcon name={basename(r.path)} />}
              {r.type === 'text' ? <span className="se-name" style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{r.label}</span> : <Highlight text={r.label} q={q.trim()} />}
              {r.type === 'symbol' && r.container && <span className="se-sub">in {r.container}</span>}
              <span className="se-right">{r.sub}</span>
            </div>
          ),
        )}
      </div>
      <div className="se-footer"><kbd>↑↓</kbd> navigate <kbd>↵</kbd> open <kbd>Tab</kbd> scope <kbd>Esc</kbd> close</div>
    </div>
  );
}

export function openSearchEverywhere(scope: Scope = 'all', prefill = '') {
  return openPopup((close) => <SearchEverywhereView initialScope={scope} prefill={prefill} close={() => close()} />);
}
