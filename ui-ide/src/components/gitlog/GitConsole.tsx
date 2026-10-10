'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { on } from '@/lib/bus';

interface Entry {
  cmd: string;
  output: string;
  ok: boolean;
  ms: number;
  at: number;
}

export function GitConsole() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    api<Entry[]>('/api/git/console').then(setEntries).catch(() => undefined);
    return on<{ entry: Entry }>('git-command', ({ entry }) => setEntries((l) => [...l.slice(-199), entry]));
  }, []);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [entries]);
  return (
    <div ref={ref} className="git-console">
      {entries.map((e, i) => (
        <div key={i} className={`gc-entry${e.ok ? '' : ' err'}`}>
          <div className="gc-cmd">{e.cmd}<span className="gc-time">{new Date(e.at).toLocaleTimeString()} · {e.ms} ms</span></div>
          {e.output && <div className="gc-out">{e.output}</div>}
        </div>
      ))}
    </div>
  );
}
