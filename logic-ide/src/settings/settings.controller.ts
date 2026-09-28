import { Body, Controller, Get, Post } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { GitHubClient } from '../github/github-client';
import { fail } from '../common/errors';

@Controller('api/settings')
export class SettingsController {
  private readonly github: GitHubClient;

  constructor(private readonly settings: SettingsService) {
    this.github = new GitHubClient(() => settings.token());
  }

  @Get()
  async get() {
    return this.settings.toPublic(await this.settings.get());
  }

  @Post()
  async update(@Body() body: { githubToken?: string; clearGithubToken?: boolean }) {
    const patch: Record<string, string> = {};
    if (typeof body.githubToken === 'string' && !body.githubToken.includes('•')) patch.githubToken = body.githubToken.trim();
    if (body.clearGithubToken) Object.assign(patch, { githubToken: '', githubUser: '' });
    let s = await this.settings.update(patch);
    if (patch.githubToken) s = await this.verifyToken();
    return this.settings.toPublic(s);
  }

  private async verifyToken() {
    try {
      const user = await this.github.user();
      return this.settings.update({ githubUser: user.login });
    } catch (err: any) {
      await this.settings.update({ githubToken: '', githubUser: '' });
      return fail('GitHub rejected the token: ' + (err?.response?.error || err.message));
    }
  }
}
