import type * as Monaco from 'monaco-editor';

export const THEME_NAME = 'jetbrains-dark';

export function defineTheme(monaco: typeof Monaco) {
  monaco.editor.defineTheme(THEME_NAME, {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: '', foreground: 'bcbec4', background: '1e1f22' },
      { token: 'comment', foreground: '7a7e85', fontStyle: 'italic' },
      { token: 'keyword', foreground: 'cf8e6d' },
      { token: 'string', foreground: '6aab73' },
      { token: 'string.key.json', foreground: 'c77dbb' },
      { token: 'string.value.json', foreground: '6aab73' },
      { token: 'number', foreground: '2aacb8' },
      { token: 'regexp', foreground: '42c3d2' },
      { token: 'type', foreground: 'bcbec4' },
      { token: 'identifier', foreground: 'bcbec4' },
      { token: 'variable', foreground: 'c77dbb' },
      { token: 'delimiter', foreground: 'bcbec4' },
      { token: 'tag', foreground: 'd5b778' },
      { token: 'metatag', foreground: 'd5b778' },
      { token: 'metatag.php', foreground: 'cf8e6d' },
      { token: 'attribute.name', foreground: 'bcbec4' },
      { token: 'attribute.value', foreground: '6aab73' },
      { token: 'constant', foreground: 'c77dbb' },
      { token: 'annotation', foreground: 'b3ae60' },
      { token: 'predefined', foreground: '8888c6' },
      { token: 'key', foreground: 'c77dbb' },
      { token: 'string.escape', foreground: 'cf8e6d' },
    ],
    colors: {
      'editor.background': '#1e1f22', 'editor.foreground': '#bcbec4',
      'editor.lineHighlightBackground': '#26282e', 'editor.lineHighlightBorder': '#26282e',
      'editor.selectionBackground': '#214283', 'editor.inactiveSelectionBackground': '#2a3550',
      'editor.selectionHighlightBackground': '#2d3a55', 'editor.wordHighlightBackground': '#344134', 'editor.wordHighlightStrongBackground': '#40332b',
      'editor.findMatchBackground': '#6b5a2a', 'editor.findMatchHighlightBackground': '#4b4420',
      'editorLineNumber.foreground': '#4b5059', 'editorLineNumber.activeForeground': '#a1a3ab',
      'editorCursor.foreground': '#ced0d6', 'editorWhitespace.foreground': '#3b3e45',
      'editorIndentGuide.background1': '#313438', 'editorIndentGuide.activeBackground1': '#4b5059',
      'editorGutter.background': '#1e1f22', 'editorOverviewRuler.border': '#1e1f22',
      'editorWidget.background': '#2b2d30', 'editorWidget.border': '#393b40',
      'editorSuggestWidget.background': '#2b2d30', 'editorSuggestWidget.border': '#393b40', 'editorSuggestWidget.selectedBackground': '#2e436e',
      'editorHoverWidget.background': '#2b2d30', 'editorHoverWidget.border': '#393b40',
      'editorBracketMatch.background': '#3b514d', 'editorBracketMatch.border': '#3b514d',
      'editorBracketHighlight.foreground1': '#d5b778', 'editorBracketHighlight.foreground2': '#c77dbb', 'editorBracketHighlight.foreground3': '#56a8f5',
      'scrollbarSlider.background': '#ffffff22', 'scrollbarSlider.hoverBackground': '#ffffff40', 'scrollbarSlider.activeBackground': '#ffffff55',
      'minimap.background': '#1e1f22', 'editorStickyScroll.background': '#1e1f22', 'editorStickyScroll.shadow': '#00000055',
      'diffEditor.insertedTextBackground': '#294436', 'diffEditor.removedTextBackground': '#484a4a', 'diffEditor.insertedLineBackground': '#29443655', 'diffEditor.removedLineBackground': '#484a4a55',
      'peekView.border': '#3574f0', 'peekViewEditor.background': '#26282e', 'peekViewResult.background': '#2b2d30', 'peekViewTitle.background': '#2b2d30',
      'input.background': '#1e1f22', 'input.border': '#393b40', focusBorder: '#3574f0',
      'list.hoverBackground': '#35373b', 'list.activeSelectionBackground': '#2e436e', 'list.focusBackground': '#2e436e',
    },
  });
}

export function configureTypescript(monaco: typeof Monaco) {
  const ts = (monaco.languages as any).typescript;
  for (const defaults of [ts.javascriptDefaults, ts.typescriptDefaults]) {
    defaults.setCompilerOptions({ allowJs: true, checkJs: false, allowNonTsExtensions: true, target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.NodeJs, jsx: ts.JsxEmit.Preserve, esModuleInterop: true, noEmit: true });
    defaults.setDiagnosticsOptions({ noSemanticValidation: true, noSyntaxValidation: false });
    defaults.setEagerModelSync(true);
    defaults.setModeConfiguration({ ...defaults.modeConfiguration, definitions: false });
  }
}

const LANGUAGES: Record<string, string> = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript', php: 'php', phtml: 'php', inc: 'php',
  py: 'python', pyw: 'python', pyi: 'python', json: 'json', html: 'html', htm: 'html', vue: 'html', css: 'css', scss: 'scss', less: 'less', md: 'markdown',
  yml: 'yaml', yaml: 'yaml', sh: 'shell', bash: 'shell', zsh: 'shell', sql: 'sql', xml: 'xml', svg: 'xml', env: 'ini', ini: 'ini', toml: 'ini', dockerfile: 'dockerfile', rb: 'ruby', go: 'go', java: 'java',
};

export function languageFor(path: string): string {
  const name = path.split('/').pop()!.toLowerCase();
  if (name.endsWith('.blade.php')) return 'php';
  if (name === 'dockerfile') return 'dockerfile';
  if (name.startsWith('.env')) return 'ini';
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : '';
  return LANGUAGES[ext] || 'plaintext';
}
