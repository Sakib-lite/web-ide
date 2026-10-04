

export function activate(api) {
  const { el, escapeHtml, toast } = api;
  const S = api.settings;
  let root, messagesEl, inputEl, statusEl, usageEl, attachEl, popupEl, sessionsEl, tool;
  let ws = null, connected = false, busy = false;
  let sessionId = null, sessionTitle = 'New session';
  let currentAssistant = null;
  const toolCards = new Map();
  let streamText = new Map();
  const attachments = [];
  let commands = [];
  let totals = { cost: 0, input: 0, output: 0, turns: 0 };
  const history = [];
  const opts = () => ({ model: S.get('model', 'default'), permissionMode: S.get('permissionMode', 'default'), effort: S.get('effort', 'default') });

  tool = api.tools.register({
    id: 'claude-code', side: 'right', title: 'Claude Code', icon: api.manifest.icon, shortcut: api.manifest.toolWindow?.shortcut,
    render: (container) => { root = build(); container.append(root); connect(); loadCommands(); },
    onShow: () => setTimeout(() => inputEl?.focus(), 250),
  });

  function build() {
    const sel = (key, options, title) => {
      const s = el('select', { class: 'filter-select', title });
      for (const [v, label] of options) s.append(el('option', { value: v }, label));
      s.value = S.get(key, options[0][0]);
      s.addEventListener('change', () => { S.set(key, s.value); send({ type: 'configure', options: opts() }); if (key === 'permissionMode' && s.value === 'bypassPermissions') toast('Bypass permissions enabled', 'Claude will run tools without asking. Restart the session for it to take effect.', 'info', 5000); });
      return s;
    };
    statusEl = el('span', { class: 'cc-status' }, 'Idle');
    const toolbar = el('div', { class: 'cc-toolbar' },
      el('button', { class: 'tb-icon sm', title: 'New session', onClick: newSession }, el('span', { class: 'ico ico-plus' })),
      el('button', { class: 'tb-icon sm', title: 'Session history', onClick: showSessions }, el('span', { class: 'ico ico-history' })),
      sel('model', [['default', 'Model: Default'], ['fable', 'Model: Fable'], ['opus', 'Model: Opus'], ['sonnet', 'Model: Sonnet'], ['haiku', 'Model: Haiku']], 'Model'),
      sel('permissionMode', [['default', 'Ask permissions'], ['acceptEdits', 'Accept edits'], ['plan', 'Plan mode'], ['bypassPermissions', 'Bypass permissions']], 'Permission mode'),
      sel('effort', [['default', 'Effort: Default'], ['low', 'Effort: Low'], ['medium', 'Effort: Medium'], ['high', 'Effort: High'], ['max', 'Effort: Max']], 'Reasoning effort'),
      el('button', { class: 'tb-icon sm', title: 'Export conversation as Markdown', onClick: exportMarkdown }, el('span', { class: 'ico ico-external' })),
      statusEl,
    );
    messagesEl = el('div', { class: 'cc-messages' });
    usageEl = el('div', { class: 'cc-usage hidden' });
    attachEl = el('div', { class: 'cc-attach' });
    inputEl = el('textarea', { class: 'cc-input', placeholder: 'Ask Claude Code… Type @ to reference a file, / for commands. Enter to send, Shift+Enter for a new line.' });
    inputEl.addEventListener('keydown', onInputKey);
    inputEl.addEventListener('input', onInputChange);
    const sendBtn = el('button', { class: 'btn primary', onClick: submit }, 'Send');
    const stopBtn = el('button', { class: 'btn', title: 'Interrupt (Esc)', onClick: () => send({ type: 'interrupt' }) }, 'Stop');
    const inputWrap = el('div', { class: 'cc-input-wrap' }, attachEl, inputEl, el('div', { class: 'cc-input-bar' }, el('span', { class: 'cc-hint' }, `cwd: ${api.state.name}`), stopBtn, sendBtn));
    popupEl = null;
    showEmpty();
    return el('div', { class: 'cc-root' }, toolbar, messagesEl, usageEl, inputWrap);
  }

  function showEmpty() {
    messagesEl.innerHTML = '';
    messagesEl.append(el('div', { class: 'cc-empty' }, el('div', { class: 'big' }, '✦'), el('div', {}, el('b', {}, 'Claude Code'), el('br'), 'Chat with Claude Code in this project. Tool calls, diffs and permission prompts show up here.'),
      el('div', { style: { display: 'flex', gap: '6px' } }, el('button', { class: 'btn', onClick: () => { inputEl.value = '/init'; inputEl.focus(); } }, '/init'), el('button', { class: 'btn', onClick: () => { inputEl.value = '/review'; inputEl.focus(); } }, '/review'), el('button', { class: 'btn', onClick: showSessions }, 'Resume a session…'))));
  }

  function setStatus(text, spinning = false) {
    statusEl.innerHTML = '';
    if (spinning) statusEl.append(el('span', { class: 'spinner' }));
    statusEl.append(text);
  }

  function connect() {
    ws = api.ws();
    ws.onopen = () => { connected = true; send({ type: 'configure', options: opts() }); if (sessionId) send({ type: 'resume', sessionId }); };
    ws.onclose = () => { connected = false; setStatus('Disconnected'); setTimeout(connect, 2000); };
    ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch { return; } handle(m); };
  }
  function send(m) { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m)); }

  function handle(m) {
    switch (m.type) {
      case 'ready': setStatus('Idle'); break;
      case 'started': setStatus('Starting…', true); break;
      case 'session': sessionId = m.sessionId; break;
      case 'exited': busy = false; setStatus(m.code === 0 || m.code == null ? 'Idle' : `Exited (${m.code})`); if (m.code && m.code !== 0) addSys(`Claude Code exited with code ${m.code}.`); break;
      case 'stderr': if (/error|Error/.test(m.data)) addError(m.data.trim()); break;
      case 'error': busy = false; setStatus('Error'); addError(m.message); break;
      case 'permission': renderPermission(m.requestId, m.request); break;
      case 'event': onEvent(m.data); break;
    }
  }

  function onEvent(ev) {
    if (ev.type === 'system') {
      if (ev.subtype === 'init') { setStatus('Thinking…', true); busy = true; if (ev.model) statusEl.title = ev.model; }
      else if (ev.subtype === 'status') setStatus(ev.status === 'requesting' ? 'Thinking…' : ev.status, true);
      return;
    }
    if (ev.type === 'stream_event') { onStream(ev.event); return; }
    if (ev.type === 'assistant') { renderAssistant(ev); return; }
    if (ev.type === 'user') { renderUserEvent(ev); return; }
    if (ev.type === 'result') { renderResult(ev); return; }
  }

  function ensureAssistant(id) {
    if (currentAssistant && currentAssistant.id === id) return currentAssistant;
    const wrap = el('div', { class: 'cc-msg assistant' });
    messagesEl.append(wrap);
    currentAssistant = { el: wrap, id, blocks: new Map() };
    scroll();
    return currentAssistant;
  }

  function onStream(e) {
    if (e.type === 'message_start') { ensureAssistant(e.message.id); streamText = new Map(); return; }
    const a = currentAssistant; if (!a) return;
    if (e.type === 'content_block_start') {
      const cb = e.content_block;
      if (cb.type === 'text') { const t = el('div', { class: 'cc-text cc-cursor' }); a.el.append(t); a.blocks.set(e.index, t); streamText.set(e.index, ''); }
      else if (cb.type === 'thinking') { const d = el('details', { class: 'cc-thinking' }, el('summary', {}, 'Thinking…'), el('div', { class: 'cc-think-body' })); a.el.append(d); a.blocks.set(e.index, d); }
      else if (cb.type === 'tool_use') { const card = toolCard({ id: cb.id, name: cb.name, input: {} }); a.el.append(card.card); a.blocks.set(e.index, card.card); }
      scroll();
    } else if (e.type === 'content_block_delta') {
      const b = a.blocks.get(e.index); if (!b) return;
      if (e.delta.type === 'text_delta') { const t = (streamText.get(e.index) || '') + e.delta.text; streamText.set(e.index, t); b.innerHTML = markdown(t); b.classList.add('cc-cursor'); scroll(); }
      else if (e.delta.type === 'thinking_delta') { b.querySelector('.cc-think-body').textContent += e.delta.thinking; }
    } else if (e.type === 'content_block_stop') {
      const b = a.blocks.get(e.index); b?.classList.remove('cc-cursor');
    }
  }

  function renderAssistant(ev) {
    const msg = ev.message; const a = ensureAssistant(msg.id);
    msg.content.forEach((block) => {
      if (block.type === 'text') {

        const existing = [...a.blocks.values()].find((x) => x.classList?.contains('cc-text') && !x.dataset.final);
        const t = existing || el('div', { class: 'cc-text' });
        t.classList.remove('cc-cursor'); t.innerHTML = markdown(block.text); t.dataset.final = '1';
        if (!existing) a.el.append(t);
        history.push({ role: 'assistant', text: block.text });
      } else if (block.type === 'thinking') {
        const existing = [...a.blocks.values()].find((x) => x.classList?.contains('cc-thinking') && !x.dataset.final);
        const d = existing || el('details', { class: 'cc-thinking' }, el('summary', {}, 'Thinking…'), el('div', { class: 'cc-think-body' }));
        d.querySelector('.cc-think-body').textContent = block.thinking; d.querySelector('summary').textContent = 'Thought'; d.dataset.final = '1';
        if (!existing) a.el.append(d);
      } else if (block.type === 'tool_use') {
        let card = toolCards.get(block.id);
        if (!card) { card = toolCard(block); a.el.append(card.card); }
        else card.update(block);
      }
    });
    scroll();
  }

  function renderUserEvent(ev) {
    const content = ev.message?.content;
    if (!Array.isArray(content)) return;
    for (const b of content) {
      if (b.type === 'tool_result') {
        const card = toolCards.get(b.tool_use_id);
        if (card) card.result(b, ev.tool_use_result);
      }
    }
  }

  function renderResult(ev) {
    busy = false;
    currentAssistant = null;
    setStatus('Idle');
    const line = el('div', { class: `cc-result-line${ev.is_error ? ' error' : ''}` });
    if (ev.is_error) line.append(`Error: ${ev.result || ev.subtype}`);
    else {
      const u = ev.usage || {};
      for (const part of [`${(ev.duration_ms / 1000).toFixed(1)}s`, `${ev.num_turns} turn${ev.num_turns === 1 ? '' : 's'}`, ev.total_cost_usd != null ? `$${ev.total_cost_usd.toFixed(4)}` : '', `${u.input_tokens || 0}+${u.cache_read_input_tokens || 0}c in / ${u.output_tokens || 0} out`]) if (part) line.append(el('span', {}, part));
      totals.cost += ev.total_cost_usd || 0; totals.input += (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0); totals.output += u.output_tokens || 0; totals.turns += ev.num_turns || 0;
      usageEl.classList.remove('hidden');
      usageEl.innerHTML = `<span>Session: $${totals.cost.toFixed(4)}</span><span>${totals.input.toLocaleString()} in</span><span>${totals.output.toLocaleString()} out</span><span>${totals.turns} turns</span>${sessionId ? `<span title="${sessionId}">${sessionId.slice(0, 8)}</span>` : ''}`;
    }
    messagesEl.append(line);
    scroll();
    api.emit('fs-change', { changes: [] });
    api.emit('git-change');
  }

  function summarize(name, input) {
    const rel = (p) => (p || '').replace(api.state.root + '/', '');
    switch (name) {
      case 'Read': return rel(input.file_path);
      case 'Write': return rel(input.file_path);
      case 'Edit': case 'MultiEdit': return rel(input.file_path);
      case 'Bash': return input.command || input.description || '';
      case 'Grep': return `${input.pattern || ''} ${rel(input.path) || ''}`;
      case 'Glob': return input.pattern || '';
      case 'WebFetch': case 'WebSearch': return input.url || input.query || '';
      case 'Task': return input.description || input.prompt?.slice(0, 80) || '';
      default: return JSON.stringify(input).slice(0, 120);
    }
  }
  function toolCard(block) {
    const state = el('span', { class: 'cc-tool-state' });
    const sum = el('span', { class: 'cc-tool-sum' }, summarize(block.name, block.input || {}));
    const link = el('span', { class: 'cc-tool-link hidden' });
    const body = el('div', { class: 'cc-tool-body hidden' });
    const head = el('div', { class: 'cc-tool-head' }, state, el('span', { class: 'cc-tool-name' }, block.name), sum, link);
    head.addEventListener('click', (e) => { if (e.target === link) return; body.classList.toggle('hidden'); });
    const card = el('div', { class: 'cc-tool' }, head, body);
    const api2 = {
      card, body, input: block.input || {},
      update(b) { this.input = b.input || {}; sum.textContent = summarize(b.name, this.input); body.innerHTML = ''; body.append(renderInput(b.name, this.input)); const file = this.input.file_path; if (file && file.startsWith(api.state.root + '/')) { link.textContent = 'Open'; link.classList.remove('hidden'); link.onclick = () => api.openFile(file.slice(api.state.root.length + 1), { preview: false }); } },
      result(res, structured) {
        const text = typeof res.content === 'string' ? res.content : Array.isArray(res.content) ? res.content.map((c) => c.text || '').join('\n') : '';
        state.classList.add(res.is_error ? 'error' : 'done');
        if (/denied|rejected/i.test(text) && res.is_error) state.classList.replace('error', 'denied');
        const r = el('div', { class: `cc-result${res.is_error ? ' error' : ''}` }, (structured?.stdout ?? text ?? '').toString().slice(0, 4000) || '(no output)');
        if (structured?.stderr) r.append('\n' + structured.stderr.slice(0, 2000));
        body.append(r);
        if (block.name === 'Edit' && structured?.filePath && structured.originalFile != null) {
          link.textContent = 'Show diff'; link.classList.remove('hidden');
          link.onclick = () => showEditDiff(structured);
        } else if (block.name === 'Write' && structured?.filePath) {
          link.textContent = 'Open'; link.classList.remove('hidden');
          link.onclick = () => api.openFile(structured.filePath.replace(api.state.root + '/', ''), { preview: false });
        }
        if (res.is_error) body.classList.remove('hidden');
      },
    };
    api2.update(block);
    toolCards.set(block.id, api2);
    return api2;
  }
  function renderInput(name, input) {
    const frag = document.createDocumentFragment();
    if ((name === 'Edit') && input.old_string != null) {
      for (const l of String(input.old_string).split('\n')) frag.append(el('span', { class: 'cc-diff-del' }, '- ' + l));
      for (const l of String(input.new_string).split('\n')) frag.append(el('span', { class: 'cc-diff-add' }, '+ ' + l));
      return frag;
    }
    if (name === 'MultiEdit' && Array.isArray(input.edits)) { for (const e of input.edits) { frag.append(renderInput('Edit', e)); frag.append(el('div', { style: { height: '6px' } })); } return frag; }
    if (name === 'Write') { frag.append((input.content || '').slice(0, 3000)); return frag; }
    if (name === 'Bash') { frag.append('$ ' + (input.command || '')); return frag; }
    frag.append(JSON.stringify(input, null, 2).slice(0, 3000));
    return frag;
  }
  async function showEditDiff(structured) {
    const rel = structured.filePath.replace(api.state.root + '/', '');
    let after = '';
    try { after = await api.readFile(rel); } catch { after = applyEdit(structured); }
    api.openDiff(rel, { key: `diff:claude:${rel}:${Date.now()}`, title: `${rel.split('/').pop()} (Claude edit)`, before: { content: structured.originalFile, label: 'Before Claude' }, after: { content: after, label: 'After Claude', readOnly: true } });
  }
  function applyEdit(s) { return s.originalFile.replace(s.oldString, s.newString); }

  function renderPermission(requestId, req) {
    const input = el('div', { class: 'cc-perm-input' }, req.tool_name === 'Bash' ? '$ ' + req.input.command : JSON.stringify(req.input, null, 2).slice(0, 3000));
    const box = el('div', { class: 'cc-perm' }, el('div', { class: 'cc-perm-title' }, el('span', { class: 'ico ico-settings' }), `Allow ${req.display_name || req.tool_name}?`, el('span', { style: { color: 'var(--text-muted)', fontWeight: 400 } }, req.description || '')), input);
    const actions = el('div', { class: 'cc-perm-actions' });
    const answer = (allow, extra = {}) => { send({ type: 'permission', requestId, allow, ...extra }); box.classList.add('answered'); actions.innerHTML = ''; actions.append(el('span', { style: { color: 'var(--text-muted)', fontSize: '12px' } }, allow ? 'Allowed' : 'Denied')); };
    actions.append(el('button', { class: 'btn primary', onClick: () => answer(true) }, 'Allow once'));
    const modeSuggestion = (req.permission_suggestions || []).find((s) => s.type === 'setMode');
    if (modeSuggestion) actions.append(el('button', { class: 'btn', onClick: () => answer(true, { updatedPermissions: [modeSuggestion] }) }, `Allow all ${modeSuggestion.mode === 'acceptEdits' ? 'edits' : modeSuggestion.mode} this session`));
    const ruleSuggestion = (req.permission_suggestions || []).find((s) => s.type === 'addRules');
    if (ruleSuggestion) actions.append(el('button', { class: 'btn', onClick: () => answer(true, { updatedPermissions: [ruleSuggestion] }) }, 'Always allow'));
    actions.append(el('button', { class: 'btn', onClick: async () => { const r = await api.promptDialog({ title: 'Deny with feedback', label: 'Tell Claude what to do instead (optional):', okText: 'Deny' }); if (r !== null) answer(false, { message: r || undefined }); } }, 'Deny'));
    box.append(actions);
    messagesEl.append(box);
    setStatus('Waiting for permission', false);
    scroll();
    api.toast('Claude Code needs permission', `${req.tool_name}: ${summarize(req.tool_name, req.input)}`.slice(0, 160), 'info', 6000);
  }

  function onInputKey(e) {
    if (popupEl) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); movePopup(e.key === 'ArrowDown' ? 1 : -1); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); choosePopup(); return; }
      if (e.key === 'Escape') { e.preventDefault(); closePopup(); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
    else if (e.key === 'Escape' && busy) send({ type: 'interrupt' });
  }
  async function onInputChange() {
    const v = inputEl.value; const pos = inputEl.selectionStart;
    const before = v.slice(0, pos);
    const at = /(?:^|\s)@([\w./-]*)$/.exec(before);
    const slash = /^\/([\w:-]*)$/.exec(before);
    if (at) {
      const files = await api.files();
      const q = at[1].toLowerCase();
      const scored = files.map((f) => ({ f, s: q ? api.fuzzyScore(f, q) : 0 })).filter((x) => x.s >= 0).sort((a, b) => b.s - a.s).slice(0, 12);
      openPopup(scored.map((x) => ({ label: x.f, sub: '', apply: () => { inputEl.value = before.slice(0, before.length - at[0].length) + (at[0].startsWith(' ') ? ' ' : '') + '@' + x.f + ' ' + v.slice(pos); addAttachment(x.f); } })), q);
    } else if (slash) {
      const q = slash[1].toLowerCase();
      const list = commands.filter((c) => c.name.toLowerCase().includes(q)).slice(0, 12);
      openPopup(list.map((c) => ({ label: '/' + c.name, sub: c.description, apply: () => { inputEl.value = '/' + c.name + ' ' + v.slice(pos); } })), q);
    } else closePopup();
  }
  let popupItems = [], popupIndex = 0;
  function openPopup(items, q) {
    closePopup();
    if (!items.length) return;
    popupItems = items; popupIndex = 0;
    popupEl = el('div', { class: 'cc-popup' });
    items.forEach((it, i) => {
      const row = el('div', { class: `se-item${i === 0 ? ' active' : ''}` }, api.highlightMatch(it.label, q), it.sub ? el('span', { class: 'se-sub' }, it.sub) : null);
      row.addEventListener('mousedown', (e) => { e.preventDefault(); popupIndex = i; choosePopup(); });
      popupEl.append(row);
    });
    inputEl.parentElement.append(popupEl);
  }
  function movePopup(d) { popupIndex = (popupIndex + d + popupItems.length) % popupItems.length; [...popupEl.children].forEach((c, i) => c.classList.toggle('active', i === popupIndex)); }
  function choosePopup() { const it = popupItems[popupIndex]; closePopup(); it?.apply(); inputEl.focus(); }
  function closePopup() { popupEl?.remove(); popupEl = null; popupItems = []; }
  function addAttachment(f) { if (attachments.includes(f)) return; attachments.push(f); renderAttachments(); }
  function renderAttachments() {
    attachEl.innerHTML = '';
    for (const f of attachments) attachEl.append(el('span', { class: 'chip' }, '@' + f, el('span', { class: 'x', onClick: () => { attachments.splice(attachments.indexOf(f), 1); renderAttachments(); } }, '×')));
  }

  async function submit() {
    const text = inputEl.value.trim();
    if (!text) return;
    if (text === '/clear') { newSession(); return; }
    if (!connected) { toast('Claude Code', 'Not connected to the server yet.', 'error'); return; }
    if (messagesEl.querySelector('.cc-empty')) messagesEl.innerHTML = '';
    const bubble = el('div', { class: 'cc-msg user' });
    bubble.innerHTML = escapeHtml(text).replace(/(^|\s)@([\w./-]+)/g, '$1<span class="cc-at">@$2</span>');
    messagesEl.append(bubble);
    history.push({ role: 'user', text });
    inputEl.value = ''; attachments.length = 0; renderAttachments(); closePopup();
    busy = true; setStatus('Sending…', true);
    send({ type: 'send', text, options: opts() });
    scroll();
  }

  function addSys(t) { messagesEl.append(el('div', { class: 'cc-sys' }, t)); scroll(); }
  function addError(t) { messagesEl.append(el('div', { class: 'cc-error' }, t)); scroll(); }
  function scroll() { messagesEl.scrollTop = messagesEl.scrollHeight; }

  function newSession() {
    send({ type: 'new' });
    sessionId = null; sessionTitle = 'New session'; currentAssistant = null; toolCards.clear(); history.length = 0;
    totals = { cost: 0, input: 0, output: 0, turns: 0 }; usageEl.classList.add('hidden');
    showEmpty(); setStatus('Idle');
  }
  async function showSessions() {
    sessionsEl?.remove();
    const list = el('div', { class: 'cc-sess-list' }, el('div', { class: 'empty-hint' }, 'Loading…'));
    const search = el('input', { type: 'text', placeholder: 'Search sessions', class: 'cc-input', style: { minHeight: '28px', height: '28px', padding: '2px 8px' } });
    sessionsEl = el('div', { class: 'cc-sessions' }, el('div', { class: 'cc-sess-head' }, el('button', { class: 'tb-icon sm', onClick: () => sessionsEl.remove() }, el('span', { class: 'ico ico-back' })), el('b', {}, 'Sessions'), search), list);
    root.append(sessionsEl);
    let sessions = [];
    try { sessions = await api.fetch('/sessions'); } catch (err) { list.innerHTML = `<div class="empty-hint">${escapeHtml(err.message)}</div>`; return; }
    const render = () => {
      const q = search.value.trim().toLowerCase();
      list.innerHTML = '';
      const items = sessions.filter((s) => !q || s.title.toLowerCase().includes(q));
      if (!items.length) list.append(el('div', { class: 'empty-hint' }, 'No sessions for this project yet.'));
      for (const s of items) {
        const row = el('div', { class: `cc-sess${s.id === sessionId ? ' current' : ''}` }, el('div', { class: 't' }, s.title), el('div', { class: 'm' }, `${api.timeAgo(s.modified)} · ${s.messages}${s.partial ? '+' : ''} messages · ${s.id.slice(0, 8)}`));
        row.addEventListener('click', () => resumeSession(s));
        list.append(row);
      }
    };
    search.addEventListener('input', render);
    render();
    setTimeout(() => search.focus(), 50);
  }
  async function resumeSession(s) {
    sessionsEl?.remove();
    let data;
    try { data = await api.fetch(`/sessions/${s.id}`); } catch (err) { toast('Cannot load session', err.message, 'error'); return; }
    newSession();
    sessionId = s.id; sessionTitle = s.title;
    send({ type: 'resume', sessionId });
    messagesEl.innerHTML = '';
    addSys(`Resumed session "${s.title}" (${s.id.slice(0, 8)})`);
    for (const m of data.messages) {
      if (m.type === 'user') {
        const c = m.message.content;
        if (typeof c === 'string') { const b = el('div', { class: 'cc-msg user' }); b.textContent = c; messagesEl.append(b); history.push({ role: 'user', text: c }); }
        else if (Array.isArray(c)) { for (const b of c) { if (b.type === 'text') { const bb = el('div', { class: 'cc-msg user' }); bb.textContent = b.text; messagesEl.append(bb); } else if (b.type === 'tool_result') toolCards.get(b.tool_use_id)?.result(b, m.tool_use_result); } }
      } else if (m.type === 'assistant') renderAssistant({ message: m.message });
    }
    currentAssistant = null;
    scroll();
  }

  async function loadCommands() { try { commands = await api.fetch('/commands'); } catch { commands = []; } }

  function exportMarkdown() {
    if (!history.length) { toast('Nothing to export', '', 'info', 1500); return; }
    const md = `# Claude Code – ${api.state.name}\n\n` + history.map((h) => (h.role === 'user' ? `**You:**\n\n${h.text}` : `**Claude:**\n\n${h.text}`)).join('\n\n---\n\n');
    const a = el('a', { href: URL.createObjectURL(new Blob([md], { type: 'text/markdown' })), download: `claude-${(sessionId || 'session').slice(0, 8)}.md` });
    document.body.append(a); a.click(); a.remove();
  }

  function markdown(src) {
    const esc = escapeHtml;
    const blocks = [];
    let text = src.replace(/```(\w*)\n([\s\S]*?)(```|$)/g, (m, lang, code) => { blocks.push(`<pre>${lang ? `<span class="cc-lang">${esc(lang)}</span>` : ''}<code>${esc(code.replace(/\n$/, ''))}</code></pre>`); return `\u0000${blocks.length - 1}\u0000`; });
    text = esc(text);
    text = text.replace(/`([^`\n]+)`/g, '<code>$1</code>');
    text = text.replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<i>$2</i>');
    text = text.replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
    const lines = text.split('\n');
    const out = []; let list = null; let para = [];
    const flushPara = () => { if (para.length) { out.push(`<p>${para.join('<br>')}</p>`); para = []; } };
    const flushList = () => { if (list) { out.push(`<${list.type}>${list.items.map((i) => `<li>${i}</li>`).join('')}</${list.type}>`); list = null; } };
    for (const raw of lines) {
      const l = raw.trimEnd();
      let m;
      if (/^\u0000\d+\u0000$/.test(l.trim())) { flushPara(); flushList(); out.push(l.trim()); continue; }
      if ((m = /^(#{1,4})\s+(.*)$/.exec(l))) { flushPara(); flushList(); out.push(`<h${m[1].length + 1}>${m[2]}</h${m[1].length + 1}>`); continue; }
      if ((m = /^\s*[-*]\s+(.*)$/.exec(l))) { flushPara(); if (!list || list.type !== 'ul') { flushList(); list = { type: 'ul', items: [] }; } list.items.push(m[1]); continue; }
      if ((m = /^\s*\d+[.)]\s+(.*)$/.exec(l))) { flushPara(); if (!list || list.type !== 'ol') { flushList(); list = { type: 'ol', items: [] }; } list.items.push(m[1]); continue; }
      if ((m = /^>\s?(.*)$/.exec(l))) { flushPara(); flushList(); out.push(`<blockquote>${m[1]}</blockquote>`); continue; }
      if (!l.trim()) { flushPara(); flushList(); continue; }
      flushList(); para.push(l);
    }
    flushPara(); flushList();
    return out.join('').replace(/\u0000(\d+)\u0000/g, (m, i) => blocks[Number(i)]);
  }

  return { deactivate() { ws?.close(); } };
}
