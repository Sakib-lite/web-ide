'use client';

import { useEffect, useState } from 'react';
import { api, gitApi } from '@/lib/api';
import { showContextMenu } from '@/components/ui/ContextMenu';
import { toast } from '@/components/ui/Toasts';
import { Icon } from '@/components/ui/Icon';
import { useCommitStore } from './commit-store';
import { commit, commitHistory, generateCommitMessage } from './commit-actions';

export function CommitForm() {
  const { message, amend, setMessage, setAmend, checked } = useCommitStore();
  const [author, setAuthor] = useState<{ name: string; email: string } | null>(null);
  const [busy, setBusy] = useState<'commit' | 'ai' | null>(null);
  useEffect(() => {
    gitApi.config().then(setAuthor).catch(() => setAuthor(null));
  }, []);
  const toggleAmend = async (on: boolean) => {
    setAmend(on);
    if (on && !message.trim()) {
      const log = await gitApi.log({ ref: 'HEAD', limit: 1 }).catch(() => ({ commits: [] }));
      const c = log.commits?.[0];
      if (c) setMessage((await api(`/api/git/commit/${c.hash}`).catch(() => ({ message: c.subject }))).message);
    }
  };
  const history = (e: React.MouseEvent) => {
    const r = e.currentTarget.getBoundingClientRect();
    const items = commitHistory();
    if (!items.length) return toast('No commit message history', '', 'info', 1500);
    showContextMenu(r.left, r.bottom + 4, items.map((m) => ({ label: m.split('\n')[0].slice(0, 70), action: () => setMessage(m) })));
  };
  const run = async (kind: 'commit' | 'ai', fn: () => Promise<unknown>) => {
    setBusy(kind);
    try {
      await fn();
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="commit-form">
      <div className="commit-options">
        <label className="chk"><input type="checkbox" checked={amend} onChange={(e) => toggleAmend(e.target.checked)} /><span />Amend</label>
        <span className="commit-author" title={author?.name ? 'Author (from git config)' : 'Set user.name / user.email in Settings → Git'}>{author?.name ? `${author.name} <${author.email}>` : 'No git identity'}</span>
        <button className="tb-icon sm" title="Commit message history" onClick={history}><Icon name="history" /></button>
        <button className={`tb-icon sm${busy === 'ai' ? ' busy' : ''}`} id="btn-commit-ai" title="Generate commit message with Claude (from the checked files)" disabled={busy === 'ai'} onClick={() => run('ai', generateCommitMessage)}><span className="ico-ai">✦</span></button>
      </div>
      <textarea id="commit-message" placeholder={busy === 'ai' ? 'Claude is writing a commit message…' : 'Commit Message'} rows={5} value={message} onChange={(e) => setMessage(e.target.value)} onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === 'Enter' && run('commit', () => commit())} />
      <div className="commit-buttons">
        <button className="btn primary" id="btn-commit" disabled={busy === 'commit'} onClick={() => run('commit', () => commit())}>{busy === 'commit' ? 'Committing…' : checked.size ? `Commit (${checked.size})` : 'Commit'}</button>
        <button className="btn" onClick={() => run('commit', () => commit({ push: true }))}>Commit and Push…</button>
      </div>
    </div>
  );
}
