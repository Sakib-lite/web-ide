import { chromium } from 'playwright-core';
import fs from 'node:fs';

const base = process.env.UI_URL || 'http://web-ide.com';
const project = process.env.PROJECT || '/tmp/demo-project';
const exe = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'].find((p) => fs.existsSync(p));
const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 940 } });
const errors = [];
const writes = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('request', (r) => r.url().includes('/api/fs/write') && writes.push(r.url()));
const results = [];
const check = (name, ok, extra = '') => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
const count = (sel) => page.$$(sel).then((l) => l.length);
const press = (k) => page.keyboard.press(k);

const ed = () => page.evaluate(() => {
  const e = monaco.editor.getEditors()[0];
  const s = e.getSelection();
  return {
    lines: e.getModel().getLinesContent(),
    line: e.getPosition().lineNumber,
    col: e.getPosition().column,
    sel: s ? [s.startLineNumber, s.startColumn, s.endLineNumber, s.endColumn] : null,
    sels: e.getSelections().length,
    visible: e.getVisibleRanges().map((r) => r.endLineNumber - r.startLineNumber + 1).reduce((a, b) => a + b, 0),
  };
});
const setValue = (v) => page.evaluate((v) => monaco.editor.getEditors()[0].getModel().setValue(v), v);
const setPos = (l, c) => page.evaluate(([l, c]) => { const e = monaco.editor.getEditors()[0]; e.setPosition({ lineNumber: l, column: c }); e.focus(); }, [l, c]);
const setSel = (sl, sc, el, ec) => page.evaluate(([sl, sc, el, ec]) => { const e = monaco.editor.getEditors()[0]; e.setSelection(new monaco.Range(sl, sc, el, ec)); e.focus(); }, [sl, sc, el, ec]);
const blurEditor = () => page.evaluate(() => document.activeElement?.blur?.());
const esc = async () => { await press('Escape'); await page.waitForTimeout(120); };
const openFile = async (p) => { await page.dblclick(`.tree-row[data-path="${p}"]`); await page.waitForTimeout(600); };
const expand = async (p) => { if (!(await page.$(`.tree-node.open > .tree-row[data-path="${p}"]`))) { await page.click(`.tree-row[data-path="${p}"]`); await page.waitForTimeout(400); } };
const activeTab = () => page.getAttribute('.tab.active', 'title');

