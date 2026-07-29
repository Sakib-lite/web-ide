export type Lang = 'js' | 'php' | 'py';

export interface Symbol {
  name: string;
  file: string;
  line: number;
  col: number;
  kind: string;
  container: string | null;
  lang: Lang;
  fqn?: string;
  parents?: string[];
  exported?: boolean;
  static?: boolean;
  visibility?: 'public' | 'protected' | 'private';
  signature?: string;
  type?: string | null;
}

export const JS_EXTS = new Set(['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.vue']);
export const PHP_EXTS = new Set(['.php', '.phtml', '.inc']);
export const PY_EXTS = new Set(['.py', '.pyw', '.pyi']);
export const INDEXED_EXTS = new Set([...JS_EXTS, ...PHP_EXTS, ...PY_EXTS]);

export function langOf(file: string): Lang {
  const ext = file.slice(file.lastIndexOf('.')).toLowerCase();
  if (PHP_EXTS.has(ext)) return 'php';
  if (PY_EXTS.has(ext)) return 'py';
  return 'js';
}

export function lineLocator(content: string) {
  const starts = [0];
  for (let i = 0; i < content.length; i++) if (content.charCodeAt(i) === 10) starts.push(i + 1);
  return (offset: number) => {
    let lo = 0, hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return { line: lo + 1, col: offset - starts[lo] + 1 };
  };
}

export function blankStringsAndComments(content: string, php = false): string {
  let out = '';
  let i = 0;
  const n = content.length;
  const keep = (c: string) => (c === '\n' ? '\n' : ' ');
  while (i < n) {
    const c = content[i], d = content[i + 1];
    if ((c === '/' && d === '/') || (php && c === '#' && d !== '[')) {
      while (i < n && content[i] !== '\n') { out += ' '; i++; }
    } else if (c === '/' && d === '*') {
      out += '  '; i += 2;
      while (i < n && !(content[i] === '*' && content[i + 1] === '/')) { out += keep(content[i]); i++; }
      out += '  '; i += 2;
    } else if (c === '"' || c === "'" || c === '`') {
      out += c; i++;
      while (i < n && content[i] !== c) {
        if (content[i] === '\\') { out += ' '; i++; }
        out += keep(content[i]); i++;
      }
      out += c; i++;
    } else {
      out += c; i++;
    }
  }
  return out;
}

export function matchBrace(src: string, openIdx: number): number {
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return i;
  }
  return src.length;
}

export function dedupe(symbols: Symbol[]): Symbol[] {
  const seen = new Set<string>();
  return symbols.filter((s) => {
    const key = `${s.name}:${s.line}:${s.kind}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export interface ClassRange {
  name: string;
  start: number;
  end: number;
}

export function containerFinder(ranges: ClassRange[]) {
  return (offset: number): string | null => {
    let best: ClassRange | null = null;
    for (const r of ranges) if (offset > r.start && offset < r.end && (!best || r.start > best.start)) best = r;
    return best?.name || null;
  };
}
