import path from 'node:path';

export const APP_ROOT = path.resolve(__dirname, '..', '..');
export const ROOT_DIR = path.resolve(APP_ROOT, '..');
export const DATA_DIR = path.join(ROOT_DIR, 'personal-data');
export const PLUGIN_DIRS = [path.join(APP_ROOT, 'plugins'), path.join(DATA_DIR, 'plugins')];
export const ASKPASS = path.join(APP_ROOT, 'scripts', 'git-askpass.sh');
export const PORT = Number(process.env.PORT || 4099);
export const IDE_TOKEN = process.env.IDE_TOKEN || '';
export const UI_ORIGINS = (process.env.UI_ORIGIN || 'http://web-ide.com,http://web-ide.com:3099,http://localhost:3099,http://127.0.0.1:3099').split(',').map((s) => s.trim());
