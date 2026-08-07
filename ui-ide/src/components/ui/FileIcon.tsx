import { extname } from '@/lib/utils';
import { Icon } from './Icon';

const EXT_CLASS: Record<string, string> = {
  js: 'js', mjs: 'js', cjs: 'js', jsx: 'jsx', ts: 'ts', tsx: 'tsx', php: 'php', phtml: 'php', py: 'py', pyw: 'py', pyi: 'py', json: 'json', html: 'html', htm: 'html',
  css: 'css', scss: 'scss', sass: 'scss', less: 'less', md: 'md', markdown: 'md', vue: 'vue', yml: 'yml', yaml: 'yaml', toml: 'toml', env: 'env',
  sh: 'sh', bash: 'sh', zsh: 'sh', sql: 'sql', png: 'img', jpg: 'img', jpeg: 'img', gif: 'img', svg: 'img', webp: 'img', ico: 'img', lock: 'lock',
};
const EXT_LABEL: Record<string, string> = { js: 'JS', mjs: 'JS', cjs: 'JS', jsx: 'JSX', ts: 'TS', tsx: 'TSX', php: 'php', phtml: 'php', py: 'py', pyw: 'py', pyi: 'py', json: '{}', html: '<>', htm: '<>', css: '#', scss: 'S', sass: 'S', less: 'L', md: 'M↓', markdown: 'M↓', vue: 'V', yml: 'Y', yaml: 'Y', toml: 'T', env: 'env', sh: '$_', bash: '$_', zsh: '$_', sql: 'SQL' };
const SPECIAL_DIRS = new Set(['src', 'app', 'lib', 'public', 'resources', 'tests', 'test', '__tests__', 'config', 'routes', 'database']);

interface Props {
  name: string;
  dir?: boolean;
  ignored?: boolean;
}

export function FileIcon({ name, dir = false, ignored = false }: Props) {
  if (dir) return <span className={`ficon folder${SPECIAL_DIRS.has(name) && !ignored ? ' special' : ''}`}><Icon name="folder" /></span>;
  const lower = name.toLowerCase();
  let ext = extname(name);
  if (lower.endsWith('.blade.php')) ext = 'php';
  if (lower.startsWith('.env')) ext = 'env';
  if (lower === '.gitignore' || lower === '.gitattributes') return <span className="ficon git">git</span>;
  if (['package-lock.json', 'composer.lock', 'yarn.lock', 'pnpm-lock.yaml'].includes(lower)) return <span className="ficon lock">🔒</span>;
  const cls = EXT_CLASS[ext];
  if (!cls) return <span className="ficon generic"><Icon name="file" /></span>;
  if (cls === 'img') return <span className="ficon img">▣</span>;
  return <span className={`ficon ${cls}`}>{EXT_LABEL[ext] || ext.slice(0, 3)}</span>;
}
