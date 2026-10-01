import { Injectable } from '@nestjs/common';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { GitRunner } from '../git/git-runner';
import { SettingsService } from '../settings/settings.service';
import { ProjectsService } from '../projects/projects.service';
import { fail } from '../common/errors';

interface CloneJob {
  id: string;
  done: boolean;
  error: string | null;
  output: string;
  root: string | null;
}

@Injectable()
export class CloneService {
  private readonly jobs = new Map<string, CloneJob>();

  constructor(private readonly settings: SettingsService, private readonly projects: ProjectsService) {}

  async tokenFor(url: string) {
    return /github\.com/.test(url) ? this.settings.token() : null;
  }

  async start(url: string, directory: string) {
    if (!url || !directory) fail('Repository URL and directory are required');
    const dest = path.resolve(directory);
    if (await fs.stat(dest).catch(() => null)) fail('Directory already exists: ' + dest);
    const job: CloneJob = { id: crypto.randomUUID(), done: false, error: null, output: '', root: null };
    this.jobs.set(job.id, job);
    GitRunner.clone(url, dest, await this.tokenFor(url), (d) => (job.output = (job.output + d).slice(-4000)))
      .then(async () => {
        job.root = dest;
        await this.projects.remember(dest);
      })
      .catch((err) => (job.error = err.message))
      .finally(() => {
        job.done = true;
        setTimeout(() => this.jobs.delete(job.id), 10 * 60 * 1000);
      });
    return { jobId: job.id };
  }

  status(id: string) {
    const job = this.jobs.get(id);
    if (!job) fail('Unknown job', 404);
    return job;
  }
}
