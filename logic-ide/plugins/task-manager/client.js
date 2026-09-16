export function activate(api) {
  let tasks = [];
  let host = null;

  const refresh = async () => {
    tasks = api.state.root ? await api.fetch('/tasks').catch(() => []) : [];
    render();
  };

  const save = async (task) => {
    try {
      tasks = await api.fetch('/tasks', { method: 'POST', body: { task } });
      render();
    } catch (err) {
      api.toast('Could not save task', err.message, 'error');
    }
  };

  const remove = async (id) => {
    try {
      tasks = await api.fetch('/tasks', { method: 'DELETE', query: { id } });
      render();
    } catch (err) {
      api.toast('Could not delete task', err.message, 'error');
    }
  };

  const taskForm = async (existing) => {
    const v = await api.formDialog({
      title: existing ? 'Edit Task' : 'New Task',
      okText: existing ? 'Save' : 'Add',
      fields: [
        { name: 'name', label: 'Name:', value: existing?.name || '', placeholder: 'e.g. Dev server' },
        { type: 'textarea', name: 'command', label: 'Command:', rows: 3, value: existing?.command || '', placeholder: 'npm run dev' },
        { name: 'cwd', label: 'Working directory (optional):', value: existing?.cwd || '', placeholder: 'defaults to the project root' },
      ],
      validate: (x) => (!String(x.name).trim() ? 'Name is required' : !String(x.command).trim() ? 'Command is required' : undefined),
    });
    if (!v) return;
    await save({ id: existing?.id, name: v.name, command: v.command, cwd: v.cwd });
  };

  const run = (t) => {
    api.runInTerminal(t.command, { cwd: t.cwd || api.state.root });
  };

  function row(t) {
    const { el } = api;
    return el('div', { class: 'tm-row', ondblclick: () => run(t), title: 'Double-click to run' },
      el('div', { class: 'tm-info' },
        el('div', { class: 'tm-name' }, t.name),
        el('div', { class: 'tm-cmd', title: t.command }, (t.cwd ? t.cwd + ' $ ' : '') + t.command),
      ),
      el('div', { class: 'tm-actions' },
        el('button', { class: 'tm-btn tm-run', title: 'Run in terminal', onclick: () => run(t) }, '▶'),
        el('button', { class: 'tm-btn', title: 'Edit', onclick: () => taskForm(t) }, '✎'),
        el('button', { class: 'tm-btn tm-del', title: 'Delete', onclick: async () => { if (await api.confirmDialog(`Delete task "${t.name}"?`, 'Delete')) remove(t.id); } }, '✕'),
      ),
    );
  }

  function render() {
    if (!host) return;
    const { el } = api;
    host.textContent = '';
    host.append(
      el('div', { class: 'tm-head' },
        el('span', { class: 'tm-title' }, 'Saved Tasks'),
        el('button', { class: 'btn tm-add', onclick: () => taskForm() }, '+ Add Task'),
      ),
      !api.state.root
        ? el('div', { class: 'tm-empty' }, 'Open a project to manage its tasks.')
        : tasks.length
          ? el('div', { class: 'tm-list' }, tasks.map(row))
          : el('div', { class: 'tm-empty' }, 'No tasks yet. Click “+ Add Task” to save a command. Tasks are stored per project on the server, so they survive browser refreshes.'),
    );
  }

  api.tools.register({
    render(elHost) {
      host = elHost;
      host.classList.add('tm-host');
      refresh();
    },
    onShow: refresh,
  });
}
