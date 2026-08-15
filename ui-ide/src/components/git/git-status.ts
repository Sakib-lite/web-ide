import { gitApi } from '@/lib/api';
import { emit } from '@/lib/bus';
import { useStore, GitStatus } from '@/lib/store';
import { toast } from '@/components/ui/Toasts';

export async function refreshGitStatus(): Promise<GitStatus | null> {
  const state = useStore.getState();
  if (!state.project) return null;
  try {
    const status: GitStatus = await gitApi.status();
    const prevOp = state.gitStatus.operation;
    state.setGitStatus(status);
    if (status.operation && status.operation !== prevOp) toast(`${status.operation[0].toUpperCase()}${status.operation.slice(1)} in progress`, 'Resolve conflicts, then use the branch menu to continue or abort.', 'info', 8000);
    emit('git-status', status);
    return status;
  } catch {
    return null;
  }
}

export function changedPaths(status: GitStatus = useStore.getState().gitStatus): string[] {
  return Object.keys(status.files || {}).filter((p) => status.files[p].status !== 'ignored').sort();
}
