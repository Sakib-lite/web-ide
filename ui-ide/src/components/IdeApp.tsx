'use client';

import { useEffect, useState } from 'react';
import { useStore } from '@/lib/store';
import { openProject, rootFromUrl } from '@/lib/project';
import { Welcome } from './welcome/Welcome';
import { ToastHost, toast } from './ui/Toasts';
import { ContextMenuHost } from './ui/ContextMenu';
import { DialogHost } from './ui/dialogs';
import { IdeShell } from './layout/IdeShell';
import { openSettingsDialog } from './github/SettingsDialog';
import { openCloneDialog } from './github/CloneDialog';
import { openPluginsDialog } from './plugins/PluginsDialog';
import { BranchPopupHost } from './vcs/BranchPopup';

export default function IdeApp() {
  const project = useStore((s) => s.project);
  const [leaving, setLeaving] = useState(false);
  const open = async (path: string) => {
    try {
      setLeaving(true);
      await openProject(path);
    } catch (err: any) {
      setLeaving(false);
      toast('Cannot open project', err.message, 'error');
    }
  };
  useEffect(() => {
    const root = rootFromUrl();
    if (root) open(root);
  }, []);
  return (
    <>
      {!project && <Welcome leaving={leaving} onOpen={open} onClone={() => openCloneDialog(open)} onSettings={() => openSettingsDialog()} onPlugins={() => openPluginsDialog()} />}
      {project && <IdeShell />}
      <BranchPopupHost />
      <DialogHost />
      <ContextMenuHost />
      <ToastHost />
    </>
  );
}
