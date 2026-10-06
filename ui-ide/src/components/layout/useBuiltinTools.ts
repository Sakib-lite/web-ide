import { useEffect } from 'react';
import { useStore } from '@/lib/store';

const BUILTIN_TOOLS = [
  { id: 'project', side: 'left', title: 'Project', icon: 'folder', shortcut: '⌘1' },
  { id: 'commit', side: 'left', title: 'Commit', icon: 'commit', shortcut: '⌘0' },
  { id: 'pulls', side: 'left', title: 'Pull Requests', icon: 'pr' },
  { id: 'structure', side: 'left', title: 'Structure', icon: 'structure', shortcut: '⌘7' },
  { id: 'terminal', side: 'bottom', title: 'Terminal', icon: 'terminal', shortcut: '⌥F12' },
  { id: 'git', side: 'bottom', title: 'Git', icon: 'git', shortcut: '⌘9' },
  { id: 'find', side: 'bottom', title: 'Find', icon: 'find-files', shortcut: '⌘3' },
] as const;

export function useBuiltinTools() {
  const register = useStore((s) => s.registerTool);
  useEffect(() => {
    for (const t of BUILTIN_TOOLS) register({ ...t });
  }, [register]);
}
