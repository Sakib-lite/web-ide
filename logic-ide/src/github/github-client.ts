import { fail } from '../common/errors';

const API = 'https://api.github.com';

export interface RepoRef {
  owner: string;
  repo: string;
}

export class GitHubClient {
  constructor(private readonly getToken: () => Promise<string | null>) {}

  async request(path: string, { method = 'GET', body, query }: { method?: string; body?: unknown; query?: Record<string, unknown> } = {}): Promise<any> {
    const token = await this.getToken();
    if (!token) fail('No GitHub token configured. Add one in Settings → GitHub.', 401, 'NO_TOKEN');
    const url = new URL(path.startsWith('http') ? path : API + path);
    if (query) for (const [k, v] of Object.entries(query)) if (v != null && v !== '') url.searchParams.set(k, String(v));
    const res = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'web-ide', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 204) return null;
    const text = await res.text();
    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    if (!res.ok) {
      const detail = data?.errors?.map((e: any) => e.message || e.code).filter(Boolean).join('; ');
      fail(detail ? `${data?.message}: ${detail}` : data?.message || res.statusText, res.status);
    }
    return data;
  }

  user() {
    return this.request('/user');
  }

  async repos(q = '') {
    const all: any[] = [];
    for (let page = 1; page <= 5; page++) {
      const list = await this.request('/user/repos', { query: { sort: 'pushed', per_page: 100, page, affiliation: 'owner,collaborator,organization_member' } });
      all.push(...list);
      if (list.length < 100) break;
    }
    const needle = q.trim().toLowerCase();
    return all.filter((r) => !needle || r.full_name.toLowerCase().includes(needle) || (r.description || '').toLowerCase().includes(needle)).map(slimRepo);
  }

  async pulls({ owner, repo }: RepoRef, { state = 'open', author = '', q = '', page = 1 }: { state?: string; author?: string; q?: string; page?: number }) {
    const ghState = state === 'merged' || state === 'closed' ? 'closed' : state === 'all' ? 'all' : 'open';
    const list = await this.request(`/repos/${owner}/${repo}/pulls`, { query: { state: ghState, sort: 'updated', direction: 'desc', per_page: 100, page } });
    const needle = q.trim().toLowerCase();
    const items = list
      .filter((p: any) => state !== 'merged' || p.merged_at)
      .filter((p: any) => !author || p.user?.login?.toLowerCase() === author.toLowerCase())
      .filter((p: any) => !needle || p.title.toLowerCase().includes(needle) || String(p.number) === needle.replace('#', '') || (p.body || '').toLowerCase().includes(needle))
      .map((p: any) => ({ number: p.number, title: p.title, state: p.state, merged: !!p.merged_at, draft: !!p.draft, author: p.user?.login, avatar: p.user?.avatar_url, createdAt: p.created_at, updatedAt: p.updated_at, url: p.html_url, labels: (p.labels || []).map(slimLabel), head: p.head?.ref, base: p.base?.ref }));
    return { total: items.length, hasMore: list.length === 100, items };
  }

  async pullAuthors({ owner, repo }: RepoRef): Promise<string[]> {
    try {
      const list = await this.request(`/repos/${owner}/${repo}/pulls`, { query: { state: 'all', sort: 'updated', direction: 'desc', per_page: 100 } });
      return [...new Set<string>(list.map((p: any) => p.user?.login).filter(Boolean))];
    } catch {
      return [];
    }
  }

  async pull({ owner, repo }: RepoRef, number: number) {
    const p = await this.request(`/repos/${owner}/${repo}/pulls/${number}`);
    return {
      number: p.number, title: p.title, body: p.body || '', state: p.state, merged: p.merged, draft: p.draft, mergeable: p.mergeable,
      author: p.user?.login, avatar: p.user?.avatar_url, createdAt: p.created_at, updatedAt: p.updated_at, url: p.html_url,
      head: { ref: p.head.ref, sha: p.head.sha, repo: p.head.repo?.full_name, label: p.head.label }, base: { ref: p.base.ref, sha: p.base.sha },
      additions: p.additions, deletions: p.deletions, changedFiles: p.changed_files, commits: p.commits, reviewComments: p.review_comments,
      labels: (p.labels || []).map(slimLabel), requestedReviewers: (p.requested_reviewers || []).map((u: any) => u.login),
    };
  }

  async pullFiles({ owner, repo }: RepoRef, number: number) {
    const files = await this.request(`/repos/${owner}/${repo}/pulls/${number}/files`, { query: { per_page: 100 } });
    return files.map((f: any) => ({ path: f.filename, status: f.status, additions: f.additions, deletions: f.deletions, previous: f.previous_filename }));
  }

  async pullTimeline({ owner, repo }: RepoRef, number: number) {
    const [comments, reviews] = await Promise.all([
      this.request(`/repos/${owner}/${repo}/issues/${number}/comments`, { query: { per_page: 50 } }),
      this.request(`/repos/${owner}/${repo}/pulls/${number}/reviews`, { query: { per_page: 50 } }),
    ]);
    const items = [
      ...comments.map((c: any) => ({ type: 'comment', author: c.user?.login, avatar: c.user?.avatar_url, body: c.body, at: c.created_at })),
      ...reviews.filter((r: any) => r.state !== 'COMMENTED' || r.body).map((r: any) => ({ type: 'review', state: r.state, author: r.user?.login, avatar: r.user?.avatar_url, body: r.body, at: r.submitted_at })),
    ];
    return items.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  }

  async checks({ owner, repo }: RepoRef, sha: string) {
    try {
      const d = await this.request(`/repos/${owner}/${repo}/commits/${sha}/check-runs`, { query: { per_page: 50 } });
      return d.check_runs.map((c: any) => ({ name: c.name, status: c.status, conclusion: c.conclusion, url: c.html_url }));
    } catch {
      return [];
    }
  }

  createPull({ owner, repo }: RepoRef, body: { title: string; body?: string; head: string; base: string; draft?: boolean }) {
    return this.request(`/repos/${owner}/${repo}/pulls`, { method: 'POST', body: { ...body, draft: !!body.draft } });
  }

  mergePull({ owner, repo }: RepoRef, number: number, { method = 'merge', title, message }: { method?: string; title?: string; message?: string }) {
    return this.request(`/repos/${owner}/${repo}/pulls/${number}/merge`, { method: 'PUT', body: { merge_method: method, commit_title: title, commit_message: message } });
  }

  closePull({ owner, repo }: RepoRef, number: number) {
    return this.request(`/repos/${owner}/${repo}/pulls/${number}`, { method: 'PATCH', body: { state: 'closed' } });
  }

  editPull({ owner, repo }: RepoRef, number: number, body: { title?: string; body?: string }) {
    const patch: Record<string, string> = {};
    if (typeof body.title === 'string' && body.title.trim()) patch.title = body.title.trim();
    if (typeof body.body === 'string') patch.body = body.body;
    return this.request(`/repos/${owner}/${repo}/pulls/${number}`, { method: 'PATCH', body: patch });
  }

  requestReviewers({ owner, repo }: RepoRef, number: number, reviewers: string[]) {
    return this.request(`/repos/${owner}/${repo}/pulls/${number}/requested_reviewers`, { method: 'POST', body: { reviewers } });
  }

  removeReviewer({ owner, repo }: RepoRef, number: number, login: string) {
    return this.request(`/repos/${owner}/${repo}/pulls/${number}/requested_reviewers`, { method: 'DELETE', body: { reviewers: [login] } });
  }

  async repoExists(owner: string, repo: string): Promise<boolean> {
    try {
      await this.request(`/repos/${owner}/${repo}`);
      return true;
    } catch (err: any) {
      if (err?.status === 404 || err?.getStatus?.() === 404) return false;
      throw err;
    }
  }

  async createRepo({ name, description, isPrivate }: { name: string; description?: string; isPrivate: boolean }) {
    const r = await this.request('/user/repos', { method: 'POST', body: { name, description: description || undefined, private: isPrivate, auto_init: false } });
    return slimRepo(r);
  }

  async repoInfo({ owner, repo }: RepoRef) {
    const r = await this.request(`/repos/${owner}/${repo}`);
    return { ...slimRepo(r), defaultBranch: r.default_branch, openIssues: r.open_issues_count };
  }

  async collaborators({ owner, repo }: RepoRef): Promise<string[]> {
    try {
      return (await this.request(`/repos/${owner}/${repo}/collaborators`, { query: { per_page: 100 } })).map((u: any) => u.login);
    } catch {
      return [];
    }
  }
}

function slimLabel(l: any) {
  return { name: l.name, color: l.color };
}

function slimRepo(r: any) {
  return { id: r.id, name: r.name, fullName: r.full_name, owner: r.owner?.login, private: r.private, fork: r.fork, description: r.description, language: r.language, updatedAt: r.pushed_at || r.updated_at, stars: r.stargazers_count, cloneUrl: r.clone_url, sshUrl: r.ssh_url, url: r.html_url, defaultBranch: r.default_branch };
}

export function parseGitHubRemote(url: string | null): RepoRef | null {
  if (!url) return null;
  const m = /github\.com[:/]+([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(url.trim());
  return m ? { owner: m[1], repo: m[2] } : null;
}
