import type * as Monaco from 'monaco-editor';
import type { editorManager as Manager } from './editor-manager';
import { emit } from '@/lib/bus';
import { isOnDeclaration } from './intellisense';

export function registerKeymap(monaco: typeof Monaco, manager: typeof Manager) {
  const { editor, diffEditor } = manager;
  const M = monaco.KeyMod, C = monaco.KeyCode;
  const act = (id: string, label: string, keys: number[], run: string | ((ed: Monaco.editor.ICodeEditor) => void)) =>
    editor.addAction({ id: 'jb.' + id, label, keybindings: keys, run: typeof run === 'string' ? (ed) => ed.trigger('jb', run, null) : run });

  act('goto', 'Go to Declaration or Usages', [M.CtrlCmd | C.KeyB, M.CtrlCmd | M.Alt | C.KeyB], async (ed) => {
    if (await isOnDeclaration(ed.getModel()!, ed.getPosition()!)) return ed.trigger('jb', 'editor.action.referenceSearch.trigger', null);
    manager.noteLocation();
    ed.trigger('jb', 'editor.action.revealDefinition', null);
  });
  act('save', 'Save', [M.CtrlCmd | C.KeyS], () => manager.saveActive());
  act('format', 'Reformat Code', [M.CtrlCmd | M.Alt | C.KeyL], 'editor.action.formatDocument');
  act('closeTab', 'Close Tab', [M.CtrlCmd | M.Shift | C.KeyW], () => manager.active && manager.closeTab(manager.active.key));
  act('blame', 'Annotate with Git Blame', [], () => manager.toggleBlame());
  act('history', 'Show Git History for File', [], () => manager.active && emit('log-filter-path', { path: manager.active.path }));
  act('dupLine', 'Duplicate Line or Selection', [M.CtrlCmd | C.KeyD], 'editor.action.copyLinesDownAction');
  act('deleteLine', 'Delete Line', [M.CtrlCmd | C.Backspace, M.CtrlCmd | C.KeyY], 'editor.action.deleteLines');
  act('moveUp', 'Move Line Up', [M.Shift | M.Alt | C.UpArrow], 'editor.action.moveLinesUpAction');
  act('moveDown', 'Move Line Down', [M.Shift | M.Alt | C.DownArrow], 'editor.action.moveLinesDownAction');
  act('extendSel', 'Extend Selection', [M.Alt | C.UpArrow], 'editor.action.smartSelect.expand');
  act('shrinkSel', 'Shrink Selection', [M.Alt | C.DownArrow], 'editor.action.smartSelect.shrink');
  act('gotoLine', 'Go to Line:Column', [M.CtrlCmd | C.KeyL], 'editor.action.gotoLine');
  act('replace', 'Replace', [M.CtrlCmd | C.KeyR], 'editor.action.startFindReplaceAction');
  act('toggleCase', 'Toggle Case', [M.CtrlCmd | M.Shift | C.KeyU], (ed) => {
    const text = ed.getModel()!.getValueInRange(ed.getSelection()!);
    ed.trigger('jb', text === text.toUpperCase() ? 'editor.action.transformToLowercase' : 'editor.action.transformToUppercase', null);
  });
  act('complete', 'Basic Completion', [M.WinCtrl | C.Space], 'editor.action.triggerSuggest');
  act('paramInfo', 'Parameter Info', [M.CtrlCmd | C.KeyP], 'editor.action.triggerParameterHints');
  act('quickDoc', 'Quick Documentation', [C.F1, M.WinCtrl | C.KeyJ], 'editor.action.showHover');
  act('intention', 'Show Intention Actions', [M.Alt | C.Enter], 'editor.action.quickFix');
  act('rename', 'Rename…', [M.Shift | C.F6], 'editor.action.rename');
  act('usagesPopup', 'Show Usages', [M.CtrlCmd | M.Alt | C.F7], 'editor.action.referenceSearch.trigger');
  act('findUsages', 'Find Usages', [M.Alt | C.F7], () => {
    const word = manager.currentWord();
    if (word) emit('find-usages', { word, file: manager.active?.path });
  });
  act('back', 'Back', [M.CtrlCmd | M.Alt | C.LeftArrow, M.CtrlCmd | C.BracketLeft], () => manager.navigate(-1));
  act('forward', 'Forward', [M.CtrlCmd | M.Alt | C.RightArrow, M.CtrlCmd | C.BracketRight], () => manager.navigate(1));
  act('commentLine', 'Comment with Line Comment', [M.CtrlCmd | C.Slash], 'editor.action.commentLine');
  act('blockComment', 'Comment with Block Comment', [M.CtrlCmd | M.Alt | C.Slash], 'editor.action.blockComment');
  act('reformatSel', 'Reformat Selection', [M.CtrlCmd | M.Alt | M.Shift | C.KeyL], 'editor.action.formatSelection');
  act('selectWord', 'Select Next Occurrence', [M.WinCtrl | C.KeyG], 'editor.action.addSelectionToNextFindMatch');
  act('joinLines', 'Join Lines', [M.WinCtrl | M.Shift | C.KeyJ], 'editor.action.joinLines');
  act('foldAll', 'Collapse All', [M.CtrlCmd | M.Shift | C.Minus], 'editor.foldAll');
  act('unfoldAll', 'Expand All', [M.CtrlCmd | M.Shift | C.Equal], 'editor.unfoldAll');
  act('fold', 'Collapse', [M.CtrlCmd | C.Minus], 'editor.fold');
  act('unfold', 'Expand', [M.CtrlCmd | C.Equal], 'editor.unfold');
  act('completeStatement', 'Complete Current Statement', [M.CtrlCmd | M.Shift | C.Enter], (ed) => completeStatement(monaco, ed));

  diffEditor.addAction({ id: 'jb.diff.next', label: 'Next Difference', keybindings: [C.F7], run: () => diffEditor.goToDiff('next') });
  diffEditor.addAction({ id: 'jb.diff.prev', label: 'Previous Difference', keybindings: [M.Shift | C.F7], run: () => diffEditor.goToDiff('previous') });
  diffEditor.addAction({ id: 'jb.diff.source', label: 'Jump to Source', keybindings: [C.F4], run: () => emit('diff-jump-to-source') });
}

function completeStatement(monaco: typeof Monaco, ed: Monaco.editor.ICodeEditor) {
  const model = ed.getModel()!;
  const pos = ed.getPosition()!;
  const line = model.getLineContent(pos.lineNumber);
  const lang = model.getLanguageId();
  const needsSemi = ['php', 'javascript', 'typescript'].includes(lang) && !/[;{}\s]$/.test(line.trimEnd()) && !/^\s*(if|for|while|function|class|else|switch|try|catch)\b/.test(line);
  ed.executeEdits('jb', [{ range: new monaco.Range(pos.lineNumber, line.length + 1, pos.lineNumber, line.length + 1), text: (needsSemi ? ';' : '') + '\n' }]);
  ed.setPosition({ lineNumber: pos.lineNumber + 1, column: 1 });
  ed.trigger('jb', 'editor.action.reindentselectedlines', null);
}
