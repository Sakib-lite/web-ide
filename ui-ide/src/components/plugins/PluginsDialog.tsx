'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { DialogFrame, openDialog } from '@/components/ui/dialogs';
import { Icon } from '@/components/ui/Icon';
import { toast } from '@/components/ui/Toasts';
import { PluginManifest } from '@/plugins/loader';

function PluginsView({ close }: { close: () => void }) {
  const [list, setList] = useState<PluginManifest[]>([]);
  const [url, setUrl] = useState('');
  const [installing, setInstalling] = useState(false);
  useEffect(() => {
    api<PluginManifest[]>('/api/plugins').then(setList).catch(() => setList([]));
  }, []);
  const toggle = async (p: PluginManifest, enabled: boolean) => {
    try {
      setList(await api(`/api/plugins/${p.id}/enabled`, { method: 'POST', body: { enabled } }));
      toast(enabled ? 'Plugin enabled' : 'Plugin disabled', `${p.name}, reload the page to apply.`, 'info', 4000);
    } catch (err: any) {
      toast('Cannot change plugin', err.message, 'error');
    }
  };
  const install = async () => {
    if (!url.trim()) return;
    setInstalling(true);
    try {
      setList(await api('/api/plugins/install', { method: 'POST', body: { url: url.trim() } }));
      toast('Plugin installed', 'Reload the page to activate it.', 'success');
      setUrl('');
    } catch (err: any) {
      toast('Install failed', err.message, 'error', 12000);
    } finally {
      setInstalling(false);
    }
  };
  return (
    <DialogFrame title="Plugins" width={640} hint="Plugins are folders with a plugin.json (client.js + optional server.mjs). JetBrains .jar plugins cannot run here." onClose={close} footer={<button className="btn primary" onClick={close}>Close</button>}>
      <div className="plugin-list">
        {!list.length && <div className="empty-hint">No plugins installed.</div>}
        {list.map((p) => (
          <div key={p.id} className="plugin-row">
            <span className="plugin-icon">{p.icon ? <span dangerouslySetInnerHTML={{ __html: p.icon }} /> : <Icon name="plugins" />}</span>
            <div className="plugin-text">
              <div className="plugin-name">{p.name} <span className="plugin-ver">{p.version}</span>{p.builtin && <span className="plugin-tag">bundled</span>}{p.error && <span className="plugin-tag err" title={p.error}>error</span>}</div>
              <div className="plugin-desc">{p.description}</div>
              <div className="plugin-meta">{p.vendor ? `${p.vendor} · ` : ''}{p.homepage && <a href={p.homepage} target="_blank" rel="noreferrer">homepage</a>} · {p.dir}</div>
            </div>
            <label className="chk" title="Enabled"><input type="checkbox" checked={p.enabled} onChange={(e) => toggle(p, e.target.checked)} /><span /></label>
          </div>
        ))}
      </div>
      <div className="form-field">
        <label>Install a plugin from a Git repository:</label>
        <div className="form-row">
          <input type="text" value={url} placeholder="https://github.com/owner/ide-plugin.git" spellCheck={false} onChange={(e) => setUrl(e.target.value)} />
          <button className="btn" disabled={installing} onClick={install}>{installing ? 'Installing…' : 'Install from Git'}</button>
        </div>
      </div>
    </DialogFrame>
  );
}

export function openPluginsDialog() {
  return openDialog((close) => <PluginsView close={() => close()} />);
}
