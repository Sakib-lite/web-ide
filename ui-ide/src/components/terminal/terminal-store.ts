import { create } from 'zustand';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { wsUrl } from '@/lib/api';
import { useStore } from '@/lib/store';

export interface TerminalSession {
  id: number;
  title: string;
  term: Terminal;
  fit: FitAddon;
  ws: WebSocket;
  exited: boolean;
}

interface TerminalState {
  sessions: TerminalSession[];
  activeId: number | null;
  create: (opts?: { cwd?: string; command?: string }) => TerminalSession;
  activate: (id: number) => void;
  close: (id: number) => void;
}

const THEME = {
  background: '#1e1f22', foreground: '#bcbec4', cursor: '#ced0d6', cursorAccent: '#1e1f22', selectionBackground: '#214283',
  black: '#1e1f22', red: '#f75464', green: '#5fad65', yellow: '#d6bf55', blue: '#548af7', magenta: '#c77dbb', cyan: '#2aacb8', white: '#bcbec4',
  brightBlack: '#6c707e', brightRed: '#fa6675', brightGreen: '#73bd79', brightYellow: '#e3c764', brightBlue: '#6b9bfa', brightMagenta: '#d58fd0', brightCyan: '#3fbfcd', brightWhite: '#ffffff',
};

let counter = 0;

export const useTerminals = create<TerminalState>((set, get) => ({
  sessions: [],
  activeId: null,
  create: ({ cwd, command } = {}) => {
    const id = ++counter;
    const term = new Terminal({ theme: THEME, fontFamily: '"JetBrains Mono", "Fira Code", Menlo, Monaco, monospace', fontSize: 12.5, lineHeight: 1.2, cursorBlink: true, cursorStyle: 'bar', allowProposedApi: true, scrollback: 5000, macOptionIsMeta: true });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    const ws = new WebSocket(wsUrl('/ws/terminal'));
    const session: TerminalSession = { id, title: `Local${id > 1 ? ` (${id})` : ''}`, term, fit, ws, exited: false };
    const send = (msg: Record<string, unknown>) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(msg));
    ws.onopen = () => {
      const dims = fit.proposeDimensions();
      if (dims) send({ type: 'resize', cols: dims.cols, rows: dims.rows });
      const prelude = [cwd ? `cd ${JSON.stringify(cwd)}` : null, command].filter(Boolean);
      if (prelude.length) setTimeout(() => send({ type: 'input', data: prelude.join(' && ') + '\r' }), 250);
    };
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === 'output') term.write(msg.data);
      else if (msg.type === 'exit') {
        session.exited = true;
        term.write(`\r\n\x1b[90m[Process exited with code ${msg.code}]\x1b[0m\r\n`);
        setTimeout(() => get().close(id), 600);
      } else if (msg.type === 'error') term.write(`\r\n\x1b[31m${msg.message}\x1b[0m\r\n`);
    };
    ws.onclose = () => !session.exited && term.write('\r\n\x1b[90m[Disconnected]\x1b[0m\r\n');
    term.onData((data) => send({ type: 'input', data }));
    term.onResize(({ cols, rows }) => send({ type: 'resize', cols, rows }));
    set((s) => ({ sessions: [...s.sessions, session], activeId: id }));
    return session;
  },
  activate: (id) => set({ activeId: id }),
  close: (id) => {
    const session = get().sessions.find((s) => s.id === id);
    if (!session) return;
    try {
      session.ws.close();
    } catch {}
    session.term.dispose();
    const remaining = get().sessions.filter((s) => s.id !== id);
    set({ sessions: remaining, activeId: get().activeId === id ? remaining[remaining.length - 1]?.id ?? null : get().activeId });
    if (!remaining.length) useStore.getState().hideTool('terminal');
  },
}));

export function runInTerminal(command: string, cwd?: string) {
  useStore.getState().showTool('terminal');
  const { sessions, activeId, create } = useTerminals.getState();
  const active = sessions.find((s) => s.id === activeId);
  if (!active || active.exited) return create({ cwd, command });
  const text = (cwd ? `cd ${JSON.stringify(cwd)} && ` : '') + command + '\r';
  const send = () => active.ws.send(JSON.stringify({ type: 'input', data: text }));
  active.ws.readyState === WebSocket.OPEN ? send() : active.ws.addEventListener('open', () => setTimeout(send, 250), { once: true });
  active.term.focus();
}

export function openTerminalAt(cwd: string) {
  useStore.getState().showTool('terminal');
  useTerminals.getState().create({ cwd });
}
