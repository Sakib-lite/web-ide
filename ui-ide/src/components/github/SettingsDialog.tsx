'use client';

import { useEffect, useState } from 'react';
import { api, gitApi } from '@/lib/api';
import { useStore } from '@/lib/store';
import { emit } from '@/lib/bus';
import { DialogFrame, openDialog } from '@/components/ui/dialogs';
import { Icon } from '@/components/ui/Icon';
import { toast } from '@/components/ui/Toasts';
import { loadGithubUser } from './github-actions';
import { usePullsStore } from './pulls-store';

function SettingsView({ close }: { close: () => void }) {
  const project = useStore((s) => s.project);
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);
  const [token, setToken] = useState('');
  const [hasToken, setHasToken] = useState(false);
  const [user, setUser] = useState<{ login: string; name?: string; avatar_url?: string } | null>(null);
  const [clear, setClear] = useState(false);
  const [git, setGit] = useState({ name: '', email: '' });
  const [initialGit, setInitialGit] = useState({ name: '', email: '' });
  const [rebase, setRebase] = useState(settings.updateRebase);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    loadGithubUser().then((s) => {
      setToken(s.githubToken);
      setHasToken(s.hasGithubToken);
      if (s.hasGithubToken) api('/api/github/user').then(setUser).catch(() => setUser({ login: s.githubUser || '' }));
    });
    if (project) gitApi.config().then((c) => { setGit(c); setInitialGit(c); }).catch(() => undefined);
  }, [project]);
  const apply = async () => {
    setBusy(true);
    setError('');
    try {
      const patch: Record<string, unknown> = { clearGithubToken: clear };
      if (token && !token.includes('•')) patch.githubToken = token;
      await api('/api/settings', { method: 'POST', body: patch });
      if (project && (git.name !== initialGit.name || git.email !== initialGit.email)) await api('/api/git/config', { method: 'POST', body: git });
      updateSettings({ updateRebase: rebase });
      const s = await loadGithubUser();
      usePullsStore.getState().loadRepo(true);
      if (patch.githubToken) toast('GitHub connected', `Logged in as ${s.githubUser}`, 'success');
      emit('settings-changed');
      close();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <DialogFrame title="Settings" width={560} onClose={close} footer={<><button className="btn" onClick={close}>Cancel</button><button className="btn primary" disabled={busy} onClick={apply}>{busy ? 'Working…' : 'Apply'}</button></>}>
      <div className="form-static"><b>Version Control → GitHub</b></div>
      <div className="gh-user">
        {!hasToken && <span style={{ color: 'var(--text-muted)' }}>Not logged in. Create a token at github.com → Settings → Developer settings → Personal access tokens (scopes: repo).</span>}
        {hasToken && (user?.avatar_url ? <><img src={user.avatar_url} alt="" /><span>{user.name || user.login} ({user.login})</span></> : <><Icon name="github" /><span>Logged in as <b>{user?.login || '…'}</b></span></>)}
      </div>
      <div className="form-field">
        <label>Personal access token:</label>
        <input type="password" value={token} placeholder="ghp_… or github_pat_…" onChange={(e) => setToken(e.target.value)} />
        <div className="form-static">Stored on the API server in data/settings.json (mode 600) and used for the GitHub API, clone, fetch, pull and push over HTTPS.</div>
      </div>
      <div className="form-field"><label className="chk"><input type="checkbox" checked={clear} onChange={(e) => setClear(e.target.checked)} /><span />Log out (remove token)</label></div>
      <div className="form-static"><br /><b>Version Control → Git</b></div>
      <div className="form-row">
        <div className="form-field"><label>user.name (this repository):</label><input type="text" value={git.name} onChange={(e) => setGit({ ...git, name: e.target.value })} /></div>
        <div className="form-field"><label>user.email:</label><input type="text" value={git.email} onChange={(e) => setGit({ ...git, email: e.target.value })} /></div>
      </div>
      <div className="form-field"><label className="chk"><input type="checkbox" checked={rebase} onChange={(e) => setRebase(e.target.checked)} /><span />Update Project uses rebase instead of merge</label></div>
      <div className="form-error">{error}</div>
    </DialogFrame>
  );
}

export function openSettingsDialog() {
  return openDialog((close) => <SettingsView close={() => close()} />);
}
