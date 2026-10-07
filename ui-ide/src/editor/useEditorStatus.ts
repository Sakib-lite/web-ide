import { useEffect, useState } from 'react';
import { editorManager } from './editor-manager';
import { on } from '@/lib/bus';
import { escapeRegExp } from '@/lib/utils';

export function useEditorStatus() {
  const [status, setStatus] = useState({ position: '1:1', eol: 'LF', indent: '4 spaces', usages: '' });
  useEffect(() => {
    let disposed = false;
    let cursorDisposable: { dispose(): void } | null = null;
    const attach = () => {
      if (disposed || !editorManager.editor || cursorDisposable) return;
      const editor = editorManager.editor;
      cursorDisposable = editor.onDidChangeCursorPosition((e) => {
        const model = editor.getModel();
        const word = model?.getWordAtPosition(e.position)?.word;
        const n = model && word ? countWord(model.getValue(), word) : 0;
        setStatus((s) => ({ ...s, position: `${e.position.lineNumber}:${e.position.column}`, usages: n > 1 ? `${n} usages` : '' }));
      });
    };
    const offReady = editorManager.onChange(attach);
    const offTab = on<any>('active-tab', (tab) => {
      if (!tab || tab.kind !== 'file') return;
      const opts = tab.model.getOptions();
      setStatus((s) => ({ ...s, eol: tab.model.getEOL() === '\n' ? 'LF' : 'CRLF', indent: opts.insertSpaces ? `${opts.tabSize} spaces` : 'Tab' }));
    });
    attach();
    return () => {
      disposed = true;
      offReady();
      offTab();
      cursorDisposable?.dispose();
    };
  }, []);
  return status;
}

function countWord(text: string, word: string): number {
  const re = new RegExp(`(^|[^\\w$])${escapeRegExp(word)}(?![\\w$])`, 'g');
  let n = 0;
  while (re.exec(text) && n < 5000) n++;
  return n;
}
