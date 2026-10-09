import { useStore } from '@/lib/store';
import { changedPaths } from './git-status';
import { usePullsStore } from '@/components/github/pulls-store';

export function useCommitBadge(toolId: string): string {
  const count = useStore((s) => (toolId === 'commit' ? changedPaths(s.gitStatus).length : 0));
  const pulls = usePullsStore((s) => (toolId === 'pulls' ? s.openCount : 0));
  if (toolId === 'commit') return count ? String(count) : '';
  if (toolId === 'pulls') return pulls ? String(Math.min(99, pulls)) : '';
  return '';
}
