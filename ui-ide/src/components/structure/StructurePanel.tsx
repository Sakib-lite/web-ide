'use client';

import { useEffect, useState } from 'react';
import { symApi } from '@/lib/api';
import { useStore, isToolVisible } from '@/lib/store';
import { on } from '@/lib/bus';
import { editorManager } from '@/editor/editor-manager';
import { ToolHeader } from '@/components/layout/ToolPanel';

interface Sym {
  name: string;
  kind: string;
  container: string | null;
  line: number;
  col: number;
}

const SUPPORTED = /\.(js|mjs|cjs|jsx|ts|tsx|vue|php|phtml|inc|py|pyw|pyi)$/i;

export function StructurePanel() {
  const activeKey = useStore((s) => s.activeTab);
  const visible = useStore((s) => isToolVisible(s, 'structure'));
  const path = useStore((s) => s.tabs.find((t) => t.key === activeKey)?.path || null);
  const [symbols, setSymbols] = useState<Sym[]>([]);
  const [tick, setTick] = useState(0);
  useEffect(() => on<{ path: string }>('file-saved', (d) => d.path === path && setTick((n) => n + 1)), [path]);
  useEffect(() => {
    if (!visible || !path || !SUPPORTED.test(path)) return setSymbols([]);
    let alive = true;
    symApi.file(path).then((s: Sym[]) => alive && setSymbols([...s].sort((a, b) => a.line - b.line))).catch(() => alive && setSymbols([]));
    return () => {
      alive = false;
    };
  }, [path, visible, tick]);
  return (
    <>
      <ToolHeader id="structure" title="Structure" />
      <div className="structure-list">
        {(!path || !SUPPORTED.test(path)) && <div className="empty-hint">Open a JS, PHP or Python file to see its structure.</div>}
        {path && SUPPORTED.test(path) && !symbols.length && <div className="empty-hint">No classes or functions found in this file.</div>}
        {symbols.map((s, i) => (
          <div key={i} className={`struct-row${s.container ? ' nested' : ''}`} onClick={() => editorManager.revealLine(s.line, s.col)}>
            <span className={`struct-kind ${s.kind}`}>{s.kind[0].toUpperCase()}</span>
            <span>{s.name}</span>
            {s.container && <span className="struct-container">{s.container}</span>}
            <span className="struct-line">{s.line}</span>
          </div>
        ))}
      </div>
    </>
  );
}
