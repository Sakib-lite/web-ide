
import { spawn, execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const encodeProjectDir = (root) => root.replace(/[^A-Za-z0-9]/g, '-');

export async function register({ router, onWebSocket }) {
  const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).then((out) => res.json(out)).catch((err) => res.status(err.status || 500).json({ error: err.message }));

  router.get('/status', wrap(async () => {
    const version = await new Promise((resolve) => execFile('claude', ['--version'], { timeout: 10000 }, (err, out) => resolve(err ? null : out.trim())));
    return { installed: !!version, version };
  }));

  router.get('/sessions', wrap(async (req) => listSessions(req.query.root)));
  router.get('/sessions/:id', wrap(async (req) => loadSession(req.query.root, req.params.id)));
  router.get('/commands', wrap(async (req) => listCommands(req.query.root)));

  onWebSocket((ws, project) => new Bridge(ws, project.root));
}

async function listSessions(root) {
  const dir = path.join(CLAUDE_DIR, 'projects', encodeProjectDir(root));
  let files = [];
  try { files = (await fs.readdir(dir)).filter((f) => f.endsWith('.jsonl')); } catch { return []; }
  const out = [];
  for (const f of files) {
    const abs = path.join(dir, f);
    try {
      const stat = await fs.stat(abs);
      if (stat.size < 200) continue;
      const fh = await fs.open(abs, 'r');
      const buf = Buffer.alloc(Math.min(stat.size, 256 * 1024));
      await fh.read(buf, 0, buf.length, 0);
      await fh.close();
      const head = buf.toString('utf8');
      let title = null, firstPrompt = null, count = 0, summary = null, name = null;
      for (const line of head.split('\n')) {
        if (!line.trim()) continue;
        let j; try { j = JSON.parse(line); } catch { continue; }
        if (j.type === 'summary' && j.summary) summary = j.summary;
        if (j.type === 'custom-title' && j.title) name = j.title;
        if (j.type === 'user' && !j.isSidechain && !firstPrompt) {
          const c = j.message?.content;
          const text = typeof c === 'string' ? c : Array.isArray(c) ? c.filter((b) => b.type === 'text').map((b) => b.text).join(' ') : '';
          if (text && !text.startsWith('<')) firstPrompt = text.trim();
        }
        if ((j.type === 'user' || j.type === 'assistant') && !j.isSidechain) count++;
      }
      title = name || summary || firstPrompt;
      if (!title) continue;
      out.push({ id: f.replace(/\.jsonl$/, ''), title: title.replace(/\s+/g, ' ').slice(0, 120), modified: stat.mtimeMs, size: stat.size, messages: count, partial: stat.size > buf.length });
    } catch {  }
  }
  return out.sort((a, b) => b.modified - a.modified).slice(0, 100);
}

async function loadSession(root, id) {
  if (!/^[\w-]+$/.test(id)) throw Object.assign(new Error('Bad session id'), { status: 400 });
  const abs = path.join(CLAUDE_DIR, 'projects', encodeProjectDir(root), id + '.jsonl');
  let text;
  try { text = await fs.readFile(abs, 'utf8'); } catch { throw Object.assign(new Error('Session not found'), { status: 404 }); }
  const messages = [];
  let model = null;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let j; try { j = JSON.parse(line); } catch { continue; }
    if (j.isSidechain) continue;
    if ((j.type === 'user' || j.type === 'assistant') && j.message) {
      if (j.message.model) model = j.message.model;
      messages.push({ type: j.type, message: j.message, uuid: j.uuid, timestamp: j.timestamp, tool_use_result: j.toolUseResult || j.tool_use_result });
    }
  }
  return { id, model, messages };
}

