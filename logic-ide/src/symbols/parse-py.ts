import { Symbol, dedupe } from './types';

interface Scope {
  indent: number;
  name: string;
  kind: 'class' | 'function';
}

const TRIPLE = /^\s*[rbuf]*("{3}|'{3})/i;

export function parsePy(content: string, file: string): Symbol[] {
  const symbols: Symbol[] = [];
  const lines = content.split('\n');
  const stack: Scope[] = [];
  let inTriple: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (inTriple) {
      if (line.includes(inTriple)) inTriple = null;
      continue;
    }
    const tq = TRIPLE.exec(line);
    if (tq && line.indexOf(tq[1], tq.index + tq[0].length) < 0) {
      inTriple = tq[1];
      continue;
    }
    if (!line.trim() || /^\s*#/.test(line)) continue;
    const indent = /^\s*/.exec(line)![0].replace(/\t/g, '    ').length;
    while (stack.length && indent <= stack[stack.length - 1].indent) stack.pop();
    const scope = stack[stack.length - 1];
    const inClass = scope?.kind === 'class';
    const base = { file, line: i + 1, lang: 'py' as const };
    let m: RegExpExecArray | null;
    if ((m = /^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(([^)]*)\)?/.exec(line))) {
      const name = m[1];
      symbols.push({ ...base, name, col: line.indexOf(name) + 1, kind: inClass ? 'method' : 'function', container: inClass ? scope.name : null, exported: indent === 0, static: /@(staticmethod|classmethod)/.test(lines[i - 1] || ''), visibility: name.startsWith('__') && !name.endsWith('__') ? 'private' : name.startsWith('_') ? 'protected' : 'public', signature: `(${(m[2] || '').replace(/^self\s*,?\s*|^cls\s*,?\s*/, '').trim()})` });
      stack.push({ indent, name, kind: 'function' });
    } else if ((m = /^\s*class\s+([A-Za-z_]\w*)\s*(?:\(([^)]*)\))?\s*:/.exec(line))) {
      const parents = (m[2] || '').split(',').map((x) => x.trim().split('.').pop()!).filter((x) => x && !/^(object|metaclass=)/.test(x));
      symbols.push({ ...base, name: m[1], col: line.indexOf(m[1]) + 1, kind: 'class', container: null, parents, exported: true });
      stack.push({ indent, name: m[1], kind: 'class' });
    } else if (indent === 0 && (m = /^([A-Za-z_]\w*)\s*(?::[^=]+)?=(?!=)/.exec(line))) {
      symbols.push({ ...base, name: m[1], col: 1, kind: /^[A-Z0-9_]+$/.test(m[1]) ? 'constant' : 'variable', container: null, exported: true });
    } else if (scope && (m = /^\s*self\.([A-Za-z_]\w*)\s*(?::[^=]+)?=(?!=)/.exec(line))) {
      const cls = [...stack].reverse().find((x) => x.kind === 'class');
      if (cls) symbols.push({ ...base, name: m[1], col: line.indexOf(m[1]) + 1, kind: 'property', container: cls.name });
    }
  }
  return dedupe(symbols);
}
