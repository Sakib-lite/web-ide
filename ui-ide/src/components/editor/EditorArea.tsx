'use client';

import { useEffect, useRef, useState } from 'react';
import { useStore } from '@/lib/store';
import { editorManager } from '@/editor/editor-manager';
import { Tabs } from './Tabs';
import { Breadcrumbs } from './Breadcrumbs';
import { DiffToolbar } from './DiffToolbar';
import { EmptyEditor } from './EmptyEditor';
import { MarkdownPreview, isMarkdown, mdMode, setMdMode, type MdMode } from '@/components/markdown/MarkdownPreview';

export function EditorArea() {
  const editorHost = useRef<HTMLDivElement>(null);
  const diffHost = useRef<HTMLDivElement>(null);
  const tabs = useStore((s) => s.tabs);
  const activeKey = useStore((s) => s.activeTab);
  const active = tabs.find((t) => t.key === activeKey);
  const [mode, setModeState] = useState<MdMode>(mdMode());
  useEffect(() => {
    editorManager.init(editorHost.current!, diffHost.current!).then(() => editorManager.restoreTabs());
    const onChange = () => setModeState(mdMode());
    window.addEventListener('md-preview-changed', onChange);
    return () => window.removeEventListener('md-preview-changed', onChange);
  }, []);
  const isMd = !!active && active.kind === 'file' && isMarkdown(active.path);
  const showPreview = isMd && mode !== 'editor';
  const fullPreview = isMd && mode === 'preview';
  return (
    <section className="editor-area">
      <Tabs />
      {active && <Breadcrumbs path={active.path} />}
      {active?.kind === 'diff' && <DiffToolbar />}
      {isMd && (
        <div className="md-mode-switch">
          <button className={mode === 'editor' ? 'active' : ''} title="Editor only" onClick={() => setMdMode('editor')}><Icon name="edit" /></button>
          <button className={mode === 'split' ? 'active' : ''} title="Editor and Preview" onClick={() => setMdMode('split')}><Icon name="diff" /></button>
          <button className={mode === 'preview' ? 'active' : ''} title="Preview only" onClick={() => setMdMode('preview')}><Icon name="structure" /></button>
        </div>
      )}
      <div className={`editor-host${showPreview ? ' with-preview' : ''}`}>
        <div ref={editorHost} id="editor" className={active?.kind === 'diff' || fullPreview ? 'hidden' : ''} />
        {showPreview && active && <MarkdownPreview key={active.path} path={active.path} />}
        <div ref={diffHost} id="diff-editor" className={active?.kind === 'diff' ? '' : 'hidden'} />
        {!active && <EmptyEditor />}
      </div>
    </section>
  );
}
