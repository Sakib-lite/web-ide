import type * as Monaco from 'monaco-editor';
import { fsApi, symApi } from '@/lib/api';
import { basename, dirname, escapeRegExp } from '@/lib/utils';
import { enclosingClass } from './definitions';
import { ensureModels } from './model-cache';

type Family = 'js' | 'php' | 'py';
const LANGS = ['javascript', 'typescript', 'php', 'python'];
const FAMILY: Record<string, Family> = { javascript: 'js', typescript: 'js', php: 'php', python: 'py' };
let monaco: typeof Monaco;

export function initIntellisense(m: typeof Monaco, _editor: Monaco.editor.IStandaloneCodeEditor) {
  monaco = m;
  monaco.languages.registerCompletionItemProvider(LANGS, { triggerCharacters: ['.', '>', ':', '\\', '/', "'", '"', '{', ' ', ','], provideCompletionItems: safe(provideCompletions, { suggestions: [] }) });
  monaco.languages.registerDocumentHighlightProvider(['php', 'python'], { provideDocumentHighlights: safe(provideHighlights, []) });
  monaco.languages.registerReferenceProvider(LANGS, { provideReferences: safe(provideReferences, []) });
  monaco.languages.registerRenameProvider(['php', 'python'], { provideRenameEdits: safe(provideRename, { edits: [] }), resolveRenameLocation: safe(resolveRename, null) });
  monaco.languages.registerCodeActionProvider(LANGS, { provideCodeActions: safe(provideCodeActions, { actions: [], dispose() {} }) });
  monaco.languages.registerHoverProvider(['php', 'python'], { provideHover: safe(provideHover, null) });
}

