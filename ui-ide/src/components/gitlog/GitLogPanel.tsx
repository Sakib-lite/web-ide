'use client';

import { useEffect } from 'react';
import { useStore, isToolVisible } from '@/lib/store';
import { on } from '@/lib/bus';
import { debounce } from '@/lib/utils';
import { Icon } from '@/components/ui/Icon';
import { toast } from '@/components/ui/Toasts';
import { LogBranchTree } from './LogBranchTree';
import { CommitList } from './CommitList';
import { CommitDetails } from './CommitDetails';
import { GitConsole } from './GitConsole';
import { useLogStore } from './log-store';

function LogToolbar() {
  const { filters, setFilter, branches, authors, commits, hasMore } = useLogStore();
  const refs = [...(branches?.local || []).map((b) => b.name), ...(branches?.remote || []).map((b) => b.name)];
  return (
    <div className="log-toolbar">
      <div className="search-field sm log-search"><Icon name="search" /><input value={filters.grep} placeholder="Text or hash" onChange={(e) => setFilter({ grep: e.target.value })} /></div>
      <select className="filter-select" value={filters.ref} onChange={(e) => setFilter({ ref: e.target.value })}>
        <option value="all">Branch: All</option>
        <option value="HEAD">Branch: HEAD</option>
        {refs.map((r) => <option key={r} value={r}>Branch: {r}</option>)}
        {filters.ref !== 'all' && filters.ref !== 'HEAD' && !refs.includes(filters.ref) && <option value={filters.ref}>Branch: {filters.ref}</option>}
      </select>
      <select className="filter-select" value={filters.author} onChange={(e) => setFilter({ author: e.target.value })}>
        <option value="">User: All</option>
        {[...new Map(authors.map((a) => [a.email, a])).values()].map((a) => <option key={a.email} value={a.email}>User: {a.name}</option>)}
      </select>
      <select className="filter-select" value={filters.since} onChange={(e) => setFilter({ since: e.target.value })}>
        <option value="">Date: All</option>
        <option value="1 day ago">Today</option>
        <option value="7 days ago">Last 7 days</option>
        <option value="1 month ago">Last month</option>
        <option value="1 year ago">Last year</option>
      </select>
      <span className="log-summary">{commits.length}{hasMore ? '+' : ''} commits{filters.path ? ` · ${filters.path}` : ''}</span>
    </div>
  );
}

export function GitLogPanel() {
  const { tab, setTab, refresh } = useLogStore();
  const visible = useStore((s) => isToolVisible(s, 'git'));
  const hide = useStore((s) => s.hideTool);
  const showTool = useStore((s) => s.showTool);
  useEffect(() => {
    if (visible) refresh();
  }, [visible, refresh]);
  useEffect(() => {
    const debounced = debounce(() => useStore.getState().tools.active.bottom === 'git' && useStore.getState().tools.open.bottom && refresh(true), 500);
    const offs = [
      on('git-change', debounced),
      on<{ ref: string }>('log-filter-ref', ({ ref }) => { showTool('git'); useLogStore.getState().setFilter({ ref }); }),
      on<{ path: string }>('log-filter-path', ({ path }) => { showTool('git'); setTab('log'); useLogStore.getState().setFilter({ path }); toast('Showing history', path, 'info', 2000); }),
    ];
    return () => offs.forEach((off) => off());
  }, [refresh, setTab, showTool]);
  return (
    <>
      <header className="tool-header tabs-header">
        <span className="tool-title">Git</span>
        <button className={`subtab${tab === 'log' ? ' active' : ''}`} onClick={() => setTab('log')}>Log</button>
        <button className={`subtab${tab === 'console' ? ' active' : ''}`} onClick={() => setTab('console')}>Console</button>
        <div className="tool-header-actions">
          <button className="tb-icon sm" title="Refresh" onClick={() => refresh(true)}><Icon name="refresh" /></button>
          <button className="tb-icon sm" title="Hide" onClick={() => hide('git')}><Icon name="minimize" /></button>
        </div>
      </header>
      {tab === 'log' ? (
        <div className="git-log-layout">
          <LogBranchTree />
          <div className="log-main">
            <LogToolbar />
            <CommitList />
          </div>
          <CommitDetails />
        </div>
      ) : (
        <GitConsole />
      )}
    </>
  );
}
