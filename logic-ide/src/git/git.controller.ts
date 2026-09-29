import { Body, Controller, Delete, Get, Param, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ProjectsService } from '../projects/projects.service';
import { Root } from '../common/project-root';
import { ok } from '../common/ok';

@Controller('api/git')
export class GitController {
  constructor(private readonly projects: ProjectsService) {}

  private git(root: string) {
    return this.projects.require(root).git;
  }

  @Get('status')
  async status(@Root() root: string) {
    const p = this.projects.require(root);
    const st: any = await p.git.status();
    if (st.repo) {
      const changed = new Set(Object.keys(st.files).filter((f) => !['ignored', 'untracked'].includes(st.files[f].status)));
      st.changelists = await p.changelists.prune(changed);
    }
    return st;
  }

  @Post('init')
  init(@Root() root: string) {
    return ok(this.git(root).init());
  }

  @Get('head')
  async head(@Root() root: string, @Query('path') rel: string) {
    return { content: await this.git(root).headContent(rel) };
  }

  @Get('file-at')
  async fileAt(@Root() root: string, @Query('rev') rev: string, @Query('path') rel: string) {
    return { content: await this.git(root).fileAt(rev, rel) };
  }

  @Post('changes')
  changes(@Root() root: string, @Body() body: { path: string; content: string }) {
    return this.git(root).lineChanges(body.path, body.content);
  }

  @Post('stage')
  stage(@Root() root: string, @Body('paths') paths: string[]) {
    return ok(this.git(root).stage(paths));
  }

  @Post('unstage')
  unstage(@Root() root: string, @Body('paths') paths: string[]) {
    return ok(this.git(root).unstage(paths));
  }

  @Post('revert')
  revert(@Root() root: string, @Body('paths') paths: string[]) {
    return ok(this.git(root).revert(paths));
  }

  @Post('commit')
  commit(@Root() root: string, @Body() body: { message: string; paths: string[]; amend?: boolean }) {
    return ok(this.git(root).commit(body.message, body.paths, !!body.amend));
  }

  @Get('patch')
  async patch(@Root() root: string, @Query('paths') paths = '', @Res() res: Response) {
    res.type('text/plain').send(await this.git(root).patch(paths.split('\n').filter(Boolean)));
  }

  @Get('console')
  console(@Root() root: string) {
    return this.projects.require(root).console;
  }

  @Get('blame')
  blame(@Root() root: string, @Query('path') rel: string) {
    return this.git(root).blame(rel);
  }

  @Get('config')
  config(@Root() root: string) {
    return this.git(root).config();
  }

  @Post('config')
  setConfig(@Root() root: string, @Body() body: { name?: string; email?: string }) {
    return ok(this.git(root).setConfig(body.name, body.email));
  }

  @Get('branches')
  branches(@Root() root: string) {
    return this.git(root).branches();
  }

  @Post('checkout')
  checkout(@Root() root: string, @Body() body: { ref: string; create?: string }) {
    return ok(this.git(root).checkout(body.ref, body.create));
  }

  @Post('branch')
  createBranch(@Root() root: string, @Body() body: { name: string; from?: string; checkout?: boolean }) {
    return ok(this.git(root).createBranch(body.name, body.from, body.checkout !== false));
  }

  @Post('branch/rename')
  renameBranch(@Root() root: string, @Body() body: { name: string; newName: string }) {
    return ok(this.git(root).renameBranch(body.name, body.newName));
  }

  @Post('branch/delete')
  deleteBranch(@Root() root: string, @Body() body: { name: string; force?: boolean; remote?: boolean }) {
    return ok(this.git(root).deleteBranch(body.name, !!body.force, !!body.remote));
  }

  @Post('merge')
  merge(@Root() root: string, @Body() body: { ref: string; noFf?: boolean; squash?: boolean }) {
    return ok(this.git(root).merge(body.ref, !!body.noFf, !!body.squash));
  }

  @Post('rebase')
  rebase(@Root() root: string, @Body('onto') onto: string) {
    return ok(this.git(root).rebase(onto));
  }

  @Post('abort')
  abort(@Root() root: string, @Body('op') op: string) {
    return ok(this.git(root).abort(op));
  }

  @Post('continue')
  continueOp(@Root() root: string, @Body('op') op: string) {
    return ok(this.git(root).continueOp(op));
  }

  @Post('cherry-pick')
  cherryPick(@Root() root: string, @Body('hash') hash: string) {
    return ok(this.git(root).cherryPick(hash));
  }

  @Post('revert-commit')
  revertCommit(@Root() root: string, @Body('hash') hash: string) {
    return ok(this.git(root).revertCommit(hash));
  }

  @Post('reset')
  reset(@Root() root: string, @Body() body: { hash: string; mode?: string }) {
    return ok(this.git(root).resetTo(body.hash, body.mode));
  }

  @Post('tag')
  tag(@Root() root: string, @Body() body: { name: string; hash: string; message?: string }) {
    return ok(this.git(root).tag(body.name, body.hash, body.message));
  }

  @Get('compare')
  compare(@Root() root: string, @Query('a') a: string, @Query('b') b: string) {
    return this.git(root).compare(a, b);
  }

  @Post('fetch')
  fetch(@Root() root: string) {
    return ok(this.git(root).fetch());
  }

  @Post('pull')
  pull(@Root() root: string, @Body('rebase') rebase?: boolean) {
    return ok(this.git(root).pull(!!rebase));
  }

  @Post('push')
  push(@Root() root: string, @Body() body: { remote?: string; branch?: string; force?: boolean; tags?: boolean }) {
    return ok(this.git(root).push(body));
  }

  @Get('remotes')
  remotes(@Root() root: string) {
    return this.git(root).remotes();
  }

  @Post('remote')
  addRemote(@Root() root: string, @Body() body: { name: string; url: string }) {
    return ok(this.git(root).addRemote(body.name, body.url));
  }

  @Get('outgoing')
  outgoing(@Root() root: string) {
    return this.git(root).outgoing();
  }

  @Get('stash')
  stashList(@Root() root: string) {
    return this.git(root).stashList();
  }

  @Post('stash')
  stashPush(@Root() root: string, @Body() body: { message: string; paths?: string[] }) {
    return ok(this.git(root).stashPush(body.message, body.paths));
  }

  @Get('stash/:index/files')
  stashFiles(@Root() root: string, @Param('index') index: string) {
    return this.git(root).stashFiles(Number(index));
  }

  @Post('stash/:index/apply')
  stashApply(@Root() root: string, @Param('index') index: string, @Body('pop') pop?: boolean) {
    return ok(this.git(root).stashApply(Number(index), pop !== false));
  }

  @Delete('stash/:index')
  stashDrop(@Root() root: string, @Param('index') index: string) {
    return ok(this.git(root).stashDrop(Number(index)));
  }

  @Get('log')
  log(@Root() root: string, @Query() q: Record<string, string>) {
    return this.git(root).log({ ref: q.ref, author: q.author, grep: q.grep, since: q.since, until: q.until, path: q.path, limit: Number(q.limit) || 200, skip: Number(q.skip) || 0 });
  }

  @Get('authors')
  authors(@Root() root: string) {
    return this.git(root).authors();
  }

  @Get('commit/:hash')
  commitDetail(@Root() root: string, @Param('hash') hash: string) {
    return this.git(root).commitDetail(hash);
  }

  @Get('commit/:hash/file')
  commitFile(@Root() root: string, @Param('hash') hash: string, @Query('path') rel: string, @Query('from') from?: string) {
    return this.git(root).commitFile(hash, rel, from);
  }
}
