'use client';

import { useEffect } from 'react';
import { TitleBar } from './TitleBar';
import { Stripe } from './Stripe';
import { ToolPanel } from './ToolPanel';
import { StatusBar } from './StatusBar';
import { EditorArea } from '@/components/editor/EditorArea';
import { useBuiltinTools } from './useBuiltinTools';
import { useProjectEvents } from '@/hooks/useProjectEvents';
import { useShortcuts } from '@/hooks/useShortcuts';
import { useGitStatusPolling } from '@/hooks/useGitStatusPolling';
import { loadPlugins } from '@/plugins/loader';
import { loadGithubUser } from '@/components/github/github-actions';

export function IdeShell() {
  useBuiltinTools();
  useProjectEvents();
  useShortcuts();
  useGitStatusPolling();
  useEffect(() => {
    loadPlugins();
    loadGithubUser();
  }, []);
  return (
    <div className="ide">
      <TitleBar />
      <div className="workbench">
        <Stripe side="left" />
        <div className="main-column">
          <div className="upper-row">
            <ToolPanel side="left" />
            <EditorArea />
            <ToolPanel side="right" />
          </div>
          <ToolPanel side="bottom" />
        </div>
        <Stripe side="right" />
      </div>
      <StatusBar />
    </div>
  );
}
