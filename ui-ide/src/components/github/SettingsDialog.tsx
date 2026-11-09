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

type Section = 'git' | 'ai' | 'editor' | 'diff' | 'terminal' | 'keymap';

interface AiProv {
  baseUrl: string;
  apiKey: string;
  models: string[];
  activeModel?: string;
  thinking?: boolean;
  hasApiKey?: boolean;
}
interface AiCfg {
  responseStyle: 'short' | 'detailed' | 'custom';
  customStyle: string;
  activeProvider: string;
  providers: Record<string, AiProv>;
}

const DEFAULT_AI: AiCfg = {
  responseStyle: 'short',
  customStyle: '',
  activeProvider: 'glm',
  providers: {
    glm: { baseUrl: 'https://api.z.ai/api/coding/paas/v4', apiKey: '', models: ['glm-4.6', 'glm-4.5', 'glm-4.5-air'], activeModel: 'glm-4.6', thinking: false },
    claude: { baseUrl: 'https://api.anthropic.com/v1', apiKey: '', models: ['claude-sonnet-4-5', 'claude-haiku-4-5'], activeModel: 'claude-sonnet-4-5' },
    openai: { baseUrl: 'https://api.openai.com/v1', apiKey: '', models: ['gpt-4o', 'gpt-4o-mini'], activeModel: 'gpt-4o' },
    custom: { baseUrl: '', apiKey: '', models: [] },
  },
};

