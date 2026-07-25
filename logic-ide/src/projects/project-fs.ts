import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fail } from '../common/errors';

export const IGNORED_DIRS = new Set(['node_modules', '.git', 'vendor', 'dist', 'build', '.next', '.idea', '.vscode', 'coverage', '.cache']);
const HIDDEN = new Set(['.git', '.DS_Store']);

export interface Entry {
  name: string;
  path: string;
  type: 'dir' | 'file';
  ignored: boolean;
}

export class ProjectFS {
  readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  resolve(rel = ''): string {
    const abs = path.resolve(this.root, '.' + path.sep + (rel || ''));
    if (abs !== this.root && !abs.startsWith(this.root + path.sep)) fail('Path escapes project root');
    return abs;
  }

  relative(abs: string): string {
    return path.relative(this.root, abs).split(path.sep).join('/');
  }

  async list(rel = ''): Promise<Entry[]> {
    const abs = this.resolve(rel);
    const entries = await fs.readdir(abs, { withFileTypes: true });
    const out: Entry[] = [];
    for (const e of entries) {
      if (HIDDEN.has(e.name)) continue;
      const isDir = await this.isDirectory(abs, e);
      if (isDir === null) continue;
      out.push({ name: e.name, path: rel ? `${rel}/${e.name}` : e.name, type: isDir ? 'dir' : 'file', ignored: isDir && IGNORED_DIRS.has(e.name) });
    }
    return out.sort(compareEntries);
  }

  private async isDirectory(abs: string, e: { name: string; isDirectory(): boolean; isSymbolicLink(): boolean }): Promise<boolean | null> {
    if (!e.isSymbolicLink()) return e.isDirectory();
    try {
      return (await fs.stat(path.join(abs, e.name))).isDirectory();
    } catch {
      return null;
    }
  }

  async read(rel: string) {
    const abs = this.resolve(rel);
    const stat = await fs.stat(abs);
    if (stat.size > 5 * 1024 * 1024) fail('File too large to open (> 5 MB)', 413);
    const buf = await fs.readFile(abs);
    if (buf.subarray(0, 8192).includes(0)) fail('Binary file', 415);
    return { content: buf.toString('utf8'), size: stat.size, mtime: stat.mtimeMs };
  }

  async write(rel: string, content: string) {
    const abs = this.resolve(rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content, 'utf8');
    const stat = await fs.stat(abs);
    return { mtime: stat.mtimeMs, size: stat.size };
  }

  async create(rel: string, type: 'dir' | 'file') {
    const abs = this.resolve(rel);
    if (type === 'dir') return fs.mkdir(abs, { recursive: true });
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, '', { flag: 'wx' });
  }

  rename(rel: string, newRel: string) {
    return fs.rename(this.resolve(rel), this.resolve(newRel));
  }

  async remove(rel: string) {
    const abs = this.resolve(rel);
    if (abs === this.root) fail('Refusing to delete project root');
    await fs.rm(abs, { recursive: true, force: true });
  }

  async exists(rel: string): Promise<boolean> {
    return !!(await fs.stat(this.resolve(rel)).catch(() => null));
  }

  async *walk(rel = '', exts?: Set<string>): AsyncGenerator<string> {
    let entries: import('node:fs').Dirent[];
    try {
      entries = await fs.readdir(this.resolve(rel), { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isDirectory() && (e.name.startsWith('.') || IGNORED_DIRS.has(e.name))) continue;
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) yield* this.walk(childRel, exts);
      else if (e.isFile() && (!exts || exts.has(path.extname(e.name).toLowerCase()))) yield childRel;
    }
  }
}

function compareEntries(a: Entry, b: Entry): number {
  if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
}

export async function browseDirectories(dir?: string) {
  const abs = dir ? path.resolve(dir) : os.homedir();
  const entries = await fs.readdir(abs, { withFileTypes: true });
  const dirs: { name: string; path: string; isGit: boolean; isProject: boolean }[] = [];
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    let isDir = e.isDirectory();
    if (e.isSymbolicLink()) {
      try {
        isDir = (await fs.stat(path.join(abs, e.name))).isDirectory();
      } catch {
        continue;
      }
    }
    if (!isDir) continue;
    const inner = await fs.readdir(path.join(abs, e.name)).catch(() => [] as string[]);
    const isGit = inner.includes('.git');
    dirs.push({ name: e.name, path: path.join(abs, e.name), isGit, isProject: isGit || inner.includes('package.json') || inner.includes('composer.json') });
  }
  dirs.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  return { path: abs, parent: path.dirname(abs) === abs ? null : path.dirname(abs), home: os.homedir(), dirs };
}
