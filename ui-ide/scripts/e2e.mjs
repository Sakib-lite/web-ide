import { chromium } from 'playwright-core';
import fs from 'node:fs';
import { execSync } from 'node:child_process';

const base = process.env.UI_URL || 'http://localhost:3005';
const project = process.env.PROJECT || '/tmp/demo-project';
const exe = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'].find((p) => fs.existsSync(p));
const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 940 } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => m.type() === 'error' && !/favicon|404/.test(m.text()) && errors.push('console: ' + m.text()));
const results = [];
const check = (name, ok, extra = '') => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
const text = (sel) => page.textContent(sel).then((t) => (t || '').trim()).catch(() => '');
const count = (sel) => page.$$(sel).then((l) => l.length);
const activeTab = () => page.getAttribute('.tab.active', 'title');
const git = (args) => execSync(`git ${args}`, { cwd: project, encoding: 'utf8' }).trim();
const gotoDef = async (line, col) => {
  await page.evaluate(([l, c]) => { const ed = monaco.editor.getEditors()[0]; ed.setPosition({ lineNumber: l, column: c }); ed.focus(); }, [line, col]);
  await page.evaluate(() => monaco.editor.getEditors()[0].trigger('t', 'editor.action.revealDefinition', null));
  await page.waitForTimeout(800);
  const pos = await page.evaluate(() => { const p = monaco.editor.getEditors()[0].getPosition(); return p ? `${p.lineNumber}:${p.column}` : null; });
  return { file: await activeTab(), pos };
};
const openFile = async (p) => { await page.dblclick(`.tree-row[data-path="${p}"]`); await page.waitForTimeout(600); };
const expand = async (p) => { if (!(await page.$(`.tree-node.open > .tree-row[data-path="${p}"]`))) { await page.click(`.tree-row[data-path="${p}"]`); await page.waitForTimeout(400); } };

