import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const GLOBAL = '__global__';

export async function register({ router, dataDir }) {
  const file = path.join(dataDir, 'tasks.json');
  const readAll = async () => {
    try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return {}; }
  };
  const writeAll = async (all) => {
    await fs.mkdir(dataDir, { recursive: true });
    await fs.writeFile(file, JSON.stringify(all, null, 2));
  };
  const wrap = (fn) => (req, res) => Promise.resolve(fn(req)).then((out) => res.json(out)).catch((err) => res.status(err.status || 500).json({ error: err.message }));
  const bad = (message) => { const e = new Error(message); e.status = 400; throw e; };
  const upsert = (list, task) => {
    const id = task.id || crypto.randomUUID();
    const next = { id, name: task.name.trim(), command: task.command.trim(), cwd: (task.cwd || '').trim(), ...(task.global ? { global: true } : {}) };
    const i = list.findIndex((t) => t.id === id);
    if (i >= 0) list[i] = next;
    else list.push(next);
    return list;
  };

  router.get('/tasks', wrap(async (req) => {
    if (!req.query.root) bad('No project open');
    const all = await readAll();
    return [...(all[GLOBAL] || []), ...(all[req.query.root] || [])];
  }));

  router.post('/tasks', wrap(async (req) => {
    const { root, task } = req.body || {};
    if (!root) bad('No project open');
    if (!task?.name?.trim() || !task?.command?.trim()) bad('Name and command are required');
    const all = await readAll();
    const key = task.global ? GLOBAL : root;
    all[key] = all[key] || [];
    upsert(all[key], task);
    await writeAll(all);
    return [...(all[GLOBAL] || []), ...(all[root] || [])];
  }));

  router.post('/tasks/reorder', wrap(async (req) => {
    const { root, ids } = req.body || {};
    if (!root || !Array.isArray(ids)) bad('Invalid request');
    const all = await readAll();
    const list = all[root] || [];
    const byId = new Map(list.map((t) => [t.id, t]));
    all[root] = [...ids.map((id) => byId.get(id)).filter(Boolean), ...list.filter((t) => !ids.includes(t.id))];
    await writeAll(all);
    return [...(all[GLOBAL] || []), ...(all[root] || [])];
  }));

  router.delete('/tasks', wrap(async (req) => {
    const { root, id } = req.query;
    if (!root || !id) bad('Invalid request');
    const all = await readAll();
    for (const key of [root, GLOBAL]) all[key] = (all[key] || []).filter((t) => t.id !== id);
    await writeAll(all);
    return [...(all[GLOBAL] || []), ...(all[root] || [])];
  }));
}
