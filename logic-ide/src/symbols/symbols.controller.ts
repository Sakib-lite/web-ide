import { Controller, Get, Post, Query } from '@nestjs/common';
import { ProjectsService } from '../projects/projects.service';
import { Root } from '../common/project-root';

@Controller('api/symbols')
export class SymbolsController {
  constructor(private readonly projects: ProjectsService) {}

  private async index(root: string) {
    const idx = this.projects.require(root).symbols;
    await idx.build();
    return idx;
  }

  @Get('status')
  status(@Root() root: string) {
    const idx = this.projects.require(root).symbols;
    return { ready: idx.ready, stats: idx.stats };
  }

  @Post('rebuild')
  async rebuild(@Root() root: string) {
    return { ready: true, stats: await this.projects.require(root).rebuildIndex() };
  }

  @Get('lookup')
  async lookup(@Root() root: string, @Query() q: Record<string, string>) {
    return (await this.index(root)).lookup(q.name, { file: q.file, container: q.container || null, isMember: q.isMember === '1', isNew: q.isNew === '1', fqn: q.fqn || null, preferFile: q.preferFile || null }).slice(0, 20);
  }

  @Get('search')
  async search(@Root() root: string, @Query('q') q = '') {
    return (await this.index(root)).search(q, 60);
  }

  @Get('file')
  async file(@Root() root: string, @Query('path') rel: string) {
    const idx = await this.index(root);
    await idx.ensureIndexed(rel);
    return idx.fileSymbols(rel);
  }

  @Get('members')
  async members(@Root() root: string, @Query('class') cls = '', @Query('file') file?: string) {
    return (await this.index(root)).members(cls, file);
  }

  @Get('complete')
  async complete(@Root() root: string, @Query('q') q = '', @Query('file') file?: string, @Query('kinds') kinds?: string) {
    return (await this.index(root)).complete(q, file, kinds ? kinds.split(',') : undefined);
  }

  @Get('php-names')
  async phpNames(@Root() root: string, @Query('q') q = '') {
    return (await this.index(root)).phpNames(q);
  }

  @Get('py-modules')
  async pyModules(@Root() root: string, @Query('q') q = '') {
    return (await this.index(root)).pyModules(q);
  }
}
