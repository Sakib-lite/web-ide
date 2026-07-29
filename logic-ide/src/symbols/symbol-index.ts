import fs from 'node:fs/promises';
import path from 'node:path';
import { ProjectFS } from '../projects/project-fs';
import { parseJs } from './parse-js';
import { parsePhp } from './parse-php';
import { parsePy } from './parse-py';
import { INDEXED_EXTS, PHP_EXTS, PY_EXTS, Symbol, langOf } from './types';

export interface LookupContext {
  file?: string;
  container?: string | null;
  isMember?: boolean;
  isNew?: boolean;
  fqn?: string | null;
  preferFile?: string | null;
}

export interface IndexStats {
  files: number;
  symbols: number;
  ms: number;
}

const CLASS_KINDS = new Set(['class', 'interface', 'trait', 'enum']);

export class SymbolIndex {
  readonly byName = new Map<string, Symbol[]>();
  readonly byFile = new Map<string, Symbol[]>();
  readonly phpClasses = new Map<string, string>();
  ready = false;
  stats: IndexStats | null = null;
  private building: Promise<IndexStats> | null = null;

  constructor(private readonly pfs: ProjectFS) {}

  build(): Promise<IndexStats> {
    if (this.building) return this.building;
    this.building = (async () => {
      const started = Date.now();
      let count = 0;
      for await (const rel of this.pfs.walk('', INDEXED_EXTS)) {
        await this.indexFile(rel).catch(() => undefined);
        count++;
      }
      this.ready = true;
      this.stats = { files: count, symbols: this.byName.size, ms: Date.now() - started };
      return this.stats;
    })();
    return this.building;
  }

  rebuild(): Promise<IndexStats> {
    this.building = null;
    this.byName.clear();
    this.byFile.clear();
    this.phpClasses.clear();
    this.ready = false;
    return this.build();
  }

  removeFile(rel: string) {
    const prev = this.byFile.get(rel);
    if (!prev) return;
    for (const sym of prev) {
      const next = (this.byName.get(sym.name) || []).filter((s) => s.file !== rel);
      if (next.length) this.byName.set(sym.name, next);
      else this.byName.delete(sym.name);
    }
    for (const [fqn, file] of this.phpClasses) if (file === rel) this.phpClasses.delete(fqn);
    this.byFile.delete(rel);
  }

  async indexFile(rel: string, content?: string) {
    const ext = path.extname(rel).toLowerCase();
    if (!INDEXED_EXTS.has(ext)) return;
    if (content == null) {
      const abs = this.pfs.resolve(rel);
      if ((await fs.stat(abs)).size > 2 * 1024 * 1024) return;
      content = await fs.readFile(abs, 'utf8');
    }
    this.removeFile(rel);
    const symbols = PHP_EXTS.has(ext) ? parsePhp(content, rel) : PY_EXTS.has(ext) ? parsePy(content, rel) : parseJs(content, rel);
    this.byFile.set(rel, symbols);
    for (const sym of symbols) {
      if (!this.byName.has(sym.name)) this.byName.set(sym.name, []);
      this.byName.get(sym.name)!.push(sym);
      if (sym.lang === 'php' && sym.fqn) this.phpClasses.set(sym.fqn, rel);
    }
  }

  async ensureIndexed(rel: string) {
    if (!this.byFile.has(rel) && INDEXED_EXTS.has(path.extname(rel).toLowerCase())) await this.indexFile(rel).catch(() => undefined);
  }

  lookup(name: string, ctx: LookupContext = {}) {
    const { file, container, isMember, isNew, fqn, preferFile } = ctx;
    const fqnFile = fqn ? this.phpClasses.get(fqn.replace(/^\\/, '')) : null;
    const askingLang = file ? langOf(file) : null;
    const scored = (this.byName.get(name) || []).map((s) => {
      let score = 0;
      if (fqnFile && s.file === fqnFile && CLASS_KINDS.has(s.kind)) score += 100;
      if (preferFile && s.file === preferFile) score += 100;
      if (s.file === file) score += 50;
      if (container && s.container && s.container.toLowerCase() === container.toLowerCase()) score += 40;
      if (isNew && s.kind === 'class') score += 40;
      if (isMember && s.kind === 'method') score += 20;
      if (!isMember && (s.kind === 'function' || s.kind === 'class')) score += 10;
      if (file && path.dirname(s.file) === path.dirname(file)) score += 5;
      if (askingLang && s.lang === askingLang) score += 15;
      return { ...s, score };
    });
    return scored.sort((a, b) => b.score - a.score);
  }

