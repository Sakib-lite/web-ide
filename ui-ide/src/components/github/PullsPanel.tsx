'use client';

import { useEffect } from 'react';
import { useStore, isToolVisible } from '@/lib/store';
import { on } from '@/lib/bus';
import { timeAgo } from '@/lib/utils';
import { Icon } from '@/components/ui/Icon';
import { ToolHeader } from '@/components/layout/ToolPanel';
import { usePullsStore } from './pulls-store';
import { PrDetail } from './PrDetail';
import { openSettingsDialog } from './SettingsDialog';
import { createPullRequestDialog } from './CreatePullRequestDialog';

export function PullsPanel() {
  const { repo, pulls, authors, state, author, query, error, selected, setFilters, refresh, select } = usePullsStore();
  const visible = useStore((s) => isToolVisible(s, 'pulls'));
  useEffect(() => {
    if (visible) refresh();
  }, [visible, refresh]);
  useEffect(() => on('git-change', () => usePullsStore.setState({ repo: null })), []);
  const title = repo?.connected ? `Pull Requests · ${repo.repo}` : 'Pull Requests';
  return (
    <>
      <ToolHeader id="pulls" title={<span className="tool-title" title={repo?.connected ? `${repo.owner}/${repo.repo}` : ''}>{title}</span>}>
        <button className="tb-icon sm" title="Create Pull Request…" onClick={() => createPullRequestDialog()}><Icon name="plus" /></button>
        <button className="tb-icon sm" title="Refresh" onClick={() => refresh(true)}><Icon name="refresh" /></button>
        <button className="tb-icon sm" title="Open on GitHub" onClick={() => repo?.connected && window.open(`https://github.com/${repo.owner}/${repo.repo}/pulls`, '_blank')}><Icon name="external" /></button>
      </ToolHeader>
      {selected ? (
        <PrDetail number={selected} />
      ) : (
        <div className="pr-list-pane">
          <div className="pr-search search-field"><Icon name="search" /><input value={query} placeholder="Search pull requests" onChange={(e) => setFilters({ query: e.target.value })} /></div>
          <div className="pr-filters">
            <Icon name="filter" />
            <select className="filter-select" value={state} onChange={(e) => setFilters({ state: e.target.value })}>
              <option value="open">State: Open</option><option value="closed">State: Closed</option><option value="merged">State: Merged</option><option value="all">State: All</option>
            </select>
            <select className="filter-select" value={author} onChange={(e) => setFilters({ author: e.target.value })}>
              <option value="">Author: Any</option>
              {repo?.user && <option value={repo.user}>Author: {repo.user} (me)</option>}
              {authors.filter((a) => a !== repo?.user).map((a) => <option key={a} value={a}>Author: {a}</option>)}
            </select>
          </div>
          <div className="pr-list">
            {repo && !repo.connected && <div className="pr-login">The &quot;origin&quot; remote of this project is not a GitHub repository.<span style={{ fontSize: 12 }}>Add a GitHub remote or clone a repository with Get from VCS.</span></div>}
            {repo?.connected && !repo.hasToken && <div className="pr-login"><Icon name="github" style={{ width: 28, height: 28 }} />Log in to GitHub to see pull requests<button className="btn primary" onClick={() => openSettingsDialog()}>Log In…</button></div>}
            {error && <div className="pr-login">{error}</div>}
            {repo?.connected && repo.hasToken && !error && !pulls.length && <div className="empty-hint">No pull requests match.</div>}
            {pulls.map((p) => {
              const st = p.merged ? 'merged' : p.draft ? 'draft' : p.state;
              return (
                <div key={p.number} className="pr-row" onClick={() => select(p.number)}>
                  <div className="pr-top"><span className={`pr-dot ${st}`} /><span className="pr-title" title={p.title}>{p.title}</span><span className={`pr-badge ${st}`}>{st.toUpperCase()}</span><img className="pr-avatar" src={p.avatar} alt="" title={p.author} /></div>
                  <div className="pr-sub">#{p.number} · created {timeAgo(new Date(p.createdAt).getTime())}, by {p.author}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}
