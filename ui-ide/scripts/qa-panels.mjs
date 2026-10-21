import { chromium } from 'playwright-core';
import fs from 'node:fs';

const base = process.env.UI_URL || 'http://localhost:3099';
const project = process.env.PROJECT || '/tmp/webide-qa/proj-a';
const exe = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((p) => fs.existsSync(p));
const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 940 } });
const results = [];
const check = (name, ok, extra = '') => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);

const metrics = async () => page.evaluate(() => {
  const r = (sel) => { const el = document.querySelector(sel); if (!el) return null; const x = el.getBoundingClientRect(); return Math.round(x.width); };
  return { right: r('.tool-panel.right'), left: r('.tool-panel.left'), editor: r('.editor-area'), stripeX: Math.round(document.querySelector('.stripe-right')?.getBoundingClientRect().x || 0), vw: innerWidth };
});
const openClaude = async () => { await page.click('.stripe-right [data-tool="claude-code"]'); await page.waitForTimeout(900); };
const reloadWith = async (val) => {
  await page.evaluate((v) => localStorage.setItem('ide.rightW', v), val);
  await page.reload();
  await page.waitForSelector('.stripe-right [data-tool="claude-code"]', { timeout: 30000 });
  await page.waitForTimeout(1200);
  await openClaude();
};

try {
  await page.goto(`${base}/?root=${encodeURIComponent(project)}`);
  await page.waitForSelector('.stripe-right [data-tool="claude-code"]', { timeout: 30000 });
  await page.waitForTimeout(1500);

  await reloadWith('NaN');
  let m = await metrics();
  check('NaN stored → panel visible at sane width', m.right >= 240 && m.right <= 1200, JSON.stringify(m));
  await reloadWith('0');
  m = await metrics();
  check('0 stored → panel visible at sane width', m.right >= 240, JSON.stringify(m));
  await reloadWith('5000');
  m = await metrics();
  check('huge stored → clamped, editor keeps floor, stripe onscreen', m.right <= 1300 && m.editor >= 200 && m.stripeX < m.vw, JSON.stringify(m));

  await page.click('.tool-panel.right .tool-header-actions button[title="Hide"]');
  await page.waitForTimeout(700);
  m = await metrics();
  check('Hide collapses panel', m.right <= 2, 'w=' + m.right);
  const btn = '.stripe-right [data-tool="claude-code"]';
  await page.click(btn); await page.waitForTimeout(40); await page.click(btn); await page.waitForTimeout(40); await page.click(btn);
  await page.waitForTimeout(1100);
  m = await metrics();
  check('rapid mid-transition toggles end open and sane', m.right >= 240, 'w=' + m.right);

  await page.setViewportSize({ width: 900, height: 800 });
  await page.waitForTimeout(700);
  m = await metrics();
  const fits = 40 + m.left + m.editor + m.right + 40 <= 900;
  check('900px viewport: panels+editor fit, editor ≥ floor', fits && m.editor >= 200, JSON.stringify(m));
  check('900px viewport: stripe onscreen', m.stripeX + 40 <= 900, 'stripeX=' + m.stripeX);

  await page.setViewportSize({ width: 1600, height: 940 });
  await page.waitForTimeout(700);
  const handle = await page.$('.tool-panel.right .resizer-v');
  const hb = await handle.boundingBox();
  await page.mouse.move(hb.x + 3, hb.y + 100); await page.mouse.down();
  for (let i = 0; i < 6; i++) { await page.mouse.move(hb.x + 3 + i * 25, hb.y + 100); await page.waitForTimeout(30); }
  await page.mouse.up();
  await page.waitForTimeout(500);
  const stored = await page.evaluate(() => localStorage.getItem('ide.rightW'));
  check('drag end stores a valid int ≥ 240', /^\d+$/.test(stored || '') && +stored >= 240, 'ide.rightW=' + stored);
  await page.screenshot({ path: '/tmp/qa-rightbar/final.png' });

  for (const w of [1440, 1600]) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.waitForTimeout(600);
    await page.waitForSelector('.tree-row[data-path="test.md"]', { timeout: 15000 });
    await page.dblclick('.tree-row[data-path="test.md"]');
    await page.waitForTimeout(1200);
    for (const mode of ['Preview only', 'Editor and Preview']) {
      const sw = await page.$(`.md-mode-switch button[title="${mode}"]`);
      if (sw) { await sw.click(); await page.waitForTimeout(700); }
      m = await metrics();
      check(`${w}px md ${mode === 'Preview only' ? 'preview' : 'split'}: layout inside viewport`, m.stripeX + 40 <= w + 1, JSON.stringify(m));
    }
  }
} catch (err) {
  results.push('FAIL fatal — ' + err.message);
}
console.log(results.join('\n'));
await browser.close();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
