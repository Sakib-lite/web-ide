import path from 'node:path';

export const APP_ROOT = path.resolve(__dirname, '..', '..');
export const DATA_DIR = path.join(APP_ROOT, 'data');
export const PLUGIN_DIRS = [path.join(APP_ROOT, 'plugins'), path.join(DATA_DIR, 'plugins')];
export const ASKPASS = path.join(APP_ROOT, 'scripts', 'git-askpass.sh');
export const PORT = Number(process.env.PORT || 4000);
export const IDE_TOKEN = process.env.IDE_TOKEN || '';
export const UI_ORIGINS = (process.env.UI_ORIGIN || 'http://localhost:3000,http://127.0.0.1:3000').split(',').map((s) => s.trim());
