import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA_DIR } from '../config/paths';
import { fail } from '../common/errors';

export interface Changelist {
  id: string;
  name: string;
  comment: string;
  active: boolean;
  files: string[];
}

const DIR = path.join(DATA_DIR, 'changelists');
const DEFAULT: Changelist = { id: 'default', name: 'Changes', comment: '', active: true, files: [] };

export class Changelists {
  private readonly file: string;
  private lists: Changelist[] | null = null;

  constructor(root: string) {
    this.file = path.join(DIR, crypto.createHash('sha1').update(root).digest('hex') + '.json');
  }

  async load(): Promise<Changelist[]> {
    if (this.lists) return this.lists;
    try {
      this.lists = JSON.parse(await fs.readFile(this.file, 'utf8')).lists;
    } catch {
      this.lists = [{ ...DEFAULT }];
    }
    if (!this.lists!.some((l) => l.id === 'default')) this.lists!.unshift({ ...DEFAULT });
    if (!this.lists!.some((l) => l.active)) this.lists![0].active = true;
    return this.lists!;
  }

  private async save() {
    await fs.mkdir(DIR, { recursive: true });
    await fs.writeFile(this.file, JSON.stringify({ lists: this.lists }, null, 2));
    return this.lists!;
  }

  async create({ name, comment = '', active = false }: { name: string; comment?: string; active?: boolean }) {
    const lists = await this.load();
    if (!name?.trim()) fail('Changelist name is required');
    if (lists.some((l) => l.name === name)) fail('A changelist with this name already exists');
    const list: Changelist = { id: crypto.randomUUID(), name: name.trim(), comment, active: false, files: [] };
    lists.push(list);
    if (active) lists.forEach((l) => (l.active = l.id === list.id));
    await this.save();
    return list;
  }

  async update(id: string, { name, comment }: { name?: string; comment?: string }) {
    const list = (await this.load()).find((l) => l.id === id);
    if (!list) fail('Changelist not found', 404);
    if (name != null) list!.name = name.trim() || (id === 'default' ? 'Changes' : list!.name);
    if (comment != null) list!.comment = comment;
    await this.save();
    return list;
  }

  async remove(id: string) {
    if (id === 'default') fail('The default changelist cannot be removed');
    const lists = await this.load();
    const removed = lists.find((l) => l.id === id);
    this.lists = lists.filter((l) => l.id !== id);
    if (removed?.active) this.lists[0].active = true;
    return this.save();
  }

  async setActive(id: string) {
    for (const l of await this.load()) l.active = l.id === id;
    return this.save();
  }

  async move(paths: string[], id: string) {
    const lists = await this.load();
    for (const l of lists) l.files = l.files.filter((f) => !paths.includes(f));
    const target = lists.find((l) => l.id === id);
    if (!target) fail('Changelist not found', 404);
    if (id !== 'default') target!.files.push(...paths);
    return this.save();
  }

  async prune(changed: Set<string>) {
    const lists = await this.load();
    let dirty = false;
    for (const l of lists) {
      const next = l.files.filter((f) => changed.has(f));
      if (next.length !== l.files.length) {
        l.files = next;
        dirty = true;
      }
    }
    return dirty ? this.save() : lists;
  }
}
