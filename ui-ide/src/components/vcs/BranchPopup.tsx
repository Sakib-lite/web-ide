'use client';

import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { api } from '@/lib/api';
import { useStore } from '@/lib/store';
import { emit } from '@/lib/bus';
import { isMac, readLocal, timeAgo, writeLocal } from '@/lib/utils';
import { Icon } from '@/components/ui/Icon';
import { MenuItem, showContextMenu } from '@/components/ui/ContextMenu';
import { toast } from '@/components/ui/Toasts';
import { focusCommitMessage } from '@/components/git/commit-actions';
import { Branch, Branches, checkout, checkoutRevisionDialog, compareWith, deleteBranch, fetchAll, isFavorite, loadBranches, mergeInto, newBranchDialog, pullBranch, pushDialog, rebaseOnto, renameBranch, runGit, toggleFavorite, updateProject } from './vcs-actions';

interface PopupState {
  anchor: HTMLElement | null;
  data: Branches | null;
  open: (anchor: HTMLElement, data: Branches) => void;
  close: () => void;
}

const usePopup = create<PopupState>((set) => ({ anchor: null, data: null, open: (anchor, data) => set({ anchor, data }), close: () => set({ anchor: null, data: null }) }));

export async function openBranchPopup(anchor: HTMLElement) {
  if (!useStore.getState().gitStatus.repo) return toast('Not a Git repository', 'Use the Commit tool window to create one.', 'info');
  try {
    usePopup.getState().open(anchor, await loadBranches(true));
  } catch (err: any) {
    toast('Cannot load branches', err.message, 'error');
  }
}

export function branchActions(b: Branch, { remote = false, current = false }: { remote?: boolean; current?: boolean }): MenuItem[] {
  const cur = useStore.getState().gitStatus.branch || '';
  const showLog = () => {
    useStore.getState().showTool('git');
    emit('log-filter-ref', { ref: b.name });
  };
  const items: (MenuItem | null)[] = [
    current ? { label: 'Update…', key: '⌘T', action: () => updateProject() } : { label: 'Checkout', action: () => checkout(b.name).catch(() => undefined) },
    current ? { label: 'Push…', key: '⇧⌘K', action: () => pushDialog() } : null,
    { label: `New Branch from '${b.name}'…`, action: () => newBranchDialog(b.name) },
    'sep',
    !current ? { label: `Compare with '${cur}'`, action: () => compareWith(b.name) } : null,
    !current ? { label: `Merge '${b.name}' into '${cur}'`, action: () => mergeInto(b.name) } : null,
    !current ? { label: `Rebase '${cur}' onto '${b.name}'`, action: () => rebaseOnto(b.name) } : null,
    remote ? { label: `Pull into '${cur}' Using Merge`, action: () => pullBranch(b.name, false) } : null,
    remote ? { label: `Pull into '${cur}' Using Rebase`, action: () => pullBranch(b.name, true) } : null,
    'sep',
    { label: isFavorite(b.name) ? 'Remove from Favorites' : 'Add to Favorites', action: () => toggleFavorite(b.name) },
    { label: 'Show Log', action: showLog },
    'sep',
    !remote && !current ? { label: 'Rename…', action: () => renameBranch(b.name) } : null,
    !current ? { label: 'Delete', danger: true, action: () => deleteBranch(b.name, remote) } : null,
  ];
  return items.filter((i): i is MenuItem => i !== null);
}

function BranchRow({ b, remote, current, indent, close }: { b: Branch; remote?: boolean; current?: boolean; indent: string; close: () => void }) {
  const menu = (x: number, y: number) => showContextMenu(x, y, branchActions(b, { remote, current }).map((it) => (it === 'sep' || !it.action ? it : { ...it, action: () => { close(); it.action!(); } })));
  const fav = isFavorite(b.name);
  return (
    <div
      className={`bp-item ${indent}${current ? ' current' : ''}`}
      title={`${b.subject || ''}\n${b.date ? timeAgo(b.date) : ''}`.trim()}
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        if (current || (e.target as HTMLElement).closest('.bp-more')) return menu(r.right - 220, r.bottom);
        close();
        checkout(b.name).catch(() => undefined);
      }}
      onContextMenu={(e) => { e.preventDefault(); menu(e.clientX, e.clientY); }}
    >
      <Icon name={current ? 'tag' : fav ? 'star' : 'branch'} style={current ? { color: 'var(--accent)' } : fav ? { color: 'var(--warning)' } : undefined} />
      <span className="bp-name">{b.name}</span>
      <span className="bp-upstream">{!remote && b.upstream ? b.upstream : ''}</span>
      {!remote && (b.ahead || b.behind) ? <span className="bp-sync">{`${b.ahead ? '↑' + b.ahead : ''} ${b.behind ? '↓' + b.behind : ''}`.trim()}</span> : null}
      <Icon name="chevron-right" className="bp-more" />
    </div>
  );
}

