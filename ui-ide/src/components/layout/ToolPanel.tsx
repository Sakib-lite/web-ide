'use client';

import { ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Side, useStore } from '@/lib/store';
import { emit } from '@/lib/bus';
import { Icon } from '@/components/ui/Icon';
import { ProjectPanel } from '@/components/project/ProjectPanel';
import { CommitPanel } from '@/components/git/CommitPanel';
import { PullsPanel } from '@/components/github/PullsPanel';
import { StructurePanel } from '@/components/structure/StructurePanel';
import { TerminalPanel } from '@/components/terminal/TerminalPanel';
import { GitLogPanel } from '@/components/gitlog/GitLogPanel';
import { FindPanel } from '@/components/search/FindPanel';
import { PluginToolView } from '@/plugins/PluginToolView';

const SIZE: Record<Side, { key: string; cssVar: string; def: number; axis: 'x' | 'y'; dir: 1 | -1 }> = {
  left: { key: 'ide.leftW', cssVar: '--left-w', def: 280, axis: 'x', dir: 1 },
  bottom: { key: 'ide.bottomH', cssVar: '--bottom-h', def: 260, axis: 'y', dir: 1 },
  right: { key: 'ide.rightW', cssVar: '--right-w', def: 440, axis: 'x', dir: -1 },
};

const BUILTIN: Record<string, () => ReactNode> = {
  project: () => <ProjectPanel />,
  commit: () => <CommitPanel />,
  pulls: () => <PullsPanel />,
  structure: () => <StructurePanel />,
  terminal: () => <TerminalPanel />,
  git: () => <GitLogPanel />,
  find: () => <FindPanel />,
};

export function ToolHeader({ id, title, children }: { id: string; title: ReactNode; children?: ReactNode }) {
  const hide = useStore((s) => s.hideTool);
  return (
    <header className="tool-header">
      {typeof title === 'string' ? <span className="tool-title">{title}</span> : title}
      <div className="tool-header-actions">
        {children}
        <button className="tb-icon sm" title="Hide" onClick={() => hide(id)}><Icon name="minimize" /></button>
      </div>
    </header>
  );
}

function useResizer(side: Side, panel: React.RefObject<HTMLElement | null>) {
  const cfg = SIZE[side];
  const [resizing, setResizing] = useState(false);
  useEffect(() => {
    panel.current?.style.setProperty(cfg.cssVar, (localStorage.getItem(cfg.key) || cfg.def) + 'px');
  }, [cfg, panel]);
  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const el = panel.current!;
    const start = cfg.axis === 'x' ? e.clientX : e.clientY;
    const rect = el.getBoundingClientRect();
    const startSize = cfg.axis === 'x' ? rect.width : rect.height;
    setResizing(true);
    document.body.style.cursor = cfg.axis === 'x' ? 'col-resize' : 'row-resize';
    const move = (ev: MouseEvent) => {
      const delta = (cfg.axis === 'x' ? ev.clientX - start : start - ev.clientY) * cfg.dir;
      const size = Math.max(cfg.axis === 'x' ? 180 : 120, Math.min(cfg.axis === 'x' ? innerWidth * 0.6 : innerHeight * 0.8, startSize + delta));
      el.style.setProperty(cfg.cssVar, size + 'px');
      emit('layout');
    };
    const up = () => {
      removeEventListener('mousemove', move);
      removeEventListener('mouseup', up);
      setResizing(false);
      document.body.style.cursor = '';
      localStorage.setItem(cfg.key, String(parseInt(el.style.getPropertyValue(cfg.cssVar))));
      emit('layout');
    };
    addEventListener('mousemove', move);
    addEventListener('mouseup', up);
  };
  return { resizing, onMouseDown };
}

export function ToolPanel({ side }: { side: Side }) {
  const ref = useRef<HTMLElement>(null);
  const open = useStore((s) => s.tools.open[side]);
  const active = useStore((s) => s.tools.active[side]);
  const allDefs = useStore((s) => s.toolDefs);
  const defs = useMemo(() => allDefs.filter((d) => d.side === side), [allDefs, side]);
  const { resizing, onMouseDown } = useResizer(side, ref);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onEnd = (e: TransitionEvent) => e.target === el && emit('layout');
    el.addEventListener('transitionend', onEnd);
    return () => el.removeEventListener('transitionend', onEnd);
  }, []);
  return (
    <aside ref={ref} className={`tool-panel ${side}${open ? '' : ' collapsed'}${resizing ? ' resizing' : ''}`}>
      {side === 'bottom' && <div className="resizer resizer-h" onMouseDown={onMouseDown} />}
      <div className="tool-panel-inner">
        {defs.map((d) => (
          <section key={d.id} className={`tool-view${active === d.id ? ' active' : ''}`} data-view={d.id}>
            {d.plugin ? <PluginToolView def={d} /> : BUILTIN[d.id]?.()}
          </section>
        ))}
      </div>
      {side !== 'bottom' && <div className={`resizer resizer-v${side === 'right' ? ' right' : ''}`} onMouseDown={onMouseDown} />}
    </aside>
  );
}
