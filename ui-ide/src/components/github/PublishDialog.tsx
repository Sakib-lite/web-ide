'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useStore } from '@/lib/store';
import { emit } from '@/lib/bus';
import { debounce } from '@/lib/utils';
import { DialogFrame, openDialog } from '@/components/ui/dialogs';
import { toast } from '@/components/ui/Toasts';
import { loadGithubUser } from './github-actions';
import { openSettingsDialog } from './SettingsDialog';

const NAME_RE = /^[A-Za-z0-9_.-]{1,100}$/;

type Availability = { state: 'idle' | 'checking' | 'ok' | 'taken' | 'error'; owner?: string; message?: string };

function PublishView({ close }: { close: (result?: 'published' | 'remote-added') => void }) {
  const project = useStore((s) => s.project)!;
  const [name, setName] = useState(project.name.replace(/[^A-Za-z0-9_.-]+/g, '-'));
  const [description, setDescription] = useState('');
  const [isPrivate, setPrivate] = useState(true);
  const [remoteUrl, setRemoteUrl] = useState('');
  const [hasToken, setHasToken] = useState(true);
  const [availability, setAvailability] = useState<Availability>({ state: 'idle' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    loadGithubUser().then((s) => setHasToken(s.hasGithubToken));
  }, []);
  useEffect(() => {
    if (remoteUrl.trim() || !hasToken) return setAvailability({ state: 'idle' });
    if (!NAME_RE.test(name)) return setAvailability({ state: 'error', message: 'Use letters, numbers, dashes, underscores or dots' });
    setAvailability({ state: 'checking' });
    const run = debounce(() => api<{ available: boolean; owner: string }>('/api/github/repo-available', { query: { name } }).then((r) => setAvailability(r.available ? { state: 'ok', owner: r.owner } : { state: 'taken', owner: r.owner })).catch((e) => setAvailability({ state: 'error', message: e.message })), 400);
    run();
    return () => run.cancel();
  }, [name, remoteUrl, hasToken]);
  const manual = !!remoteUrl.trim();
  const canSubmit = manual || (hasToken && availability.state === 'ok');
  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      if (manual) {
        await api('/api/git/remote', { method: 'POST', body: { name: 'origin', url: remoteUrl.trim() } });
        toast('Remote added', `origin → ${remoteUrl.trim()}`, 'success');
      } else {
        const r = await api<{ url: string; fullName: string; private: boolean }>('/api/github/publish', { method: 'POST', body: { name, description, private: isPrivate } });
        toast('Project published', `${r.fullName} (${r.private ? 'private' : 'public'})`, 'success', 8000);
      }
      emit('git-change');
      close(manual ? 'remote-added' : 'published');
    } catch (e: any) {
      setError(e.message);
      setBusy(false);
    }
  };
  const hint = availability.state === 'checking' ? 'Checking availability…' : availability.state === 'ok' ? `Will be created as ${availability.owner}/${name}` : availability.state === 'taken' ? `${availability.owner}/${name} already exists on GitHub` : availability.message || '';
  return (
    <DialogFrame
      title="Share Project on GitHub"
      width={560}
      onClose={() => close()}
      hint="Creates the repository, adds it as origin and pushes the current branch."
      footer={<><button className="btn" onClick={() => close()}>Cancel</button><button className="btn primary" disabled={busy || !canSubmit} onClick={submit}>{busy ? 'Working…' : manual ? 'Add Remote' : 'Share'}</button></>}
    >
      {!hasToken && <div className="form-static">Log in to GitHub first to create a repository, or paste an existing remote URL below. <button className="btn" style={{ marginLeft: 8 }} onClick={async () => { await openSettingsDialog(); setHasToken((await loadGithubUser()).hasGithubToken); }}>Log In…</button></div>}
      <div className="form-field mono">
        <label>Repository name:</label>
        <input type="text" value={name} spellCheck={false} disabled={manual} onChange={(e) => setName(e.target.value.trim())} />
        <div className="form-static" style={{ color: availability.state === 'taken' || availability.state === 'error' ? 'var(--danger)' : availability.state === 'ok' ? 'var(--success)' : undefined }}>{manual ? '' : hint}</div>
      </div>
      <div className="form-field"><label>Description:</label><input type="text" value={description} disabled={manual} onChange={(e) => setDescription(e.target.value)} /></div>
      <div className="form-field"><label className="chk"><input type="checkbox" checked={isPrivate} disabled={manual} onChange={(e) => setPrivate(e.target.checked)} /><span />Private repository</label></div>
      <div className="form-field mono">
        <label>Or use an existing remote URL (optional):</label>
        <input type="text" value={remoteUrl} placeholder="git@github.com:owner/repo.git" spellCheck={false} onChange={(e) => setRemoteUrl(e.target.value)} />
      </div>
      <div className="form-error">{error}</div>
    </DialogFrame>
  );
}

export function openPublishDialog() {
  return openDialog<'published' | 'remote-added'>((close) => <PublishView close={close} />);
}
