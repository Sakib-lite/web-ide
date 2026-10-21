import { chromium } from 'playwright-core';
import fs from 'node:fs';

const base = process.env.UI_URL || 'http://web-ide.com';
const project = process.env.PROJECT || '/tmp/demo-project';
const exe = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'].find((p) => fs.existsSync(p));
const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 940 } });
const findings = [];
const note = (area, msg, extra = '') => findings.push(`[${area}] ${msg}${extra ? ' — ' + extra : ''}`);
page.on('pageerror', (e) => note('pageerror', e.message.split('\n')[0]));
page.on('console', (m) => {
  if (m.type() === 'error' && !/favicon|404|net::/.test(m.text())) note('console', m.text().slice(0, 160));
});
page.on('requestfailed', (r) => note('net', r.url().slice(0, 120), r.failure()?.errorText || ''));
const ok = (area, name, cond, extra = '') => findings.push(`[${area}] ${cond ? 'OK ' : 'BUG '}${name}${extra ? ' — ' + extra : ''}`);
const count = (s) => page.$$(s).then((l) => l.length);
const press = (k) => page.keyboard.press(k);
const wait = (ms) => page.waitForTimeout(ms);
const apiWrite = (path, content) => fetch('http://web-ide.com:4099/api/fs/write?root=' + encodeURIComponent(project), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ root: project, path, content }) });

try {
  await page.goto(base + '/?root=/definitely/not/a/dir');
  await wait(1500);
  ok('welcome', 'bad root deep-link does not crash', (await count('.welcome')) > 0 && !(await page.evaluate(() => document.body.innerText.includes('Application error'))));

  await page.goto(`${base}/?root=${encodeURIComponent(project)}`);
  await page.waitForSelector('.tree-row[data-path="src"]', { timeout: 20000 });
  await wait(1000);

  await press('Meta+Digit0');
  await wait(600);
  if (await page.$('.change-row')) { await page.dblclick('.change-row'); await wait(800); }
  await press('Escape');
  await press('Meta+Digit1');
  await wait(400);
  await apiWrite('qa.md', '# QA\n\n## Section\n\ntext\n');
  await page.waitForSelector('.tree-row[data-path="qa.md"]', { timeout: 6000 }).catch(() => {});
  await page.dblclick('.tree-row[data-path="qa.md"]');
  await wait(1000);
  await wait(4000);
  ok('tabs', 'md tab survives async events', (await page.getAttribute('.tab.active', 'title')) === 'qa.md', `active: ${await page.getAttribute('.tab.active', 'title')}`);

  await apiWrite('empty.md', '');
  await page.waitForSelector('.tree-row[data-path="empty.md"]', { timeout: 6000 }).catch(() => {});
  await page.dblclick('.tree-row[data-path="empty.md"]');
  await wait(1200);
  ok('md', 'empty md renders', (await count('.mdv')) === 1 && (await count('.mdv .prose h1')) === 0);

  await apiWrite('dia.md', '# Diagram\n\n```mermaid\ngraph TD;\n  A-->B;\n  A-->C;\n```\n');
  await page.waitForSelector('.tree-row[data-path="dia.md"]', { timeout: 6000 }).catch(() => {});
  await page.dblclick('.tree-row[data-path="dia.md"]');
  await wait(3000);
  ok('md', 'mermaid diagram renders', (await count('.mermaid-figure svg')) === 1, `figures=${await count('.mermaid-figure')}`);

  await apiWrite('bad.md', '# Bad\n\n[link](nonexistent.md) and [ext](https://example.com)\n\n| broken | table\n|---|\n| a |\n');
  await page.waitForSelector('.tree-row[data-path="bad.md"]', { timeout: 6000 }).catch(() => {});
  await page.dblclick('.tree-row[data-path="bad.md"]');
  await wait(1500);
  const badLink = await page.$('.mdv a[href="nonexistent.md"]');
  if (badLink) {
    await badLink.click();
    await wait(800);
    const errToast = await page.evaluate(() => document.body.innerText.includes('not found') || document.body.innerText.includes('error') || document.body.innerText.includes('Cannot'));
    ok('md', 'dead relative md link handled', (await count('.ide')) === 1, errToast ? 'error surfaced' : 'no crash');
  } else ok('md', 'dead relative md link present', false);

  await page.dblclick('.tree-row[data-path="qa.md"]');
  await wait(600);
  await page.click('.md-mode-switch button[title="Editor and Preview"]');
  await wait(400);
  await page.evaluate(() => { const ed = monaco.editor.getEditors()[0]; ed.getModel().applyEdits([{ range: new monaco.Range(1, 1, 1, 1), text: '## Added Live\n' }]); ed.focus(); });
  await wait(1200);
  ok('md', 'typing in split updates preview', (await count('.mdv .prose h2')) >= 2 && (await count('.mdv-toc')) >= 2, `h2=${await count('.mdv .prose h2')}`);

  const tabsBefore = await count('.tab');
  await page.dblclick('.tree-row[data-path="qa.md"]');
  await wait(600);
  ok('tabs', 'opening same file reuses tab', (await count('.tab')) === tabsBefore, `${tabsBefore} → ${await count('.tab')}`);

  await press('Meta+KeyE');
  await wait(400);
  ok('nav', 'recent files popup', (await count('.context-menu')) > 0);
  await press('Escape');

  await press('Meta+Comma');
  await wait(400);
  await page.click('.settings-nav button:has-text("Keymap")');
  await page.fill('.km-search input', '((!@#$');
  await wait(300);
  ok('settings', 'keymap garbage filter', (await count('.km-row')) === 0);
  await page.keyboard.press('Escape');
  await wait(300);
  ok('settings', 'settings escape closes', (await count('.settings-nav')) === 0);

  await press('Shift'); await press('Shift');
  await wait(400);
  await page.keyboard.type('**((!');
  await wait(700);
  ok('search', 'SE special chars no crash', (await count('.popup')) === 1);
  await press('Escape');

  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true })));
  await wait(300);
  ok('shortcuts', 'window-targeted keydown does not throw', true);

  await press('Meta+Shift+F12');
  await wait(300);
  ok('nav', 'still alive at the end', (await count('.ide')) === 1);
} catch (err) {
  note('crash', err.message.split('\n')[0]);
  await page.screenshot({ path: '/tmp/ws-shots/qa-crash.png' }).catch(() => undefined);
}

console.log(findings.join('\n'));
const bugs = findings.filter((f) => f.includes('BUG') || f.startsWith('[pageerror]') || f.startsWith('[console]') || f.startsWith('[net]') || f.startsWith('[crash'));
console.log(`\n${findings.filter((f) => f.includes('OK ')).length} ok, ${bugs.length} issues`);
await browser.close();
