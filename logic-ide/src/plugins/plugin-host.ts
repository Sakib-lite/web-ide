import { Injectable } from '@nestjs/common';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import express, { Express, Router } from 'express';
import type { WebSocket } from 'ws';
import { PLUGIN_DIRS, DATA_DIR } from '../config/paths';
import { SettingsService } from '../settings/settings.service';
import { ProjectsService } from '../projects/projects.service';
import { Project } from '../projects/project';
import { fail } from '../common/errors';

export interface PluginManifest {
  id: string;
  name: string;
  version?: string;
  description?: string;
  vendor?: string;
  homepage?: string;
  icon?: string;
  client?: string;
  server?: string;
  styles?: string;
  toolWindow?: { side?: string; title?: string; shortcut?: string };
  builtin?: boolean;
}

interface LoadedPlugin {
  manifest: PluginManifest;
  dir: string;
  enabled: boolean;
  error: string | null;
  served: boolean;
  router: Router | null;
  wsHandler: ((ws: WebSocket, project: Project, url: URL) => void) | null;
}

const dynamicImport = new Function('u', 'return import(u)') as (u: string) => Promise<any>;

@Injectable()
export class PluginHost {
  private readonly plugins = new Map<string, LoadedPlugin>();
  private app: Express | null = null;

  constructor(private readonly settings: SettingsService, private readonly projects: ProjectsService) {}

  async attach(app: Express) {
    this.app = app;
    await this.load();
  }

  async load() {
    const existing = new Map(this.plugins);
    this.plugins.clear();
    for (const base of PLUGIN_DIRS) await this.scan(base, existing);
    const disabled = new Set((await this.settings.get()).disabledPlugins || []);
    for (const p of this.plugins.values()) {
      p.enabled = !disabled.has(p.manifest.id);
      this.serve(p);
      if (p.enabled && p.manifest.server && !p.router) await this.activate(p);
    }
  }

  private async scan(base: string, existing: Map<string, LoadedPlugin>) {
    let entries: import('node:fs').Dirent[] = [];
    try {
      entries = await fs.readdir(base, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const dir = path.join(base, e.name);
      try {
        const manifest: PluginManifest = JSON.parse(await fs.readFile(path.join(dir, 'plugin.json'), 'utf8'));
        if (!manifest.id) throw new Error('plugin.json has no "id"');
        manifest.builtin = base === PLUGIN_DIRS[0];
        const prev = existing.get(manifest.id);
        this.plugins.set(manifest.id, { manifest, dir, enabled: true, error: null, served: prev?.served || false, router: prev?.router || null, wsHandler: prev?.wsHandler || null });
      } catch {}
    }
  }

  private serve(p: LoadedPlugin) {
    if (p.served || !this.app) return;
    this.app.use(`/plugins/${p.manifest.id}`, express.static(p.dir));
    this.app.use(`/api/plugins/${p.manifest.id}`, (req, res, next) => (p.enabled && p.router ? p.router(req, res, next) : res.status(404).json({ error: 'Plugin disabled' })));
    p.served = true;
  }

  private async activate(p: LoadedPlugin) {
    try {
      const mod = await dynamicImport(pathToFileURL(path.join(p.dir, p.manifest.server!)).href + `?t=${Date.now()}`);
      const router = express.Router();
      const dataDir = path.join(DATA_DIR, 'plugin-data', p.manifest.id);
      await fs.mkdir(dataDir, { recursive: true });
      await mod.register({
        router,
        manifest: p.manifest,
        dir: p.dir,
        dataDir,
        getProject: (root: string) => this.projects.require(root),
        getToken: () => this.settings.token(),
        getSettings: () => this.settings.get(),
        onWebSocket: (handler: LoadedPlugin['wsHandler']) => {
          p.wsHandler = handler;
        },
        broadcast: (project: Project, msg: Record<string, unknown>) => project.broadcast({ type: 'plugin', plugin: p.manifest.id, ...msg }),
      });
      p.router = router;
    } catch (err: any) {
      p.error = err.message;
    }
  }

  list() {
    return [...this.plugins.values()].map((p) => ({ ...p.manifest, enabled: p.enabled, error: p.error, dir: p.dir }));
  }

  async setEnabled(id: string, enabled: boolean) {
    const p = this.plugins.get(id);
    if (!p) fail('Unknown plugin', 404);
    const disabled = new Set((await this.settings.get()).disabledPlugins || []);
    enabled ? disabled.delete(id) : disabled.add(id);
    await this.settings.update({ disabledPlugins: [...disabled] });
    p!.enabled = enabled;
    if (enabled && p!.manifest.server && !p!.router) await this.activate(p!);
    return this.list();
  }

  async installFromGit(url: string, clone: (url: string, dest: string) => Promise<unknown>) {
    const name = (/\/([^/]+?)(?:\.git)?\/?$/.exec(url) || [])[1];
    if (!name) fail('Cannot derive a folder name from the URL');
    const dest = path.join(PLUGIN_DIRS[1], name);
    await fs.mkdir(PLUGIN_DIRS[1], { recursive: true });
    await clone(url, dest);
    if (!(await fs.stat(path.join(dest, 'plugin.json')).catch(() => null))) {
      const jetbrains = (await fs.stat(path.join(dest, 'build.gradle.kts')).catch(() => null)) || (await fs.stat(path.join(dest, 'build.gradle')).catch(() => null));
      await fs.rm(dest, { recursive: true, force: true });
      fail(jetbrains ? 'This is a JetBrains (Kotlin/Java) plugin and cannot run inside the browser IDE. Use a plugin written for this IDE (a folder with plugin.json).' : 'The repository has no plugin.json, so it is not a plugin for this IDE.');
    }
    await this.load();
    return this.list();
  }

  handleUpgrade(id: string, ws: WebSocket, project: Project, url: URL) {
    const p = this.plugins.get(id);
    if (!p?.enabled || !p.wsHandler) return ws.close(1008, 'No websocket handler for plugin ' + id);
    p.wsHandler(ws, project, url);
  }
}
