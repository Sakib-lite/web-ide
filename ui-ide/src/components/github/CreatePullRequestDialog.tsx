import { api, gitApi } from '@/lib/api';
import { useStore } from '@/lib/store';
import { confirmDialog, formDialog } from '@/components/ui/dialogs';
import { toast } from '@/components/ui/Toasts';
import { loadBranches, pushDialog } from '@/components/vcs/vcs-actions';
import { usePullsStore } from './pulls-store';
import { openSettingsDialog } from './SettingsDialog';

export async function createPullRequestDialog() {
  const repo = await usePullsStore.getState().loadRepo(true);
  if (!repo.connected) return toast('Not a GitHub repository', 'The origin remote must point to GitHub.', 'info');
  if (!repo.hasToken) return openSettingsDialog();
  const br = await loadBranches(true);
  const cur = br.local.find((b) => b.current);
  if (!cur) return toast('Detached HEAD', 'Check out a branch first.', 'info');
  if ((!cur.upstream || cur.ahead) && (await confirmDialog(`Branch "${cur.name}" ${cur.upstream ? `has ${cur.ahead} unpushed commit(s)` : 'has not been pushed yet'}. Push it now?`, 'Push'))) await pushDialog();
  const log = await gitApi.log({ ref: 'HEAD', limit: 1 }).catch(() => ({ commits: [] }));
  const defaultBase = repo.info?.defaultBranch || 'main';
  const bases = [...new Set([defaultBase, ...br.remote.filter((b) => b.remote === 'origin').map((b) => b.branch!)])].filter((b) => b !== cur.name);
  return formDialog({
    title: 'Create Pull Request',
    okText: 'Create Pull Request',
    width: 600,
    fields: [
      { type: 'row', fields: [{ type: 'select', name: 'base', label: 'Base branch:', options: bases, value: defaultBase }, { name: 'head', label: 'Head branch:', value: cur.name, mono: true }] },
      { name: 'title', label: 'Title:', value: log.commits[0]?.subject || cur.name },
      { type: 'textarea', name: 'body', label: 'Description:', rows: 6, placeholder: 'What does this change and why?' },
      { type: 'checkbox', name: 'draft', label: 'Create as draft' },
    ],
    validate: (v) => (!String(v.title).trim() ? 'Title is required' : v.base === v.head ? 'Base and head must differ' : undefined),
    onSubmit: async (v) => {
      const pr = await api('/api/github/pulls', { method: 'POST', body: v });
      toast(`Pull request #${pr.number} created`, pr.html_url, 'success', 8000);
      useStore.getState().showTool('pulls');
      await usePullsStore.getState().refresh(true);
      setTimeout(() => usePullsStore.getState().select(pr.number), 300);
    },
  });
}
