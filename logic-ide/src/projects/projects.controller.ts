import { Body, Controller, Delete, Get, Post, Query } from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { browseDirectories } from './project-fs';

@Controller('api')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get('recent')
  recent() {
    return this.projects.recent();
  }

  @Delete('recent')
  forget(@Query('path') path: string) {
    return this.projects.forget(path);
  }

  @Get('browse')
  browse(@Query('dir') dir?: string) {
    return browseDirectories(dir);
  }

  @Post('project/open')
  async open(@Body('path') path: string) {
    return this.projects.info(await this.projects.open(path));
  }

  @Post('project/create')
  async create(@Body('path') path: string) {
    return this.projects.info(await this.projects.create(path));
  }
}
