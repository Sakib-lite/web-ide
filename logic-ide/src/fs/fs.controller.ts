import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ProjectsService } from '../projects/projects.service';
import { Root } from '../common/project-root';
import { ok } from '../common/ok';
import { INDEXED_EXTS, JS_EXTS, PHP_EXTS, PY_EXTS, langOf } from '../symbols/types';
import { Project } from '../projects/project';

@Controller('api')
export class FsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get('files')
  async files(@Root() root: string) {
    const p = this.projects.require(root);
    const out: string[] = [];
    for await (const rel of p.fs.walk('')) {
      out.push(rel);
      if (out.length >= 20000) break;
    }
    return out;
  }

  @Get('fs/list')
  list(@Root() root: string, @Query('path') rel = '') {
    return this.projects.require(root).fs.list(rel);
  }

  @Get('fs/read')
  read(@Root() root: string, @Query('path') rel: string) {
    return this.projects.require(root).fs.read(rel);
  }

  @Post('fs/write')
  async write(@Root() root: string, @Body() body: { path: string; content: string }) {
    const p = this.projects.require(root);
    const out = await p.fs.write(body.path, body.content);
    if (INDEXED_EXTS.has(path.extname(body.path).toLowerCase())) await p.symbols.indexFile(body.path, body.content);
    return out;
  }

  @Post('fs/create')
  create(@Root() root: string, @Body() body: { path: string; type: 'dir' | 'file' }) {
    return ok(this.projects.require(root).fs.create(body.path, body.type));
  }

  @Post('fs/rename')
  rename(@Root() root: string, @Body() body: { path: string; newPath: string }) {
    return ok(this.projects.require(root).fs.rename(body.path, body.newPath));
  }

  @Post('fs/delete')
  remove(@Root() root: string, @Body('path') rel: string) {
    return ok(this.projects.require(root).fs.remove(rel));
  }

  @Get('fs/resolve')
  async resolve(@Root() root: string, @Query('from') from = '', @Query('spec') spec = '', @Query('dirRelative') dirRelative?: string, @Query('python') python?: string) {
    const p = this.projects.require(root);
    if (!spec) return { path: null };
    for (const candidate of moduleCandidates(from, spec, dirRelative === '1', python === '1')) {
      try {
        if ((await fs.stat(p.fs.resolve(candidate))).isFile()) return { path: candidate };
      } catch {}
    }
    return { path: null };
  }

  @Get('search')
  async search(@Root() root: string, @Query('q') q = '') {
    const p = this.projects.require(root);
    if (q.length < 2) return [];
    const needle = q.toLowerCase();
    const results: { file: string; line: number; col: number; text: string }[] = [];
    for await (const rel of p.fs.walk('')) {
      if (results.length >= 300) break;
      const text = await readText(p, rel);
      if (!text || !text.toLowerCase().includes(needle)) continue;
      const lines = text.split('\n');
      for (let i = 0; i < lines.length && results.length < 300; i++) {
        const idx = lines[i].toLowerCase().indexOf(needle);
        if (idx >= 0) results.push({ file: rel, line: i + 1, col: idx + 1, text: lines[i].trim().slice(0, 200) });
      }
    }
    return results;
  }

  @Get('usages')
  async usages(@Root() root: string, @Query('word') word = '', @Query('file') from = '') {
    const p = this.projects.require(root);
    if (!/^[A-Za-z_$][\w$]*$/.test(word)) return [];
    const lang = from ? langOf(from) : null;
    const exts = lang === 'php' ? PHP_EXTS : lang === 'py' ? PY_EXTS : lang === 'js' ? JS_EXTS : INDEXED_EXTS;
    const re = new RegExp(`(^|[^\\w$])${word.replace(/[$]/g, '\\$')}(?![\\w$])`, 'g');
    const results: { file: string; line: number; col: number; text: string }[] = [];
    for await (const rel of p.fs.walk('', exts)) {
      if (results.length >= 500) break;
      const text = await readText(p, rel);
      if (!text || !text.includes(word)) continue;
      const lines = text.split('\n');
      for (let i = 0; i < lines.length && results.length < 500; i++) {
        re.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(lines[i])) && results.length < 500) results.push({ file: rel, line: i + 1, col: m.index + m[1].length + 1, text: lines[i].trim().slice(0, 200) });
      }
    }
    return results.sort((a, b) => Number(b.file === from) - Number(a.file === from) || a.file.localeCompare(b.file) || a.line - b.line);
  }
}

async function readText(p: Project, rel: string): Promise<string | null> {
  try {
    const abs = p.fs.resolve(rel);
    if ((await fs.stat(abs)).size > 1024 * 1024) return null;
    const buf = await fs.readFile(abs);
    return buf.subarray(0, 4096).includes(0) ? null : buf.toString('utf8');
  } catch {
    return null;
  }
}

function moduleCandidates(from: string, spec: string, dirRelative: boolean, python: boolean): string[] {
  const fromDir = path.posix.dirname(from);
  let base: string;
  if (spec.startsWith('.')) base = path.posix.normalize(path.posix.join(fromDir, spec));
  else if (spec.startsWith('/')) base = dirRelative ? path.posix.normalize(path.posix.join(fromDir, spec.slice(1))) : spec.slice(1);
  else if (spec.startsWith('@/')) base = 'src/' + spec.slice(2);
  else base = spec;
  const out: string[] = [];
  for (const e of ['', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.vue', '.php', '.json', '.py']) out.push(base + e);
  for (const e of ['.js', '.ts', '.jsx', '.tsx', '.php']) out.push(path.posix.join(base, 'index' + e));
  out.push(path.posix.join(base, '__init__.py'));
  if (python) for (const d of ['src', 'app', 'lib']) out.push(`${d}/${base}.py`, `${d}/${base}/__init__.py`);
  return out;
}
