const { cpSync, existsSync, mkdirSync } = require('node:fs');
const { join } = require('node:path');

const sources = ['node_modules/monaco-editor/min/vs', '../node_modules/monaco-editor/min/vs'];
const target = join('public', 'monaco', 'vs');
for (const src of sources) {
  if (!existsSync(src)) continue;
  mkdirSync(target, { recursive: true });
  cpSync(src, target, { recursive: true });
  break;
}
