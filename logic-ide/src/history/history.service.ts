import { Injectable } from '@nestjs/common';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA_DIR } from '../config/paths';

const BASE = path.join(DATA_DIR, 'local-history');
const MAX_PER_FILE = 30;
const MAX_SIZE = 1024 * 1024;
// Rapid auto-saves would otherwise produce a snapshot every ~second while typing.
const MERGE_WINDOW_MS = 60_000;

const hash = (s: string) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 16);

export interface Snapshot {
  ts: number;
  event: 'save' | 'delete';
  size: number;
}

@Injectable()
export class HistoryService {
  private dir(root: string, rel: string) {
    return path.join(BASE, hash(root), hash(rel));
  }

  /** Snapshot the current on-disk content of `abs` before it is overwritten or deleted. */
  async snapshot(root: string, rel: string, abs: string, event: 'save' | 'delete') {
    try {
      const stat = await fs.stat(abs).catch(() => null);
      if (!stat?.isFile() || stat.size > MAX_SIZE) return;
      const content = await fs.readFile(abs);
      if (content.subarray(0, 8192).includes(0)) return;
      const entries = await this.list(root, rel);
      const last = entries[0];
      if (last && event === 'save') {
        if (Date.now() - last.ts < MERGE_WINDOW_MS) return;
        const prev = await this.content(root, rel, last.ts);
        if (prev === content.toString('utf8')) return;
      }
      const dir = this.dir(root, rel);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, 'meta.json'), JSON.stringify({ root, path: rel }));
      await fs.writeFile(path.join(dir, `${Date.now()}.${event}.snap`), content);
      for (const e of entries.slice(MAX_PER_FILE - 1)) await fs.rm(path.join(dir, `${e.ts}.${e.event}.snap`), { force: true });
    } catch {}
  }

  async list(root: string, rel: string): Promise<Snapshot[]> {
    let names: string[] = [];
    try {
      names = await fs.readdir(this.dir(root, rel));
    } catch {
      return [];
    }
    const out: Snapshot[] = [];
    for (const f of names) {
      const m = /^(\d+)\.(save|delete)\.snap$/.exec(f);
      if (!m) continue;
      const stat = await fs.stat(path.join(this.dir(root, rel), f)).catch(() => null);
      out.push({ ts: Number(m[1]), event: m[2] as Snapshot['event'], size: stat?.size ?? 0 });
    }
    return out.sort((a, b) => b.ts - a.ts);
  }

  async content(root: string, rel: string, ts: number): Promise<string | null> {
    const entries = await this.list(root, rel);
    const e = entries.find((x) => x.ts === ts);
    if (!e) return null;
    return fs.readFile(path.join(this.dir(root, rel), `${e.ts}.${e.event}.snap`), 'utf8').catch(() => null);
  }
}
