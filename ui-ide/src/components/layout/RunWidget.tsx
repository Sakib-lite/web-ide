'use client';

import { useEffect, useState } from 'react';
import { useStore } from '@/lib/store';
import { Icon } from '@/components/ui/Icon';
import { editorManager } from '@/editor/editor-manager';
import { runInTerminal } from '@/components/terminal/terminal-store';
import { toast } from '@/components/ui/Toasts';

export function runSelectedConfig() {
  const { project } = useStore.getState();
  const selected = localStorage.getItem('ide.runConfig.' + project?.root) || 'current';
  const command = selected === 'current' ? editorManager.runCommandForActive() : project?.runConfigs.find((c) => c.id === selected)?.command;
  if (!command) return toast('Nothing to run', 'Open a .js, .php or .py file, or pick a run configuration.', 'info');
  editorManager.saveAll();
  runInTerminal(command);
}

export function RunWidget() {
  const project = useStore((s) => s.project)!;
  const activeTab = useStore((s) => s.activeTab);
  const [selected, setSelected] = useState('current');
  useEffect(() => {
    const saved = localStorage.getItem('ide.runConfig.' + project.root);
    if (saved && (saved === 'current' || project.runConfigs.some((c) => c.id === saved))) setSelected(saved);
  }, [project]);
  const choose = (id: string) => {
    setSelected(id);
    localStorage.setItem('ide.runConfig.' + project.root, id);
  };
  const enabled = selected !== 'current' || (!!activeTab && !!editorManager.runCommandForActive());
  return (
    <div className="run-widget">
      <select className="run-config" value={selected} onChange={(e) => choose(e.target.value)} title="Run configuration">
        <option value="current">Current File</option>
        {project.runConfigs.map((c) => <option key={c.id} value={c.id} title={c.command}>{c.label}</option>)}
      </select>
      <button className="tb-icon run" title="Run" disabled={!enabled} onClick={runSelectedConfig}><Icon name="run" /></button>
    </div>
  );
}
