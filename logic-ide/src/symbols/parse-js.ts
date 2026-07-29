import { Symbol, ClassRange, blankStringsAndComments, containerFinder, dedupe, lineLocator, matchBrace } from './types';

const KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'function', 'typeof', 'await', 'async', 'else', 'do', 'new', 'throw', 'case', 'default', 'import', 'export', 'const', 'let', 'var', 'class', 'super', 'this', 'yield', 'delete', 'void', 'in', 'of', 'instanceof', 'constructor']);

const PATTERNS: [RegExp, string][] = [
  [/\bfunction\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(/g, 'function'],
  [/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/g, 'function'],
  [/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?function\b/g, 'function'],
  [/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:require\(|new\s|class\b|{|\[)/g, 'variable'],
  [/^[ \t]*([A-Za-z_$][\w$]*)\s*:\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*=>)/gm, 'method'],
  [/^[ \t]*(?:static\s+|async\s+|get\s+|set\s+|\*\s*)*([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*\{/gm, 'method'],
  [/\b(?:interface|type|enum)\s+([A-Za-z_$][\w$]*)/g, 'type'],
  [/\b(?:exports\.|module\.exports\.)([A-Za-z_$][\w$]*)\s*=/g, 'function'],
];

export function parseJs(content: string, file: string): Symbol[] {
  const src = blankStringsAndComments(content);
  const at = lineLocator(content);
  const symbols: Symbol[] = [];
  const push = (name: string, offset: number, kind: string, container: string | null = null, extra: Partial<Symbol> = {}) => {
    if (!name || KEYWORDS.has(name)) return;
    symbols.push({ name, file, kind, container, lang: 'js', ...at(offset), ...extra });
  };
  const ranges: ClassRange[] = [];
  const classRe = /\bclass\s+([A-Za-z_$][\w$]*)(?:\s+extends\s+([A-Za-z_$][\w$.]*))?/g;
  let m: RegExpExecArray | null;
  while ((m = classRe.exec(src))) {
    const bodyStart = src.indexOf('{', m.index + m[0].length);
    if (bodyStart < 0) continue;
    ranges.push({ name: m[1], start: bodyStart, end: matchBrace(src, bodyStart) });
    push(m[1], m.index + m[0].indexOf(m[1]), 'class', null, m[2] ? { parents: [m[2].split('.').pop()!] } : {});
  }
  const containerAt = containerFinder(ranges);
  const exported = collectExports(src);
  for (const [re, kind] of PATTERNS) {
    while ((m = re.exec(src))) {
      const name = m[1];
      const offset = m.index + m[0].indexOf(name);
      const container = containerAt(offset);
      if (kind === 'method') {
        if (!container && !/^[ \t]*[A-Za-z_$][\w$]*\s*:/.test(m[0]) && KEYWORDS.has(name)) continue;
        push(name, offset, 'method', container, { signature: m[2] != null ? `(${m[2].replace(/\s+/g, ' ').trim()})` : undefined, static: /^\s*static\b/.test(m[0]) });
        continue;
      }
      push(name, offset, kind, container);
    }
  }
  for (const s of symbols) if (!s.container && (exported.has(s.name) || /module\.exports|exports\./.test(src))) s.exported = true;
  return dedupe(symbols);
}

function collectExports(src: string): Set<string> {
  const names = new Set<string>();
  let m: RegExpExecArray | null;
  const direct = /\bexport\s+(?:default\s+)?(?:async\s+)?(?:function\s*\*?\s*|class\s+|const\s+|let\s+|var\s+)([A-Za-z_$][\w$]*)/g;
  while ((m = direct.exec(src))) names.add(m[1]);
  const list = /\bexport\s*\{([^}]*)\}/g;
  while ((m = list.exec(src))) for (const part of m[1].split(',')) {
    const n = part.trim().split(/\s+as\s+/).pop();
    if (n) names.add(n);
  }
  return names;
}
