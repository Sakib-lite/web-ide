import type * as Monaco from 'monaco-editor';

/**
 * Clickable chip stacks rendered INSIDE the editor's line-number gutter
 * (JetBrains merge-dialog style) — an absolutely-positioned overlay that
 * follows each anchored line through scroll and relayout.
 */
export class GutterChips {
  private overlay: HTMLDivElement | null = null;
  private stacks: { line: number; el: HTMLDivElement }[] = [];
  private readonly disposables: Monaco.IDisposable[] = [];

  constructor(private readonly editor: Monaco.editor.IStandaloneCodeEditor, private readonly align: 'left' | 'right' = 'left') {
    const host = editor.getDomNode();
    if (!host) return;
    this.overlay = document.createElement('div');
    this.overlay.className = 'md-gutter-overlay';
    host.appendChild(this.overlay);
    this.disposables.push(
      editor.onDidScrollChange(() => this.render()),
      editor.onDidLayoutChange(() => this.render()),
      editor.onDidChangeModel(() => this.clear()),
    );
  }

  clear() {
    if (!this.overlay) return;
    this.overlay.replaceChildren();
    this.stacks = [];
  }

  add(line: number, chips: HTMLElement[]) {
    const el = document.createElement('div');
    el.className = 'md-gutter-stack';
    el.append(...chips);
    if (!this.overlay) return;
    this.overlay.appendChild(el);
    this.stacks.push({ line, el });
    this.render();
  }

  render() {
    const layout = this.editor.getLayoutInfo();
    const scrollTop = this.editor.getScrollTop();
    const model = this.editor.getModel();
    for (const { line, el } of this.stacks) {
      if (!model || line < 1 || line > model.getLineCount()) {
        el.style.display = 'none';
        continue;
      }
      const y = this.editor.getTopForLineNumber(line) - scrollTop;
      if (y < -24 || y > layout.height) {
        el.style.display = 'none';
        continue;
      }
      el.style.display = 'flex';
      const w = el.offsetWidth;
      // 'left': right-aligned against the code text (the editor's left gutter).
      // 'right': pinned to the editor's right edge — the second icon column
      // flanking the Result pane, JetBrains-style.
      el.style.left = (this.align === 'left'
        ? Math.max(2, layout.contentLeft - w - 6)
        : Math.max(layout.contentLeft + 10, layout.width - w - 16)) + 'px';
      el.style.top = y - 1 + 'px';
    }
  }

  dispose() {
    for (const d of this.disposables) d.dispose();
    this.overlay?.remove();
  }
}
