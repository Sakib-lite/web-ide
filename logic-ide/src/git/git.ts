import fs from 'node:fs/promises';
import path from 'node:path';
import { GitRunner, CommandEntry } from './git-runner';
import { computeLineChanges } from './line-changes';
import { fail } from '../common/errors';

export type FileStatus = 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'conflict' | 'ignored';

export interface StatusFile {
  index: string;
  worktree: string;
  status: FileStatus;
  from: string | null;
  staged: boolean;
}

export interface NameStatus {
  path: string;
  from?: string;
  status: FileStatus;
}

const STATUS_RANK: Record<string, number> = { conflict: 5, modified: 4, added: 3, renamed: 3, untracked: 2, deleted: 1 };
const LOG_FORMAT = '%H%x1f%P%x1f%h%x1f%an%x1f%ae%x1f%at%x1f%ar%x1f%D%x1f%s%x1e';

export class Git {
  private readonly runner: GitRunner;
  private available: boolean | null = null;

  constructor(readonly root: string, getToken: () => Promise<string | null>, onCommand: (entry: CommandEntry) => void) {
    this.runner = new GitRunner(root, getToken, onCommand);
  }

  exec(args: string[], opts?: Parameters<GitRunner['exec']>[1]) {
    return this.runner.exec(args, opts);
  }

  async isRepo(): Promise<boolean> {
    if (this.available !== null) return this.available;
    try {
      this.available = (await this.exec(['rev-parse', '--is-inside-work-tree'])).trim() === 'true';
    } catch {
      this.available = false;
    }
    return this.available;
  }

  async init() {
    await this.exec(['init'], { log: true });
    this.available = null;
  }

