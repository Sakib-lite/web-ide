'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Icon } from '@/components/ui/Icon';
import { promptDialog } from '@/components/ui/dialogs';
import { toast } from '@/components/ui/Toasts';
import { RecentList, RecentProject } from './RecentList';
import { openProjectDialog } from './OpenProjectDialog';

interface Props {
  leaving: boolean;
  onOpen: (path: string) => void;
  onClone: () => void;
  onSettings: () => void;
  onPlugins: () => void;
}

const NAV = [
  { id: 'projects', icon: 'projects', label: 'Projects' },
  { id: 'remote', icon: 'remote', label: 'Remote Development', disabled: true },
  { id: 'customize', icon: 'customize', label: 'Customize' },
  { id: 'plugins', icon: 'plugins', label: 'Plugins' },
  { id: 'learn', icon: 'learn', label: 'Learn', disabled: true },
];

export function Welcome({ leaving, onOpen, onClone, onSettings, onPlugins }: Props) {
  const [recent, setRecent] = useState<RecentProject[]>([]);
  const [filter, setFilter] = useState('');
  useEffect(() => {
    api<RecentProject[]>('/api/recent').then(setRecent).catch(() => setRecent([]));
  }, []);
  const items = recent.filter((p) => !filter || p.name.toLowerCase().includes(filter.toLowerCase()) || p.path.toLowerCase().includes(filter.toLowerCase()));
  const newProject = async () => {
    const home = (await api<{ home: string }>('/api/browse').catch(() => ({ home: '' }))).home;
    const location = await promptDialog({ title: 'New Project', label: 'Location:', value: `${home}/projects/untitled`, okText: 'Create', mono: true, validate: (v) => (!v.startsWith('/') ? 'Enter an absolute path' : undefined) });
    if (!location) return;
    try {
      onOpen((await api<{ root: string }>('/api/project/create', { method: 'POST', body: { path: location } })).root);
    } catch (err: any) {
      toast('Could not create project', err.message, 'error');
    }
  };
  const navAction: Record<string, () => void> = { customize: onSettings, plugins: onPlugins };
  return (
    <div className={`welcome${leaving ? ' leaving' : ''}`}>
      <aside className="welcome-side">
        <div className="welcome-brand">
          <div className="brand-logo">WS</div>
          <div>
            <div className="brand-name">Web IDE</div>
            <div className="brand-ver">2026.2 · browser edition</div>
          </div>
        </div>
        <nav className="welcome-nav">
          {NAV.map((n) => (
            <button key={n.id} className={n.id === 'projects' ? 'active' : ''} disabled={n.disabled} onClick={() => navAction[n.id]?.()}><Icon name={n.icon} />{n.label}</button>
          ))}
        </nav>
      </aside>
      <main className="welcome-main">
        <div className="welcome-toolbar">
          <div className="search-field">
            <Icon name="search" />
            <input value={filter} placeholder="Search projects" onChange={(e) => setFilter(e.target.value)} />
          </div>
          <div className="welcome-actions">
            <button className="btn" onClick={newProject}>New Project</button>
            <button className="btn primary" onClick={async () => { const p = await openProjectDialog(); if (p) onOpen(p); }}>Open</button>
            <button className="btn" onClick={onClone}>Get from VCS</button>
          </div>
        </div>
        <RecentList items={items} onOpen={onOpen} onChange={setRecent} />
        {!recent.length && (
          <div className="recent-empty">
            <p>No recent projects yet.</p>
            <p>Click <b>Open</b> to pick a folder, or <b>Get from VCS</b> to clone one from GitHub.</p>
          </div>
        )}
      </main>
    </div>
  );
}
