import type * as Monaco from 'monaco-editor';
import type { editorManager as Manager } from './editor-manager';
import { fsApi, symApi } from '@/lib/api';
import { ensureModels } from './model-cache';

const LANGS = ['javascript', 'typescript', 'php', 'html', 'python'];
const JS_KEYWORDS = /^(const|let|var|function|class|return|if|else|for|while|import|export|from|new|this|true|false|null|undefined)$/;

export function registerDefinitionProvider(monaco: typeof Monaco, manager: typeof Manager) {
  monaco.languages.registerDefinitionProvider(LANGS, {
    provideDefinition: async (model, position) => {
      const path = model.uri.path.replace(/^\//, '');
      const lineText = model.getLineContent(position.lineNumber);
      const location = (file: string, line = 1, col = 1, len = 0) => ({ uri: monaco.Uri.file('/' + file), range: new monaco.Range(line, col, line, col + len) });
      const inString = await stringTarget(path, lineText, position.column);
      if (inString !== undefined) {
        if (!inString) return [];
        await ensureModels(monaco, [inString]);
        return [location(inString)];
      }
      const word = model.getWordAtPosition(position);
      if (!word || /^\d/.test(word.word)) return [];
      const before = lineText.slice(0, word.startColumn - 1);
      const after = lineText.slice(word.endColumn - 1);
      const lang = model.getLanguageId();
      const isPhp = lang === 'php' || /\.php$/i.test(path);
      const isPy = lang === 'python';
      let preferFile: string | null = null;
      if (isPy) {
        const py = await pythonImportTarget(path, lineText, position.column, word.word);
        if (py.jump) {
          await ensureModels(monaco, [py.jump]);
          return [location(py.jump)];
        }
        preferFile = py.preferFile;
      }
      const member = /([A-Za-z_$][\w$]*)\s*(->|::|\.|\?\.)\s*$/.exec(before);
      let container = member ? member[1].replace(/^\$/, '') : null;
      if (container && ['this', 'self', 'static', 'cls'].includes(container)) container = enclosingClass(model, position.lineNumber);
      if (container === 'parent') container = null;
      const isNew = /\b(new|extends|implements|instanceof)\s+(\\?[\w\\]+\\)?$/.test(before) || /\buse\s+[\w\\]*$/.test(before);
      let fqn: string | null = null;
      if (isPhp) {
        const use = /\buse\s+([\w\\]+\\)?$/.exec(before);
        fqn = use ? (use[1] || '') + word.word : resolvePhpUse(model.getValue(), word.word);
        if (!fqn && /\\$/.test(before)) {
          const ns = /([\w\\]+)\\$/.exec(before);
          if (ns) fqn = ns[1] + '\\' + word.word;
        }
      }
      if (!member && !after.trim().startsWith('(') && !isNew && !isPhp && JS_KEYWORDS.test(word.word)) return [];
      if (!isPhp && !isPy) {
        const tsDefs = await tsDefinitions(monaco, model, position);
        if (tsDefs?.length) {
          const real = tsDefs.filter((d) => !d.importBinding);
          if (real.length) return real.map(({ uri, range }) => ({ uri, range }));
        }
      }
      let results: any[];
      try {
        results = await symApi.lookup({ name: word.word.replace(/^\$/, ''), file: path, container: container || undefined, isMember: member ? '1' : '0', isNew: isNew ? '1' : '0', fqn: fqn || undefined, preferFile: preferFile || undefined });
      } catch {
        return [];
      }
      results = results.filter((r) => !(r.file === path && r.line === position.lineNumber));
      if (!results.length) return [];
      const top = results[0].score;
      const picked = results.filter((r) => r.score >= top - 5);
      await ensureModels(monaco, picked.map((r) => r.file));
      return picked.map((r) => location(r.file, r.line, r.col, word.word.length));
    },
  });
  void manager;
}

async function stringTarget(path: string, lineText: string, column: number): Promise<string | null | undefined> {
  const re = /(['"`])([^'"`\n]+?)\1/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(lineText))) {
    const start = m.index + 2, end = m.index + m[0].length;
    if (column < start || column > end) continue;
    const spec = m[2];
    if (!/^(\.{1,2}\/|\/|@\/)/.test(spec) && !/\.(php|js|ts|json)$/.test(spec)) return null;
    const dirRelative = /__DIR__|dirname\s*\(/.test(lineText);
    const r = await fsApi.resolve(path, spec, dirRelative).catch(() => ({ path: null }));
    return r.path;
  }
  return undefined;
}

async function pythonImportTarget(path: string, lineText: string, column: number, word: string): Promise<{ jump: string | null; preferFile: string | null }> {
  const imp = /^\s*from\s+([\w.]+)\s+import\s+(.*)$/.exec(lineText) || /^\s*import\s+([\w.]+)/.exec(lineText);
  if (!imp) return { jump: null, preferFile: null };
  const modSpec = imp[1];
  const modStart = lineText.indexOf(modSpec) + 1, modEnd = modStart + modSpec.length;
  const spec = pyModuleToPath(modSpec);
  const r = await fsApi.resolve(path, spec, false, true).catch(() => ({ path: null }));
  if (column >= modStart && column <= modEnd) return { jump: r.path, preferFile: null };
  if (r.path) return { jump: null, preferFile: r.path };
  if (/^\s*from/.test(lineText)) {
    const sub = await fsApi.resolve(path, spec + '/' + word, false, true).catch(() => ({ path: null }));
    if (sub.path) return { jump: sub.path, preferFile: null };
  }
  return { jump: null, preferFile: null };
}

export function pyModuleToPath(spec: string): string {
  const m = /^(\.*)(.*)$/.exec(spec)!;
  const dots = m[1].length, rest = m[2].replace(/\./g, '/');
  if (dots === 0) return rest;
  return (dots === 1 ? './' : '../'.repeat(dots - 1)) + rest;
}

export function enclosingClass(model: Monaco.editor.ITextModel, lineNumber: number): string | null {
  for (let l = lineNumber; l >= 1; l--) {
    const m = /^\s*(?:export\s+)?(?:abstract\s+|final\s+)?(?:class|trait|interface|enum)\s+([A-Za-z_]\w*)/.exec(model.getLineContent(l));
    if (m) return m[1];
  }
  return null;
}

export function resolvePhpUse(text: string, name: string): string | null {
  const re = /^\s*use\s+([\w\\]+)(?:\s+as\s+(\w+))?\s*;/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) if ((m[2] || m[1].split('\\').pop()) === name) return m[1];
  const grouped = /^\s*use\s+([\w\\]+)\\\{([^}]+)\}/gm;
  while ((m = grouped.exec(text))) {
    for (const part of m[2].split(',')) {
      const [cls, alias] = part.trim().split(/\s+as\s+/);
      if ((alias || cls.split('\\').pop()) === name) return m[1] + '\\' + cls.trim();
    }
  }
  const ns = /\bnamespace\s+([\w\\]+)\s*;/.exec(text);
  return ns ? `${ns[1]}\\${name}` : null;
}

async function tsDefinitions(monaco: typeof Monaco, model: Monaco.editor.ITextModel, position: Monaco.Position) {
  const lang = model.getLanguageId();
  if (lang !== 'javascript' && lang !== 'typescript') return null;
  try {
    const ts = (monaco.languages as any).typescript;
    const getWorker = lang === 'typescript' ? ts.getTypeScriptWorker : ts.getJavaScriptWorker;
    const worker = await (await getWorker())(model.uri);
    const defs: any[] = (await worker.getDefinitionAtPosition(model.uri.toString(), model.getOffsetAt(position))) || [];
    const out = [];
    for (const d of defs) {
      const uri = monaco.Uri.parse(d.fileName);
      const m = monaco.editor.getModel(uri);
      if (!m || uri.scheme !== 'file') continue;
      const start = m.getPositionAt(d.textSpan.start), end = m.getPositionAt(d.textSpan.start + d.textSpan.length);
      const lineText = m.getLineContent(start.lineNumber);
      out.push({ uri, range: new monaco.Range(start.lineNumber, start.column, end.lineNumber, end.column), importBinding: m === model && (/^\s*import\b/.test(lineText) || /\brequire\s*\(/.test(lineText)) });
    }
    return out;
  } catch {
    return null;
  }
}
