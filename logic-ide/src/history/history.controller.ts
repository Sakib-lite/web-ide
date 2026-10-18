import { Controller, Get, Query } from '@nestjs/common';
import { HistoryService } from './history.service';
import { ProjectsService } from '../projects/projects.service';
import { Root } from '../common/project-root';
import { fail } from '../common/errors';

@Controller('api/history')
export class HistoryController {
  constructor(private readonly history: HistoryService, private readonly projects: ProjectsService) {}

  @Get()
  list(@Root() root: string, @Query('path') rel: string) {
    this.projects.require(root).fs.resolve(rel);
    return this.history.list(root, rel);
  }

  @Get('content')
  async content(@Root() root: string, @Query('path') rel: string, @Query('ts') ts: string) {
    this.projects.require(root).fs.resolve(rel);
    const content = await this.history.content(root, rel, Number(ts));
    if (content == null) fail('Snapshot not found', 404);
    return { content };
  }
}
