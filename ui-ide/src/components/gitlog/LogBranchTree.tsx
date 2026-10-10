'use client';

import { useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { showContextMenu } from '@/components/ui/ContextMenu';
import { Branch, checkout, isFavorite } from '@/components/vcs/vcs-actions';
import { branchActions } from '@/components/vcs/BranchPopup';
import { readLocal, writeLocal } from '@/lib/utils';
import { useLogStore } from './log-store';

function Row({ b, remote, current, depth, icon, selected, onSelect }: { b: Branch & { short?: string }; remote?: boolean; current?: boolean; depth: number; icon?: string; selected: boolean; onSelect: () => void }) {
  return (
    <div
      className={`lb-row${current ? ' current' : ''}${selected ? ' selected' : ''}`}
      style={{ paddingLeft: 8 + depth * 14 }}
      title={b.subject || ''}
      onClick={onSelect}
      onDoubleClick={() => checkout(b.name).catch(() => undefined)}
      onContextMenu={(e) => { e.preventDefault(); showContextMenu(e.clientX, e.clientY, branchActions(b, { remote, current })); }}
    >
      <Icon name={icon || (current ? 'tag' : isFavorite(b.name) ? 'star' : 'branch')} />
      <span className="lb-name">{b.short || b.name}</span>
      {!remote && (b.ahead || b.behind) ? <span className="lb-sync">{`${b.ahead ? '↑' + b.ahead : ''}${b.behind ? ' ↓' + b.behind : ''}`.trim()}</span> : null}
    </div>
  );
}

function Folder({ id, title, depth, defaultOpen, children, forceOpen }: { id: string; title: string; depth: number; defaultOpen: boolean; children: React.ReactNode[]; forceOpen: boolean }) {
  const [open, setOpen] = useState(() => (id ? readLocal<string[]>('ide.logGroups', ['local', 'remote']).includes(id) : defaultOpen));
  if (!children.length) return null;
  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (!id) return;
    const saved = new Set(readLocal<string[]>('ide.logGroups', ['local', 'remote']));
    next ? saved.add(id) : saved.delete(id);
    writeLocal('ide.logGroups', [...saved]);
  };
  const isOpen = open || forceOpen;
  return (
    <>
      <div className={`lb-row${isOpen ? ' open' : ''}`} style={{ paddingLeft: 8 + depth * 14 }} onClick={toggle}><Icon name="chevron-right" className="lb-arrow" /><Icon name="folder" /><span>{title}</span></div>
      <div className={`lb-children${isOpen ? ' open' : ''}`}><div>{children}</div></div>
    </>
  );
}

function tree(list: Branch[], remote: boolean, depth: number, q: string, cur: string | null, ref: string, select: (name: string) => void) {
  const folders = new Map<string, (Branch & { short: string })[]>();
  const leaves: (Branch & { short: string })[] = [];
  for (const b of list) {
    if (!b.name.toLowerCase().includes(q)) continue;
    const name = remote ? b.branch! : b.name;
    const i = name.indexOf('/');
    if (i > 0) (folders.get(name.slice(0, i)) || folders.set(name.slice(0, i), []).get(name.slice(0, i)))!.push({ ...b, short: name.slice(i + 1) });
    else leaves.push({ ...b, short: name });
  }
  const out: React.ReactNode[] = [];
  for (const [f, items] of [...folders.entries()].sort()) out.push(<Folder key={f} id="" title={f} depth={depth} defaultOpen forceOpen={!!q}>{items.map((b) => <Row key={b.name} b={b} remote={remote} current={!remote && b.name === cur} depth={depth + 1} selected={ref === b.name} onSelect={() => select(b.name)} />)}</Folder>);
  leaves.sort((a, b) => Number(b.name === cur) - Number(a.name === cur) || Number(isFavorite(b.name)) - Number(isFavorite(a.name)) || a.short.localeCompare(b.short));
  for (const b of leaves) out.push(<Row key={b.name} b={b} remote={remote} current={!remote && b.name === cur} depth={depth} selected={ref === b.name} onSelect={() => select(b.name)} />);
  return out;
}

export function LogBranchTree() {
  const { branches, filters, setFilter } = useLogStore();
  const [q, setQ] = useState('');
  if (!branches) return <aside className="log-branches" />;
  const needle = q.trim().toLowerCase();
  const select = (name: string) => setFilter({ ref: filters.ref === name ? 'all' : name });
  const remotes = new Map<string, Branch[]>();
  for (const b of branches.remote) (remotes.get(b.remote!) || remotes.set(b.remote!, []).get(b.remote!))!.push(b);
  return (
    <aside className="log-branches">
      <div className="log-branches-toolbar"><div className="search-field sm"><Icon name="search" /><input value={q} placeholder="Search branches" onChange={(e) => setQ(e.target.value)} /></div></div>
      <div className="log-branch-tree">
        <div className={`lb-row${filters.ref === 'HEAD' ? ' selected' : ''}`} style={{ paddingLeft: 8 }} onClick={() => select('HEAD')}><Icon name="locate" /><span className="lb-name">HEAD (Current Branch)</span></div>
        <Folder id="local" title="Local" depth={0} defaultOpen forceOpen={!!needle}>{tree(branches.local, false, 1, needle, branches.current, filters.ref, select)}</Folder>
        <Folder id="remote" title="Remote" depth={0} defaultOpen forceOpen={!!needle}>
          {[...remotes.entries()].map(([name, list]) => <Folder key={name} id="" title={name} depth={1} defaultOpen forceOpen={!!needle}>{tree(list, true, 2, needle, branches.current, filters.ref, select)}</Folder>)}
        </Folder>
        <Folder id="tags" title="Tags" depth={0} defaultOpen={false} forceOpen={!!needle}>
          {branches.tags.filter((t) => t.name.toLowerCase().includes(needle)).slice(0, 100).map((t) => <Row key={t.name} b={t} depth={1} icon="tag" selected={filters.ref === t.name} onSelect={() => select(t.name)} />)}
        </Folder>
      </div>
    </aside>
  );
}
