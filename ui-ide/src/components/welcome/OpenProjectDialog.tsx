'use client';

import { useEffect, useState } from 'react';
import { api, favoritesApi } from '@/lib/api';
import { DialogFrame, openDialog } from '@/components/ui/dialogs';
import { Icon } from '@/components/ui/Icon';
import { toast } from '@/components/ui/Toasts';

interface BrowseDir {
  name: string;
  path: string;
  isProject: boolean;
  isGit: boolean;
}

interface Browse {
  path: string;
  parent: string | null;
  home: string;
  dirs: BrowseDir[];
}

function OpenProjectView({ close, startDir }: { close: (path?: string) => void; startDir?: string }) {
  const [data, setData] = useState<Browse | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [pathInput, setPathInput] = useState('');
  const [favorites, setFavorites] = useState<string[]>([]);
  const browse = async (dir?: string) => {
    try {
      const d = await api<Browse>('/api/browse', { query: { dir } });
      setData(d);
      setSelected(null);
      setPathInput(d.path);
    } catch (err: any) {
      toast('Cannot open folder', err.message, 'error');
    }
  };
  useEffect(() => {
    browse(startDir);
  }, [startDir]);
  useEffect(() => {
    favoritesApi.list().then(setFavorites).catch(() => setFavorites([]));
  }, []);
  const toggleFavorite = async (e: React.MouseEvent, path: string) => {
    e.stopPropagation();
    try {
      setFavorites(await (favorites.includes(path) ? favoritesApi.remove(path) : favoritesApi.add(path)));
    } catch (err: any) {
      toast('Could not update favorites', err.message, 'error');
    }
  };
  return (
    <DialogFrame
      title="Open File or Project"
      hint="Folders with a .git, package.json or composer.json are marked as projects."
      onClose={() => close()}
      footer={
        <>
          <button className="btn" onClick={() => close()}>Cancel</button>
          <button className="btn primary" onClick={() => close(selected || data?.path)}>Open</button>
        </>
      }
    >
      {!!favorites.length && (
        <div className="favorites-row">
          {favorites.map((f) => (
            <button key={f} className="favorite-chip" title={f} onClick={() => browse(f)}>
              <Icon name="star" />
              <span>{f.split('/').pop() || f}</span>
            </button>
          ))}
        </div>
      )}
      <div className="path-row">
        <button className="tb-icon" title="Up one level" onClick={() => data?.parent && browse(data.parent)}><Icon name="up" /></button>
        <button className="tb-icon" title="Home" onClick={() => browse(data?.home)}><Icon name="home" /></button>
        <input value={pathInput} spellCheck={false} onChange={(e) => setPathInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && browse(pathInput.trim())} />
        {data && (
          <button
            className={`tb-icon${favorites.includes(data.path) ? ' active' : ''}`}
            title={favorites.includes(data.path) ? 'Remove from favorites' : 'Add current folder to favorites'}
            onClick={(e) => toggleFavorite(e, data.path)}
          >
            <Icon name="star" />
          </button>
        )}
      </div>
      <div className="browse-list">
        {data && !data.dirs.length && <div className="empty-hint">No sub-folders here. Click Open to use this folder as the project.</div>}
        {data?.dirs.map((d) => (
          <div key={d.path} className={`browse-item${selected === d.path ? ' selected' : ''}`} onClick={() => setSelected(d.path)} onDoubleClick={() => browse(d.path)}>
            <span className={`ficon folder${d.isProject ? ' project' : ''}`}><Icon name="folder" /></span>
            <span>{d.name}</span>
            {d.isGit ? <span className="tag git">git</span> : d.isProject ? <span className="tag">project</span> : null}
            <button
              className={`favorite-toggle${favorites.includes(d.path) ? ' active' : ''}`}
              title={favorites.includes(d.path) ? 'Remove from favorites' : 'Add to favorites'}
              onClick={(e) => toggleFavorite(e, d.path)}
            >
              <Icon name="star" />
            </button>
          </div>
        ))}
      </div>
    </DialogFrame>
  );
}

export function openProjectDialog(startDir?: string) {
  return openDialog<string>((close) => <OpenProjectView close={close} startDir={startDir} />);
}