  search(query: string, limit = 50): Symbol[] {
    const q = query.toLowerCase();
    const out: Symbol[] = [];
    for (const [name, syms] of this.byName) {
      if (!name.toLowerCase().includes(q)) continue;
      for (const s of syms) {
        out.push(s);
        if (out.length >= limit) return out;
      }
    }
    return out;
  }

  fileSymbols(rel: string): Symbol[] {
    return this.byFile.get(rel) || [];
  }

  members(className: string, file?: string) {
    const out: (Symbol & { inherited: boolean; from: string })[] = [];
    const seen = new Set<string>();
    const visit = (name: string, depth: number, preferFile?: string) => {
      if (depth > 6 || seen.has(name)) return;
      seen.add(name);
      const classes = (this.byName.get(name) || []).filter((s) => CLASS_KINDS.has(s.kind)).sort((a, b) => Number(b.file === preferFile) - Number(a.file === preferFile));
      const cls = classes[0];
      if (!cls) return;
      for (const sym of this.byFile.get(cls.file) || []) {
        if (sym.container === name && sym.kind !== 'class' && !out.some((o) => o.name === sym.name && o.kind === sym.kind)) out.push({ ...sym, inherited: depth > 0, from: name });
      }
      for (const p of cls.parents || []) visit(p, depth + 1, cls.file);
    };
    visit(className, 0, file);
    return out;
  }

  complete(prefix: string, file?: string, kinds?: string[], limit = 60): Symbol[] {
    const q = prefix.toLowerCase();
    const askingLang = file ? langOf(file) : null;
    const out: Symbol[] = [];
    for (const [name, syms] of this.byName) {
      if (q && !name.toLowerCase().startsWith(q)) continue;
      for (const s of syms) {
        if (s.container || (kinds && !kinds.includes(s.kind)) || (askingLang && s.lang !== askingLang)) continue;
        out.push(s);
      }
    }
    return out.sort((a, b) => Number(b.file === file) - Number(a.file === file) || a.name.length - b.name.length || a.name.localeCompare(b.name)).slice(0, limit);
  }

  phpNames(prefix: string) {
    const q = prefix.replace(/^\\/, '').toLowerCase();
    const classes: { fqn: string; file: string }[] = [];
    const namespaces = new Set<string>();
    for (const [fqn, file] of this.phpClasses) {
      if (!fqn.toLowerCase().startsWith(q)) continue;
      classes.push({ fqn, file });
      const segs = fqn.split('\\');
      for (let i = 1; i < segs.length; i++) {
        const ns = segs.slice(0, i).join('\\');
        if (ns.toLowerCase().startsWith(q) && ns.length > q.length) namespaces.add(ns);
      }
    }
    return { classes: classes.slice(0, 80), namespaces: [...namespaces].slice(0, 40) };
  }

  pyModules(prefix: string): string[] {
    const q = prefix.toLowerCase();
    const mods = new Set<string>();
    for (const file of this.byFile.keys()) {
      if (!file.endsWith('.py')) continue;
      const mod = file.replace(/\.py$/, '').replace(/\/__init__$/, '').replace(/\//g, '.');
      mods.add(mod);
      if (/^(src|app|lib)\./.test(mod)) mods.add(mod.replace(/^(src|app|lib)\./, ''));
    }
    const out = new Set<string>();
    for (const m of mods) {
      if (!m.toLowerCase().startsWith(q)) continue;
      out.add(prefix + m.slice(prefix.length).split('.')[0]);
    }
    return [...out].sort().slice(0, 80);
  }
}
