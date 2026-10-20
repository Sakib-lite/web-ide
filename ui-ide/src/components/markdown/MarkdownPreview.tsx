'use client';

import { useEffect, useRef, useState } from 'react';
import { editorManager } from '@/editor/editor-manager';
import { Icon } from '@/components/ui/Icon';
import { readLocal, writeLocal } from '@/lib/utils';

const EXT = /\.(md|markdown|mdx)$/i;
export const isMarkdown = (path: string) => EXT.test(path);

export type MdMode = 'editor' | 'split' | 'preview';
export const mdMode = () => readLocal<MdMode>('ide.md-mode', 'preview');
export function setMdMode(mode: MdMode) {
  writeLocal('ide.md-mode', mode);
  window.dispatchEvent(new CustomEvent('md-preview-changed'));
}
export const cycleMdMode = () => setMdMode(mdMode() === 'preview' ? 'editor' : mdMode() === 'editor' ? 'split' : 'preview');

let libsPromise: Promise<void> | null = null;
async function loadUmd(src: string) {
  const text = await fetch(src).then((r) => {
    if (!r.ok) throw new Error(src + ' → HTTP ' + r.status);
    return r.text();
  });
  (new Function('define', 'module', 'exports', text)).call(window, undefined, undefined, undefined);
}
const loadCss = (href: string) => {
  if (!document.querySelector(`link[href="${href}"]`)) document.head.append(Object.assign(document.createElement('link'), { rel: 'stylesheet', href }));
};
function loadLibs() {
  if (!libsPromise) {
    loadCss('/vendor/atom-one-dark.min.css');
    libsPromise = Promise.all([loadUmd('/vendor/marked.min.js'), loadUmd('/vendor/purify.min.js'), loadUmd('/vendor/highlight.min.js')]).then(() => undefined);
  }
  return libsPromise;
}

const loadGlobalScript = async (src: string) => {
  const hadDefine = (window as any).define;
  (window as any).define = undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) return resolve();
      const s = document.createElement('script');
      s.src = src;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error(src + ' failed to load'));
      document.head.append(s);
    });
  } finally {
    (window as any).define = hadDefine;
  }
};
let mermaidPromise: Promise<any> | null = null;
const ensureMermaid = () => {
  if (!mermaidPromise) mermaidPromise = loadGlobalScript('/vendor/mermaid.min.js').then(() => (window as any).mermaid);
  return mermaidPromise;
};

async function renderMermaidBlocks(prose: HTMLElement) {
  const blocks = [...prose.querySelectorAll<HTMLElement>('pre > code.language-mermaid')];
  if (!blocks.length) return;
  try {
    const mermaid = await ensureMermaid();
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'dark' });
    for (const code of blocks) {
      const { svg } = await mermaid.render('mmd-' + Math.random().toString(36).slice(2), code.textContent || '');
      const fig = document.createElement('figure');
      fig.className = 'mermaid-figure';
      fig.innerHTML = svg;
      code.closest('pre')?.replaceWith(fig);
    }
  } catch {
  }
}

function slugify(text: string, used: Set<string>) {
  const base = text.toLowerCase().replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 's';
  let slug = base;
  let i = 2;
  while (used.has(slug)) slug = base + '-' + i++;
  used.add(slug);
  return slug;
}

