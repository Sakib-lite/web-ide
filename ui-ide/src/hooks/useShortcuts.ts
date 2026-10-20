import { useEffect } from 'react';
import { useStore } from '@/lib/store';
import { isMac } from '@/lib/utils';
import { editorManager } from '@/editor/editor-manager';
import { openSearchEverywhere } from '@/components/search/SearchEverywhere';
import { findUsages, openFindInFiles } from '@/components/search/search-actions';
import { focusCommitMessage } from '@/components/git/commit-actions';
import { newBranchDialog, pushDialog, updateProject } from '@/components/vcs/vcs-actions';
import { openSettingsDialog } from '@/components/github/SettingsDialog';
import { createNode } from '@/components/project/tree-actions';
import { openRecentFiles } from '@/lib/actions';
import { cycleMdMode } from '@/components/markdown/MarkdownPreview';
import { isDialogOpen } from '@/components/ui/dialogs';

const TOOL_KEYS: Record<string, string> = { Digit1: 'project', Digit0: 'commit', Digit7: 'structure', Digit9: 'git', Digit3: 'find' };

export function useShortcuts() {
  useEffect(() => {
    let lastShift = 0, shiftOnly = true;
    const onKeyDown = (e: KeyboardEvent) => {
      const cmd = isMac ? e.metaKey : e.ctrlKey;
      const { toggleTool, showTool, hideAllTools, hideTool, tools, toolDefs } = useStore.getState();
      const target = e.target instanceof Element ? e.target : document.body;
      const inEditor = !!target.closest('.monaco-editor');
      const inField = !!target.closest('input, textarea');
      if (e.key !== 'Shift') shiftOnly = false;
      if (e.key === 'Shift' && !e.repeat) shiftOnly = true;
      const handle = (fn: () => void) => {
        e.preventDefault();
        fn();
      };
      if (cmd && !e.shiftKey && !e.altKey) {
        if (TOOL_KEYS[e.code]) return handle(() => toggleTool(TOOL_KEYS[e.code]));
        if (e.code === 'KeyS') return handle(() => editorManager.saveAll());
        if (e.code === 'KeyN' && !inEditor && !inField) return handle(() => createNode(null, 'file'));
        if (e.code === 'KeyO') return handle(() => openSearchEverywhere('symbols'));
        if (e.code === 'KeyK') return handle(focusCommitMessage);
        if (e.code === 'KeyT') return handle(() => updateProject());
        if (e.code === 'Comma') return handle(() => openSettingsDialog());
        if (e.code === 'Equal') return handle(() => editorManager.changeFontSize(1));
        if (e.code === 'Minus') return handle(() => editorManager.changeFontSize(-1));
        if (e.code === 'KeyE') return handle(openRecentFiles);
        if (e.code === 'F12') return handle(() => showTool('structure'));
        if (e.code === 'F4') return handle(() => { const a = editorManager.active; if (a) editorManager.closeTab(a.key); });
        if (e.code === 'KeyL' && !inEditor) return handle(() => { editorManager.editor?.focus(); editorManager.trigger('editor.action.gotoLine'); });
        if (e.code === 'BracketLeft' && !inEditor) return handle(() => editorManager.navigate(-1));
        if (e.code === 'BracketRight' && !inEditor) return handle(() => editorManager.navigate(1));
      }
      if (cmd && e.shiftKey && !e.altKey) {
        if (e.code === 'KeyF') return handle(() => openFindInFiles(editorManager.selectedText()));
        if (e.code === 'KeyV') return handle(() => cycleMdMode());
        if (e.code === 'KeyO' || e.code === 'KeyN') return handle(() => openSearchEverywhere('files'));
        if (e.code === 'KeyA') return handle(() => openSearchEverywhere('actions'));
        if (e.code === 'KeyK') return handle(() => pushDialog());
        if (e.code === 'KeyC' && toolDefs.some((d) => d.id === 'claude-code')) return handle(() => toggleTool('claude-code'));
        if (e.code === 'F12') return handle(hideAllTools);
        if (e.code === 'BracketLeft') return handle(() => editorManager.nextTab(-1));
        if (e.code === 'BracketRight') return handle(() => editorManager.nextTab(1));
      }
      if (cmd && e.altKey && !e.shiftKey) {
        if (e.code === 'KeyO') return handle(() => openSearchEverywhere('symbols'));
        if (e.code === 'KeyN') return handle(() => newBranchDialog());
        if (e.code === 'ArrowLeft' && !inEditor) return handle(() => editorManager.navigate(-1));
        if (e.code === 'ArrowRight' && !inEditor) return handle(() => editorManager.navigate(1));
        if (e.code === 'F7') return handle(() => editorManager.trigger('editor.action.referenceSearch.trigger'));
      }
      if (e.altKey && !cmd && e.code === 'F7') return handle(() => { const w = editorManager.currentWord(); if (w) findUsages(w, editorManager.active?.path); });
      if (e.altKey && e.code === 'F12') return handle(() => toggleTool('terminal'));
      if (e.shiftKey && e.key === 'Escape') {
        const side = tools.open.bottom ? 'bottom' : tools.open.right ? 'right' : tools.open.left ? 'left' : null;
        if (side && tools.active[side]) return handle(() => hideTool(tools.active[side]!));
      }
      if (e.key === 'Escape' && !inEditor && !inField && !isDialogOpen() && !document.querySelector('.context-menu')) editorManager.editor?.focus();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key !== 'Shift') return;
      const now = Date.now();
      if (shiftOnly && now - lastShift < 350 && !isDialogOpen()) {
        const sel = editorManager.selectedText().split('\n')[0].trim().slice(0, 80);
        openSearchEverywhere('all', sel);
        lastShift = 0;
        return;
      }
      lastShift = shiftOnly ? now : 0;
    };
    addEventListener('keydown', onKeyDown, true);
    addEventListener('keyup', onKeyUp, true);
    return () => {
      removeEventListener('keydown', onKeyDown, true);
      removeEventListener('keyup', onKeyUp, true);
    };
  }, []);
}