  async branch(): Promise<string | null> {
    try {
      return (await this.exec(['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
    } catch {
      return null;
    }
  }

  async headShort(): Promise<string | null> {
    try {
      return (await this.exec(['rev-parse', '--short', 'HEAD'])).trim();
    } catch {
      return null;
    }
  }

  async status() {
    if (!(await this.isRepo())) return { repo: false, branch: null, files: {} as Record<string, StatusFile>, dirs: {} as Record<string, FileStatus> };
    const out = await this.exec(['status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignored=matching']);
    const files = parsePorcelain(out);
    const [tracking, operation, head, branch] = await Promise.all([this.tracking(), this.operationInProgress(), this.headShort(), this.branch()]);
    return { repo: true, branch, detached: branch === 'HEAD', head, files, dirs: rollUpDirs(files), ...tracking, operation };
  }

  private async tracking() {
    try {
      const out = (await this.exec(['rev-list', '--left-right', '--count', '@{upstream}...HEAD'])).trim();
      const [behind, ahead] = out.split(/\s+/).map(Number);
      const upstream = (await this.exec(['rev-parse', '--abbrev-ref', '@{upstream}'])).trim();
      return { upstream, ahead, behind };
    } catch {
      return { upstream: null, ahead: 0, behind: 0 };
    }
  }

  private async operationInProgress(): Promise<string | null> {
    const gitDir = path.resolve(this.root, (await this.exec(['rev-parse', '--git-dir'])).trim());
    const exists = async (p: string) => !!(await fs.stat(path.join(gitDir, p)).catch(() => null));
    if (await exists('MERGE_HEAD')) return 'merge';
    if ((await exists('rebase-merge')) || (await exists('rebase-apply'))) return 'rebase';
    if (await exists('CHERRY_PICK_HEAD')) return 'cherry-pick';
    if (await exists('REVERT_HEAD')) return 'revert';
    return null;
  }

  async fileAt(rev: string, rel: string): Promise<string | null> {
    try {
      return await this.exec(['show', `${rev}:${rel}`]);
    } catch {
      return null;
    }
  }

  headContent(rel: string) {
    return this.fileAt('HEAD', rel);
  }

  async lineChanges(rel: string, working: string) {
    if (!(await this.isRepo())) return [];
    const head = await this.headContent(rel);
    return head === null ? [] : computeLineChanges(head, working);
  }

  async stage(paths: string[]) {
    if (paths.length) await this.exec(['add', '-A', '--', ...paths], { log: true });
  }

  async unstage(paths: string[]) {
    if (paths.length) await this.exec(['reset', '-q', 'HEAD', '--', ...paths], { log: true });
  }

  async revert(paths: string[]) {
    if (!paths.length) return;
    const { files } = await this.status();
    const tracked = paths.filter((p) => files[p] && files[p].status !== 'untracked');
    const untracked = paths.filter((p) => files[p]?.status === 'untracked');
    const added = tracked.filter((p) => files[p].status === 'added');
    const rest = tracked.filter((p) => files[p].status !== 'added');
    if (added.length) await this.exec(['rm', '-f', '--cached', '--', ...added], { log: true });
    if (rest.length) {
      await this.exec(['reset', '-q', 'HEAD', '--', ...rest]).catch(() => undefined);
      await this.exec(['checkout', 'HEAD', '--', ...rest], { log: true });
    }
    for (const p of [...untracked, ...added]) await fs.rm(path.join(this.root, p), { recursive: true, force: true });
  }

  async commit(message: string, paths: string[], amend = false) {
    if (!paths?.length && !amend) fail('No files selected');
    if (paths?.length) await this.exec(['add', '-A', '--', ...paths], { log: true });
    const args = ['commit', '-m', message];
    if (amend) args.push('--amend');
    if (paths?.length) args.push('--only', '--', ...paths);
    return this.exec(args, { log: true });
  }

  async patch(paths: string[]) {
    const { files } = await this.status();
    const tracked = paths.filter((p) => files[p]?.status !== 'untracked');
    const untracked = paths.filter((p) => files[p]?.status === 'untracked');
    let out = tracked.length ? await this.exec(['diff', 'HEAD', '--', ...tracked]) : '';
    for (const p of untracked) out += await this.exec(['diff', '--no-index', '--', '/dev/null', p]).catch((e) => e.raw || '');
    return out;
  }

  async branches() {
    if (!(await this.isRepo())) return { current: null, detached: false, local: [], remote: [], tags: [], recent: [], remotes: [] };
    const fmt = ['%(refname)', '%(refname:short)', '%(objectname:short)', '%(upstream:short)', '%(upstream:track)', '%(committerdate:unix)', '%(HEAD)', '%(subject)'].join('%00');
    const out = await this.exec(['for-each-ref', '--sort=-committerdate', `--format=${fmt}`, 'refs/heads', 'refs/remotes', 'refs/tags']);
    const local: any[] = [], remote: any[] = [], tags: any[] = [];
    for (const line of out.split('\n').filter(Boolean)) {
      const [refname, short, hash, upstream, track, date, head, subject] = line.split('\0');
      const m = /\[(?:ahead (\d+))?(?:, )?(?:behind (\d+))?\]/.exec(track || '');
      const item = { name: short, hash, date: Number(date) * 1000, subject, current: head === '*' };
      if (refname.startsWith('refs/heads/')) local.push({ ...item, upstream: upstream || null, ahead: m ? Number(m[1] || 0) : 0, behind: m ? Number(m[2] || 0) : 0, gone: /gone/.test(track || '') });
      else if (refname.startsWith('refs/remotes/')) {
        if (!short.endsWith('/HEAD')) remote.push({ ...item, remote: short.split('/')[0], branch: short.split('/').slice(1).join('/') });
      } else tags.push(item);
    }
    const current = await this.branch();
    const remotes = (await this.exec(['remote']).catch(() => '')).split('\n').filter(Boolean);
    return { current, detached: current === 'HEAD', local, remote, tags, recent: await this.recentBranches(local), remotes };
  }

  private async recentBranches(local: { name: string }[]): Promise<string[]> {
    const recent: string[] = [];
    const log = await this.exec(['reflog', '--format=%gs', '-n', '200']).catch(() => '');
    for (const l of log.split('\n')) {
      const m = /^checkout: moving from \S+ to (\S+)$/.exec(l);
      if (m && local.some((b) => b.name === m[1]) && !recent.includes(m[1])) recent.push(m[1]);
      if (recent.length >= 6) break;
    }
    return recent;
  }

  async checkout(ref: string, create?: string) {
    if (create) return this.exec(['checkout', '-b', create, ref], { log: true });
    const br = await this.branches();
    const rb = br.remote.find((r: any) => r.name === ref);
    if (rb && !br.local.some((l: any) => l.name === rb.branch)) return this.exec(['checkout', '-b', rb.branch, '--track', ref], { log: true });
    return this.exec(['checkout', ref], { log: true });
  }

  createBranch(name: string, from?: string, checkout = true) {
    const base = from ? [from] : [];
    return checkout ? this.exec(['checkout', '-b', name, ...base], { log: true }) : this.exec(['branch', name, ...base], { log: true });
  }

  renameBranch(oldName: string, newName: string) {
    return this.exec(['branch', '-m', oldName, newName], { log: true });
  }

  deleteBranch(name: string, force = false, remote = false) {
    if (remote) {
      const [r, ...rest] = name.split('/');
      return this.exec(['push', r, '--delete', rest.join('/')], { log: true, net: true });
    }
    return this.exec(['branch', force ? '-D' : '-d', name], { log: true });
  }

  merge(ref: string, noFf = false, squash = false) {
    return this.exec(['merge', '--no-edit', ...(noFf ? ['--no-ff'] : []), ...(squash ? ['--squash'] : []), ref], { log: true });
  }

  rebase(onto: string) {
    return this.exec(['rebase', onto], { log: true });
  }

  abort(op: string) {
    return this.exec([op, '--abort'], { log: true });
  }

  continueOp(op: string) {
    return this.exec([op, '--continue'], { log: true });
  }

  cherryPick(hash: string) {
    return this.exec(['cherry-pick', hash], { log: true });
  }

  revertCommit(hash: string) {
    return this.exec(['revert', '--no-edit', hash], { log: true });
  }

  resetTo(hash: string, mode = 'mixed') {
    return this.exec(['reset', `--${mode}`, hash], { log: true });
  }

  tag(name: string, hash: string, message?: string) {
    return this.exec(message ? ['tag', '-a', name, hash, '-m', message] : ['tag', name, hash], { log: true });
  }

  async compare(a: string, b: string) {
    const [left, right] = (await this.exec(['rev-list', '--left-right', '--count', `${a}...${b}`])).trim().split(/\s+/).map(Number);
    return { left, right };
  }

  fetch() {
    return this.exec(['fetch', '--all', '--prune'], { log: true, net: true });
  }

  pull(rebase = false) {
    return this.exec(['pull', rebase ? '--rebase' : '--no-rebase', '--autostash'], { log: true, net: true });
  }

  async push({ remote = 'origin', branch, force = false, tags = false }: { remote?: string; branch?: string; force?: boolean; tags?: boolean }) {
    const args = ['push'];
    if (force) args.push('--force-with-lease');
    if (tags) args.push('--tags');
    const cur = branch || (await this.branch()) || 'HEAD';
    if (!(await this.tracking()).upstream) args.push('-u');
    return this.exec([...args, remote, cur], { log: true, net: true });
  }

  async remotes() {
    const out = await this.exec(['remote', '-v']).catch(() => '');
    const map: Record<string, Record<string, string>> = {};
    for (const l of out.split('\n')) {
      const m = /^(\S+)\s+(\S+)\s+\((fetch|push)\)/.exec(l);
      if (m) (map[m[1]] ??= {})[m[3]] = m[2];
    }
    return Object.entries(map).map(([name, urls]) => ({ name, fetch: urls.fetch, push: urls.push }));
  }

  async remoteUrl(name = 'origin'): Promise<string | null> {
    try {
      return (await this.exec(['remote', 'get-url', name])).trim();
    } catch {
      return null;
    }
  }

  addRemote(name: string, url: string) {
    return this.exec(['remote', 'add', name, url], { log: true });
  }

  async outgoing() {
    const parse = (out: string) => out.split('\n').filter(Boolean).map((l) => {
      const [short, subject, author, date] = l.split('\x1f');
      return { short, subject, author, date };
    });
    try {
      return parse(await this.exec(['log', '@{upstream}..HEAD', '--pretty=format:%h%x1f%s%x1f%an%x1f%ar']));
    } catch {
      return parse(await this.exec(['log', '-n20', '--pretty=format:%h%x1f%s%x1f%an%x1f%ar']).catch(() => ''));
    }
  }

  async stashList() {
    if (!(await this.isRepo())) return [];
    const out = await this.exec(['stash', 'list', '--format=%gd%x1f%s%x1f%cr%x1f%at']).catch(() => '');
    return out.split('\n').filter(Boolean).map((l) => {
      const [ref, subject, date, at] = l.split('\x1f');
      return { ref, index: Number(/\{(\d+)\}/.exec(ref)?.[1] ?? 0), message: subject.replace(/^(WIP on|On) [^:]+: /, ''), date, at: Number(at) * 1000 };
    });
  }

  stashPush(message: string, paths?: string[]) {
    const args = ['stash', 'push', '--include-untracked'];
    if (message) args.push('-m', message);
    if (paths?.length) args.push('--', ...paths);
    return this.exec(args, { log: true });
  }

  async stashFiles(index: number) {
    const ref = `stash@{${index}}`;
    const out = await this.exec(['stash', 'show', '--include-untracked', '--name-status', ref]).catch(() => this.exec(['stash', 'show', '--name-status', ref]));
    return parseNameStatus(out);
  }

  stashApply(index: number, pop = true) {
    return this.exec(['stash', pop ? 'pop' : 'apply', `stash@{${index}}`], { log: true });
  }

  stashDrop(index: number) {
    return this.exec(['stash', 'drop', `stash@{${index}}`], { log: true });
  }

  async log({ ref, author, grep, since, until, path: filePath, limit = 200, skip = 0 }: { ref?: string; author?: string; grep?: string; since?: string; until?: string; path?: string; limit?: number; skip?: number }) {
    if (!(await this.isRepo())) return { commits: [], hasMore: false };
    const args = ['log', '--date-order', `-n${limit + 1}`, `--skip=${skip}`, `--pretty=format:${LOG_FORMAT}`];
    if (!ref || ref === 'all') args.push('--all', '--branches', '--remotes', '--tags');
    else args.push(ref);
    if (author) args.push(`--author=${author}`);
    if (grep) args.push(`--grep=${grep}`, '-i');
    if (since) args.push(`--since=${since}`);
    if (until) args.push(`--until=${until}`);
    if (filePath) args.push('--', filePath);
    let out: string;
    try {
      out = await this.exec(args);
    } catch {
      return { commits: [], hasMore: false };
    }
    const commits = out.split('\x1e').map((s) => s.replace(/^\n/, '')).filter((s) => s.trim()).map(parseLogRecord);
    return { commits: commits.slice(0, limit), hasMore: commits.length > limit };
  }

  async authors() {
    const out = await this.exec(['shortlog', '-sne', '--all', 'HEAD']).catch(() => '');
    return out.split('\n').filter(Boolean).map((l) => {
      const m = /^\s*(\d+)\s+(.+?)\s+<(.+)>$/.exec(l);
      return m ? { count: Number(m[1]), name: m[2], email: m[3] } : null;
    }).filter(Boolean);
  }

  async commitDetail(hash: string) {
    const meta = await this.exec(['show', '-s', '--format=%H%x1f%h%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%cn%x1f%ct%x1f%D%x1f%B', hash]);
    const [full, short, parents, author, email, at, committer, cat, refs, body] = meta.split('\x1f');
    const parentList = parents ? parents.split(' ') : [];
    const files = parseNameStatus(parentList.length
      ? await this.exec(['diff', '--name-status', '-M', `${hash}^1`, hash])
      : await this.exec(['diff-tree', '--no-commit-id', '--name-status', '-r', '-M', '--root', hash]));
    const stat = parentList.length
      ? await this.exec(['diff', '--shortstat', `${hash}^1`, hash]).catch(() => '')
      : await this.exec(['show', '--shortstat', '--format=', hash]).catch(() => '');
    return { hash: full, short, parents: parentList, author, email, at: Number(at) * 1000, committer, committedAt: Number(cat) * 1000, refs: refs ? refs.split(', ').filter(Boolean) : [], message: body.trim(), files, stat: stat.trim() };
  }

  async commitFile(hash: string, rel: string, from?: string) {
    const [before, after] = await Promise.all([this.fileAt(`${hash}^1`, from || rel), this.fileAt(hash, rel)]);
    return { before, after };
  }

  async blame(rel: string) {
    const out = await this.exec(['blame', '--porcelain', '--', rel]);
    const commits: Record<string, { hash: string; short: string; author: string; time: number; summary: string }> = {};
    const lines: string[] = [];
    let cur: string | null = null;
    for (const l of out.split('\n')) {
      const head = /^([0-9a-f]{40}) \d+ (\d+)(?: \d+)?$/.exec(l);
      if (head) {
        cur = head[1];
        commits[cur] ??= { hash: cur, short: cur.slice(0, 7), author: '', time: 0, summary: '' };
        lines.push(cur);
        continue;
      }
      if (!cur) continue;
      if (l.startsWith('author ')) commits[cur].author = l.slice(7);
      else if (l.startsWith('author-time ')) commits[cur].time = Number(l.slice(12)) * 1000;
      else if (l.startsWith('summary ')) commits[cur].summary = l.slice(8);
    }
    return lines.map((h) => ({ ...commits[h], uncommitted: /^0{40}$/.test(h) }));
  }

  async config() {
    const read = (key: string) => this.exec(['config', key]).then((v) => v.trim()).catch(() => '');
    return { name: await read('user.name'), email: await read('user.email') };
  }

  async setConfig(name?: string, email?: string) {
    if (name) await this.exec(['config', 'user.name', name], { log: true });
    if (email) await this.exec(['config', 'user.email', email], { log: true });
  }
}

function classify(x: string, y: string): FileStatus {
  if (x === '!') return 'ignored';
  if (x === '?') return 'untracked';
  if (x === 'U' || y === 'U' || (x === 'A' && y === 'A') || (x === 'D' && y === 'D')) return 'conflict';
  if (y === 'D' || x === 'D') return 'deleted';
  if (x === 'R') return 'renamed';
  if (x === 'A') return 'added';
  return 'modified';
}

function parsePorcelain(out: string): Record<string, StatusFile> {
  const files: Record<string, StatusFile> = {};
  const parts = out.split('\0');
  for (let i = 0; i < parts.length; i++) {
    const rec = parts[i];
    if (!rec || rec.length < 4) continue;
    const x = rec[0], y = rec[1];
    const file = rec.slice(3);
    const from = x === 'R' || x === 'C' ? parts[++i] : null;
    files[file] = { index: x, worktree: y, status: classify(x, y), from, staged: x !== ' ' && x !== '?' && x !== '!' };
  }
  return files;
}

function rollUpDirs(files: Record<string, StatusFile>): Record<string, FileStatus> {
  const dirs: Record<string, FileStatus> = {};
  for (const [file, info] of Object.entries(files)) {
    if (info.status === 'ignored') continue;
    const segs = file.split('/');
    for (let d = 1; d < segs.length; d++) {
      const dir = segs.slice(0, d).join('/');
      if (!dirs[dir] || STATUS_RANK[info.status] > STATUS_RANK[dirs[dir]]) dirs[dir] = info.status;
    }
  }
  return dirs;
}

function parseNameStatus(out: string): NameStatus[] {
  const map: Record<string, FileStatus> = { M: 'modified', A: 'added', D: 'deleted', R: 'renamed', C: 'added', T: 'modified', U: 'conflict' };
  return out.split('\n').filter((l) => l.trim()).map((l) => {
    const parts = l.split('\t');
    const code = parts[0][0];
    const status = map[code] || 'modified';
    return code === 'R' || code === 'C' ? { path: parts[2], from: parts[1], status } : { path: parts[1], status };
  });
}

function parseLogRecord(rec: string) {
  const [hash, parents, short, author, email, at, rel, refs, subject] = rec.split('\x1f');
  const refList = refs ? refs.split(', ') : [];
  return {
    hash,
    short,
    parents: parents ? parents.split(' ') : [],
    author,
    email,
    at: Number(at) * 1000,
    date: rel,
    subject,
    refs: refList.map((r) => r.replace(/^HEAD -> /, '')).filter((r) => r && r !== 'HEAD' && !r.endsWith('/HEAD')),
    head: refList.some((r) => r === 'HEAD' || r.startsWith('HEAD -> ')),
  };
}