const safe = <A extends unknown[], R>(fn: (...a: A) => Promise<R> | R, fallback: R) => async (...a: A): Promise<R> => {
  try {
    return await fn(...a);
  } catch {
    return fallback;
  }
};
const relOf = (model: Monaco.editor.ITextModel) => model.uri.path.replace(/^\//, '');
const famOf = (model: Monaco.editor.ITextModel) => FAMILY[model.getLanguageId()];
const kindOf = (s: any) => {
  const K = monaco.languages.CompletionItemKind;
  return ({ class: K.Class, interface: K.Interface, trait: K.Class, enum: K.Enum, function: K.Function, method: K.Method, property: K.Field, constant: K.Constant, variable: K.Variable, type: K.Interface } as Record<string, number>)[s.kind] ?? K.Text;
};
const wordRange = (model: Monaco.editor.ITextModel, position: Monaco.Position) => {
  const w = model.getWordUntilPosition(position);
  return new monaco.Range(position.lineNumber, w.startColumn, position.lineNumber, w.endColumn);
};
const retrigger = { id: 'editor.action.triggerSuggest', title: 'retrigger' };
const inComment = (line: string, column: number) => /^\s*(\/\/|#|\*|\/\*)/.test(line) || /\/\/[^'"]*$/.test(line.slice(0, column - 1));

type ImportContext =
  | { type: 'path'; spec: string; dirRelative: boolean }
  | { type: 'string' }
  | { type: 'named'; spec: string | null; already: string[] }
  | { type: 'phpname'; prefix: string; useStatement: boolean }
  | { type: 'pymodule'; prefix: string }
  | { type: 'pynames'; module: string; already: string[] };

async function provideCompletions(model: Monaco.editor.ITextModel, position: Monaco.Position): Promise<Monaco.languages.CompletionList> {
  const line = model.getLineContent(position.lineNumber);
  const before = line.slice(0, position.column - 1);
  if (inComment(line, position.column)) return { suggestions: [] };
  const fam = famOf(model), file = relOf(model);
  const ctx = importContext(fam, line, before, position.column);
  if (ctx) return { suggestions: await importSuggestions(ctx, model, position, fam, file) };
  const member = /([A-Za-z_$][\w$]*)\s*(->|::|\.)\s*([A-Za-z_$]?[\w$]*)$/.exec(before);
  if (member) {
    const op = member[2];
    const phpOk = fam === 'php' && op !== '.';
    const otherOk = fam !== 'php' && op === '.';
    if (phpOk || otherOk) return { suggestions: await memberSuggestions(model, position, fam, file, member[1].replace(/^\$/, ''), op, before) };
  }
  const w = model.getWordUntilPosition(position);
  if (!w.word || (fam === 'php' && line[w.startColumn - 2] === '$')) return { suggestions: [] };
  return { suggestions: await identifierSuggestions(model, position, fam, file, w.word) };
}

function importContext(fam: Family, line: string, before: string, column: number): ImportContext | null {
  const str = /(['"])([^'"]*)$/.exec(before);
  if (str) {
    const spec = str[2];
    const lineBefore = before.slice(0, before.length - spec.length - 1);
    if (/\b(from|import|require|require_once|include|include_once)\b\s*\(?\s*$/.test(lineBefore) || /__DIR__\s*\.\s*$/.test(lineBefore) || /\bdirname\s*\(\s*__FILE__\s*\)\s*\.\s*$/.test(lineBefore)) return { type: 'path', spec, dirRelative: /__DIR__|dirname\s*\(/.test(lineBefore) };
    return { type: 'string' };
  }
  if (fam === 'js') {
    const named = /\bimport\s*\{([^}]*)$/.exec(before);
    if (named) {
      const from = /\}\s*from\s*['"]([^'"]+)['"]/.exec(line.slice(column - 1));
      return { type: 'named', spec: from?.[1] || null, already: named[1].split(',').map((s) => s.trim()).filter(Boolean) };
    }
  }
  if (fam === 'php') {
    const u = /^\s*use\s+(?:function\s+|const\s+)?([\w\\]*)$/.exec(before) || /\b(?:new|extends|implements|instanceof|catch\s*\()\s*\\?([\w\\]*)$/.exec(before);
    if (u) return { type: 'phpname', prefix: u[1], useStatement: /^\s*use\s/.test(before) };
    if (/\\[\w]*$/.test(before)) return { type: 'phpname', prefix: /([\w\\]*)$/.exec(before)![1], useStatement: false };
  }
  if (fam === 'py') {
    const names = /^\s*from\s+([\w.]+)\s+import\s+(?:\(?\s*)?([\w\s,]*)$/.exec(before);
    if (names) return { type: 'pynames', module: names[1], already: names[2].split(',').map((s) => s.trim()).filter(Boolean) };
    const mod = /^\s*(?:from|import)\s+([\w.]*)$/.exec(before);
    if (mod) return { type: 'pymodule', prefix: mod[1] };
  }
  return null;
}

async function importSuggestions(ctx: ImportContext, model: Monaco.editor.ITextModel, position: Monaco.Position, fam: Family, file: string): Promise<Monaco.languages.CompletionItem[]> {
  const K = monaco.languages.CompletionItemKind;
  const out: Monaco.languages.CompletionItem[] = [];
  const rangeFor = (partial: string) => new monaco.Range(position.lineNumber, position.column - partial.length, position.lineNumber, position.column);
  if (ctx.type === 'string') return out;
  if (ctx.type === 'path') {
    const slash = ctx.spec.lastIndexOf('/');
    const typedDir = slash >= 0 ? ctx.spec.slice(0, slash + 1) : '';
    const partial = slash >= 0 ? ctx.spec.slice(slash + 1) : ctx.spec;
    const dir = pathDir(file, typedDir, ctx.dirRelative);
    if (dir === null) return out;
    const entries: { name: string; type: string }[] = await fsApi.list(dir).catch(() => []);
    const range = rangeFor(partial);
    for (const e of entries) {
      if (e.name.startsWith('.') && !partial.startsWith('.')) continue;
      const isDir = e.type === 'dir';
      if (!isDir && fam === 'js' && !/\.(js|mjs|cjs|ts|tsx|jsx|json|vue|css)$/.test(e.name)) continue;
      if (!isDir && fam === 'php' && !/\.php$/.test(e.name)) continue;
      out.push({ label: e.name, kind: isDir ? K.Folder : K.File, insertText: isDir ? e.name + '/' : e.name, range, sortText: (isDir ? '0' : '1') + e.name, command: isDir ? retrigger : undefined });
    }
    if (!typedDir && !ctx.dirRelative) for (const p of ['./', '../']) out.push({ label: p, kind: K.Folder, insertText: p, range, sortText: '00' + p, command: retrigger });
    return out;
  }
  if (ctx.type === 'named') {
    if (!ctx.spec) return out;
    const r = await fsApi.resolve(file, ctx.spec);
    if (!r.path) return out;
    const range = wordRange(model, position);
    for (const s of (await symApi.file(r.path)).filter((s: any) => !s.container && s.exported !== false && !ctx.already.includes(s.name))) out.push({ label: s.name, kind: kindOf(s), insertText: s.name, range, detail: `${s.kind} · ${r.path}`, sortText: '0' + s.name });
    return out;
  }
  if (ctx.type === 'phpname') {
    const { classes, namespaces } = await symApi.phpNames(ctx.prefix);
    const lastSep = ctx.prefix.lastIndexOf('\\');
    const partial = ctx.prefix.slice(lastSep + 1), prefixNs = ctx.prefix.slice(0, lastSep + 1);
    const range = rangeFor(partial);
    for (const ns of namespaces) {
      const rest = ns.slice(prefixNs.length);
      if (rest && !rest.includes('\\')) out.push({ label: rest, kind: K.Module, insertText: rest + '\\', range, detail: ns, sortText: '0' + rest, command: retrigger });
    }
    for (const c of classes) {
      const rest = c.fqn.slice(prefixNs.length);
      if (rest && !rest.includes('\\')) out.push({ label: rest, kind: K.Class, insertText: rest + (ctx.useStatement ? ';' : ''), range, detail: c.fqn, sortText: '1' + rest });
    }
    if (!ctx.useStatement && !ctx.prefix.includes('\\')) {
      for (const s of await symApi.complete(ctx.prefix, file, 'class,interface,trait,enum')) {
        if (!s.fqn || out.some((o) => (typeof o.label === 'string' ? o.label : o.label.label) === s.name)) continue;
        const edit = importEdit(model, 'php', s, file);
        out.push({ label: { label: s.name, description: edit && edit !== 'imported' ? 'auto-import' : '' }, kind: K.Class, insertText: s.name, range, detail: s.fqn, sortText: '2' + s.name, additionalTextEdits: edit && edit !== 'imported' ? [edit] : undefined });
      }
    }
    return out;
  }
  if (ctx.type === 'pymodule') {
    const lastDot = ctx.prefix.lastIndexOf('.');
    const range = rangeFor(ctx.prefix.slice(lastDot + 1));
    for (const m of await symApi.pyModules(ctx.prefix)) {
      const rest = m.slice(lastDot + 1);
      out.push({ label: rest, kind: K.Module, insertText: rest, range, detail: m, sortText: '0' + rest });
    }
    return out;
  }
  const spec = ctx.module.replace(/^(\.+)/, (d) => (d.length === 1 ? './' : '../'.repeat(d.length - 1))).replace(/\./g, '/');
  const r = await fsApi.resolve(file, spec, false, true);
  if (!r.path) return out;
  const range = wordRange(model, position);
  for (const s of (await symApi.file(r.path)).filter((s: any) => !s.container && !ctx.already.includes(s.name))) out.push({ label: s.name, kind: kindOf(s), insertText: s.name, range, detail: `${s.kind} · ${r.path}`, sortText: '0' + s.name });
  for (const m of await symApi.pyModules(ctx.module + '.')) {
    const rest = m.slice(ctx.module.length + 1);
    if (rest && !ctx.already.includes(rest)) out.push({ label: rest, kind: K.Module, insertText: rest, range, detail: m, sortText: '1' + rest });
  }
  return out;
}

function pathDir(file: string, typedDir: string, dirRelative: boolean): string | null {
  let base: string;
  if (dirRelative) base = dirname(file) + '/' + typedDir.replace(/^\//, '');
  else if (typedDir.startsWith('.') || typedDir === '') base = (dirname(file) ? dirname(file) + '/' : '') + typedDir;
  else if (typedDir.startsWith('/')) base = typedDir.slice(1);
  else if (typedDir.startsWith('@/')) base = 'src/' + typedDir.slice(2);
  else return null;
  const parts: string[] = [];
  for (const seg of base.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') {
      if (!parts.length) return null;
      parts.pop();
      continue;
    }
    parts.push(seg);
  }
  return parts.join('/');
}

async function memberSuggestions(model: Monaco.editor.ITextModel, position: Monaco.Position, fam: Family, file: string, receiver: string, op: string, before: string): Promise<Monaco.languages.CompletionItem[]> {
  const info = await resolveReceiver(model, position, fam, file, receiver, op, before);
  if (!info?.cls) return [];
  const range = wordRange(model, position);
  const out: Monaco.languages.CompletionItem[] = [];
  for (const m of await symApi.members(info.cls, file)) {
    if (!info.self && m.visibility === 'private') continue;
    if (!info.self && m.visibility === 'protected' && !info.subclass) continue;
    if (info.static && !m.static && m.kind !== 'constant' && fam !== 'py') continue;
    if (!info.static && m.static && fam === 'php' && op === '->') continue;
    const isMethod = m.kind === 'method';
    const insert = isMethod ? (m.signature && m.signature !== '()' ? `${m.name}($1)$0` : `${m.name}()$0`) : m.kind === 'property' && fam === 'php' && info.static ? '$' + m.name : m.name;
    out.push({
      label: { label: m.name, detail: isMethod ? m.signature || '()' : '', description: m.inherited ? `↑ ${m.from}` : '' },
      kind: kindOf(m), insertText: insert, insertTextRules: isMethod ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet : undefined, range,
      detail: `${m.visibility || ''} ${m.static ? 'static ' : ''}${m.kind}${m.type ? ': ' + m.type : ''} · ${m.file}:${m.line}`.trim(),
      sortText: (m.inherited ? '1' : '0') + (isMethod ? '0' : '1') + m.name,
    });
  }
  return out;
}

async function resolveReceiver(model: Monaco.editor.ITextModel, position: Monaco.Position, fam: Family, file: string, receiver: string, op: string, before: string) {
  const enclosing = enclosingClass(model, position.lineNumber);
  if (['this', 'self', 'static', 'cls'].includes(receiver)) return { cls: enclosing, self: true, static: receiver === 'static' || receiver === 'cls' || (op === '::' && receiver !== 'self'), subclass: false };
  if (receiver === 'parent' || receiver === 'super') {
    const cur = enclosing ? (await symApi.lookup({ name: enclosing, file, isNew: '1' }))[0] : null;
    return cur?.parents?.[0] ? { cls: cur.parents[0], self: true, subclass: true, static: false } : null;
  }
  const chain = /(?:\$this->|self\.|this\.)(\w+)\s*(?:->|\.)\s*$/.exec(before.replace(/[\w$]*$/, ''));
  if (chain && enclosing) {
    const prop = (await symApi.members(enclosing, file)).find((m: any) => m.name === chain[1] && m.kind === 'property');
    if (prop?.type) return { cls: prop.type.replace(/^\?/, '').split('|')[0].split('\\').pop(), self: false, static: false, subclass: false };
  }
  if (/^[A-Z]/.test(receiver)) {
    const cls = (await symApi.lookup({ name: receiver, file, isNew: '1' })).find((c: any) => ['class', 'interface', 'trait', 'enum'].includes(c.kind));
    if (cls) return { cls: cls.name, static: true, self: cls.name === enclosing, subclass: false };
  }
  const found = inferVariableType(model.getValue().split('\n').slice(0, position.lineNumber).join('\n'), fam, receiver);
  if (!found) return null;
  const cls = found.replace(/^\\/, '').split('\\').pop()!.split('.').pop()!;
  return { cls, self: false, static: false, subclass: cls === enclosing };
}

function inferVariableType(text: string, fam: Family, name: string): string | null {
  const r = escapeRegExp(name);
  const patterns = fam === 'php'
    ? [`\\$${r}\\s*=\\s*new\\s+\\\\?([\\w\\\\]+)`, `([A-Z][\\w\\\\]*)\\s+\\$${r}\\b`, `@var\\s+\\\\?([\\w\\\\]+)\\s+\\$${r}\\b`, `\\$${r}\\s*=\\s*\\\\?([A-Z][\\w\\\\]*)::(?:new|make|create|instance|get|find|first|query|factory|from)\\w*\\(`, `\\$${r}\\s*=\\s*app\\(\\s*\\\\?([\\w\\\\]+)::class`]
    : fam === 'py'
      ? [`\\b${r}\\s*=\\s*([A-Z]\\w*)\\(`, `\\b${r}\\s*:\\s*([A-Z][\\w.]*)`, `isinstance\\(\\s*${r}\\s*,\\s*([A-Z]\\w*)`]
      : [`\\b${r}\\s*=\\s*new\\s+([A-Z][\\w.]*)`, `\\b${r}\\s*:\\s*([A-Z]\\w*)`, `@(?:param|type|var)\\s*\\{([A-Z]\\w*)\\}\\s*${r}\\b`, `\\b${r}\\s*=\\s*(?:await\\s+)?([A-Z]\\w*)\\.(?:create|from|get|find|build|make|of)\\w*\\(`];
  for (const p of patterns) {
    const re = new RegExp(p, 'g');
    let m: RegExpExecArray | null, found: string | null = null;
    while ((m = re.exec(text))) found = m[1];
    if (found) return found;
  }
  return null;
}

async function identifierSuggestions(model: Monaco.editor.ITextModel, position: Monaco.Position, fam: Family, file: string, prefix: string): Promise<Monaco.languages.CompletionItem[]> {
  const range = wordRange(model, position);
  const text = model.getValue();
  const out: Monaco.languages.CompletionItem[] = [];
  for (const s of await symApi.complete(prefix, file)) {
    if (s.file === file) {
      if (fam !== 'js') out.push({ label: s.name, kind: kindOf(s), insertText: s.name, range, detail: `${s.kind} · this file`, sortText: '0' + s.name });
      continue;
    }
    if (s.exported === false || (fam === 'php' && !s.fqn && s.kind !== 'function' && s.kind !== 'constant')) continue;
    const edit = importEdit(model, fam, s, file, text);
    if (!edit) continue;
    const imported = edit === 'imported';
    const snippet = s.kind === 'function' && fam !== 'php';
    out.push({
      label: { label: s.name, description: imported ? basename(s.file) : `auto-import from ${s.file}` },
      kind: kindOf(s), insertText: snippet ? `${s.name}($1)$0` : s.name, insertTextRules: snippet ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet : undefined,
      range, detail: `${s.kind} · ${s.file}:${s.line}`, sortText: (imported ? '1' : '2') + s.name, additionalTextEdits: imported ? undefined : [edit],
    });
  }
  return out;
}

type ImportEdit = { range: Monaco.Range; text: string } | 'imported' | null;

export function importEdit(model: Monaco.editor.ITextModel, fam: Family, s: any, file: string, text = model.getValue()): ImportEdit {
  const lines = text.split('\n');
  if (fam === 'js') return jsImportEdit(lines, text, s, file);
  if (fam === 'php') return phpImportEdit(lines, text, s);
  return pyImportEdit(lines, text, s);
}

function jsImportEdit(lines: string[], text: string, s: any, file: string): ImportEdit {
  const esc = escapeRegExp(s.name);
  if (new RegExp(`\\bimport\\b[^;]*\\b${esc}\\b[^;]*\\bfrom\\b`).test(text) || new RegExp(`\\b${esc}\\b[^\\n]*=\\s*require\\(`).test(text)) return 'imported';
  let rel = relativePath(dirname(file), s.file);
  if (!rel.startsWith('.')) rel = './' + rel;
  const useRequire = /\brequire\(/.test(text) && !/^\s*import\s/m.test(text);
  const keepExt = /from\s+['"][^'"]+\.(?:m?js|ts)['"]/.test(text) || /\.m?js$/.test(file);
  if (!keepExt) rel = rel.replace(/\.(js|ts|jsx|tsx)$/, '');
  const quote = /from\s+"/.test(text) ? '"' : "'";
  const same = lines.findIndex((l) => new RegExp(`^\\s*import\\s*\\{[^}]*\\}\\s*from\\s*['"]${escapeRegExp(rel)}['"]`).test(l));
  if (same >= 0) {
    const idx = lines[same].indexOf('}');
    return { range: new monaco.Range(same + 1, idx + 1, same + 1, idx + 1), text: `, ${s.name}${lines[same][idx - 1] === ' ' ? ' ' : ''}` };
  }
  let at = 0;
  lines.forEach((l, i) => /^\s*(import\s|const\s.*=\s*require\(|['"]use strict['"];?)/.test(l) && (at = i + 1));
  if (at === 0 && /^#!/.test(lines[0])) at = 1;
  const line = useRequire ? `const { ${s.name} } = require(${quote}${rel}${quote});` : `import { ${s.name} } from ${quote}${rel}${quote};`;
  return { range: new monaco.Range(at + 1, 1, at + 1, 1), text: line + '\n' + (at === 0 && lines[0].trim() ? '\n' : '') };
}

function phpImportEdit(lines: string[], text: string, s: any): ImportEdit {
  if (!s.fqn) return null;
  const ns = /\bnamespace\s+([\w\\]+)\s*;/.exec(text)?.[1] || '';
  const symNs = s.fqn.split('\\').slice(0, -1).join('\\');
  if (ns === symNs || !symNs) return 'imported';
  if (new RegExp(`^\\s*use\\s+\\\\?${escapeRegExp(s.fqn)}\\s*;`, 'm').test(text) || new RegExp(`^\\s*use\\s+[\\w\\\\]+\\\\\\{[^}]*\\b${escapeRegExp(s.name)}\\b`, 'm').test(text)) return 'imported';
  let at = -1;
  lines.forEach((l, i) => /^\s*use\s+[\w\\]+(\s+as\s+\w+)?\s*;/.test(l) && (at = i));
  if (at >= 0) return { range: new monaco.Range(at + 2, 1, at + 2, 1), text: `use ${s.fqn};\n` };
  const nsLine = lines.findIndex((l) => /^\s*namespace\s+[\w\\]+\s*;/.test(l));
  if (nsLine >= 0) return { range: new monaco.Range(nsLine + 2, 1, nsLine + 2, 1), text: `\nuse ${s.fqn};\n` };
  const open = lines.findIndex((l) => l.includes('<?php'));
  return { range: new monaco.Range(open + 2, 1, open + 2, 1), text: `\nuse ${s.fqn};\n` };
}

function pyImportEdit(lines: string[], text: string, s: any): ImportEdit {
  const mod = pyModuleOf(s.file);
  if (!mod) return null;
  if (new RegExp(`^\\s*from\\s+${escapeRegExp(mod)}\\s+import\\s+[^\\n]*\\b${escapeRegExp(s.name)}\\b`, 'm').test(text) || new RegExp(`^\\s*import\\s+${escapeRegExp(mod)}\\b`, 'm').test(text)) return 'imported';
  const same = lines.findIndex((l) => new RegExp(`^\\s*from\\s+${escapeRegExp(mod)}\\s+import\\s+[\\w\\s,]+$`).test(l));
  if (same >= 0) return { range: new monaco.Range(same + 1, lines[same].length + 1, same + 1, lines[same].length + 1), text: `, ${s.name}` };
  let at = 0;
  lines.forEach((l, i) => /^(import\s|from\s+[\w.]+\s+import\s)/.test(l) && (at = i + 1));
  if (at === 0) {
    let i = /^#!/.test(lines[0]) ? 1 : 0;
    while (lines[i] !== undefined && /^\s*(#|$)/.test(lines[i])) i++;
    at = i;
  }
  return { range: new monaco.Range(at + 1, 1, at + 1, 1), text: `from ${mod} import ${s.name}\n` };
}

const pyModuleOf = (file: string) => (file.endsWith('.py') ? file.replace(/\.py$/, '').replace(/\/__init__$/, '').replace(/^(src|app|lib)\//, '').replace(/\//g, '.') : null);

function relativePath(fromDir: string, to: string): string {
  const a = fromDir ? fromDir.split('/') : [], b = to.split('/');
  let i = 0;
  while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++;
  return [...Array(a.length - i).fill('..'), ...b.slice(i)].join('/');
}

function provideHighlights(model: Monaco.editor.ITextModel, position: Monaco.Position): Monaco.languages.DocumentHighlight[] {
  const w = model.getWordAtPosition(position);
  if (!w) return [];
  const re = new RegExp(`(^|[^\\w$])(${escapeRegExp(w.word)})(?![\\w$])`, 'g');
  const out: Monaco.languages.DocumentHighlight[] = [];
  const lines = model.getLinesContent();
  for (let i = 0; i < lines.length && out.length < 2000; i++) {
    let m: RegExpExecArray | null;
    re.lastIndex = 0;
    while ((m = re.exec(lines[i]))) {
      const col = m.index + m[1].length + 1;
      const write = /^\s*(=(?!=)|\+=|-=|\*=|\/=)/.test(lines[i].slice(col - 1 + w.word.length));
      out.push({ range: new monaco.Range(i + 1, col, i + 1, col + w.word.length), kind: write ? monaco.languages.DocumentHighlightKind.Write : monaco.languages.DocumentHighlightKind.Text });
    }
  }
  return out;
}

async function provideReferences(model: Monaco.editor.ITextModel, position: Monaco.Position): Promise<Monaco.languages.Location[]> {
  const w = model.getWordAtPosition(position);
  if (!w) return [];
  const usages: any[] = await symApi.usages(w.word, relOf(model));
  await ensureModels(monaco, usages.map((u) => u.file as string));
  return usages.map((u) => ({ uri: monaco.Uri.file('/' + u.file), range: new monaco.Range(u.line, u.col, u.line, u.col + w.word.length) }));
}

function resolveRename(model: Monaco.editor.ITextModel, position: Monaco.Position): Monaco.languages.RenameLocation & Monaco.languages.Rejection {
  const w = model.getWordAtPosition(position);
  if (!w) return { rejectReason: 'Place the caret on an identifier', range: new monaco.Range(1, 1, 1, 1), text: '' };
  const sigil = w.word.startsWith('$') ? 1 : 0;
  return { range: new monaco.Range(position.lineNumber, w.startColumn + sigil, position.lineNumber, w.endColumn), text: w.word.slice(sigil) };
}

function provideRename(model: Monaco.editor.ITextModel, position: Monaco.Position, newName: string): Monaco.languages.WorkspaceEdit {
  const w = model.getWordAtPosition(position);
  if (!w) return { edits: [] };
  const php = model.getLanguageId() === 'php';
  const oldBare = w.word.replace(/^\$/, ''), newBare = newName.replace(/^\$/, '');
  const re = php ? new RegExp(`(->|::\\$|\\$)(${escapeRegExp(oldBare)})(?![\\w$])`, 'g') : new RegExp(`(^|[^\\w$])(${escapeRegExp(oldBare)})(?![\\w$])`, 'g');
  const edits: Monaco.languages.IWorkspaceTextEdit[] = [];
  model.getLinesContent().forEach((line, i) => {
    let m: RegExpExecArray | null;
    re.lastIndex = 0;
    while ((m = re.exec(line))) {
      const col = m.index + m[1].length + 1;
      edits.push({ resource: model.uri, textEdit: { range: new monaco.Range(i + 1, col, i + 1, col + oldBare.length), text: newBare }, versionId: model.getVersionId() });
    }
  });
  return { edits };
}

async function provideCodeActions(model: Monaco.editor.ITextModel, range: Monaco.Range): Promise<Monaco.languages.CodeActionList> {
  const w = model.getWordAtPosition(range.getStartPosition());
  if (!w || !/^[A-Za-z_]/.test(w.word)) return { actions: [], dispose() {} };
  const fam = famOf(model), file = relOf(model);
  const candidates = (await symApi.complete(w.word, file)).filter((s: any) => s.name === w.word && s.file !== file && s.exported !== false && (fam !== 'php' || s.fqn || s.kind === 'function'));
  const actions: Monaco.languages.CodeAction[] = [];
  for (const s of candidates.slice(0, 6)) {
    const edit = importEdit(model, fam, s, file);
    if (!edit || edit === 'imported') continue;
    actions.push({ title: `Import '${s.fqn || s.name}' from ${s.file}`, kind: 'quickfix', isPreferred: actions.length === 0, edit: { edits: [{ resource: model.uri, textEdit: edit, versionId: model.getVersionId() }] } });
  }
  return { actions, dispose() {} };
}

async function provideHover(model: Monaco.editor.ITextModel, position: Monaco.Position): Promise<Monaco.languages.Hover | null> {
  const w = model.getWordAtPosition(position);
  if (!w) return null;
  const line = model.getLineContent(position.lineNumber);
  const isMember = /(->|::|\.)\s*$/.test(line.slice(0, w.startColumn - 1));
  const s = (await symApi.lookup({ name: w.word.replace(/^\$/, ''), file: relOf(model), isMember: isMember ? '1' : '0' }))[0];
  if (!s) return null;
  const sig = s.kind === 'method' || s.kind === 'function' ? `${s.name}${s.signature || '()'}` : s.name;
  const sep = famOf(model) === 'php' ? '::' : '.';
  return { range: new monaco.Range(position.lineNumber, w.startColumn, position.lineNumber, w.endColumn), contents: [{ value: `\`\`\`${model.getLanguageId()}\n${s.visibility ? s.visibility + ' ' : ''}${s.static ? 'static ' : ''}${s.kind} ${s.container ? s.container + sep : ''}${sig}\n\`\`\`` }, { value: `${s.fqn ? '`' + s.fqn + '` · ' : ''}${s.file}:${s.line}` }] };
}

export async function isOnDeclaration(model: Monaco.editor.ITextModel, position: Monaco.Position): Promise<boolean> {
  const w = model.getWordAtPosition(position);
  if (!w) return false;
  const symbols: any[] = await symApi.file(relOf(model)).catch(() => []);
  return symbols.some((s) => s.name === w.word.replace(/^\$/, '') && s.line === position.lineNumber);
}
