import { chromium } from 'playwright-core';
import fs from 'node:fs';

const exe = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((p) => fs.existsSync(p));
const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 940 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + String(e).slice(0, 200)));

const root = '/Users/sakib/projects/instrat/echory-agent/DEV-383/meeting-analyzer-backend';
await page.goto('http://localhost:3099/?root=' + encodeURIComponent(root));
await page.waitForSelector('#btn-branch', { timeout: 30000 });
await page.waitForFunction(() => document.querySelector('#btn-branch span')?.textContent && document.querySelector('#btn-branch span').textContent !== 'no vcs', null, { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(2500);
await page.click('#btn-branch');
await page.waitForTimeout(1500);
const state = await page.evaluate(() => {
  const popup = document.querySelector('#branch-popup');
  const groups = [...document.querySelectorAll('.bp-group span')].map((s) => s.textContent);
  const remoteHeaders = [...document.querySelectorAll('#branch-popup .bp-item.bp-indent')].map((d) => d.textContent?.trim()).filter((t) => ['origin', 'origin-pr', 'origin-prm'].includes(t || ''));
  return { popupOpen: !!popup, groups, remoteHeaders };
});
await page.screenshot({ path: '/tmp/qa-rightbar/branch-popup.png' });
console.log('state:', JSON.stringify(state));
console.log('console errors:', errors.length ? errors : 'NONE');
await browser.close();
process.exit(state.popupOpen && errors.length === 0 ? 0 : 1);
