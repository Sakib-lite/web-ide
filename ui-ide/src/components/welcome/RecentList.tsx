'use client';

import { api } from '@/lib/api';
import { Icon } from '@/components/ui/Icon';
import { badgeHue, initials } from '@/lib/utils';

export interface RecentProject {
  path: string;
  name: string;
  openedAt: number;
}

interface Props {
  items: RecentProject[];
  onOpen: (path: string) => void;
  onChange: (items: RecentProject[]) => void;
}

export function RecentList({ items, onOpen, onChange }: Props) {
  const remove = async (e: React.MouseEvent, path: string) => {
    e.stopPropagation();
    onChange(await api<RecentProject[]>('/api/recent', { method: 'DELETE', query: { path } }));
  };
  return (
    <div className="recent-list">
      {items.map((p, i) => (
        <div key={p.path} className="recent-item" style={{ ['--i' as string]: i }} onClick={() => onOpen(p.path)}>
          <span className="project-badge" style={{ background: `hsl(${badgeHue(p.name)} 55% 45%)` }}>{initials(p.name)}</span>
          <div className="ri-text">
            <div className="ri-name">{p.name}</div>
            <div className="ri-path">{p.path}</div>
          </div>
          <button className="ri-remove" title="Remove from recent" onClick={(e) => remove(e, p.path)}><Icon name="close" /></button>
        </div>
      ))}
    </div>
  );
}
