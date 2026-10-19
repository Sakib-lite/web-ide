import { create } from 'zustand';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { wsUrl } from '@/lib/api';
import { readLocal, writeLocal } from '@/lib/utils';
import { useStore } from '@/lib/store';

export interface TerminalSession {
  id: number;
  serverId: string | null;
  title: string;
  term: Terminal;
  fit: FitAddon;
  ws: WebSocket;
  exited: boolean;
  lastCommand: string | null;
  reconnecting: boolean;
}

interface TerminalState {
  sessions: TerminalSession[];
  activeId: number | null;
  create: (opts?: { cwd?: string; command?: string; serverId?: string; title?: string }) => TerminalSession;
  activate: (id: number) => void;
  close: (id: number) => void;
  rerun: (id?: number) => void;
}

const THEME = {
  background: '#1e1f22', foreground: '#bcbec4', cursor: '#ced0d6', cursorAccent: '#1e1f22', selectionBackground: '#214283',
  black: '#1e1f22', red: '#f75464', green: '#5fad65', yellow: '#d6bf55', blue: '#548af7', magenta: '#c77dbb', cyan: '#2aacb8', white: '#bcbec4',
  brightBlack: '#6c708e', brightRed: '#fa6675', brightGreen: '#73bd79', brightYellow: '#e3c764', brightBlue: '#6b9bfa', brightMagenta: '#d58fd0', brightCyan: '#3fbfcd', brightWhite: '#ffffff',
};

let counter = 0;
const RECONNECT_TRIES = 5;
const RECONNECT_DELAY = 1500;

function persistSessions(sessions: TerminalSession[]) {
  writeLocal('ide.terms', sessions.map((s) => ({ serverId: s.serverId, title: s.title, lastCommand: s.lastCommand })));
}

function loadPersisted(): { serverId: string; title: string; lastCommand: string | null }[] {
  return readLocal<{ serverId: string; title: string; lastCommand: string | null }[]>('ide.terms', []).filter((s) => s && typeof s.serverId === 'string');
}

