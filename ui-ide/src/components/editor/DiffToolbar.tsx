'use client';

import { useEffect, useState } from 'react';
import { useStore } from '@/lib/store';
import { editorManager } from '@/editor/editor-manager';
import { Icon } from '@/components/ui/Icon';
import { on } from '@/lib/bus';

export function DiffToolbar() {
  const settings = useStore((s) => s.settings);
  const update = useStore((s) => s.updateSettings);
  const activeKey = useStore((s) => s.activeTab);
  const [count, setCount] = useState<number | null>(null);
  const tab = activeKey ? editorManager.tabs.get(activeKey) : null;
  useEffect(() => {
    const diff = editorManager.diffEditor;
    const d = diff.onDidUpdateDiff(() => setCount(editorManager.diffCount()));
    const t = setTimeout(() => setCount(editorManager.diffCount()), 300);
    return () => {
      d.dispose();
      clearTimeout(t);
    };
  }, [activeKey]);
  useEffect(() => on('diff-jump-to-source', jumpToSource), []);
  const jumpToSource = () => {
    if (!tab) return;
    const pos = editorManager.diffEditor.getModifiedEditor().getPosition();
    editorManager.openFile(tab.path, { line: pos?.lineNumber, col: pos?.column, preview: false });
  };
  if (!tab) return null;
  return (
    <>
      <div className="diff-toolbar">
        <button className="tb-icon sm" title="Previous Difference (⇧F7)" onClick={() => editorManager.diffEditor.goToDiff('previous')}><Icon name="up" /></button>
        <button className="tb-icon sm" title="Next Difference (F7)" onClick={() => editorManager.diffEditor.goToDiff('next')}><Icon name="down" /></button>
        <button className="tb-icon sm" title="Jump to Source (F4)" onClick={jumpToSource}><Icon name="edit" /></button>
        <span className="toolbar-sep" />
        <select className="filter-select" value={settings.diffSideBySide ? 'side' : 'unified'} onChange={(e) => update({ diffSideBySide: e.target.value === 'side' })}>
          <option value="side">Side-by-side viewer</option>
          <option value="unified">Unified viewer</option>
        </select>
        <select className="filter-select" value={settings.diffIgnoreWs ? '1' : '0'} onChange={(e) => update({ diffIgnoreWs: e.target.value === '1' })}>
          <option value="0">Do not ignore</option>
          <option value="1">Ignore whitespace</option>
        </select>
        <span className="diff-count">{count === null ? '' : count === 0 ? 'No differences' : `${count} difference${count === 1 ? '' : 's'}`}</span>
      </div>
      <div className={`diff-labels${settings.diffSideBySide ? '' : ' unified'}`}>
        <span>{tab.labels?.left.split(' ').map((part, i) => (i === 0 && /^[0-9a-f]{7,}$/.test(part) ? <span key={i} className="rev">{part}</span> : <span key={i}>{part} </span>))}</span>
        <span>{tab.labels?.right}</span>
      </div>
    </>
  );
}
