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

const STRIPES_W = 80;
const EDITOR_MIN = 220;
const PANEL_MIN = { left: 180, right: 240, bottom: 120 } as const;

const clampNum = (n: number, min: number, max: number) => Math.min(Math.max(n, min), Math.max(min, max));

function relayoutToolPanels() {
  const el = (cls: string) => document.querySelector<HTMLElement>(`.tool-panel.${cls}`);
  const [l, r, b] = [el('left'), el('right'), el('bottom')];
  if (!l || !r || !b) return;
  const isOpen = (p: HTMLElement) => !p.classList.contains('collapsed');
  const current = (p: HTMLElement, cfg: (typeof SIZE)[Side]) => {
    const v = parseInt(p.style.getPropertyValue(cfg.cssVar) || '', 10);
    if (Number.isFinite(v) && v > 0) return v;
    const stored = parseInt(localStorage.getItem(cfg.key) || '', 10);
    return Number.isFinite(stored) && stored > 0 ? stored : cfg.def;
  };
  const apply = (p: HTMLElement, cfg: (typeof SIZE)[Side], v: number) => {
    const size = Math.round(v);
    p.style.setProperty(cfg.cssVar, size + 'px');
    if (localStorage.getItem(cfg.key) !== String(size)) localStorage.setItem(cfg.key, String(size));
  };
  const avail = Math.max(PANEL_MIN.left + PANEL_MIN.right, innerWidth - STRIPES_W - EDITOR_MIN);
  const left = clampNum(current(l, SIZE.left), PANEL_MIN.left, avail - (isOpen(r) ? PANEL_MIN.right : 0));
  apply(l, SIZE.left, left);
  apply(r, SIZE.right, clampNum(current(r, SIZE.right), PANEL_MIN.right, avail - (isOpen(l) ? left : 0)));
  apply(b, SIZE.bottom, clampNum(current(b, SIZE.bottom), PANEL_MIN.bottom, innerHeight * 0.8));
}

function useResizer(side: Side, panel: React.RefObject<HTMLElement | null>) {
  const cfg = SIZE[side];
  const [resizing, setResizing] = useState(false);
  const tools = useStore((s) => s.tools);
  useEffect(() => {
    relayoutToolPanels();
    const onResize = () => relayoutToolPanels();
    addEventListener('resize', onResize);
    return () => removeEventListener('resize', onResize);
  }, [tools]);
  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const el = panel.current!;
    const start = cfg.axis === 'x' ? e.clientX : e.clientY;
    const rect = el.getBoundingClientRect();
    const startSize = cfg.axis === 'x' ? rect.width : rect.height;
    setResizing(true);
    document.body.style.cursor = cfg.axis === 'x' ? 'col-resize' : 'row-resize';
    const dragMax = () => {
      if (cfg.axis === 'y') return innerHeight * 0.8;
      const other = document.querySelector<HTMLElement>(`.tool-panel.${side === 'right' ? 'left' : 'right'}`);
      const otherW = other && !other.classList.contains('collapsed') ? other.getBoundingClientRect().width : 0;
      return Math.max(PANEL_MIN[side], innerWidth - STRIPES_W - otherW - EDITOR_MIN);
    };
    const move = (ev: MouseEvent) => {
      const delta = (cfg.axis === 'x' ? ev.clientX - start : start - ev.clientY) * cfg.dir;
      el.style.setProperty(cfg.cssVar, clampNum(startSize + delta, PANEL_MIN[side], dragMax()) + 'px');
      emit('layout');
    };
    const up = () => {
      removeEventListener('mousemove', move);
      removeEventListener('mouseup', up);
      setResizing(false);
      document.body.style.cursor = '';
      relayoutToolPanels();
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