try {
  await page.goto(base);
  await page.waitForSelector('.welcome', { timeout: 30000 });
  check('welcome renders', await page.isVisible('.welcome'));
  await page.click('text=Open');
  await page.waitForSelector('.browse-item', { timeout: 8000 });
  check('open dialog lists folders', (await count('.browse-item')) > 0);
  await page.keyboard.press('Escape');

  await page.goto(`${base}/?root=${encodeURIComponent(project)}`);
  await page.waitForSelector('.tree-row[data-path="src"]', { timeout: 30000 });
  await page.waitForTimeout(1500);
  check('project name in title bar', (await text('.tb-project')).includes('demo-project'));
  check('branch label', (await text('.tb-branch')).includes('main'));
  await expand('src');
  await page.waitForSelector('.tree-row[data-path="src/format.js"]');
  check('git colours in tree', (await page.getAttribute('.tree-row[data-path="src/format.js"]', 'class')).includes('git-modified') && (await page.getAttribute('.tree-row[data-path="src/untracked.js"]', 'class')).includes('git-untracked'));
  await openFile('src/format.js');
  check('tab opened', (await activeTab()) === 'src/format.js');
  await page.waitForTimeout(800);
  check('gutter change markers', (await count('.gutter-added, .gutter-modified')) > 0);
  await expand('src/utils');
  await openFile('src/index.js');
  let r = await gotoDef(5, 7);
  check('JS goto calc.plus → math.js', r.file === 'src/utils/math.js' && r.pos?.startsWith('11:'), JSON.stringify(r));
  await openFile('src/index.js');
  r = await gotoDef(6, 28);
  check('JS goto add → math.js', r.file === 'src/utils/math.js', JSON.stringify(r));
  await expand('app');
  await expand('app/Services');
  await openFile('app/Services/Greeter.php');
  r = await gotoDef(12, 23);
  check('PHP goto $user->greet → User.php', r.file === 'app/Models/User.php' && r.pos?.startsWith('14:'), JSON.stringify(r));
  await expand('pyapp');
  await expand('pyapp/services');
  await openFile('pyapp/services/greeter.py');
  r = await gotoDef(7, 18);
  check('PY goto make_user → models.py', r.file === 'pyapp/models.py' && r.pos?.startsWith('12:'), JSON.stringify(r));

  await page.keyboard.press('Meta+Digit7');
  await page.waitForSelector('.struct-row', { timeout: 4000 }).catch(() => {});
  check('structure view lists symbols', (await count('.struct-row')) >= 1);

  await page.keyboard.press('Meta+Digit0');
  await page.waitForTimeout(800);
  check('commit view groups', (await count('.cl-header')) === 2 && (await count('.change-row')) === 3, `${await count('.cl-header')} / ${await count('.change-row')}`);
  await page.dblclick('.change-row[data-path="src/utils/math.js"]');
  await page.waitForTimeout(900);
  check('diff tab with toolbar', await page.isVisible('.diff-toolbar') && /difference/.test(await text('.diff-count')), await text('.diff-count'));
  await page.fill('#commit-message', 'test: commit from web ide');
  await page.click('#btn-commit');
  await page.waitForTimeout(1500);
  check('commit created', git('log -1 --pretty=%s') === 'test: commit from web ide', git('log -1 --pretty=%s'));

  await page.click('#btn-branch');
  await page.waitForSelector('#branch-popup');
  check('branch popup lists branches', /feat\/login/.test(await text('#branch-popup')) && /Update Project/.test(await text('#branch-popup')));
  await page.fill('#branch-popup input', 'typo');
  await page.waitForTimeout(200);
  await page.click('#branch-popup .bp-item .bp-name:text("fix/typo")');
  await page.waitForTimeout(1500);
  check('checkout via popup', git('rev-parse --abbrev-ref HEAD') === 'fix/typo' && (await text('.tb-branch')).includes('fix/typo'));

  await page.keyboard.press('Meta+Digit9');
  await page.waitForTimeout(1500);
  check('git log rows with graph', (await count('#log-list, .log-list')) >= 1 && (await count('.log-row')) >= 5 && (await count('svg.log-graph')) >= 5);
  check('log branch tree', /Local/.test(await text('.log-branch-tree')) && /origin/.test(await text('.log-branch-tree')));
  await page.click('.log-row:has-text("test: commit from web ide")');
  await page.waitForTimeout(900);
  check('commit details', (await count('.ld-file')) >= 1 && (await text('.ld-msg')).length > 3);
  await page.click('.subtab:has-text("Console")');
  await page.waitForTimeout(400);
  check('git console', (await count('.gc-entry')) >= 1);

  await page.keyboard.press('Alt+F12');
  await page.waitForTimeout(1500);
  await page.keyboard.type('echo hello-from-web-terminal');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1200);
  const term = await page.evaluate(() => document.querySelector('.term-instance:not(.hidden) .xterm-rows')?.innerText || '');
  check('terminal echoes', term.split('hello-from-web-terminal').length >= 3);

  await page.keyboard.press('Shift');
  await page.keyboard.press('Shift');
  await page.waitForTimeout(400);
  check('search everywhere opens', (await count('.popup .se-input')) === 1);
  await page.keyboard.type('greet');
  await page.waitForTimeout(700);
  check('search results', (await count('.se-item')) > 0);
  await page.keyboard.press('Escape');

  await page.keyboard.press('Meta+Digit1');
  await page.waitForTimeout(500);
  await expand('src');
  await openFile('src/format.js');
  await page.evaluate(() => { const ed = monaco.editor.getEditors()[0]; ed.setSelection(new monaco.Range(1, 1, 1, 6)); ed.focus(); });
  const expectSel = await page.evaluate(() => monaco.editor.getEditors()[0].getModel().getValueInRange(new monaco.Range(1, 1, 1, 6)));
  await page.keyboard.press('Shift');
  await page.keyboard.press('Shift');
  await page.waitForTimeout(400);
  const prefill = await page.inputValue('.popup .se-input input');
  check('double-shift prefills selection', expectSel.length > 0 && prefill === expectSel, `${JSON.stringify(prefill)} vs ${JSON.stringify(expectSel)}`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  await page.keyboard.press('Meta+Comma');
  await page.waitForSelector('.settings-nav', { timeout: 4000 });
  await page.click('.settings-nav button:has-text("Keymap")');
  await page.waitForTimeout(300);
  const kmRows = await count('.km-row');
  check('keymap guide lists shortcuts', kmRows >= 40, `${kmRows} rows`);
  await page.fill('.km-search input', 'rename');
  await page.waitForTimeout(300);
  const kmFiltered = await count('.km-row');
  check('keymap guide filter narrows', kmFiltered >= 1 && kmFiltered < kmRows, `${kmFiltered} of ${kmRows} rows`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  const tabsBefore = await count('.tab');
  await page.keyboard.press('Meta+F4');
  await page.waitForTimeout(400);
  check('⌘F4 closes tab', (await count('.tab')) === tabsBefore - 1, `${tabsBefore} → ${await count('.tab')}`);

  await page.click('.stripe-left .stripe-bottom button[title^="Keymap"]');
  await page.waitForTimeout(300);
  check('keymap stripe button opens guide', (await count('.km-row')) > 40, `${await count('.km-row')} rows`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  const apiBase = process.env.API_URL || ((u) => ((u.port = '4099'), u.origin))(new URL(base));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  if (!(await page.isVisible('.tree-row[data-path="src"]'))) {
    await page.click('.stripe-left .stripe-btn[data-tool="project"]');
    await page.waitForTimeout(500);
  }
  await fetch(`${apiBase}/api/fs/write?root=${encodeURIComponent(project)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ root: project, path: 'sample-preview.md', content: '# Demo Guide\n\nIntro with `inline code`.\n\n## Install\n\n```bash\nnpm install demo\n```\n\n## Usage\n\n- item one\n- item two\n\n### Advanced\n\nText after outline levels.\n' }),
  });
  await page.waitForSelector('.tree-row[data-path="sample-preview.md"]', { timeout: 6000 }).catch(() => {});
  await page.dblclick('.tree-row[data-path="sample-preview.md"]');
  await page.waitForTimeout(1200);
  const editorHidden = () => page.$eval('#editor', (e) => e.classList.contains('hidden')).catch(() => true);
  check('markdown full preview by default', (await count('.mdv .prose h1')) === 1 && (await count('.mdv .prose h2')) === 2 && (await editorHidden()), `h1=${await count('.mdv .prose h1')} editorHidden=${await editorHidden()}`);
  check('markdown text is selectable', (await page.$eval('.mdv .prose', (e) => getComputedStyle(e).userSelect)) === 'text', await page.$eval('.mdv .prose', (e) => getComputedStyle(e).userSelect).catch(() => '?'));
  check('markdown outline lists headings', (await count('.mdv-toc')) === 3, `${await count('.mdv-toc')} toc entries`);
  check('markdown code highlighted with copy', (await count('.mdv .copy-btn')) === 1 && /bash/.test(await text('.mdv .code-lang')), await text('.mdv .code-lang'));
  const reopenMd = async () => {
    if (!(await page.isVisible('.mdv-header'))) {
      await page.dblclick('.tree-row[data-path="sample-preview.md"]');
      await page.waitForTimeout(500);
    }
  };
  await reopenMd();
  await page.click('.mdv-header .tb-icon[title^="Hide outline"]');
  await page.waitForTimeout(200);
  check('outline hides', (await count('.mdv-outline')) === 0);
  await reopenMd();
  await page.click('.md-mode-switch button[title="Editor and Preview"]');
  await page.waitForTimeout(400);
  check('split mode shows editor and preview', !(await editorHidden()) && (await count('.mdv .prose h1')) === 1);
  await reopenMd();
  await page.keyboard.press('Meta+Shift+KeyV');
  await page.waitForTimeout(300);
  check('⌘⇧V split → full preview', (await editorHidden()) && (await count('.mdv .prose h1')) === 1);
  await page.keyboard.press('Meta+Shift+KeyV');
  await page.waitForTimeout(300);
  check('⌘⇧V preview → editor only', (await count('.mdv')) === 0 && !(await editorHidden()));
  await page.keyboard.press('Meta+Shift+KeyV');
  await page.waitForTimeout(400);
  check('⌘⇧V editor → split', !(await editorHidden()) && (await count('.mdv .prose h1')) === 1);

  check('plugin stripe button', (await count('.stripe-right .stripe-btn[data-tool="claude-code"]')) === 1);
  await page.click('.stripe-right .stripe-btn[data-tool="claude-code"]');
  await page.waitForTimeout(800);
  check('claude panel renders', (await count('.cc-root')) === 1 && /Idle/.test(await text('.cc-status')), await text('.cc-status'));
  await page.screenshot({ path: '/tmp/ws-shots/30-web-ide.png' });
} catch (err) {
  results.push('CRASH ' + err.message.split('\n')[0]);
  await page.screenshot({ path: '/tmp/ws-shots/99-crash.png' }).catch(() => undefined);
}

console.log(results.join('\n'));
console.log('\nErrors:', errors.length ? '\n' + errors.join('\n') : 'none');
await browser.close();
process.exit(results.some((r) => !r.startsWith('PASS')) || errors.length ? 1 : 0);
