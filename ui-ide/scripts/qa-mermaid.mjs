import { chromium } from 'playwright-core';
import fs from 'node:fs';

const exe = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'].find((p) => fs.existsSync(p));
const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 940 } });
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message.split('\n')[0]));
page.on('console', (m) => console.log('CONSOLE[' + m.type() + ']:', m.text().slice(0, 200)));

await page.goto('http://web-ide.com/?root=' + encodeURIComponent('/tmp/demo-project'));
await page.waitForSelector('.tree-row[data-path="dia.md"]');
await page.dblclick('.tree-row[data-path="dia.md"]');
for (const ms of [1500, 3000, 5000]) {
  await page.waitForTimeout(ms === 1500 ? 1500 : ms === 3000 ? 1500 : 2000);
  console.log(`@${ms}ms`, await page.evaluate(() => ({
    figures: document.querySelectorAll('.mermaid-figure').length,
    mermaidGlobal: typeof window.mermaid,
    rawBlock: document.querySelectorAll('.mdv pre > code.language-mermaid').length,
    svgInFigure: document.querySelector('.mermaid-figure svg') ? true : false,
  })));
}
await page.screenshot({ path: '/tmp/ws-shots/qa-mermaid.png' });
await browser.close();
