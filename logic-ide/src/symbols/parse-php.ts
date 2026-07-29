import { Symbol, ClassRange, blankStringsAndComments, containerFinder, dedupe, lineLocator, matchBrace } from './types';

type Visibility = 'public' | 'protected' | 'private';

const visibilityOf = (mods: string): Visibility => (/private/.test(mods) ? 'private' : /protected/.test(mods) ? 'protected' : 'public');
const lastSegment = (name: string) => name.trim().split('\\').pop()!;

export function parsePhp(content: string, file: string): Symbol[] {
  const src = blankStringsAndComments(content, true);
  const at = lineLocator(content);
  const symbols: Symbol[] = [];
  const namespace = /\bnamespace\s+([A-Za-z_\\][\w\\]*)\s*[;{]/.exec(src)?.[1] || '';
  const push = (name: string, offset: number, kind: string, container: string | null = null, extra: Partial<Symbol> = {}) => {
    symbols.push({ name, file, kind, container, lang: 'php', ...at(offset), ...extra });
  };
  const ranges: ClassRange[] = [];
  const classRe = /\b(class|interface|trait|enum)\s+([A-Za-z_][\w]*)([^{]*)/g;
  let m: RegExpExecArray | null;
  while ((m = classRe.exec(src))) {
    const bodyStart = src.indexOf('{', m.index + m[0].length);
    if (bodyStart < 0) continue;
    ranges.push({ name: m[2], start: bodyStart, end: matchBrace(src, bodyStart) });
    push(m[2], m.index + m[0].indexOf(m[2]), m[1] === 'class' ? 'class' : m[1], null, { fqn: namespace ? `${namespace}\\${m[2]}` : m[2], parents: parseParents(m[3]), exported: true });
  }
  const containerAt = containerFinder(ranges);
  const traitUse = /\buse\s+([A-Za-z_][\w\\]*(?:\s*,\s*[A-Za-z_][\w\\]*)*)\s*;/g;
  while ((m = traitUse.exec(src))) {
    const container = containerAt(m.index);
    const cls = container && symbols.find((x) => x.name === container && x.kind !== 'method');
    if (cls) cls.parents = [...(cls.parents || []), ...m[1].split(',').map(lastSegment)];
  }
  const fnRe = /((?:(?:public|protected|private|static|abstract|final)\s+)*)function\s*&?\s*([A-Za-z_][\w]*)\s*\(([^)]*)\)/g;
  while ((m = fnRe.exec(src))) {
    const offset = m.index + m[0].indexOf(m[2], m[1].length);
    const container = containerAt(offset);
    push(m[2], offset, container ? 'method' : 'function', container, { exported: !container, static: /\bstatic\b/.test(m[1]), visibility: visibilityOf(m[1]), signature: `(${m[3].replace(/\s+/g, ' ').trim()})` });
  }
  const constRe = /\bconst\s+([A-Z_][A-Z0-9_]*)\s*=/g;
  while ((m = constRe.exec(src))) push(m[1], m.index + m[0].indexOf(m[1]), 'constant', containerAt(m.index), { exported: true });
  const defineRe = /\bdefine\s*\(\s*['"]([A-Za-z_][\w]*)['"]/g;
  while ((m = defineRe.exec(content))) push(m[1], m.index + m[0].indexOf(m[1]), 'constant', null, { exported: true });
  const propRe = /\b((?:(?:public|protected|private|var|static|readonly)\s+)+)(?:([?\w\\|]+)\s+)?\$([A-Za-z_][\w]*)/g;
  while ((m = propRe.exec(src))) {
    const offset = m.index + m[0].indexOf('$' + m[3]) + 1;
    const container = containerAt(offset);
    if (container) push(m[3], offset, 'property', container, { static: /\bstatic\b/.test(m[1]), visibility: visibilityOf(m[1]), type: m[2] || null });
  }
  const ctorRe = /function\s+__construct\s*\(([^)]*)\)/g;
  while ((m = ctorRe.exec(src))) {
    const container = containerAt(m.index);
    if (!container) continue;
    const paramRe = /(public|protected|private)\s+(?:readonly\s+)?(?:([?\w\\|]+)\s+)?\$([A-Za-z_]\w*)/g;
    let pm: RegExpExecArray | null;
    while ((pm = paramRe.exec(m[1]))) push(pm[3], m.index + m[0].indexOf('$' + pm[3]) + 1, 'property', container, { visibility: pm[1] as Visibility, type: pm[2] || null });
  }
  return dedupe(symbols);
}

function parseParents(header: string): string[] {
  const parents: string[] = [];
  const ext = /\bextends\s+([\w\\,\s]+?)(?:\s+implements|\s*$)/.exec(header);
  if (ext) parents.push(...ext[1].split(',').map(lastSegment));
  const impl = /\bimplements\s+([\w\\,\s]+)$/.exec(header.trim());
  if (impl) parents.push(...impl[1].split(',').map(lastSegment));
  return parents.filter(Boolean);
}
