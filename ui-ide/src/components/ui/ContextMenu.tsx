'use client';

import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { Icon } from './Icon';

export type MenuItem =
  | 'sep'
  | {
      label: string;
      key?: string;
      action?: () => void;
      danger?: boolean;
      disabled?: boolean;
      hidden?: boolean;
      checked?: boolean;
      children?: MenuItem[];
    };

interface MenuState {
  open: boolean;
  x: number;
  y: number;
  items: MenuItem[];
  show: (x: number, y: number, items: MenuItem[]) => void;
  hide: () => void;
}

export const useContextMenu = create<MenuState>((set) => ({
  open: false,
  x: 0,
  y: 0,
  items: [],
  show: (x, y, items) => set({ open: true, x, y, items }),
  hide: () => set({ open: false }),
}));

export const showContextMenu = (x: number, y: number, items: MenuItem[]) => useContextMenu.getState().show(x, y, items);
export const hideContextMenu = () => useContextMenu.getState().hide();

function clamp(el: HTMLElement | null, x: number, y: number) {
  if (!el) return { left: x, top: y };
  const r = el.getBoundingClientRect();
  return { left: Math.max(4, Math.min(x, innerWidth - r.width - 8)), top: Math.max(4, Math.min(y, innerHeight - r.height - 8)) };
}

function MenuList({ items, x, y, depth }: { items: MenuItem[]; x: number; y: number; depth: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  const [sub, setSub] = useState<{ index: number; x: number; y: number } | null>(null);
  useEffect(() => setPos(clamp(ref.current, x, y)), [x, y]);
  const visible = items.filter((it) => it === 'sep' || !it.hidden);
  return (
    <>
      <div ref={ref} className="context-menu" style={{ left: pos.left, top: pos.top }} data-depth={depth}>
        {visible.map((it, i) =>
          it === 'sep' ? (
            <div key={i} className="cm-sep" />
          ) : (
            <div
              key={i}
              className={`cm-item${it.danger ? ' danger' : ''}${it.checked ? ' checked' : ''}${it.children ? ' has-children' : ''}${sub?.index === i ? ' open' : ''}`}
              style={it.disabled ? { opacity: 0.45 } : undefined}
              onMouseEnter={(e) => {
                if (!it.children) return setSub(null);
                const r = e.currentTarget.getBoundingClientRect();
                setSub({ index: i, x: r.right + 2, y: r.top - 4 });
              }}
              onClick={() => {
                if (it.disabled || it.children) return;
                hideContextMenu();
                it.action?.();
              }}
            >
              {it.checked != null && <Icon name="check" className="cm-check" />}
              <span>{it.label}</span>
              {it.key && <span className="cm-key">{it.key}</span>}
              {it.children && <Icon name="chevron-right" className="cm-arrow" />}
            </div>
          ),
        )}
      </div>
      {sub && (visible[sub.index] as Exclude<MenuItem, 'sep'>).children && <MenuList items={(visible[sub.index] as Exclude<MenuItem, 'sep'>).children!} x={sub.x} y={sub.y} depth={depth + 1} />}
    </>
  );
}

export function ContextMenuHost() {
  const { open, x, y, items, hide } = useContextMenu();
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('.context-menu')) hide();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && hide();
    const id = setTimeout(() => {
      addEventListener('mousedown', onDown, true);
      addEventListener('keydown', onKey, true);
      addEventListener('blur', hide);
    });
    return () => {
      clearTimeout(id);
      removeEventListener('mousedown', onDown, true);
      removeEventListener('keydown', onKey, true);
      removeEventListener('blur', hide);
    };
  }, [open, hide]);
  if (!open) return null;
  return <MenuList items={items} x={x} y={y} depth={0} />;
}