try {
  await page.goto(`${base}/?root=${encodeURIComponent(project)}`);
  await page.waitForSelector('.tree-row[data-path="src"]', { timeout: 30000 });
  await expand('src');
  await openFile('src/format.js');
  const original = (await ed()).lines.join('\n');

  await setValue('aaa\nbbb');
  await setPos(1, 1);
  await press('Meta+KeyD');
  check('⌘D duplicate line', (await ed()).lines.join() === 'aaa,aaa,bbb', JSON.stringify((await ed()).lines));
  await press('Meta+Backspace');
  check('⌘⌫ delete line', (await ed()).lines.length === 2, JSON.stringify((await ed()).lines));
  await setPos(1, 1); await press('Shift+Alt+ArrowDown');
  check('⇧⌥↓ move line down', (await ed()).lines[0] === 'bbb', JSON.stringify((await ed()).lines));
  await setPos(1, 1); await press('Meta+Shift+ArrowDown');
  check('⌘⇧↓ move statement down', (await ed()).lines[0] === 'aaa', JSON.stringify((await ed()).lines));
  await setPos(2, 1); await press('Shift+Alt+ArrowUp');
  check('⇧⌥↑ move line up', (await ed()).lines[0] === 'bbb', JSON.stringify((await ed()).lines));
  await setPos(2, 1); await press('Meta+Shift+ArrowUp');
  check('⌘⇧↑ move statement up', (await ed()).lines[0] === 'aaa', JSON.stringify((await ed()).lines));

  await setValue('abc');
  await setSel(1, 1, 1, 4);
  await press('Meta+Shift+KeyU');
  check('⌘⇧U toggle case', (await ed()).lines[0] === 'ABC', (await ed()).lines[0]);

  await setValue('let one = 1');
  await setPos(1, 1);
  await press('Meta+Slash');
  check('⌘/ line comment', (await ed()).lines[0].startsWith('//'), (await ed()).lines[0]);
  await press('Meta+Slash');
  check('⌘/ uncomment', (await ed()).lines[0] === 'let one = 1', (await ed()).lines[0]);
  await setSel(1, 1, 1, 12);
  await press('Meta+Alt+Slash');
  check('⌘⌥/ block comment', /\*/.test((await ed()).lines[0]), (await ed()).lines[0]);

  await setValue('foo foo');
  await setSel(1, 1, 1, 4);
  await press('Control+KeyG');
  check('⌃G add selection to next occurrence', (await ed()).sels === 2, `selections=${(await ed()).sels}`);
  await esc();

  await setValue('one two');
  await setPos(1, 1);
  await press('Control+Shift+KeyJ');
  check('⌃⇧J join lines', (await ed()).lines.length === 1, JSON.stringify((await ed()).lines));

  await setValue('let x = 1');
  await setPos(1, 9);
  await press('Meta+Shift+Enter');
  let st = await ed();
  check('⌘⇧⏎ complete statement', st.lines.length === 2 && st.lines[0].trimEnd().endsWith(';'), JSON.stringify(st.lines));

  await setValue('foo bar foo');
  await setSel(1, 1, 1, 4);
  await press('Meta+KeyG');
  st = await ed();
  check('⌘G next occurrence', st.sel[1] === 9, JSON.stringify(st.sel));
  await press('Meta+Shift+KeyG');
  st = await ed();
  check('⌘⇧G previous occurrence', st.sel[1] === 1, JSON.stringify(st.sel));
  await esc();

  await setValue('const a = 1;\nconst b = 2;\nconst broken = ;');
  await page.waitForTimeout(2500);
  await setPos(1, 1);
  await press('F2');
  check('F2 next problem', (await ed()).line === 3, `line=${(await ed()).line}`);

  await setValue('function a() {\n  const x = 1;\n  if (x) {\n    return 2;\n  }\n}\nconst tail = 9;');
  await page.waitForTimeout(800);
  await setPos(3, 3);
  await press('Meta+Alt+Minus');
  check('⌘⌥- fold', (await ed()).visible < 7, `visible=${(await ed()).visible}`);
  await press('Meta+Alt+Equal');
  check('⌘⌥= unfold', (await ed()).visible === 7, `visible=${(await ed()).visible}`);
  await press('Meta+Alt+Shift+Minus');
  check('⌘⌥⇧- collapse all', (await ed()).visible < 7, `visible=${(await ed()).visible}`);
  await press('Meta+Alt+Shift+Equal');
  check('⌘⌥⇧= expand all', (await ed()).visible === 7, `visible=${(await ed()).visible}`);

  await setValue('const word = 1');
  await setPos(1, 8);
  await press('Alt+ArrowUp');
  st = await ed();
  check('⌥↑ extend selection', st.sel && st.sel[3] - st.sel[1] >= 4, JSON.stringify(st.sel));
  await press('Alt+ArrowDown');
  st = await ed();
  check('⌥↓ shrink selection', !st.sel || st.sel[3] - st.sel[1] < 4, JSON.stringify(st.sel));

  await setValue('function  f(  ){\nreturn   1;\n}');
  await press('Meta+Alt+KeyL');
  await page.waitForTimeout(700);
  check('⌘⌥L reformat code', (await ed()).lines.join('\n') !== 'function  f(  ){\nreturn   1;\n}', JSON.stringify((await ed()).lines));

  await press('Meta+KeyL');
  check('⌘L go to line', (await count('.quick-input-widget')) > 0);
  await esc(); await esc();
  await press('Meta+KeyR');
  check('⌘R replace', (await count('.find-widget')) > 0);
  await esc();

  await setValue('const total = calc.plus(1, 2)');
  await setPos(1, 7);
  await press('Control+Space');
  await page.waitForTimeout(800);
  check('⌃Space completion', (await count('.suggest-widget.visible')) > 0, `suggest=${await count('.suggest-widget.visible')}`);
  await esc();

  await setPos(1, 27);
  await press('Meta+KeyP');
  await page.waitForTimeout(1500);
  const dbg = await page.evaluate(async () => {
    const e = monaco.editor.getEditors()[0];
    const act = e.getAction('editor.action.triggerParameterHints');
    let apiLen = -1;
    try {
      const r = await fetch('http://web-ide.com:4099/api/symbols/search?q=plus&root=%2Ftmp%2Fdemo-project', { credentials: 'include' });
      apiLen = (await r.json()).length;
    } catch {}
    return {
      action: !!act,
      focused: !!document.activeElement?.closest('.monaco-editor'),
      pos: e.getPosition(),
      line: e.getModel().getLineContent(1),
      apiLen,
      hints: document.querySelectorAll('.parameter-hints-widget').length,
      hintsVisible: document.querySelectorAll('.parameter-hints-widget.visible').length,
    };
  });
  check('⌘P parameter info', dbg.hintsVisible > 0, JSON.stringify(dbg));
  await esc();

  await setPos(1, 21);
  await press('F1');
  await page.waitForTimeout(800);
  check('F1 quick doc', (await count('.monaco-hover.fade-in')) > 0, `hover=${await count('.monaco-hover.fade-in')}`);
  await esc();

  await expand('src/utils');
  await openFile('src/index.js');
  await page.waitForTimeout(600);
  await setPos(5, 7);
  await press('Meta+KeyB');
  await page.waitForTimeout(900);
  check('⌘B go to declaration', (await activeTab()) === 'src/utils/math.js', await activeTab());
  await setPos(11, 3);
  await press('Meta+KeyY');
  await page.waitForTimeout(900);
  check('⌘Y quick definition (peek)', (await count('.zone-widget')) > 0, `zone=${await count('.zone-widget')}`);
  await esc();
  await blurEditor();
  await press('Meta+BracketLeft');
  await page.waitForTimeout(500);
  check('⌘[ back', (await activeTab()) === 'src/index.js', await activeTab());
  await press('Meta+BracketRight');
  await page.waitForTimeout(500);
  check('⌘] forward', (await activeTab()) === 'src/utils/math.js', await activeTab());
  await blurEditor();
  await press('Meta+Alt+ArrowLeft');
  await page.waitForTimeout(400);
  check('⌘⌥← back', (await activeTab()) === 'src/index.js', await activeTab());
  await press('Meta+Alt+ArrowRight');
  await page.waitForTimeout(400);
  check('⌘⌥→ forward', (await activeTab()) === 'src/utils/math.js', await activeTab());

  await setPos(11, 10);
  await page.waitForTimeout(300);
  await press('Shift+F6');
  await page.waitForTimeout(900);
  check('⇧F6 rename (JS via TS worker)', (await count('.rename-input')) > 0, `rename=${await count('.rename-input')}`);
  await esc();

  await openFile('src/format.js');
  await setValue('export const tempKb = 1');
  writes.length = 0;
  await press('Meta+KeyS');
  await page.waitForTimeout(1200);
  check('⌘S save', writes.length > 0 && (await count('.tab.dirty')) === 0, `writes=${writes.length} dirty=${await count('.tab.dirty')}`);
  await setValue(original);

  const tabs0 = await count('.tab');
  await press('Meta+Shift+BracketRight');
  await page.waitForTimeout(250);
  const afterNext = await activeTab();
  check('⌘⇧] next tab', afterNext !== 'src/format.js', afterNext);
  await press('Meta+Shift+BracketLeft');
  await page.waitForTimeout(250);
  check('⌘⇧[ previous tab', (await activeTab()) === 'src/format.js', await activeTab());
  await press('Meta+Shift+KeyW');
  await page.waitForTimeout(300);
  check('⌘⇧W close tab', (await count('.tab')) === tabs0 - 1, `${tabs0} → ${await count('.tab')}`);

  const stripeActive = (id) => page.$(`.stripe-btn[data-tool="${id}"]`).then((el) => el?.getAttribute('class') || '').then((c) => c.includes('active'));
  for (const [key, id, name] of [['Meta+Digit7', 'structure', '⌘7 structure'], ['Meta+Digit0', 'commit', '⌘0 commit'], ['Meta+Digit9', 'git', '⌘9 git log'], ['Meta+Digit3', 'find', '⌘3 find']]) {
    await press(key);
    await page.waitForTimeout(300);
    const on = await stripeActive(id);
    check(`${name} opens`, on, String(on));
    await press(key);
    await page.waitForTimeout(200);
  }
  await press('Meta+Digit1');
  await page.waitForTimeout(300);
  const projOpened = await stripeActive('project');
  await press('Meta+Digit1');
  await page.waitForTimeout(300);
  const projHidden = !(await stripeActive('project'));
  check('⌘1 project toggles', projOpened && projHidden, `opened=${projOpened} hidden=${projHidden}`);
  await press('Alt+F12');
  await page.waitForTimeout(500);
  check('⌥F12 terminal', (await count('.tool-panel.bottom:not(.collapsed)')) === 1);
  await press('Alt+F12');
  await press('Meta+Shift+F12');
  await page.waitForTimeout(300);
  check('⌘⇧F12 hide all tools', ['left', 'right', 'bottom'].every(async (s) => (await count(`.tool-panel.${s}:not(.collapsed)`)) === 0));
  await press('Meta+F12');
  await page.waitForTimeout(300);
  check('⌘F12 structure via key', await stripeActive('structure'));
  await press('Shift+Escape');
  await page.waitForTimeout(200);
  check('⇧Esc hide active tool', !(await stripeActive('structure')));
  await press('Meta+Shift+KeyC');
  await page.waitForTimeout(400);
  check('⌘⇧C claude tool window', await stripeActive('claude-code'));
  await press('Meta+Shift+KeyC');

  const seScope = async () => (await page.textContent('.se-tabs button.active'))?.trim();
  await press('Meta+Shift+KeyO');
  await page.waitForTimeout(350);
  check('⌘⇧O go to file', (await seScope()) === 'Files', await seScope());
  await esc();
  await press('Meta+KeyO');
  await page.waitForTimeout(350);
  check('⌘O go to class/symbol', (await seScope()) === 'Symbols', await seScope());
  await esc();
  await press('Meta+Alt+KeyO');
  await page.waitForTimeout(350);
  check('⌘⌥O go to symbol', (await seScope()) === 'Symbols', await seScope());
  await esc();
  await press('Meta+Shift+KeyA');
  await page.waitForTimeout(350);
  check('⌘⇧A find action', (await seScope()) === 'Actions', await seScope());
  await esc();

  await press('Meta+Shift+KeyF');
  await page.waitForTimeout(400);
  check('⌘⇧F find in files', await stripeActive('find'));
  await blurEditor();
  await page.evaluate(() => { const e = monaco.editor.getEditors()[0]; e.setPosition({ lineNumber: 1, column: 8 }); e.focus(); });
  await press('Alt+F7');
  await page.waitForTimeout(1200);
  check('⌥F7 find usages', await stripeActive('find'), String(await stripeActive('find')));

  await press('Meta+KeyE');
  await page.waitForTimeout(300);
  check('⌘E recent files', (await count('.context-menu')) > 0);
  await esc();
  await press('Meta+Comma');
  await page.waitForTimeout(300);
  check('⌘, settings', (await count('.settings-nav')) === 1);
  await esc();
  await blurEditor();
  await press('Meta+KeyN');
  await page.waitForTimeout(300);
  check('⌘N new file dialog', (await count('.dialog')) > 0);
  await esc();
  await press('Meta+Alt+KeyN');
  await page.waitForTimeout(300);
  check('⌥⌘N new branch dialog', (await count('.dialog')) > 0);
  await esc();
  await press('Meta+Shift+KeyK');
  await page.waitForTimeout(300);
  check('⌘⇧K push dialog', (await count('.dialog')) > 0);
  await esc();

  await press('Meta+KeyK');
  await page.waitForTimeout(400);
  check('⌘K focus commit message', (await page.evaluate(() => document.activeElement?.id)) === 'commit-message', await page.evaluate(() => document.activeElement?.id));

  const fs0 = (await page.evaluate(() => JSON.parse(localStorage.getItem('ide.settings') || '{}').fontSize)) ?? 13;
  await press('Meta+Equal');
  await page.waitForTimeout(250);
  const fs1 = await page.evaluate(() => JSON.parse(localStorage.getItem('ide.settings') || '{}').fontSize);
  check('⌘= increase font', fs1 === fs0 + 1, `${fs0} → ${fs1}`);
  await press('Meta+Minus');
  await page.waitForTimeout(250);
  const fs2 = await page.evaluate(() => JSON.parse(localStorage.getItem('ide.settings') || '{}').fontSize);
  check('⌘- decrease font', fs2 === fs0, `${fs1} → ${fs2}`);

  await blurEditor();
  await press('Escape');
  await page.waitForTimeout(200);
  check('Esc focuses editor', !!(await page.evaluate(() => document.activeElement?.closest('.monaco-editor'))));

  await setValue(original);
  await page.screenshot({ path: '/tmp/ws-shots/40-keybindings.png' });
} catch (err) {
  results.push('CRASH ' + err.message.split('\n')[0]);
  await page.screenshot({ path: '/tmp/ws-shots/98-kb-crash.png' }).catch(() => undefined);
}

console.log(results.join('\n'));
const failed = results.filter((r) => r.startsWith('FAIL') || r.startsWith('CRASH'));
console.log(`\n${results.filter((r) => r.startsWith('PASS')).length} passed, ${failed.length} failed`);
console.log('Errors:', errors.length ? '\n' + errors.join('\n') : 'none');
await browser.close();
process.exit(failed.length ? 1 : 0);