function renderMarkdownInto(prose: HTMLElement, source: string, openRelative: (spec: string) => void): { id: string; text: string; level: number }[] {
  const marked = (window as any).marked;
  const DOMPurify = (window as any).DOMPurify;
  const hljs = (window as any).hljs;
  marked.setOptions({ gfm: true, breaks: false });
  prose.innerHTML = DOMPurify.sanitize(marked.parse(source || ''));

  const used = new Set<string>();
  prose.querySelectorAll('h1, h2, h3, h4').forEach((h) => {
    h.id = slugify(h.textContent || '', used);
  });

  prose.querySelectorAll('a[href]').forEach((node) => {
    const a = node as HTMLAnchorElement;
    const href = a.getAttribute('href') || '';
    if (/^(https?:|mailto:)/i.test(href)) {
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
    } else if (/\.mdx?($|#)/i.test(href) && !href.startsWith('#')) {
      a.addEventListener('click', (e) => {
        e.preventDefault();
        openRelative(href);
      });
      a.title = 'Open ' + href;
    }
  });

  let hasMermaid = false;
  prose.querySelectorAll('pre > code').forEach((code) => {
    const lang = [...code.classList].find((c) => c.startsWith('language-'))?.slice(9) || '';
    const pre = code.parentElement!;
    if (lang === 'mermaid') {
      hasMermaid = true;
      return;
    }
    try {
      hljs.highlightElement(code);
    } catch {}
    if (lang) {
      pre.classList.add('has-lang');
      const tag = document.createElement('span');
      tag.className = 'code-lang';
      tag.textContent = lang;
      pre.append(tag);
    }
    const btn = document.createElement('button');
    btn.className = 'copy-btn';
    btn.type = 'button';
    btn.textContent = 'copy';
    btn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(code.textContent || '');
        btn.textContent = 'copied ✓';
      } catch {
        btn.textContent = 'failed';
      }
      setTimeout(() => {
        btn.textContent = 'copy';
      }, 1600);
    });
    pre.append(btn);
  });
  if (hasMermaid) renderMermaidBlocks(prose);

  return [...prose.querySelectorAll('h2, h3')].map((h) => ({ id: h.id, text: h.textContent || '', level: h.tagName === 'H2' ? 2 : 3 }));
}

export function MarkdownPreview({ path }: { path: string }) {
  const proseRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [outline, setOutline] = useState<{ id: string; text: string; level: number }[]>([]);
  const [outlineHidden, setOutlineHidden] = useState(readLocal<boolean>('ide.md-outline', false));
  const [active, setActive] = useState(-1);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let modelListener: { dispose(): void } | null = null;
    let spyFrame: number | null = null;

    const dir = path.split('/').slice(0, -1).join('/');
    const openRelative = (spec: string) => {
      const clean = spec.split('#')[0];
      editorManager.openFile(dir ? `${dir}/${clean}` : clean, { preview: false });
    };

    const render = () => {
      const prose = proseRef.current;
      const model = editorManager.editor.getModel();
      if (!prose || !model || !(window as any).marked) return;
      const headings = renderMarkdownInto(prose, model.getValue(), openRelative);
      if (!disposed) {
        setOutline(headings);
        setActive(-1);
      }
    };

    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(render, 250);
    };

    loadLibs()
      .then(() => {
        if (disposed) return;
        render();
        const model = editorManager.editor.getModel();
        if (model) modelListener = model.onDidChangeContent(schedule);
      })
      .catch(() => setFailed(true));

    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      modelListener?.dispose();
      if (spyFrame !== null) cancelAnimationFrame(spyFrame);
    };
  }, [path]);

  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    const onScroll = () => {
      requestAnimationFrame(() => {
        const prose = proseRef.current;
        if (!prose) return;
        const y = scroll.scrollTop + 120;
        let now = -1;
        outline.forEach((h, i) => {
          const el = prose.querySelector(`#${CSS.escape(h.id)}`) as HTMLElement | null;
          if (el && el.offsetTop <= y) now = i;
        });
        setActive(now);
      });
    };
    scroll.addEventListener('scroll', onScroll, { passive: true });
    return () => scroll.removeEventListener('scroll', onScroll);
  }, [outline]);

  const jump = (id: string) => proseRef.current?.querySelector(`#${CSS.escape(id)}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const toggleOutline = () => {
    const next = !outlineHidden;
    setOutlineHidden(next);
    writeLocal('ide.md-outline', next);
  };

  if (failed) return <div className="mdv-error">Markdown libraries failed to load.</div>;
  return (
    <div className="mdv">
      <div className="mdv-header">
        <Icon name="file" />
        <span className="mdv-title">Preview</span>
        <button className={`tb-icon sm${outlineHidden ? '' : ' on'}`} title={outlineHidden ? 'Show outline' : 'Hide outline'} onClick={toggleOutline}>
          <Icon name="structure" />
        </button>
      </div>
      <div className="mdv-body">
        {!outlineHidden && outline.length > 0 && (
          <nav className="mdv-outline">
            {outline.map((h, i) => (
              <button key={h.id} className={`mdv-toc l${h.level}${i === active ? ' active' : ''}`} onClick={() => jump(h.id)}>
                {h.text}
              </button>
            ))}
          </nav>
        )}
        <div ref={scrollRef} className="mdv-scroll">
          <div ref={proseRef} className="prose" />
        </div>
      </div>
    </div>
  );
}