const SECTIONS: { id: Section; label: string; icon: string }[] = [
  { id: 'git', label: 'Git', icon: 'branch' },
  { id: 'ai', label: 'AI', icon: 'spark' },
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
  const [ai, setAi] = useState<AiCfg>(DEFAULT_AI);
  const [aiOpen, setAiOpen] = useState<string | null>(null);
  const [aiNewName, setAiNewName] = useState('');
  const [aiNewModel, setAiNewModel] = useState<Record<string, string>>({});
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
    api('/api/settings').then((s) => {
      if (s.ai?.providers) setAi(s.ai);
    }).catch(() => undefined);
  }, [project]);
  const apply = async () => {
    setBusy(true);
    setError('');
    try {
      const patch: Record<string, unknown> = { clearGithubToken: clear };
      if (token && !token.includes('*')) patch.githubToken = token;
      patch.ai = ai;
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
          {section === 'ai' && ai && (
            <>
              <div className="form-static"><b>Response Style</b></div>
              <div className="ai-style-row">
                {([['short', 'Short and simple'], ['detailed', 'Detailed'], ['custom', 'Custom instructions']] as const).map(([v, label]) => (
                  <label key={v} className="chk">
                    <input type="radio" name="ai-style" checked={ai.responseStyle === v} onChange={() => setAi({ ...ai, responseStyle: v })} />
                    <span />{label}
                  </label>
                ))}
              </div>
              {ai.responseStyle === 'custom' && (
                <div className="form-field">
                  <label>Custom style instructions:</label>
                  <textarea className="ai-style-custom" rows={2} value={ai.customStyle} placeholder="e.g. Answer in bullet points, max 5 lines, mention performance impact…" onChange={(e) => setAi({ ...ai, customStyle: e.target.value })} />
                </div>
              )}
              <div className="form-static"><br /><b>Providers</b> — pick the active one; each holds its own key, base URL and models.</div>
              {Object.entries(ai.providers).map(([id, p]) => (
                <div key={id} className={`ai-prov${ai.activeProvider === id ? ' active' : ''}`}>
                  <div className="ai-prov-head">
                    <label className="chk" title="Activate this provider">
                      <input type="radio" name="ai-prov" checked={ai.activeProvider === id} onChange={() => setAi({ ...ai, activeProvider: id })} />
                      <span />
                    </label>
                    <button className="ai-prov-name" onClick={() => setAiOpen(aiOpen === id ? null : id)}>
                      <span className="ai-prov-title">{id}{ai.activeProvider === id ? ' · active' : ''}</span>
                      {p.models.length > 0 && <span className="ai-prov-model">{p.activeModel || p.models[0]}</span>}
                      <Icon name={aiOpen === id ? 'collapse' : 'expand'} />
                    </button>
                  </div>
                  {aiOpen === id && (
                    <div className="ai-prov-body">
                      <div className="form-field">
                        <label>Base URL:</label>
                        <input type="text" value={p.baseUrl} placeholder="https://…/v1" onChange={(e) => setAi({ ...ai, providers: { ...ai.providers, [id]: { ...p, baseUrl: e.target.value } } })} />
                      </div>
                      <div className="form-field">
                        <label>API key{p.hasApiKey ? ' (set — type to replace)': ''}:</label>
                        <input type="password" value={p.apiKey} placeholder={p.hasApiKey ? '**********' : 'sk-…'} onChange={(e) => setAi({ ...ai, providers: { ...ai.providers, [id]: { ...p, apiKey: e.target.value } } })} />
                      </div>
                      {id === 'glm' && (
                        <Check label="Thinking mode (model reasons before answering)" checked={!!p.thinking} onChange={(v) => setAi({ ...ai, providers: { ...ai.providers, [id]: { ...p, thinking: v } } })} />
                      )}
                      <div className="form-field">
                        <label>Models — click one to use it, × to remove:</label>
                        <div className="ai-models">
                          {p.models.map((m) => (
                            <span key={m} className={`ai-model${p.activeModel === m ? ' active' : ''}`} onClick={() => setAi({ ...ai, providers: { ...ai.providers, [id]: { ...p, activeModel: m } } })}>
                              {m}
                              <button title="Remove model" onClick={(e) => { e.stopPropagation(); const models = p.models.filter((x) => x !== m); setAi({ ...ai, providers: { ...ai.providers, [id]: { ...p, models, activeModel: p.activeModel === m ? models[0] : p.activeModel } } }); }}>×</button>
                            </span>
                          ))}
                          {!p.models.length && <span className="form-static">No models yet.</span>}
                        </div>
                        <div className="ai-add-model">
                          <input type="text" value={aiNewModel[id] || ''} placeholder="model name, e.g. glm-4.5-air" onChange={(e) => setAiNewModel({ ...aiNewModel, [id]: e.target.value })} />
                          <button className="btn" disabled={!(aiNewModel[id] || '').trim()} onClick={() => { const m = (aiNewModel[id] || '').trim(); if (!m || p.models.includes(m)) return; setAi({ ...ai, providers: { ...ai.providers, [id]: { ...p, models: [...p.models, m], activeModel: p.activeModel || m } } }); setAiNewModel({ ...aiNewModel, [id]: '' }); }}>Add</button>
                        </div>
                      </div>
                      {Object.keys(ai.providers).length > 1 && ai.activeProvider !== id && (
                        <button className="btn danger ai-prov-del" onClick={() => { const providers = { ...ai.providers }; delete providers[id]; setAi({ ...ai, providers }); }}>Remove provider</button>
                      )}
                    </div>
                  )}
                </div>
              ))}
              <div className="ai-add-prov">
                <input type="text" value={aiNewName} placeholder="new provider name, e.g. groq" onChange={(e) => setAiNewName(e.target.value)} />
                <button className="btn" disabled={!aiNewName.trim()} onClick={() => { const n = aiNewName.trim().toLowerCase(); if (!n || ai.providers[n]) return; setAi({ ...ai, providers: { ...ai.providers, [n]: { baseUrl: '', apiKey: '', models: [], thinking: false } } }); setAiOpen(n); setAiNewName(''); }}>Add provider</button>
              </div>
              <div className="form-static">Any OpenAI-compatible /chat/completions provider works. Keys are stored on the API server in personal-data/settings.json (mode 600) and proxied server-side. GLM: https://api.z.ai/api/coding/paas/v4 · OpenAI: https://api.openai.com/v1 · Claude: https://api.anthropic.com/v1 · Ollama: http://localhost:11434/v1</div>
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
