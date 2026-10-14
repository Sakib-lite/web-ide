type Child = Node | string | number | null | undefined | false | Child[];

export function el(tag: string, attrs: Record<string, unknown> = {}, ...children: Child[]): HTMLElement {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = String(v);
    else if (k === 'style' && v && typeof v === 'object') Object.assign(node.style, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    else if (k === 'dataset' && v && typeof v === 'object') Object.assign(node.dataset, v);
    else if (v === false || v == null) continue;
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  const append = (c: Child) => {
    if (Array.isArray(c)) return c.forEach(append);
    if (c == null || c === false) return;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  };
  children.forEach(append);
  return node;
}

export function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function highlightMatch(text: string, query: string): HTMLElement {
  const span = el('span', { class: 'se-name' });
  if (!query) {
    span.textContent = text;
    return span;
  }
  const q = query.toLowerCase(), t = text.toLowerCase();
  const idx = t.indexOf(q);
  if (idx >= 0) {
    span.append(text.slice(0, idx), el('mark', {}, text.slice(idx, idx + q.length)), text.slice(idx + q.length));
    return span;
  }
  let qi = 0, buf = '';
  for (let i = 0; i < text.length; i++) {
    if (qi < q.length && t[i] === q[qi]) {
      if (buf) span.append(buf);
      buf = '';
      span.append(el('mark', {}, text[i]));
      qi++;
    } else buf += text[i];
  }
  if (buf) span.append(buf);
  return span;
}
