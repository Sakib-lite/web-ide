'use client';

import { useEffect, useRef } from 'react';
import { useStore } from '@/lib/store';
import { editorManager } from '@/editor/editor-manager';
import { Tabs } from './Tabs';
import { Breadcrumbs } from './Breadcrumbs';
import { DiffToolbar } from './DiffToolbar';
import { EmptyEditor } from './EmptyEditor';

export function EditorArea() {
  const editorHost = useRef<HTMLDivElement>(null);
  const diffHost = useRef<HTMLDivElement>(null);
  const tabs = useStore((s) => s.tabs);
  const activeKey = useStore((s) => s.activeTab);
  const active = tabs.find((t) => t.key === activeKey);
  useEffect(() => {
    editorManager.init(editorHost.current!, diffHost.current!);
  }, []);
  return (
    <section className="editor-area">
      <Tabs />
      {active && <Breadcrumbs path={active.path} />}
      {active?.kind === 'diff' && <DiffToolbar />}
      <div className="editor-host">
        <div ref={editorHost} id="editor" className={active?.kind === 'diff' ? 'hidden' : ''} />
        <div ref={diffHost} id="diff-editor" className={active?.kind === 'diff' ? '' : 'hidden'} />
        {!active && <EmptyEditor />}
      </div>
    </section>
  );
}
