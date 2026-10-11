'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { debounce } from '@/lib/utils';
import { DialogFrame, openDialog } from '@/components/ui/dialogs';
import { Icon } from '@/components/ui/Icon';
import { toast } from '@/components/ui/Toasts';
import { loadGithubUser } from './github-actions';
import { openSettingsDialog } from './SettingsDialog';

interface Repo {
  id: number;
  name: string;
  fullName: string;
  private: boolean;
  description: string | null;
  language: string | null;
  cloneUrl: string;
  sshUrl: string;
}

function CloneView({ close, onOpen }: { close: () => void; onOpen: (root: string) => void }) {
  const [mode, setMode] = useState<'url' | 'github'>('url');
  const [hasToken, setHasToken] = useState(false);
  const [home, setHome] = useState('');
  const [url, setUrl] = useState('');
  const [directory, setDirectory] = useState('');
  const [repos, setRepos] = useState<Repo[]>([]);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Repo | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [reposError, setReposError] = useState('');
  useEffect(() => {
    api<{ home: string }>('/api/browse').then((b) => { setHome(b.home); setDirectory(`${b.home}/projects/`); }).catch(() => undefined);
    loadGithubUser().then((s) => { setHasToken(s.hasGithubToken); if (s.hasGithubToken) setMode('github'); });
  }, []);
  useEffect(() => {
    if (mode !== 'github' || !hasToken) return;
    const run = debounce((q: string) => api<Repo[]>('/api/github/repos', { query: { q } }).then((r) => { setRepos(r); setReposError(''); }).catch((e) => setReposError(e.message)), 400);
    run(search);
    return () => run.cancel();
  }, [mode, hasToken, search]);
  const pickUrl = (v: string) => {
    setUrl(v);
    const m = /\/([^/]+?)(?:\.git)?\/?$/.exec(v.trim());
    if (m) setDirectory(`${home}/projects/${m[1]}`);
  };
  const clone = async () => {
    const target = mode === 'url' ? url.trim() : selected ? (hasToken ? selected.cloneUrl : selected.sshUrl) : '';
    if (!target) return setError(mode === 'url' ? 'Enter a repository URL' : 'Select a repository');
    if (!directory.trim()) return setError('Enter a directory');
    setError('');
    setProgress('Cloning…');
    try {
      const { jobId } = await api<{ jobId: string }>('/api/clone', { method: 'POST', body: { url: target, directory: directory.trim() } });
      const root = await new Promise<string>((resolve, reject) => {
        const tick = async () => {
          const j = await api<{ done: boolean; error: string | null; output: string; root: string }>(`/api/clone/${jobId}`).catch((e) => ({ done: true, error: e.message, output: '', root: '' }));
          setProgress((j.output || 'Cloning…').split('\r').pop()!);
          if (j.done) return j.error ? reject(new Error(j.error)) : resolve(j.root);
          setTimeout(tick, 500);
        };
        tick();
      });
      toast('Repository cloned', root, 'success');
      close();
      setTimeout(() => onOpen(root), 50);
    } catch (err: any) {
      setError(err.message);
      setProgress(null);
    }
  };
  return (
    <DialogFrame title="Get from Version Control" width={640} onClose={close} footer={<><button className="btn" onClick={close}>Cancel</button><button className="btn primary" disabled={!!progress} onClick={clone}>{progress ? 'Cloning…' : 'Clone'}</button></>}>
      <div className="form-tabs">
        <button className={mode === 'url' ? 'active' : ''} onClick={() => setMode('url')}>Repository URL</button>
        <button className={mode === 'github' ? 'active' : ''} onClick={() => setMode('github')}>GitHub</button>
      </div>
      {mode === 'url' ? (
        <div className="form-field"><label>URL:</label><input type="text" value={url} placeholder="https://github.com/owner/repo.git or git@github.com:owner/repo.git" spellCheck={false} onChange={(e) => pickUrl(e.target.value)} /></div>
      ) : (
        <div className="form-field">
          <div className="search-field sm"><Icon name="search" /><input value={search} placeholder="Search your repositories" onChange={(e) => setSearch(e.target.value)} /></div>
          <div className="repo-list">
            {!hasToken && <div className="pr-login">Log in to GitHub to list your repositories<button className="btn primary" onClick={async () => { await openSettingsDialog(); setHasToken((await loadGithubUser()).hasGithubToken); }}>Log In…</button></div>}
            {hasToken && reposError && <div className="empty-hint">{reposError}</div>}
            {hasToken && !reposError && !repos.length && <div className="empty-hint">No repositories found.</div>}
            {hasToken && repos.map((r) => (
              <div key={r.id} className={`repo-row${selected?.id === r.id ? ' selected' : ''}`} title={r.description || ''} onClick={() => { setSelected(r); setDirectory(`${home}/projects/${r.name}`); }} onDoubleClick={clone}>
                <Icon name="github" /><span>{r.fullName}</span>{r.private && <span className="lock">private</span>}<span className="repo-desc">{r.description}</span><span className="repo-lang">{r.language}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="form-field mono"><label>Directory:</label><input type="text" value={directory} spellCheck={false} onChange={(e) => setDirectory(e.target.value)} /></div>
      {progress && <pre className="form-static" style={{ maxHeight: 120, overflow: 'auto', fontFamily: 'var(--font-mono)', fontSize: 11, whiteSpace: 'pre-wrap' }}>{progress}</pre>}
      <div className="form-error">{error}</div>
    </DialogFrame>
  );
}

export function openCloneDialog(onOpen: (root: string) => void) {
  return openDialog((close) => <CloneView close={() => close()} onOpen={onOpen} />);
}
