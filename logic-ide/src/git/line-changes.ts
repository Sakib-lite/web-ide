import { diffLines } from 'diff';

export interface LineChange {
  type: 'added' | 'modified' | 'deleted';
  start: number;
  end: number;
}

export function computeLineChanges(oldText: string, newText: string): LineChange[] {
  const changes: LineChange[] = [];
  let line = 1;
  let pendingRemoved = 0;
  const deletedAt = () => ({ type: 'deleted' as const, start: Math.max(1, line - 1), end: Math.max(1, line - 1) });
  for (const part of diffLines(oldText, newText)) {
    const n = part.count || 0;
    if (part.removed) {
      pendingRemoved += n;
      continue;
    }
    if (part.added) {
      changes.push({ type: pendingRemoved > 0 ? 'modified' : 'added', start: line, end: line + n - 1 });
      pendingRemoved = 0;
      line += n;
      continue;
    }
    if (pendingRemoved > 0) {
      changes.push(deletedAt());
      pendingRemoved = 0;
    }
    line += n;
  }
  if (pendingRemoved > 0) changes.push(deletedAt());
  return changes;
}
