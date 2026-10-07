'use client';

import { useEffect, useRef } from 'react';
import '@xterm/xterm/css/xterm.css';
import { useStore, isToolVisible } from '@/lib/store';
import { on } from '@/lib/bus';
import { Icon } from '@/components/ui/Icon';
import { ToolHeader } from '@/components/layout/ToolPanel';
import { restoreTerminals, useTerminals, type TerminalSession } from './terminal-store';

function SessionView({ session, active }: { session: TerminalSession; active: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current && !session.term.element) session.term.open(ref.current);
  }, [session]);
  useEffect(() => {
    if (!active) return;
    const fit = () => {
      const el = ref.current;
      if (!el || el.clientHeight < 40 || el.clientWidth < 80) return;
      try {
        session.fit.fit();
      } catch {}
    };
    const raf = requestAnimationFrame(() => {
      fit();
      session.term.focus();
    });
    const observer = new ResizeObserver(() => requestAnimationFrame(fit));
    if (ref.current) observer.observe(ref.current);
    const off = on('layout', () => requestAnimationFrame(fit));
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      off();
    };
  }, [active, session]);
  return <div ref={ref} className={`term-instance${active ? '' : ' hidden'}`} />;
}

export function TerminalPanel() {
  const { sessions, activeId, activate, close, rerun } = useTerminals();
  const visible = useStore((s) => isToolVisible(s, 'terminal'));
  useEffect(() => {
    if (visible && !sessions.length) restoreTerminals();
  }, [visible, sessions.length]);
  const active = sessions.find((s) => s.id === activeId);
  return (
    <>
      <ToolHeader
        id="terminal"
        title={
          <>
            <span className="tool-title">Terminal</span>
            <div className="term-tabs">
              {sessions.map((s) => (
                <button key={s.id} className={`term-tab${s.id === activeId ? ' active' : ''}`} onClick={() => activate(s.id)}>
                  <span>{s.title}</span>
                  <span className="tab-close" title="Close session" onClick={(e) => { e.stopPropagation(); close(s.id); }}><Icon name="close" /></span>
                </button>
              ))}
            </div>
          </>
        }
      >
        {active?.lastCommand && <button className="tb-icon sm" title={`Rerun: ${active.lastCommand}`} onClick={() => rerun()}><Icon name="refresh" /></button>}
        <button className="tb-icon sm" title="New session" onClick={() => useTerminals.getState().create()}><Icon name="plus" /></button>
      </ToolHeader>
      <div className="term-host">
        {sessions.map((s) => <SessionView key={s.id} session={s} active={s.id === activeId} />)}
      </div>
    </>
  );
}