function Group({ id, title, children, forceOpen }: { id: string; title: string; children: React.ReactNode[]; forceOpen: boolean }) {
  const [open, setOpen] = useState(() => readLocal<string[]>('ide.bpOpen', ['recent', 'local', 'remote']).includes(id));
  if (!children.length) return null;
  const toggle = () => {
    const next = !open;
    setOpen(next);
    const saved = new Set(readLocal<string[]>('ide.bpOpen', ['recent', 'local', 'remote']));
    next ? saved.add(id) : saved.delete(id);
    writeLocal('ide.bpOpen', [...saved]);
  };
  return (
    <>
      <div className={`bp-group${open || forceOpen ? ' open' : ''}`} onClick={toggle}><Icon name="chevron-right" /><span>{title}</span></div>
      <div className="bp-group-body"><div>{children}</div></div>
    </>
  );
}

export function BranchPopupHost() {
  const { anchor, data, close } = usePopup();
  const [query, setQuery] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const operation = useStore((s) => s.gitStatus.operation);
  useEffect(() => {
    if (!anchor) return setQuery('');
    setTimeout(() => input.current?.focus(), 20);
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest('#branch-popup') && !t.closest('.context-menu') && !t.closest('.overlay')) close();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !document.querySelector('.overlay') && close();
    const id = setTimeout(() => {
      addEventListener('mousedown', onDown, true);
      addEventListener('keydown', onKey, true);
    });
    return () => {
      clearTimeout(id);
      removeEventListener('mousedown', onDown, true);
      removeEventListener('keydown', onKey, true);
    };
  }, [anchor, close]);
  if (!anchor || !data) return null;
  const r = anchor.getBoundingClientRect();
  const q = query.toLowerCase();
  const match = (s: string) => !q || s.toLowerCase().includes(q);
  const run = (fn: () => void) => () => { close(); fn(); };
  const actions = [
    { label: 'Update Project…', icon: 'update', key: '⌘T', run: () => updateProject() },
    { label: 'Commit…', icon: 'commit', key: '⌘K', run: focusCommitMessage },
    { label: 'Push…', icon: 'push', key: '⇧⌘K', run: () => pushDialog() },
    { label: 'Fetch', icon: 'refresh', run: () => fetchAll() },
    null,
    { label: 'New Branch…', icon: 'plus', key: isMac ? '⌥⌘N' : 'Ctrl+Alt+N', run: () => newBranchDialog() },
    { label: 'Checkout Tag or Revision…', icon: 'tag', run: () => checkoutRevisionDialog() },
  ].filter((a) => !a || match(a.label));
  const recent = data.recent.map((n) => data.local.find((b) => b.name === n)).filter((b): b is Branch => !!b && match(b.name));
  const locals = [...data.local].sort((a, b) => Number(isFavorite(b.name)) - Number(isFavorite(a.name)) || a.name.localeCompare(b.name)).filter((b) => match(b.name));
  const remotes = new Map<string, Branch[]>();
  for (const b of data.remote) if (match(b.name)) (remotes.get(b.remote!) || remotes.set(b.remote!, []).get(b.remote!))!.push(b);
  return (
    <div id="branch-popup" className="anchored-popup" style={{ left: Math.min(r.left, innerWidth - 520), top: r.bottom + 6 }}>
      <div className="search-field bp-search"><Icon name="search" /><input ref={input} value={query} placeholder="Search for branches and actions" onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (document.querySelector<HTMLElement>('#branch-popup .bp-item')?.click())} /></div>
      <div className="bp-body">
        {operation && (
          <div className="bp-banner">{operation[0].toUpperCase() + operation.slice(1)} in progress
            <button className="btn" onClick={run(() => runGit(`Continue ${operation}`, () => api('/api/git/continue', { method: 'POST', body: { op: operation } })).catch(() => undefined))}>Continue</button>
            <button className="btn" onClick={run(() => runGit(`Abort ${operation}`, () => api('/api/git/abort', { method: 'POST', body: { op: operation } })).catch(() => undefined))}>Abort</button>
          </div>
        )}
        {actions.map((a, i) => (a ? <div key={a.label} className="bp-item" onClick={run(a.run)}><Icon name={a.icon} /><span className="bp-name">{a.label}</span>{a.key && <span className="bp-key">{a.key}</span>}</div> : <div key={i} className="bp-sep" />))}
        <div className="bp-sep" />
        <Group id="recent" title="Recent" forceOpen={!!q}>{recent.map((b) => <BranchRow key={b.name} b={b} current={b.name === data.current} indent="bp-indent" close={close} />)}</Group>
        <Group id="local" title="Local" forceOpen={!!q}>{locals.map((b) => <BranchRow key={b.name} b={b} current={b.name === data.current} indent="bp-indent" close={close} />)}</Group>
        <Group id="remote" title="Remote" forceOpen={!!q}>
          {[...remotes.entries()].flatMap(([name, list]) => [
            <div key={name} className="bp-item bp-indent" style={{ color: 'var(--text-secondary)' }}><Icon name="folder" /><span>{name}</span></div>,
            ...list.sort((a, b) => a.name.localeCompare(b.name)).map((b) => <BranchRow key={b.name} b={b} remote indent="bp-indent2" close={close} />),
          ])}
        </Group>
        <Group id="tags" title="Tags" forceOpen={!!q}>
          {data.tags.filter((t) => match(t.name)).slice(0, 50).map((t) => <div key={t.name} className="bp-item bp-indent" onClick={run(() => checkout(t.name).catch(() => undefined))}><Icon name="tag" /><span className="bp-name">{t.name}</span><span className="bp-upstream">{t.hash}</span></div>)}
        </Group>
      </div>
    </div>
  );
}
