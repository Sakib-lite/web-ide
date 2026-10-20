'use client';

import { useEffect, useState } from 'react';
import { api, gitApi } from '@/lib/api';
import { EditorSettings, useStore } from '@/lib/store';
import { emit } from '@/lib/bus';
import { DialogFrame, openDialog } from '@/components/ui/dialogs';
import { Icon } from '@/components/ui/Icon';
import { toast } from '@/components/ui/Toasts';
import { KEYMAP_GROUPS } from '@/editor/keymap-reference';
import { loadGithubUser } from './github-actions';
import { usePullsStore } from './pulls-store';

type Section = 'git' | 'editor' | 'diff' | 'terminal' | 'keymap';
const SECTIONS: { id: Section; label: string; icon: string }[] = [
  { id: 'git', label: 'Git', icon: 'branch' },
  { id: 'editor', label: 'Editor', icon: 'file' },
  { id: 'diff', label: 'Diff', icon: 'diff' },
  { id: 'terminal', label: 'Terminal', icon: 'terminal' },
  { id: 'keymap', label: 'Keymap', icon: 'customize' },
];

function Num({ label, value, min, max, step = 1, suffix, onChange }: { label: string; value: number; min: number; max: number; step?: number; suffix?: string; onChange: (v: number) => void }) {
  return (
    <div className="form-field">
      <label>{label}</label>
      <div className="settings-num">
        <input type="number" value={value} min={min} max={max} step={step} onChange={(e) => onChange(Math.min(max, Math.max(min, Number(e.target.value) || min)))} />
        {suffix && <span className="settings-suffix">{suffix}</span>}
      </div>
    </div>
  );
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return <div className="form-field"><label className="chk"><input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} /><span />{label}</label></div>;
}

