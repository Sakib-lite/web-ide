import { Injectable } from '@nestjs/common';
import fs from 'node:fs/promises';
import path from 'node:path';
import { DATA_DIR } from '../config/paths';

export interface Settings {
  githubToken?: string;
  githubUser?: string;
  disabledPlugins?: string[];
}

const FILE = path.join(DATA_DIR, 'settings.json');

@Injectable()
export class SettingsService {
  private cache: Settings | null = null;

  async get(): Promise<Settings> {
    if (this.cache) return this.cache;
    try {
      this.cache = JSON.parse(await fs.readFile(FILE, 'utf8'));
    } catch {
      this.cache = {};
    }
    return this.cache!;
  }

  async update(patch: Partial<Settings>): Promise<Settings> {
    const next: Record<string, unknown> = { ...(await this.get()), ...patch };
    for (const key of Object.keys(next)) if (next[key] === null || next[key] === undefined || next[key] === '') delete next[key];
    this.cache = next as Settings;
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(FILE, JSON.stringify(next, null, 2), { mode: 0o600 });
    return this.cache;
  }

  async token(): Promise<string | null> {
    return (await this.get()).githubToken || null;
  }

  toPublic(s: Settings) {
    return {
      githubToken: s.githubToken ? `${'•'.repeat(8)}${s.githubToken.slice(-4)}` : '',
      hasGithubToken: !!s.githubToken,
      githubUser: s.githubUser || null,
    };
  }
}
