import { useEffect } from 'react';
import { wsUrl, symApi } from '@/lib/api';
import { emit } from '@/lib/bus';
import { useStore } from '@/lib/store';

export function useProjectEvents() {
  const root = useStore((s) => s.project?.root);
  useEffect(() => {
    if (!root) return;
    let ws: WebSocket | null = null;
    let closed = false;
    let retry: ReturnType<typeof setTimeout>;
    const updateIndex = async (stats?: any) => {
      const ready = useStore.getState().indexStatus.ready;
      if (!ready) return useStore.getState().setIndexStatus({ ready: false, stats: null });
      const s = stats || (await symApi.status().catch(() => ({ stats: null }))).stats;
      useStore.getState().setIndexStatus({ ready: true, stats: s });
    };
    const connect = () => {
      ws = new WebSocket(wsUrl('/ws/events'));
      ws.onmessage = (e) => {
        let msg: any;
        try {
          msg = JSON.parse(e.data);
        } catch {
          return;
        }
        if (msg.type === 'fs-change') {
          useStore.getState().setFiles(null);
          emit('fs-change', msg);
        } else if (msg.type === 'git-change') emit('git-change');
        else if (msg.type === 'git-command') emit('git-command', msg);
        else if (msg.type === 'index-ready') {
          useStore.getState().setIndexStatus({ ready: true, stats: msg.stats });
        } else if (msg.type === 'index-building') useStore.getState().setIndexStatus({ ready: false, stats: null });
        else if (msg.type === 'hello') {
          useStore.getState().setIndexStatus({ ready: msg.indexReady, stats: null });
          updateIndex();
        } else if (msg.type === 'plugin') emit(`plugin:${msg.plugin}`, msg);
      };
      ws.onclose = () => {
        if (!closed) retry = setTimeout(connect, 2000);
      };
    };
    connect();
    return () => {
      closed = true;
      clearTimeout(retry);
      ws?.close();
    };
  }, [root]);
}