async function listCommands(root) {
  const builtin = [
    { name: 'init', description: 'Create a CLAUDE.md guide for this project' },
    { name: 'review', description: 'Review the current changes' },
    { name: 'compact', description: 'Compact the conversation context' },
    { name: 'cost', description: 'Show token usage and cost for this session' },
    { name: 'clear', description: 'Start a new conversation (local)' },
  ];
  const custom = [];
  const scan = async (dir, scope) => {
    let entries = [];
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.isDirectory()) {

        const skill = path.join(dir, e.name, 'SKILL.md');
        const md = await fs.readFile(skill, 'utf8').catch(() => null);
        if (md) custom.push({ name: e.name, description: frontmatter(md, 'description') || `${scope} skill`, scope });
      } else if (e.name.endsWith('.md')) {
        const md = await fs.readFile(path.join(dir, e.name), 'utf8').catch(() => '');
        custom.push({ name: e.name.replace(/\.md$/, ''), description: frontmatter(md, 'description') || md.split('\n').find((l) => l.trim() && !l.startsWith('---'))?.slice(0, 100) || `${scope} command`, scope });
      }
    }
  };
  await scan(path.join(CLAUDE_DIR, 'commands'), 'user');
  await scan(path.join(CLAUDE_DIR, 'skills'), 'user');
  if (root) { await scan(path.join(root, '.claude', 'commands'), 'project'); await scan(path.join(root, '.claude', 'skills'), 'project'); }
  return [...builtin, ...custom.sort((a, b) => a.name.localeCompare(b.name))];
}
function frontmatter(md, key) {
  const m = /^---\n([\s\S]*?)\n---/.exec(md);
  if (!m) return null;
  const line = m[1].split('\n').find((l) => l.startsWith(key + ':'));
  return line ? line.slice(key.length + 1).trim().replace(/^["']|["']$/g, '') : null;
}

class Bridge {
  constructor(ws, root) {
    this.ws = ws;
    this.root = root;
    this.proc = null;
    this.sessionId = null;
    this.buf = '';
    this.options = {};
    this.pendingPermissions = new Map();
    ws.on('message', (raw) => { let m; try { m = JSON.parse(raw.toString()); } catch { return; } this.onMessage(m).catch((err) => this.send({ type: 'error', message: err.message })); });
    ws.on('close', () => this.kill());
    this.send({ type: 'ready' });
  }

  send(msg) { if (this.ws.readyState === this.ws.OPEN) this.ws.send(JSON.stringify(msg)); }

  async onMessage(m) {
    switch (m.type) {
      case 'configure': this.options = { ...this.options, ...m.options }; break;
      case 'send': await this.sendUser(m.text, m.options); break;
      case 'permission': this.answerPermission(m); break;
      case 'interrupt': this.interrupt(); break;
      case 'stop': this.kill(); this.send({ type: 'stopped' }); break;
      case 'new': this.kill(); this.sessionId = null; this.send({ type: 'session', sessionId: null }); break;
      case 'resume': this.kill(); this.sessionId = m.sessionId; this.send({ type: 'session', sessionId: this.sessionId }); break;
    }
  }

  start(options = {}) {
    this.options = { ...this.options, ...options };
    const o = this.options;
    const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--permission-prompt-tool', 'stdio', '--replay-user-messages'];
    if (o.model && o.model !== 'default') args.push('--model', o.model);
    if (o.permissionMode && o.permissionMode !== 'default') args.push('--permission-mode', o.permissionMode);
    if (o.permissionMode === 'bypassPermissions') args.push('--dangerously-skip-permissions');
    if (o.effort && o.effort !== 'default') args.push('--effort', o.effort);
    if (o.maxBudget) args.push('--max-budget-usd', String(o.maxBudget));
    if (this.sessionId) args.push('--resume', this.sessionId);
    const proc = spawn('claude', args, { cwd: this.root, env: { ...process.env, CLAUDE_CODE_IDE: 'webstorm-clone' }, stdio: ['pipe', 'pipe', 'pipe'] });
    this.proc = proc;
    this.buf = '';
    this.send({ type: 'started', pid: proc.pid, args });
    proc.stdout.on('data', (d) => this.onStdout(d));
    proc.stderr.on('data', (d) => this.send({ type: 'stderr', data: d.toString() }));
    proc.on('error', (err) => this.send({ type: 'error', message: err.code === 'ENOENT' ? 'The `claude` CLI is not installed or not on PATH. Install it with: npm install -g @anthropic-ai/claude-code' : err.message }));
    proc.on('close', (code, signal) => { if (this.proc === proc) this.proc = null; this.send({ type: 'exited', code, signal }); });
    return proc;
  }

  onStdout(chunk) {
    this.buf += chunk.toString();
    let i;
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i); this.buf = this.buf.slice(i + 1);
      if (!line.trim()) continue;
      let j; try { j = JSON.parse(line); } catch { this.send({ type: 'raw', data: line }); continue; }
      if (j.session_id && j.session_id !== this.sessionId) { this.sessionId = j.session_id; this.send({ type: 'session', sessionId: this.sessionId }); }
      if (j.type === 'control_request') {
        const req = j.request || {};
        if (req.subtype === 'can_use_tool') {
          this.pendingPermissions.set(j.request_id, req);
          this.send({ type: 'permission', requestId: j.request_id, request: req });
          continue;
        }

        this.write({ type: 'control_response', response: { subtype: 'success', request_id: j.request_id, response: {} } });
        continue;
      }
      this.send({ type: 'event', data: j });
    }
  }

  write(obj) {
    if (!this.proc || this.proc.stdin.destroyed) return false;
    this.proc.stdin.write(JSON.stringify(obj) + '\n');
    return true;
  }

  async sendUser(text, options) {
    if (!this.proc) this.start(options);
    else if (options) this.options = { ...this.options, ...options };
    const content = Array.isArray(text) ? text : String(text);
    this.write({ type: 'user', message: { role: 'user', content }, parent_tool_use_id: null, session_id: this.sessionId || undefined });
  }

  answerPermission({ requestId, allow, updatedInput, message, updatedPermissions }) {
    const req = this.pendingPermissions.get(requestId);
    this.pendingPermissions.delete(requestId);
    const response = allow
      ? { behavior: 'allow', updatedInput: updatedInput || req?.input || {}, ...(updatedPermissions ? { updatedPermissions } : {}) }
      : { behavior: 'deny', message: message || 'The user denied this tool call.' };
    this.write({ type: 'control_response', response: { subtype: 'success', request_id: requestId, response } });
  }

  interrupt() {
    if (!this.proc) return;
    this.write({ type: 'control_request', request_id: crypto.randomUUID(), request: { subtype: 'interrupt' } });
  }

  kill() {
    if (!this.proc) return;
    try { this.proc.stdin.end(); } catch {  }
    const p = this.proc; this.proc = null;
    setTimeout(() => { try { p.kill('SIGTERM'); } catch {  } }, 300);
    setTimeout(() => { try { p.kill('SIGKILL'); } catch {  } }, 3000);
  }
}
