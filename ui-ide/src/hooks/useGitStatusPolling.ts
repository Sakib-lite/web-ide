import { useEffect } from 'react';
import { on } from '@/lib/bus';
import { refreshGitStatus } from '@/components/git/git-status';
import { debounce } from '@/lib/utils';

export function useGitStatusPolling() {
  useEffect(() => {
    const refresh = debounce(() => refreshGitStatus(), 400);
    const offs = [on('file-saved', refresh), on('fs-change', refresh), on('fs-local-change', refresh), on('git-change', refresh)];
    const timer = setInterval(() => document.visibilityState === 'visible' && refreshGitStatus(), 8000);
    refreshGitStatus();
    return () => {
      offs.forEach((off) => off());
      clearInterval(timer);
      refresh.cancel();
    };
  }, []);
}
