import { chromium } from 'playwright-core';
import fs from 'node:fs';

const base = process.env.UI_URL || 'http://localhost:3099';
const project = process.env.PROJECT || '/tmp/webide-qa/proj-a';
const exe = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'].find((p) => fs.existsSync(p));
const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 940 } });
const results = [];
const check = (name, ok, extra = '') => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);

try {
  await page.goto(`${base}/?root=${encodeURIComponent(project)}`);
  await page.waitForSelector('.change-row', { state: 'attached', timeout: 30000 });
  if (!(await page.isVisible('.change-row'))) {
    await page.click('button[title*="Commit"]');
    await page.waitForSelector('.change-row', { timeout: 10000 });
  }
  await page.waitForTimeout(1200);

  await page.click('.change-row:has-text("file1.js")');
  await page.click('button[title*="Show Diff"]');
  await page.waitForTimeout(1500);
  const activeTitle = async () => page.getAttribute('.tab.active', 'title');
  check('file1 diff tab opens', /file1\.js/.test((await activeTitle()) || ''));

  const focusDiffEdge = async (file, edge) => {
    await page.evaluate(([f, e]) => {
      const ed = monaco.editor.getEditors().find((x) => x.getModel()?.uri.path === '/' + f && !!x.getAction('jb.diff.nextFile'));
      if (!ed) throw new Error('no diff editor for ' + f);
      ed.setPosition({ lineNumber: e === 'last' ? ed.getModel().getLineCount() : 1, column: 1 });
      ed.focus();
    }, [file, edge]);
    await page.waitForTimeout(300);
  };

  await focusDiffEdge('file1.js', 'last');
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(1500);
  const after1 = (await activeTitle()) || '';
  check('ArrowDown at EOF jumps to next file (file2.js diff)', /file2\.js/.test(after1), after1);

  await focusDiffEdge('file2.js', 'last');
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(1500);
  const after2 = (await activeTitle()) || '';
  check('next ArrowDown advances again (file3.js)', /file3\.js/.test(after2), after2);

  await page.click('.change-row:has-text("file1.js")');
  await page.click('button[title*="Show Diff"]');
  await page.waitForTimeout(1500);
  await focusDiffEdge('file1.js', 'first');
  const lastPath = await page.evaluate(() => [...document.querySelectorAll('.change-row')].pop()?.dataset.path || '');
  await page.keyboard.press('ArrowUp');
  await page.waitForTimeout(1500);
  const after3 = (await activeTitle()) || '';
  check('ArrowUp at BOF goes to previous file', lastPath.startsWith(after3.replace(/ \(.*\)$/, '')) && !!after3, `${after3} (expected wrap to ${lastPath})`);
} catch (err) {
  results.push('FAIL fatal — ' + err.message);
}

console.log(results.join('\n'));
await browser.close();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
