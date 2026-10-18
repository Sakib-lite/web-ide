import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

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

  router.get('/tasks', wrap(async (req) => {
    if (!req.query.root) bad('No project open');
    return (await readAll())[req.query.root] || [];
  }));

  router.post('/tasks', wrap(async (req) => {
    const { root, task } = req.body || {};
    if (!root) bad('No project open');
    if (!task?.name?.trim() || !task?.command?.trim()) bad('Name and command are required');
    const all = await readAll();
    const list = all[root] || [];
    const id = task.id || crypto.randomUUID();
    const next = { id, name: task.name.trim(), command: task.command.trim(), cwd: (task.cwd || '').trim() };
    const i = list.findIndex((t) => t.id === id);
    if (i >= 0) list[i] = next;
    else list.push(next);
    all[root] = list;
    await writeAll(all);
    return list;
  }));

  router.post('/tasks/reorder', wrap(async (req) => {
    const { root, ids } = req.body || {};
    if (!root || !Array.isArray(ids)) bad('Invalid request');
    const all = await readAll();
    const list = all[root] || [];
    const byId = new Map(list.map((t) => [t.id, t]));
    all[root] = [...ids.map((id) => byId.get(id)).filter(Boolean), ...list.filter((t) => !ids.includes(t.id))];
    await writeAll(all);
    return all[root];
  }));

  router.delete('/tasks', wrap(async (req) => {
    const { root, id } = req.query;
    if (!root || !id) bad('Invalid request');
    const all = await readAll();
    all[root] = (all[root] || []).filter((t) => t.id !== id);
    await writeAll(all);
    return all[root];
  }));
}
