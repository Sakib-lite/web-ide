import path from 'node:path';
import chokidar, { FSWatcher } from 'chokidar';
import type { WebSocket } from 'ws';
import { ProjectFS, IGNORED_DIRS } from './project-fs';
import { Git } from '../git/git';
import { Changelists } from '../git/changelists';
import { SymbolIndex } from '../symbols/symbol-index';
import { INDEXED_EXTS } from '../symbols/types';
import { CommandEntry } from '../git/git-runner';
import { parseGitHubRemote } from '../github/github-client';

const GIT_SIGNALS = new Set(['HEAD', 'ORIG_HEAD', 'MERGE_HEAD', 'FETCH_HEAD', 'index', 'packed-refs']);

export class Project {
  readonly name: string;
  readonly fs: ProjectFS;
  readonly git: Git;
  readonly changelists: Changelists;
  readonly symbols: SymbolIndex;
  readonly clients = new Set<WebSocket>();
  readonly console: CommandEntry[] = [];
  private readonly watcher: FSWatcher;
  private pending: { event: string; path: string }[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private rebuildTimer: NodeJS.Timeout | null = null;

  constructor(readonly root: string, getToken: () => Promise<string | null>) {
    this.name = path.basename(root);
    this.fs = new ProjectFS(root);
    this.git = new Git(root, getToken, (entry) => this.logCommand(entry));
    this.changelists = new Changelists(root);
    this.symbols = new SymbolIndex(this.fs);
    this.symbols.build().then((s) => this.broadcast({ type: 'index-ready', stats: s }));
    this.watcher = chokidar.watch(root, { ignoreInitial: true, persistent: true, ignored: (p) => this.ignored(p), awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 } });
    this.watcher.on('all', (event, p) => this.onFsEvent(event, p));
    this.watcher.on('error', () => undefined);
  }

  private ignored(abs: string): boolean {
    const rel = path.relative(this.root, abs);
    if (!rel) return false;
    const segs = rel.split(path.sep);
    if (segs[0] === '.git') return !(segs.length === 2 && GIT_SIGNALS.has(segs[1])) && segs[1] !== 'refs';
    return segs.some((s) => IGNORED_DIRS.has(s));
  }

  private onFsEvent(event: string, abs: string) {
    const rel = this.fs.relative(abs);
    if (!rel && (event === 'addDir' || event === 'unlinkDir')) {
      if (this.rebuildTimer) clearTimeout(this.rebuildTimer);
      this.rebuildTimer = setTimeout(() => this.rebuildIndex(), 1500);
      return;
    }
    if (!rel || rel.startsWith('..')) return;
    if (rel.startsWith('.git/')) return this.schedule({ event: 'git', path: rel });
    if (INDEXED_EXTS.has(path.extname(rel).toLowerCase())) {
      if (event === 'unlink') this.symbols.removeFile(rel);
      else if (event === 'add' || event === 'change') this.symbols.indexFile(rel).catch(() => undefined);
    }
    this.schedule({ event, path: rel });
  }

  private schedule(change: { event: string; path: string }) {
    this.pending.push(change);
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => {
      const changes = this.pending.splice(0);
      const files = changes.filter((c) => c.event !== 'git');
      if (files.length) this.broadcast({ type: 'fs-change', changes: files });
      if (changes.length !== files.length) this.broadcast({ type: 'git-change' });
    }, 200);
  }

  async rebuildIndex() {
    this.broadcast({ type: 'index-building' });
    const stats = await this.symbols.rebuild();
    this.broadcast({ type: 'index-ready', stats });
    this.broadcast({ type: 'fs-change', changes: [{ event: 'change', path: '' }] });
    return stats;
  }

  logCommand(entry: CommandEntry) {
    this.console.push(entry);
    if (this.console.length > 200) this.console.shift();
    this.broadcast({ type: 'git-command', entry });
  }

  broadcast(msg: Record<string, unknown>) {
    const data = JSON.stringify(msg);
    for (const ws of this.clients) if (ws.readyState === ws.OPEN) ws.send(data);
  }

  async githubRepo() {
    return parseGitHubRemote(await this.git.remoteUrl('origin'));
  }
}
