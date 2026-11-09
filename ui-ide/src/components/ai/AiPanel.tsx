'use client';

import { useEffect, useRef, useState } from 'react';
import { useAiStore } from './ai-store';
import { ToolHeader } from '@/components/layout/ToolPanel';
import { Icon } from '@/components/ui/Icon';

let libsPromise: Promise<void> | null = null;
function loadLibs() {
  if (!libsPromise) {
    libsPromise = Promise.all([
      fetch('/vendor/marked.min.js').then((r) => r.text()).then((t) => (new Function('define', 'module', 'exports', t)).call(window, undefined, undefined, undefined)),
      fetch('/vendor/purify.min.js').then((r) => r.text()).then((t) => (new Function('define', 'module', 'exports', t)).call(window, undefined, undefined, undefined)),
    ]).then(() => undefined);
  }
  return libsPromise;
}

function renderMarkdown(source: string): string {
  const marked = (window as any).marked;
  const DOMPurify = (window as any).DOMPurify;
  if (!marked || !DOMPurify) return '';
  marked.setOptions({ gfm: true, breaks: false });
  return DOMPurify.sanitize(marked.parse(source || ''));
}

function AssistantBody({ content }: { content: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(!!(window as any).marked);
  useEffect(() => {
    if (ready) return;
    loadLibs().then(() => setReady(true)).catch(() => setReady(true));
  }, [ready]);
  useEffect(() => {
    if (ref.current) ref.current.innerHTML = renderMarkdown(content);
  }, [content, ready]);
  return <div ref={ref} className="ai-md prose" />;
}

export function AiPanel() {
  const { messages, streaming, target, runAnalysis, send, clear } = useAiStore();
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages]);
  const onScroll = () => {
    const el = scrollRef.current;
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };
  const submit = () => {
    if (!input.trim() || streaming) return;
    send(input);
    setInput('');
    stick.current = true;
  };
  return (
    <div className="ai-panel">
      <ToolHeader id="ai" title={target ? `AI Assistant · ${target}` : 'AI Assistant'}>
        <button className="tb-icon sm" title="Analyze current selection (⌘⇧I)" disabled={streaming} onClick={runAnalysis}><Icon name="spark" /></button>
        <button className="tb-icon sm" title="Clear conversation" disabled={streaming || !messages.length} onClick={clear}><Icon name="close" /></button>
      </ToolHeader>
      <div ref={scrollRef} className="ai-msgs" onScroll={onScroll}>
        {!messages.length && (
          <div className="ai-empty">
            <Icon name="spark" />
            <p>Select code in the editor and press <kbd>⌘⇧I</kbd> to analyze it, or click the spark button above.</p>
            <p className="ai-empty-sub">Configure the model and API key in Settings → AI.</p>
          </div>
        )}
        {messages.map((m, i) =>
          m.role === 'user' ? (
            <div key={i} className={`ai-msg user${m.kind === 'analysis-prompt' ? ' prompt' : ''}`}>{m.content}</div>
          ) : (
            <div key={i} className={`ai-msg assistant${m.kind === 'analysis-answer' ? ' answer' : ''}`}>
              {m.content ? <AssistantBody content={m.content} /> : <span className="ai-thinking">thinking…</span>}
              {streaming && i === messages.length - 1 && !!m.content && <span className="ai-caret" />}
            </div>
          ),
        )}
      </div>
      <div className="ai-input">
        <textarea
          value={input}
          placeholder={target ? 'Ask about this code…' : 'Press ⌘⇧I in the editor to analyze code first…'}
          rows={2}
          disabled={streaming}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <button className="btn primary ai-send" disabled={streaming || !input.trim()} onClick={submit}>Send</button>
      </div>
    </div>
  );
}
