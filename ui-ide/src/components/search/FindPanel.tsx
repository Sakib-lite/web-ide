'use client';

import { useEffect, useMemo } from 'react';
import { on } from '@/lib/bus';
import { Icon } from '@/components/ui/Icon';
import { FileIcon } from '@/components/ui/FileIcon';
import { editorManager } from '@/editor/editor-manager';
import { basename, dirname, escapeRegExp } from '@/lib/utils';
import { useFindStore, findUsages } from './search-actions';
import { useStore } from '@/lib/store';

function Highlighted({ text, query, word }: { text: string; query: string; word: boolean }) {
  const re = useMemo(() => new RegExp(word ? `(?<![\\w$])${escapeRegExp(query)}(?![\\w$])` : escapeRegExp(query), word ? 'g' : 'gi'), [query, word]);
  const parts: (string | { m: string })[] = [];
  let last = 0, m: RegExpExecArray | null;
  while (query && (m = re.exec(text))) {
    parts.push(text.slice(last, m.index), { m: m[0] });
    last = m.index + m[0].length;
    if (!m[0]) break;
  }
  parts.push(text.slice(last));
  return <span>{parts.map((p, i) => (typeof p === 'string' ? p : <mark key={i}>{p.m}</mark>))}</span>;
}

export function FindPanel() {
  const { query, title, rows, status, setQuery, run } = useFindStore();
  const hide = useStore((s) => s.hideTool);
  useEffect(() => on<{ word: string; file?: string }>('find-usages', ({ word, file }) => findUsages(word, file)), []);
  const byFile = useMemo(() => {
    const map = new Map<string, typeof rows>();
    for (const r of rows) (map.get(r.file) || map.set(r.file, []).get(r.file))!.push(r);
    return map;
  }, [rows]);
  return (
    <>
      <header className="tool-header">
        <span className="tool-title">Find</span>
        <div className="find-field">
          <Icon name="search" />
          <input id="find-input" value={query} placeholder="Find in Files… (Enter)" onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && run(query.trim())} />
        </div>
        <span className="find-summary">{status}</span>
        <div className="tool-header-actions">
          <button className="tb-icon sm" title="Hide" onClick={() => hide('find')}><Icon name="minimize" /></button>
        </div>
      </header>
      <div className="find-results">
        {[...byFile.entries()].map(([file, hits]) => (
          <div key={file}>
            <div className="find-file"><FileIcon name={basename(file)} /><span>{basename(file)}</span><span className="find-path">{dirname(file)}</span><span className="find-path" style={{ marginLeft: 'auto' }}>{hits.length}</span></div>
            {hits.map((h, i) => (
              <div key={i} className="find-line" onClick={() => editorManager.openFile(file, { line: h.line, col: h.col, preview: true })}>
                <span className="ln">{h.line}</span>
                <Highlighted text={h.text} query={query} word={!!title} />
              </div>
            ))}
          </div>
        ))}
      </div>
    </>
  );
}
