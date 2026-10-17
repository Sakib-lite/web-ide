
export interface SideChange {
  side: 'left' | 'right';
  aStart: number;
  aEnd: number;
  bStart: number;
  bEnd: number;
  lines: string[];
  conflict: boolean;
}

export interface Hunk {
  id: number;
  conflict: boolean;
  start: number;
  end: number;
  parts: { start: number; end: number; side: 'left' | 'right' }[];
  state: 'pending' | 'accepted' | 'dismissed';
}

export interface MergeModel {
  resultLines: string[];
  hunks: Hunk[];
  leftChanges: SideChange[];
  rightChanges: SideChange[];
}

export function diffRegions(a: string[], b: string[]): { aStart: number; aEnd: number; bStart: number; bEnd: number }[] {
  const n = a.length;
  const m = b.length;
  if (n * m > 9_000_000) {
    return n || m ? [{ aStart: 1, aEnd: n, bStart: 1, bEnd: m }] : [];
  }
  const w = m + 1;
  const dp = new Int32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * w + j] = a[i] === b[j] ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
    }
  }
  const out: { aStart: number; aEnd: number; bStart: number; bEnd: number }[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    const aS = i;
    const bS = j;
    while (i < n && j < m && a[i] !== b[j]) {
      if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) i++;
      else j++;
    }
    out.push({ aStart: aS + 1, aEnd: i, bStart: bS + 1, bEnd: j });
  }
  if (i < n || j < m) out.push({ aStart: i + 1, aEnd: n, bStart: j + 1, bEnd: m });
  return out;
}

const anchor = (c: { aStart: number; aEnd: number }) => c.aEnd + 1;

function overlaps(x: SideChange, y: SideChange): boolean {
  const xEmpty = x.aStart > x.aEnd;
  const yEmpty = y.aStart > y.aEnd;
  if (xEmpty && yEmpty) return anchor(x) === anchor(y);
  if (xEmpty) return y.aStart <= anchor(x) && anchor(x) <= y.aEnd;
  if (yEmpty) return x.aStart <= anchor(y) && anchor(y) <= x.aEnd;
  return x.aStart <= y.aEnd && y.aStart <= x.aEnd;
}

export function buildMergeModel(base: string[], ours: string[], theirs: string[]): MergeModel {
  const toSide = (r: { aStart: number; aEnd: number; bStart: number; bEnd: number }, side: 'left' | 'right', src: string[]): SideChange => ({
    side,
    aStart: r.aStart,
    aEnd: r.aEnd,
    bStart: r.bStart,
    bEnd: r.bEnd,
    lines: src.slice(r.bStart - 1, r.bEnd),
    conflict: false,
  });
  const leftChanges = diffRegions(base, ours).map((r) => toSide(r, 'left', ours));
  const rightChanges = diffRegions(base, theirs).map((r) => toSide(r, 'right', theirs));
  const all = [...leftChanges, ...rightChanges].sort((x, y) => anchor(x) - anchor(y) || (x.side === 'left' ? -1 : 1));

  const clusters: SideChange[][] = [];
  for (const c of all) {
    const last = clusters[clusters.length - 1];
    if (last && last.some((m) => overlaps(m, c))) last.push(c);
    else clusters.push([c]);
  }

  const resultLines: string[] = [];
  const hunks: Hunk[] = [];
  let emitted = 0;
  let id = 0;
  for (const cluster of clusters) {
    const conflict = cluster.length > 1;
    const consumeTo = Math.max(...cluster.map((c) => c.aEnd));
    const before = Math.min(...cluster.map((c) => (c.aStart > c.aEnd ? c.aEnd : c.aStart - 1)));
    for (let l = emitted + 1; l <= Math.min(before, base.length); l++) resultLines.push(base[l - 1]);
    const parts: Hunk['parts'] = [];
    if (conflict) {
      const ourLines = cluster.filter((c) => c.side === 'left').flatMap((c) => c.lines);
      const theirLines = cluster.filter((c) => c.side === 'right').flatMap((c) => c.lines);
      if (ourLines.length) parts.push({ start: resultLines.length + 1, end: resultLines.length + ourLines.length, side: 'left' });
      resultLines.push(...ourLines);
      if (theirLines.length) parts.push({ start: resultLines.length + 1, end: resultLines.length + theirLines.length, side: 'right' });
      resultLines.push(...theirLines);
    } else {
      const c = cluster[0];
      if (c.lines.length) parts.push({ start: resultLines.length + 1, end: resultLines.length + c.lines.length, side: c.side });
      resultLines.push(...c.lines);
    }
    const start = resultLines.length + 1 - (parts.reduce((s, p) => s + p.end - p.start + 1, 0));
    const end = resultLines.length;
    emitted = Math.max(emitted, before, consumeTo);
    for (const c of cluster) c.conflict = conflict;
    if (parts.length) hunks.push({ id: ++id, conflict, start, end, parts, state: 'pending' });
  }
  for (let l = emitted + 1; l <= base.length; l++) resultLines.push(base[l - 1]);
  return { resultLines, hunks, leftChanges, rightChanges };
}

export function shiftHunks(hunks: Hunk[], atLine: number, deletedLines: number, exceptId?: number) {
  for (const h of hunks) {
    if (h.id === exceptId) continue;
    if (h.start >= atLine) {
      h.start -= deletedLines;
      h.end -= deletedLines;
      for (const p of h.parts) {
        if (p.start >= atLine) {
          p.start -= deletedLines;
          p.end -= deletedLines;
        }
      }
    }
  }
}
