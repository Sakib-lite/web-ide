import { Injectable } from '@nestjs/common';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Project } from './project';
import { SettingsService } from '../settings/settings.service';
import { DATA_DIR } from '../config/paths';
import { fail } from '../common/errors';

const RECENT_FILE = path.join(DATA_DIR, 'recent.json');

export interface PythonInfo {
  interpreter: string;
  venv: string | null;
}

export interface RunConfig {
  id: string;
  label: string;
  command: string;
}

@Injectable()
export class ProjectsService {
  private readonly projects = new Map<string, Project>();

  constructor(private readonly settings: SettingsService) {}

  async open(root: string): Promise<Project> {
    root = path.resolve(root);
    const stat = await fs.stat(root).catch(() => null);
    if (!stat?.isDirectory()) fail('Not a directory: ' + root);
    if (!this.projects.has(root)) this.projects.set(root, new Project(root, () => this.settings.token()));
    await this.remember(root);
    return this.projects.get(root)!;
  }

  async create(target: string): Promise<Project> {
    target = path.resolve(String(target || ''));
    if (!target || target === path.parse(target).root) fail('Invalid path');
    await fs.mkdir(target, { recursive: true });
    return this.open(target);
  }

  get(root: string | undefined): Project | undefined {
    return root ? this.projects.get(path.resolve(root)) : undefined;
  }

  require(root: string | undefined): Project {
    const p = this.get(root);
    if (!p) fail('Project not open. Reload the page and open the project again.', 409);
    return p!;
  }

  async info(p: Project) {
    const python = await detectPython(p.root);
    return { root: p.root, name: p.name, git: { repo: await p.git.isRepo(), branch: await p.git.branch() }, indexReady: p.symbols.ready, python, runConfigs: await detectRunConfigs(p.root, python) };
  }

  async recent(): Promise<{ path: string; name: string; openedAt: number }[]> {
    try {
      return JSON.parse(await fs.readFile(RECENT_FILE, 'utf8'));
    } catch {
      return [];
    }
  }

  async remember(root: string) {
    const list = (await this.recent()).filter((p) => p.path !== root);
    list.unshift({ path: root, name: path.basename(root), openedAt: Date.now() });
    return this.writeRecent(list.slice(0, 20));
  }

  async forget(root: string) {
    return this.writeRecent((await this.recent()).filter((p) => p.path !== root));
  }

  private async writeRecent(list: { path: string; name: string; openedAt: number }[]) {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(RECENT_FILE, JSON.stringify(list, null, 2));
    return list;
  }
}

async function detectPython(root: string): Promise<PythonInfo> {
  for (const venv of ['.venv', 'venv', 'env']) {
    for (const bin of ['bin/python', 'Scripts/python.exe']) {
      const abs = path.join(root, venv, bin);
      if (await fs.stat(abs).catch(() => null)) return { interpreter: abs, venv };
    }
  }
  return { interpreter: 'python3', venv: null };
}

async function detectRunConfigs(root: string, python: PythonInfo): Promise<RunConfig[]> {
  const exists = async (f: string) => !!(await fs.stat(path.join(root, f)).catch(() => null));
  const readJson = (f: string) => fs.readFile(path.join(root, f), 'utf8').then(JSON.parse).catch(() => null);
  const out: RunConfig[] = [];
  const pkg = await readJson('package.json');
  if (pkg?.scripts) {
    const pm = (await exists('pnpm-lock.yaml')) ? 'pnpm' : (await exists('yarn.lock')) ? 'yarn' : (await exists('bun.lockb')) ? 'bun' : 'npm';
    for (const name of ['dev', 'start', 'test', 'build', 'lint']) if (pkg.scripts[name]) out.push({ id: `npm:${name}`, label: `${pm} ${name}`, command: `${pm} run ${name}` });
  }
  const composer = await readJson('composer.json');
  if (composer?.scripts) for (const name of Object.keys(composer.scripts).slice(0, 6)) out.push({ id: `composer:${name}`, label: `composer ${name}`, command: `composer run ${name}` });
  if ((await exists('phpunit.xml')) || (await exists('phpunit.xml.dist'))) out.push({ id: 'phpunit', label: 'PHPUnit', command: (await exists('vendor/bin/phpunit')) ? 'vendor/bin/phpunit' : 'phpunit' });
  if (await exists('vendor/bin/pest')) out.push({ id: 'pest', label: 'Pest', command: 'vendor/bin/pest' });
  if (await exists('artisan')) out.push({ id: 'artisan', label: 'artisan serve', command: 'php artisan serve' });
  if (await exists('manage.py')) out.push({ id: 'django', label: 'Django runserver', command: `${python.interpreter} manage.py runserver` });
  if ((await exists('pytest.ini')) || (await exists('conftest.py')) || ((await exists('tests')) && (await exists('pyproject.toml')))) out.push({ id: 'pytest', label: 'pytest', command: `${python.interpreter} -m pytest` });
  if (await exists('Makefile')) out.push({ id: 'make', label: 'make', command: 'make' });
  if ((await exists('docker-compose.yml')) || (await exists('compose.yaml'))) out.push({ id: 'compose', label: 'docker compose up', command: 'docker compose up' });
  return out;
}
