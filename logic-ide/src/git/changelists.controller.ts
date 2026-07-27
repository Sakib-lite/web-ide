import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import { ProjectsService } from '../projects/projects.service';
import { Root } from '../common/project-root';

@Controller('api/changelists')
export class ChangelistsController {
  constructor(private readonly projects: ProjectsService) {}

  private lists(root: string) {
    return this.projects.require(root).changelists;
  }

  @Get()
  list(@Root() root: string) {
    return this.lists(root).load();
  }

  @Post()
  create(@Root() root: string, @Body() body: { name: string; comment?: string; active?: boolean }) {
    return this.lists(root).create(body);
  }

  @Put(':id')
  update(@Root() root: string, @Param('id') id: string, @Body() body: { name?: string; comment?: string }) {
    return this.lists(root).update(id, body);
  }

  @Delete(':id')
  remove(@Root() root: string, @Param('id') id: string) {
    return this.lists(root).remove(id);
  }

  @Post(':id/active')
  setActive(@Root() root: string, @Param('id') id: string) {
    return this.lists(root).setActive(id);
  }

  @Post('move')
  move(@Root() root: string, @Body() body: { paths: string[]; id: string }) {
    return this.lists(root).move(body.paths, body.id);
  }
}
