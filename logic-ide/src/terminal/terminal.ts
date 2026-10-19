import os from 'node:os';
import { randomUUID } from 'node:crypto';
import type { WebSocket } from 'ws';

let pty: typeof import('node-pty') | null = null;
try {
  pty = require('node-pty');
} catch {
  pty = null;
}

interface TermSession {
  id: string;
  term: import('node-pty').IPty;
  buffer: string;
  ws: WebSocket | null;
  detachedAt: number | null;
  dead?: boolean;
}

const sessions = new Map<string, TermSession>();
const BUFFER_CAP = 400_000;
const IDLE_KILL_MS = 2 * 60 * 60 * 1000;

function reapIdle() {
  const now = Date.now();
  for (const s of sessions.values()) {
    if (s.dead || s.ws || s.detachedAt == null || now - s.detachedAt < IDLE_KILL_MS) continue;
    try {
      s.term.kill();
    } catch {}
    sessions.delete(s.id);
  }
}
setInterval(reapIdle, 5 * 60 * 1000).unref();

function spawn(id: string, cwd: string, cols: number, rows: number): TermSession | { error: string } {
  if (!pty) return { error: 'Terminal unavailable: node-pty failed to load.' };
  const shell = process.env.SHELL || (os.platform() === 'win32' ? 'powershell.exe' : '/bin/bash');
  try {
    const term = pty.spawn(shell, os.platform() === 'win32' ? [] : ['-l'], { name: 'xterm-256color', cols: cols || 120, rows: rows || 30, cwd, env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor', TERM_PROGRAM: 'web-ide' } as Record<string, string> });
    const session: TermSession = { id, term, buffer: '', ws: null, detachedAt: Date.now() };
    term.onData((data) => {
      session.buffer = session.buffer.length + data.length > BUFFER_CAP ? session.buffer.slice(-BUFFER_CAP + data.length) + data : session.buffer + data;
      if (session.ws && session.ws.readyState === session.ws.OPEN) session.ws.send(JSON.stringify({ type: 'output', data }));
    });
    term.onExit(({ exitCode }) => {
      session.dead = true;
      sessions.delete(id);
      if (session.ws && session.ws.readyState === session.ws.OPEN) {
        session.ws.send(JSON.stringify({ type: 'exit', code: exitCode }));
        session.ws.close();
      }
    });
    sessions.set(id, session);
    return session;
  } catch (err: any) {
    return { error: `Failed to start shell: ${err.message}` };
  }
}

export function attachTerminal(ws: WebSocket, cwd: string) {
  const send = (msg: Record<string, unknown>) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(msg));
  let session: TermSession | null = null;
  let helloTimer: NodeJS.Timeout | null = null;

  const ping = setInterval(() => {
    if (ws.readyState === ws.OPEN) ws.ping();
  }, 25_000);
  ws.on('close', () => clearInterval(ping));

  const detach = () => {
    if (session && session.ws === ws) {
      session.ws = null;
      session.detachedAt = Date.now();
    }
    session = null;
  };

  const hello = (msg: any) => {
    if (session) return;
    const requested: string | undefined = typeof msg.id === 'string' && msg.id ? msg.id : undefined;
    if (requested && sessions.has(requested)) {
      session = sessions.get(requested)!;
      session.ws = ws;
      session.detachedAt = null;
      if (msg.cols > 0 && msg.rows > 0) {
        try {
          session.term.resize(Math.floor(msg.cols), Math.floor(msg.rows));
        } catch {}
      }
      send({ type: 'attached', id: session.id, replay: true });
      if (session.buffer) send({ type: 'output', data: session.buffer });
    } else {
      session = spawn(randomUUID(), cwd, msg.cols, msg.rows) as TermSession;
      if ('error' in (session as any)) {
        send({ type: 'error', message: (session as any).error });
        session = null;
        return;
      }
      session!.ws = ws;
      session!.detachedAt = null;
      send({ type: 'attached', id: session!.id });
    }
  };

  helloTimer = setTimeout(() => {
    if (!session) hello({ cols: 0, rows: 0 });
  }, 2000);
  ws.on('close', () => {
    clearTimeout(helloTimer!);
    detach();
  });

  ws.on('message', (raw) => {
    let msg: any;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (msg.type === 'hello') return hello(msg);
    if (!session || session.ws !== ws) return;
    if (msg.type === 'input') session.term.write(msg.data);
    else if (msg.type === 'resize' && msg.cols > 0 && msg.rows > 0) {
      try {
        session.term.resize(Math.floor(msg.cols), Math.floor(msg.rows));
      } catch {}
    } else if (msg.type === 'kill') {
      try {
        session.term.kill();
      } catch {}
      sessions.delete(session.id);
    }
  });
}
