import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { PluginHost } from './plugin-host';
import { GitRunner } from '../git/git-runner';
import { CloneService } from '../github/clone.service';
import { fail } from '../common/errors';

@Controller('api/plugins')
export class PluginsController {
  constructor(private readonly host: PluginHost, private readonly clone: CloneService) {}

  @Get()
  list() {
    return this.host.list();
  }

  @Post('reload')
  async reload() {
    await this.host.load();
    return this.host.list();
  }

  @Post('install')
  install(@Body('url') url = '') {
    url = url.trim();
    if (!url) fail('Git URL is required');
    return this.host.installFromGit(url, async (u, dest) => GitRunner.clone(u, dest, await this.clone.tokenFor(u)));
  }

  @Post(':id/enabled')
  setEnabled(@Param('id') id: string, @Body('enabled') enabled: boolean) {
    return this.host.setEnabled(id, !!enabled);
  }
}