export const useTerminals = create<TerminalState>((set, get) => {
  const makeTerm = () => {
    const term = new Terminal({ theme: THEME, fontFamily: '"JetBrains Mono", "Fira Code", Menlo, Monaco, monospace', fontSize: useStore.getState().settings.terminalFontSize || 12.5, lineHeight: 1.2, cursorBlink: true, cursorStyle: 'bar', allowProposedApi: true, scrollback: 5000, macOptionIsMeta: true });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    return { term, fit };
  };

  const connect = (session: TerminalSession, cwd?: string, command?: string, attempt = 0) => {
    const ws = new WebSocket(wsUrl('/ws/terminal'));
    session.ws = ws;
    const send = (msg: Record<string, unknown>) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(msg));
    ws.onopen = () => {
      const dims = session.fit.proposeDimensions();
      send({ type: 'hello', id: session.serverId || undefined, cols: dims?.cols, rows: dims?.rows, title: session.title });
    };
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === 'attached') {
        session.reconnecting = false;
        const fresh = session.serverId !== msg.id;
        session.serverId = msg.id;
        persistSessions(get().sessions);
        if (msg.replay) session.term.write('\x1b[90m[Reconnected]\x1b[0m\r\n');
        else if (fresh && !attempt) {
          const prelude = [cwd ? `cd ${JSON.stringify(cwd)}` : null, command].filter(Boolean);
          if (prelude.length) setTimeout(() => send({ type: 'input', data: prelude.join(' && ') + '\r' }), 250);
        } else if (fresh && cwd && attempt) {
          send({ type: 'input', data: `cd ${JSON.stringify(cwd)}\r` });
        }
      } else if (msg.type === 'output') session.term.write(msg.data);
      else if (msg.type === 'exit') {
        session.exited = true;
        session.term.write(`\r\n\x1b[90m[Process exited with code ${msg.code}]\x1b[0m\r\n`);
        setTimeout(() => get().close(session.id), 600);
      } else if (msg.type === 'error') session.term.write(`\r\n\x1b[31m${msg.message}\x1b[0m\r\n`);
    };
    ws.onclose = () => {
      if (session.exited || !get().sessions.includes(session)) return;
      if (attempt < RECONNECT_TRIES) {
        session.reconnecting = true;
        session.term.write('\r\n\x1b[90m[Connection lost — reconnecting…]\x1b[0m\r\n');
        setTimeout(() => {
          if (!session.exited && get().sessions.includes(session)) connect(session, cwd, command, attempt + 1);
        }, RECONNECT_DELAY);
      } else {
        session.term.write('\r\n\x1b[31m[Disconnected — start a new terminal]\x1b[0m\r\n');
      }
    };
  };

  const create: TerminalState['create'] = ({ cwd, command, serverId, title } = {}) => {
    const id = ++counter;
    const { term, fit } = makeTerm();
    const session: TerminalSession = { id, serverId: serverId ?? null, title: title || `Local${id > 1 ? ` (${id})` : ''}`, term, fit, ws: null as unknown as WebSocket, exited: false, lastCommand: command || null, reconnecting: false };
    const liveSend = (msg: Record<string, unknown>) => {
      if (session.ws?.readyState === WebSocket.OPEN) session.ws.send(JSON.stringify(msg));
    };
    term.onData((data) => liveSend({ type: 'input', data }));
    term.onResize(({ cols, rows }) => liveSend({ type: 'resize', cols, rows }));
    connect(session, cwd, command);
    set((s) => ({ sessions: [...s.sessions, session], activeId: id }));
    persistSessions(get().sessions);
    return session;
  };

  return {
    sessions: [],
    activeId: null,
    create,
    activate: (id) => set({ activeId: id }),
    close: (id) => {
      const session = get().sessions.find((s) => s.id === id);
      if (!session) return;
      session.exited = true;
      try {
        if (session.ws.readyState === WebSocket.OPEN) session.ws.send(JSON.stringify({ type: 'kill' }));
        session.ws.close();
      } catch {}
      session.term.dispose();
      const remaining = get().sessions.filter((s) => s.id !== id);
      set({ sessions: remaining, activeId: get().activeId === id ? remaining[remaining.length - 1]?.id ?? null : get().activeId });
      persistSessions(remaining);
      if (!remaining.length) useStore.getState().hideTool('terminal');
    },
    rerun: (id) => {
      const { sessions, activeId } = get();
      const session = sessions.find((s) => s.id === (id ?? activeId));
      if (!session || session.exited || !session.lastCommand) return;
      if (session.ws.readyState !== WebSocket.OPEN) return;
      session.ws.send(JSON.stringify({ type: 'input', data: '\u0015' + session.lastCommand + '\r' }));
      session.term.focus();
    },
  } as TerminalState;
});

export function restoreTerminals() {
  const { sessions, create } = useTerminals.getState();
  if (sessions.length) return;
  const saved = loadPersisted();
  if (!saved.length) {
    create();
    return;
  }
  for (const s of saved.slice(-8)) create({ serverId: s.serverId, title: s.title });
  if (saved.length) {
    const cur = useTerminals.getState().sessions;
    saved.forEach((s, i) => {
      if (cur[i]) cur[i].lastCommand = s.lastCommand;
    });
  }
}

if (typeof window !== 'undefined') {
  useStore.subscribe((s, prev) => {
    if (s.settings.terminalFontSize === prev.settings.terminalFontSize) return;
    for (const session of useTerminals.getState().sessions) {
      session.term.options.fontSize = s.settings.terminalFontSize;
      session.fit.fit();
    }
  });
}

export function runInTerminal(command: string, cwd?: string) {
  useStore.getState().showTool('terminal');
  const { sessions, activeId, create } = useTerminals.getState();
  const active = sessions.find((s) => s.id === activeId);
  if (!active || active.exited || active.ws.readyState !== WebSocket.OPEN) return create({ cwd, command });
  active.lastCommand = command;
  const text = (cwd ? `cd ${JSON.stringify(cwd)} && ` : '') + command + '\r';
  active.ws.send(JSON.stringify({ type: 'input', data: text }));
  active.term.focus();
}

export function openTerminalAt(cwd: string) {
  useStore.getState().showTool('terminal');
  useTerminals.getState().create({ cwd });
}
