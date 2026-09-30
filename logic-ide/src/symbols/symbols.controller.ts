import { Controller, Get, Post, Query } from '@nestjs/common';
import { ProjectsService } from '../projects/projects.service';
import { Root } from '../common/project-root';

@Controller('api/symbols')
export class SymbolsController {
  constructor(private readonly projects: ProjectsService) {}

  private index(root: string) {
    return this.projects.require(root).symbols;
  }

  @Get('status')
  status(@Root() root: string) {
    const idx = this.index(root);
    return { ready: idx.ready, stats: idx.stats };
  }

  @Post('rebuild')
  async rebuild(@Root() root: string) {
    return { ready: true, stats: await this.projects.require(root).rebuildIndex() };
  }

  @Get('lookup')
  lookup(@Root() root: string, @Query() q: Record<string, string>) {
    return this.index(root).lookup(q.name, { file: q.file, container: q.container || null, isMember: q.isMember === '1', isNew: q.isNew === '1', fqn: q.fqn || null, preferFile: q.preferFile || null }).slice(0, 20);
  }

  @Get('search')
  search(@Root() root: string, @Query('q') q = '') {
    return this.index(root).search(q, 60);
  }

  @Get('file')
  async file(@Root() root: string, @Query('path') rel: string) {
    const idx = this.index(root);
    await idx.ensureIndexed(rel);
    return idx.fileSymbols(rel);
  }

  @Get('members')
  members(@Root() root: string, @Query('class') cls = '', @Query('file') file?: string) {
    return this.index(root).members(cls, file);
  }

  @Get('complete')
  complete(@Root() root: string, @Query('q') q = '', @Query('file') file?: string, @Query('kinds') kinds?: string) {
    return this.index(root).complete(q, file, kinds ? kinds.split(',') : undefined);
  }

  @Get('php-names')
  phpNames(@Root() root: string, @Query('q') q = '') {
    return this.index(root).phpNames(q);
  }

  @Get('py-modules')
  pyModules(@Root() root: string, @Query('q') q = '') {
    return this.index(root).pyModules(q);
  }
}
