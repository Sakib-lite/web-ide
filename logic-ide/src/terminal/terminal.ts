import os from 'node:os';
import type { WebSocket } from 'ws';

let pty: typeof import('node-pty') | null = null;
try {
  pty = require('node-pty');
} catch {
  pty = null;
}

export function attachTerminal(ws: WebSocket, cwd: string) {
  const send = (msg: Record<string, unknown>) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(msg));
  if (!pty) return send({ type: 'error', message: 'Terminal unavailable: node-pty failed to load.' });
  const shell = process.env.SHELL || (os.platform() === 'win32' ? 'powershell.exe' : '/bin/bash');
  let term: import('node-pty').IPty;
  try {
    term = pty.spawn(shell, os.platform() === 'win32' ? [] : ['-l'], { name: 'xterm-256color', cols: 120, rows: 30, cwd, env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor', TERM_PROGRAM: 'web-ide' } as Record<string, string> });
  } catch (err: any) {
    return send({ type: 'error', message: `Failed to start shell: ${err.message}` });
  }
  term.onData((data) => send({ type: 'output', data }));
  term.onExit(({ exitCode }) => send({ type: 'exit', code: exitCode }));
  ws.on('message', (raw) => {
    let msg: any;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (msg.type === 'input') term.write(msg.data);
    else if (msg.type === 'resize' && msg.cols > 0 && msg.rows > 0) {
      try {
        term.resize(Math.floor(msg.cols), Math.floor(msg.rows));
      } catch {}
    }
  });
  ws.on('close', () => {
    try {
      term.kill();
    } catch {}
  });
}
