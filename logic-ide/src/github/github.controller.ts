import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ProjectsService } from '../projects/projects.service';
import { SettingsService } from '../settings/settings.service';
import { GitHubClient, RepoRef } from './github-client';
import { CloneService } from './clone.service';
import { Root } from '../common/project-root';
import { ok } from '../common/ok';
import { fail } from '../common/errors';

@Controller('api')
export class GithubController {
  private readonly github: GitHubClient;

  constructor(private readonly projects: ProjectsService, private readonly settings: SettingsService, private readonly clone: CloneService) {
    this.github = new GitHubClient(() => settings.token());
  }

  private async repo(root: string): Promise<RepoRef> {
    const ref = await this.projects.require(root).githubRepo();
    if (!ref) fail('The origin remote is not a GitHub repository.');
    return ref!;
  }

  @Post('clone')
  startClone(@Body() body: { url: string; directory: string }) {
    return this.clone.start(body.url, body.directory);
  }

  @Get('clone/:id')
  cloneStatus(@Param('id') id: string) {
    return this.clone.status(id);
  }

  @Get('github/user')
  user() {
    return this.github.user();
  }

  @Get('github/repos')
  repos(@Query('q') q = '') {
    return this.github.repos(q);
  }

  @Get('github/repo')
  async repoInfo(@Root() root: string) {
    const ref = await this.projects.require(root).githubRepo();
    if (!ref) return { connected: false };
    const s = await this.settings.get();
    const info = s.githubToken ? await this.github.repoInfo(ref).catch(() => null) : null;
    return { connected: true, ...ref, info, user: s.githubUser || null, hasToken: !!s.githubToken };
  }

  @Get('github/pulls')
  async pulls(@Root() root: string, @Query() q: Record<string, string>) {
    return this.github.pulls(await this.repo(root), { state: q.state, author: q.author, q: q.q, page: Number(q.page) || 1 });
  }

  @Get('github/pulls/:n')
  async pull(@Root() root: string, @Param('n') n: string) {
    const ref = await this.repo(root);
    const number = Number(n);
    const [pull, files, timeline] = await Promise.all([this.github.pull(ref, number), this.github.pullFiles(ref, number), this.github.pullTimeline(ref, number).catch(() => [])]);
    return { ...pull, files, timeline, checks: await this.github.checks(ref, pull.head.sha) };
  }

  @Post('github/pulls')
  async createPull(@Root() root: string, @Body() body: { title: string; body?: string; head: string; base: string; draft?: boolean }) {
    return this.github.createPull(await this.repo(root), body);
  }

  @Post('github/pulls/:n/merge')
  async mergePull(@Root() root: string, @Param('n') n: string, @Body() body: { method?: string; title?: string; message?: string }) {
    return this.github.mergePull(await this.repo(root), Number(n), body);
  }

  @Post('github/pulls/:n/close')
  async closePull(@Root() root: string, @Param('n') n: string) {
    return this.github.closePull(await this.repo(root), Number(n));
  }

  @Post('github/pulls/:n/fetch')
  fetchPull(@Root() root: string, @Param('n') n: string, @Body('base') base?: string) {
    const git = this.projects.require(root).git;
    return ok((async () => {
      await git.exec(['fetch', 'origin', `+refs/pull/${n}/head:refs/remotes/pr/${n}`], { log: true, net: true });
      if (base) await git.exec(['fetch', 'origin', `+refs/heads/${base}:refs/remotes/origin/${base}`], { log: true, net: true }).catch(() => undefined);
      return `pr/${n}`;
    })());
  }

  @Post('github/pulls/:n/checkout')
  checkoutPull(@Root() root: string, @Param('n') n: string, @Body('branch') branch?: string) {
    const git = this.projects.require(root).git;
    const name = branch || `pr-${n}`;
    return ok((async () => {
      await git.exec(['fetch', 'origin', `+refs/pull/${n}/head:refs/remotes/pr/${n}`], { log: true, net: true });
      const br = await git.branches();
      return br.local.some((b: any) => b.name === name) ? git.exec(['checkout', name], { log: true }) : git.exec(['checkout', '-b', name, `pr/${n}`], { log: true });
    })());
  }

  @Get('github/repo-available')
  async repoAvailable(@Query('name') name = '') {
    if (!/^[A-Za-z0-9_.-]{1,100}$/.test(name)) fail('Use letters, numbers, dashes, underscores or dots');
    const user = (await this.settings.get()).githubUser || (await this.github.user()).login;
    return { name, owner: user, available: !(await this.github.repoExists(user, name)) };
  }

  @Post('github/publish')
  async publish(@Root() root: string, @Body() body: { name: string; description?: string; private?: boolean }) {
    const p = this.projects.require(root);
    const name = String(body.name || '').trim();
    if (!/^[A-Za-z0-9_.-]{1,100}$/.test(name)) fail('Use letters, numbers, dashes, underscores or dots');
    if (!(await p.git.isRepo())) await p.git.init();
    if (await p.git.remoteUrl('origin')) fail('This project already has an "origin" remote');
    const repo = await this.github.createRepo({ name, description: body.description, isPrivate: body.private !== false });
    await p.git.addRemote('origin', repo.cloneUrl);
    const branch = (await p.git.branch()) || 'main';
    if (branch === 'HEAD') fail('Create a first commit before publishing');
    const output = await p.git.push({ remote: 'origin', branch });
    return { ok: true, url: repo.url, fullName: repo.fullName, private: repo.private, output: output.trim() };
  }

  @Get('github/collaborators')
  async collaborators(@Root() root: string) {
    const ref = await this.repo(root);
    const [collab, authors] = await Promise.all([this.github.collaborators(ref), this.github.pullAuthors(ref)]);
    return [...new Set([...authors, ...collab])];
  }
}
