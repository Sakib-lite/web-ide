import { Module } from '@nestjs/common';
import { SettingsService } from './settings/settings.service';
import { SettingsController } from './settings/settings.controller';
import { ProjectsService } from './projects/projects.service';
import { ProjectsController } from './projects/projects.controller';
import { FsController } from './fs/fs.controller';
import { GitController } from './git/git.controller';
import { ChangelistsController } from './git/changelists.controller';
import { SymbolsController } from './symbols/symbols.controller';
import { GithubController } from './github/github.controller';
import { CloneService } from './github/clone.service';
import { AiController } from './ai/ai.controller';
import { PluginHost } from './plugins/plugin-host';
import { PluginsController } from './plugins/plugins.controller';

@Module({
  controllers: [SettingsController, ProjectsController, FsController, GitController, ChangelistsController, SymbolsController, GithubController, AiController, PluginsController],
  providers: [SettingsService, ProjectsService, CloneService, PluginHost],
})
export class AppModule {}
