import { api } from '@/lib/api';
import { useStore } from '@/lib/store';
import { showContextMenu, MenuItem } from '@/components/ui/ContextMenu';
import { openProjectDialog } from '@/components/welcome/OpenProjectDialog';
import { openProject, closeProject } from '@/lib/project';
import { openCloneDialog } from '@/components/github/CloneDialog';

export const ProjectSwitcher = {
  async open(anchor: HTMLElement) {
    const r = anchor.getBoundingClientRect();
    const current = useStore.getState().project?.root;
    const recent = await api<{ name: string; path: string }[]>('/api/recent').catch(() => []);
    const items: MenuItem[] = recent.filter((p) => p.path !== current).slice(0, 8).map((p) => ({ label: p.name, key: p.path.replace(/^\/Users\/[^/]+/, '~'), action: () => openProject(p.path) }));
    if (items.length) items.push('sep');
    items.push(
      { label: 'Open Project…', action: async () => { const p = await openProjectDialog(); if (p) openProject(p); } },
      { label: 'Get from VCS…', action: () => openCloneDialog(openProject) },
      { label: 'Welcome Screen', action: closeProject },
    );
    showContextMenu(r.left, r.bottom + 4, items);
  },
};
