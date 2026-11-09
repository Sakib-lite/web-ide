import { create } from 'zustand';
import { editorManager } from '@/editor/editor-manager';
import { languageFor } from '@/editor/theme';
import { aiApi } from '@/lib/api';
import { useStore } from '@/lib/store';
import { toast } from '@/components/ui/Toasts';

export interface AiMessage {
  role: 'user' | 'assistant';
  content: string;
  kind?: 'analysis-prompt' | 'analysis-answer';
}

interface AnalysisTarget {
  path: string;
  language: string;
  content: string;
  selection: string;
  startLine: number;
  endLine: number;
}

interface AiState {
  messages: AiMessage[];
  streaming: boolean;
  target: string | null;
  context: { role: 'user'; content: string } | null;
  runAnalysis: () => void;
  runDiff: (scope: 'hunk' | 'file') => void;
  send: (text: string) => void;
  clear: () => void;
}

function collectTarget(): AnalysisTarget | null {
  const tab = editorManager.active;
  const ed = editorManager.editor;
  if (!tab || tab.kind !== 'file' || !ed) return null;
  const model = tab.model;
  const content = model.getValue();
  if (!content.trim()) return null;
  const sel = ed.getSelection();
  const selection = sel && !sel.isEmpty() ? model.getValueInRange(sel) : '';
  return {
    path: tab.path,
    language: model.getLanguageId?.() || languageFor(tab.path) || '',
    content,
    selection,
    startLine: sel?.startLineNumber || 1,
    endLine: sel?.endLineNumber || 1,
  };
}

function fenced(lang: string, text: string) {
  return `\`\`\`${lang}\n${text || '(empty)'}\n\`\`\``;
}

function startStream(set: (p: Partial<AiState>) => void, get: () => AiState, label: string, context: string | null, request: (onDelta: (t: string) => void) => Promise<string>) {
  set({
    streaming: true,
    target: label,
    context: context ? { role: 'user', content: context } : null,
    messages: [
      { role: 'user', content: label, kind: 'analysis-prompt' },
      { role: 'assistant', content: '', kind: 'analysis-answer' },
    ],
  });
  request((delta) => {
    const messages = [...get().messages];
    const last = messages[messages.length - 1];
    messages[messages.length - 1] = { ...last, content: last.content + delta };
    set({ messages });
  })
    .catch((err) => {
      const messages = [...get().messages];
      const last = messages[messages.length - 1];
      messages[messages.length - 1] = { ...last, content: last.content || `⚠ ${err.message}` };
      set({ messages });
    })
    .finally(() => set({ streaming: false }));
}

const sliceLines = (lines: string[], start: number, end: number) => (start <= 0 || end <= 0 ? '' : lines.slice(start - 1, Math.max(start - 1, end)).join('\n'));

export const useAiStore = create<AiState>((set, get) => ({
  messages: [],
  streaming: false,
  target: null,
  context: null,

  runAnalysis: () => {
    if (get().streaming) return;
    const t = collectTarget();
    if (!t) {
      toast('AI Analyze', 'Open a file with content first', 'error');
      return;
    }
    useStore.getState().showTool('ai');
    const hasSel = !!t.selection.trim();
    const name = t.path.split('/').pop();
    const label = hasSel ? `Analyze ${name}:${t.startLine}-${t.endLine}` : `Analyze ${name} (whole file)`;
    startStream(set, get, label, `File: ${t.path}${t.language ? ` (${t.language})` : ''}\nSelected lines: ${t.startLine}-${t.endLine}\n\n${fenced(t.language, t.content)}`, (onDelta) =>
      aiApi.analyze({ path: t.path, content: t.content, selection: t.selection, selectionStartLine: t.startLine, selectionEndLine: t.endLine, language: t.language }, onDelta),
    );
  },

  runDiff: (scope) => {
    if (get().streaming) return;
    const tab = editorManager.active;
    if (!tab || tab.kind !== 'diff' || !tab.original) {
      toast('AI Diff', 'Open a changed file in the diff viewer first', 'error');
      return;
    }
    const beforeModel = tab.original;
    const afterModel = tab.model;
    const language = afterModel.getLanguageId?.() || languageFor(tab.path) || '';
    const name = tab.path.split('/').pop();
    let before = beforeModel.getValue();
    let after = afterModel.getValue();
    let label = `Explain changes in ${name} (all changes)`;
    if (scope === 'hunk') {
      const changes = editorManager.diffEditor.getLineChanges() || [];
      const pos = editorManager.diffEditor.getModifiedEditor().getPosition();
      const line = pos?.lineNumber || 1;
      let best: any = null;
      let bestDist = Infinity;
      for (const c of changes) {
        const s = c.modifiedStartLineNumber || 0;
        const e = c.modifiedEndLineNumber || s;
        if (line >= s && line <= Math.max(s, e)) {
          best = c;
          break;
        }
        const d = Math.min(Math.abs(line - s), Math.abs(line - Math.max(s, e)));
        if (d < bestDist) {
          bestDist = d;
          best = c;
        }
      }
      if (!best) {
        toast('AI Diff', 'No changes found in this file', 'error');
        return;
      }
      const beforeLines = before.split('\n');
      const afterLines = after.split('\n');
      before = sliceLines(beforeLines, best.originalStartLineNumber, best.originalEndLineNumber);
      after = sliceLines(afterLines, best.modifiedStartLineNumber, best.modifiedEndLineNumber);
      label = `Explain change in ${name}:${best.modifiedStartLineNumber}`;
    }
    useStore.getState().showTool('ai');
    startStream(set, get, label, `File: ${tab.path}${language ? ` (${language})` : ''}\nBEFORE:\n${fenced(language, before)}\n\nAFTER:\n${fenced(language, after)}`, (onDelta) =>
      aiApi.diff({ path: tab.path, language, before, after, scope }, onDelta),
    );
  },

  send: (text) => {
    const trimmed = text.trim();
    if (!trimmed || get().streaming) return;
    const prior = get().messages.map((m) => ({ role: m.role, content: m.content }));
    set({
      streaming: true,
      messages: [...get().messages, { role: 'user', content: trimmed }, { role: 'assistant', content: '' }],
    });
    const context = get().context;
    const payload = [...(context ? [context] : []), ...prior, { role: 'user', content: trimmed }];
    aiApi
      .chat(payload, (delta) => {
        const messages = [...get().messages];
        const last = messages[messages.length - 1];
        messages[messages.length - 1] = { ...last, content: last.content + delta };
        set({ messages });
      })
      .catch((err) => {
        const messages = [...get().messages];
        const last = messages[messages.length - 1];
        messages[messages.length - 1] = { ...last, content: `⚠ ${err.message}` };
        set({ messages });
      })
      .finally(() => set({ streaming: false }));
  },

  clear: () => {
    if (get().streaming) return;
    set({ messages: [], context: null, target: null });
  },
}));