function SettingsView({ close, initial }: { close: () => void; initial: Section }) {
  const project = useStore((s) => s.project);
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);
  const [section, setSection] = useState<Section>(initial);
  const [token, setToken] = useState('');
  const [hasToken, setHasToken] = useState(false);
  const [user, setUser] = useState<{ login: string; name?: string; avatar_url?: string } | null>(null);
  const [clear, setClear] = useState(false);
  const [git, setGit] = useState({ name: '', email: '' });
  const [initialGit, setInitialGit] = useState({ name: '', email: '' });
  const [local, setLocal] = useState<EditorSettings>({ ...settings });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [kmq, setKmq] = useState('');
  const patchLocal = (p: Partial<EditorSettings>) => setLocal((s) => ({ ...s, ...p }));
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
      if (token && !token.includes('*')) patch.githubToken = token;
      await api('/api/settings', { method: 'POST', body: patch });
      if (project && (git.name !== initialGit.name || git.email !== initialGit.email)) await api('/api/git/config', { method: 'POST', body: git });
      updateSettings(local);
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
    <DialogFrame title="Settings" width={680} onClose={close} footer={<><button className="btn" onClick={close}>Cancel</button><button className="btn primary" disabled={busy} onClick={apply}>{busy ? 'Working…' : 'Apply'}</button></>}>
      <div className="settings-layout">
        <nav className="settings-nav">
          {SECTIONS.map((s) => <button key={s.id} className={s.id === section ? 'active' : ''} onClick={() => setSection(s.id)}><Icon name={s.icon} />{s.label}</button>)}
        </nav>
        <div className="settings-body">
          {section === 'git' && (
            <>
              <div className="form-static"><b>GitHub</b></div>
              <div className="gh-user">
                {!hasToken && <span style={{ color: 'var(--text-muted)' }}>Not logged in. Create a token at github.com → Settings → Developer settings → Personal access tokens (scopes: repo).</span>}
                {hasToken && (user?.avatar_url ? <><img src={user.avatar_url} alt="" /><span>{user.name || user.login} ({user.login})</span></> : <><Icon name="github" /><span>Logged in as <b>{user?.login || '…'}</b></span></>)}
              </div>
              <div className="form-field">
                <label>Personal access token:</label>
                <input type="password" value={token} placeholder="ghp_… or github_pat_…" onChange={(e) => setToken(e.target.value)} />
                <div className="form-static">Stored on the API server in personal-data/settings.json (mode 600) and used for the GitHub API, clone, fetch, pull and push over HTTPS.</div>
              </div>
              <Check label="Log out (remove token)" checked={clear} onChange={setClear} />
              <div className="form-static"><br /><b>Git</b></div>
              <div className="form-row">
                <div className="form-field"><label>user.name (this repository):</label><input type="text" value={git.name} disabled={!project} onChange={(e) => setGit({ ...git, name: e.target.value })} /></div>
                <div className="form-field"><label>user.email:</label><input type="text" value={git.email} disabled={!project} onChange={(e) => setGit({ ...git, email: e.target.value })} /></div>
              </div>
              {!project && <div className="form-static">Open a project to edit its repository user settings.</div>}
              <Check label="Update Project uses rebase instead of merge" checked={local.updateRebase} onChange={(v) => patchLocal({ updateRebase: v })} />
            </>
          )}
          {section === 'editor' && (
            <>
              <div className="form-static"><b>Editor</b></div>
              <div className="form-row">
                <Num label="Font size:" value={local.fontSize} min={9} max={28} onChange={(v) => patchLocal({ fontSize: v })} />
                <Num label="Tab size:" value={local.tabSize} min={1} max={8} onChange={(v) => patchLocal({ tabSize: v })} />
              </div>
              <Check label="Soft-wrap long lines" checked={local.wordWrap === 'on'} onChange={(v) => patchLocal({ wordWrap: v ? 'on' : 'off' })} />
              <Check label="Show minimap" checked={local.minimap} onChange={(v) => patchLocal({ minimap: v })} />
              <Check label="Sticky scroll (pin enclosing scopes)" checked={local.stickyScroll} onChange={(v) => patchLocal({ stickyScroll: v })} />
              <Check label="Font ligatures" checked={local.fontLigatures} onChange={(v) => patchLocal({ fontLigatures: v })} />
              <Num label="Auto-save delay:" value={local.autoSaveDelay} min={200} max={10000} step={100} suffix="ms" onChange={(v) => patchLocal({ autoSaveDelay: v })} />
              <div className="form-static">Auto-save delay applies to files opened after the change.</div>
            </>
          )}
          {section === 'diff' && (
            <>
              <div className="form-static"><b>Diff Viewer</b></div>
              <Check label="Side-by-side layout" checked={local.diffSideBySide} onChange={(v) => patchLocal({ diffSideBySide: v })} />
              <Check label="Ignore trim whitespace" checked={local.diffIgnoreWs} onChange={(v) => patchLocal({ diffIgnoreWs: v })} />
            </>
          )}
          {section === 'terminal' && (
            <>
              <div className="form-static"><b>Terminal</b></div>
              <Num label="Font size:" value={local.terminalFontSize} min={9} max={24} step={0.5} onChange={(v) => patchLocal({ terminalFontSize: v })} />
            </>
          )}
          {section === 'keymap' && (
            <>
              <div className="se-input km-search"><Icon name="search" /><input value={kmq} placeholder="Filter shortcuts…" autoComplete="off" onChange={(e) => setKmq(e.target.value)} /></div>
              <div className="km-list">
                {KEYMAP_GROUPS.map((g) => {
                  const q = kmq.trim().toLowerCase();
                  const rows = q ? g.items.filter((it) => it.label.toLowerCase().includes(q) || it.keys.some((k) => k.toLowerCase().includes(q))) : g.items;
                  if (!rows.length) return null;
                  return (
                    <div key={g.title}>
                      <div className="km-group">{g.title}</div>
                      {rows.map((it) => (
                        <div key={it.label} className="km-row">
                          <span>{it.label}</span>
                          <span className="km-keys">{it.keys.map((k) => <kbd key={k}>{k}</kbd>)}</span>
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
              <div className="form-static">JetBrains-style keymap · ⌘ Command · ⌥ Option · ⇧ Shift · ⌃ Control. On Windows/Linux ⌘ is Ctrl and ⌥ is Alt.</div>
            </>
          )}
          <div className="form-error">{error}</div>
        </div>
      </div>
    </DialogFrame>
  );
}

export function openSettingsDialog(section: Section = 'git') {
  return openDialog((close) => <SettingsView close={() => close()} initial={section} />);
}
