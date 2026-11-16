// One-off check of the Tetris page: loads it the way the viewer would, plays it, takes screenshots.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const dir = __dirname;
const src = fs.readFileSync(path.join(dir, 'pocket-tetris.html'), 'utf8');
const wrapped = `<!doctype html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<style>:root{color-scheme:light;padding:env(safe-area-inset-top,0px) 0 env(safe-area-inset-bottom,0px)}body{margin:0;font:14px system-ui,sans-serif}img{max-width:100%}[hidden]{display:none!important}</style>
</head><body>
${src}
</body></html>`;
fs.writeFileSync(path.join(dir, 'tetris.html'), wrapped);
const url = 'file://' + path.join(dir, 'tetris.html');

const out = { errors: [], checks: {} };
const ok = (name, cond, extra) => { out.checks[name] = cond ? 'ok' : 'FAIL' + (extra !== undefined ? ' ' + JSON.stringify(extra) : ''); };

(async () => {
  const browser = await chromium.launch();
  async function open(opts) {
    const context = await browser.newContext(opts);
    await context.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
    const page = await context.newPage();
    page.on('pageerror', e => out.errors.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) out.errors.push('console: ' + m.text()); });
    await page.addInitScript(() => { window.__tetrisTest = api => { window.T = api; }; });
    await page.goto(url);
    await page.waitForTimeout(300);
    return { context, page };
  }
  const fits = page => page.evaluate(() => ({
    w: document.documentElement.scrollWidth <= window.innerWidth,
    h: document.documentElement.scrollHeight <= window.innerHeight,
    bezel: (() => { const b = document.getElementById('bezel').getBoundingClientRect(), s = document.getElementById('screen').getBoundingClientRect(); return b.width <= s.width + 0.5 && b.height <= s.height + 0.5; })(),
    info: (() => { const i = document.getElementById('info'); return i.scrollHeight <= i.clientHeight + 1; })(),
  }));

  /* ---- Phone, portrait ---- */
  {
    const { context, page } = await open({ viewport: { width: 390, height: 760 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    ok('phone fits', Object.values(await fits(page)).every(Boolean), await fits(page));
    await page.screenshot({ path: path.join(dir, 'shot-phone-idle.png') });

    await page.tap('#veil-main');
    await page.waitForTimeout(100);
    let s = await page.evaluate(() => ({ mode: T.state.mode, x: T.state.piece.x, type: T.state.piece.type, next: T.state.nextCount, cell: T.state.cellCss }));
    ok('start', s.mode === 'play', s);
    out.phone = { cell: s.cell, next: s.next };

    // Keys under the screen
    await page.evaluate(() => T.set(a => a.piece({ type: 'T', rot: 0, x: 3, y: 4 })));
    await page.tap('[data-act="left"]');
    await page.tap('[data-act="cw"]');
    s = await page.evaluate(() => T.state.piece);
    ok('pad left + rotate', s.x === 2 && s.rot === 1, s);
    await page.tap('[data-act="hold"]');
    s = await page.evaluate(() => ({ hold: T.state.holdType, can: T.state.canHold }));
    ok('pad hold', s.hold === 'T' && s.can === false, s);
    await page.tap('[data-act="drop"]');
    await page.waitForTimeout(60);
    s = await page.evaluate(() => ({ filled: T.state.board.flat().filter(Boolean).length, score: T.state.score }));
    ok('pad drop', s.filled === 4 && s.score > 0, s);

    // Gestures on the well
    await page.evaluate(() => T.set(a => a.piece({ type: 'T', rot: 0, x: 3, y: 4 })));
    const box = await page.locator('#field').boundingBox();
    const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
    await page.touchscreen.tap(cx, cy);
    await page.waitForTimeout(50);
    s = await page.evaluate(() => T.state.piece);
    ok('tap turns', s.rot === 1, s);
    const cdp = await context.newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx, y: cy }] });
    for (let i = 1; i <= 10; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: cx + i * 7, y: cy + 1 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(50);
    const after = await page.evaluate(() => T.state.piece);
    ok('drag shifts', after.x > s.x && after.rot === 1, { before: s.x, after: after.x });

    await page.screenshot({ path: path.join(dir, 'shot-phone-play.png') });
    await context.close();
  }

  /* ---- Desktop: rules, keyboard, a full game ---- */
  {
    const { context, page } = await open({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    ok('desktop fits', Object.values(await fits(page)).every(Boolean), await fits(page));
    await page.keyboard.press('Enter');
    await page.waitForTimeout(80);
    ok('enter starts', (await page.evaluate(() => T.state.mode)) === 'play');

    const rules = await page.evaluate(() => {
      const empty = () => Array.from({ length: 22 }, () => new Array(10).fill(0));
      const r = {};
      r.rot = ['I', 'J', 'L', 'S', 'T', 'Z'].every(t => {
        T.set(a => { a.board(empty()); a.piece({ type: t, rot: 0, x: 3, y: 8 }); });
        const before = JSON.stringify(T.state.piece);
        let turned = true;
        for (let i = 0; i < 4; i++) turned = T.tryRotate(1) && turned;
        for (let i = 0; i < 4; i++) turned = T.tryRotate(-1) && turned;
        return turned && JSON.stringify(T.state.piece) === before;
      });
      // I standing against the right wall must kick inward when turned
      T.set(a => { a.board(empty()); a.piece({ type: 'I', rot: 1, x: 7, y: 8 }); });
      r.kick = T.tryRotate(1) && T.state.piece.rot === 2 && T.state.piece.x === 6;
      return r;
    });
    ok('rotation returns home', rules.rot);
    ok('wall kick', rules.kick);

    // One line
    let base = await page.evaluate(() => {
      const b = Array.from({ length: 22 }, () => new Array(10).fill(0));
      for (let c = 0; c < 10; c++) if (c < 3 || c > 6) b[21][c] = 1;
      T.set(a => { a.board(b); a.piece({ type: 'I', rot: 0, x: 3, y: 5 }); });
      const s = T.state; const v = { score: s.score, lines: s.lines, level: s.level };
      T.hardDrop();
      return v;
    });
    await page.waitForTimeout(500);
    let s = await page.evaluate(() => ({ score: T.state.score, lines: T.state.lines, bottom: T.state.board[21].some(Boolean) }));
    ok('single line', s.lines === base.lines + 1 && s.score === base.score + 30 + 100 * base.level && !s.bottom, { base, s });

    // Four lines
    base = await page.evaluate(() => {
      const b = Array.from({ length: 22 }, () => new Array(10).fill(0));
      for (let r = 18; r < 22; r++) for (let c = 0; c < 9; c++) b[r][c] = 1;
      b[17][0] = 1;
      T.set(a => { a.board(b); a.piece({ type: 'I', rot: 1, x: 7, y: 5 }); });
      const s = T.state; const v = { score: s.score, lines: s.lines, level: s.level };
      T.hardDrop();
      return v;
    });
    await page.waitForTimeout(500);
    s = await page.evaluate(() => ({ score: T.state.score, lines: T.state.lines, fell: T.state.board[21][0] === 1, rest: T.state.board.flat().filter(Boolean).length }));
    ok('tetris', s.lines === base.lines + 4 && s.score === base.score + 26 + 800 * base.level && s.fell && s.rest === 1, { base, s });

    // Keyboard
    await page.evaluate(() => T.set(a => { a.board(Array.from({ length: 22 }, () => new Array(10).fill(0))); a.piece({ type: 'L', rot: 0, x: 3, y: 4 }); }));
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('KeyZ');
    await page.keyboard.press('KeyZ');
    s = await page.evaluate(() => T.state.piece);
    ok('keyboard move + turn', s.x === 2 && s.rot === 3, s);
    await page.keyboard.press('KeyP');
    ok('pause', (await page.evaluate(() => T.state.mode)) === 'pause');
    await page.screenshot({ path: path.join(dir, 'shot-desktop-pause.png') });
    await page.keyboard.press('KeyP');
    ok('resume', (await page.evaluate(() => T.state.mode)) === 'play');

    // Snapshot and restore keep the game
    const kept = await page.evaluate(() => {
      const snap = JSON.parse(JSON.stringify(T.snapshot()));
      const before = { score: T.state.score, lines: T.state.lines, type: T.state.piece.type };
      T.restore(snap.tetris);
      return { before, after: { score: T.state.score, lines: T.state.lines, type: T.state.piece.type }, mode: T.state.mode };
    });
    ok('snapshot restore', kept.mode === 'pause' && JSON.stringify(kept.before) === JSON.stringify(kept.after), kept);
    await page.keyboard.press('Enter');

    // Play at random until the stack tops out, then start again
    const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'KeyZ', 'KeyC', 'Space', 'Space', 'ArrowDown'];
    let over = false;
    for (let i = 0; i < 900 && !over; i++) {
      await page.keyboard.press(keys[Math.floor(Math.random() * keys.length)]);
      if (i % 25 === 0) over = (await page.evaluate(() => T.state.mode)) === 'over';
    }
    await page.waitForTimeout(450);
    s = await page.evaluate(() => ({ mode: T.state.mode, score: T.state.score, lines: T.state.lines, title: document.getElementById('veil-title').textContent, text: document.getElementById('veil-text').textContent, best: document.getElementById('d-best').getAttribute('aria-label') }));
    ok('game over reached', s.mode === 'over', s);
    out.over = s;
    await page.screenshot({ path: path.join(dir, 'shot-desktop-over.png') });
    await page.keyboard.press('Enter');
    await page.waitForTimeout(80);
    s = await page.evaluate(() => ({ mode: T.state.mode, score: T.state.score, filled: T.state.board.flat().filter(Boolean).length }));
    ok('play again', s.mode === 'play' && s.score === 0 && s.filled === 0, s);
    await context.close();
  }

  /* ---- Small phone, dark theme, fractional pixel ratio ---- */
  {
    const { context, page } = await open({ viewport: { width: 360, height: 640 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true, colorScheme: 'dark' });
    ok('small phone fits', Object.values(await fits(page)).every(Boolean), await fits(page));
    await page.tap('#veil-main');
    for (let i = 0; i < 6; i++) { await page.tap('[data-act="' + ['left', 'right', 'cw'][i % 3] + '"]'); await page.tap('[data-act="drop"]'); }
    await page.waitForTimeout(400);
    out.small = await page.evaluate(() => ({ cell: T.state.cellCss, next: T.state.nextCount, canvas: document.getElementById('board').width }));
    await page.screenshot({ path: path.join(dir, 'shot-small-dark.png') });
    await context.close();
  }

  /* ---- Phone on its side ---- */
  {
    const { context, page } = await open({ viewport: { width: 740, height: 360 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    ok('landscape fits', Object.values(await fits(page)).every(Boolean), await fits(page));
    await page.tap('#veil-main');
    await page.tap('[data-act="drop"]');
    await page.waitForTimeout(100);
    out.landscape = await page.evaluate(() => ({ cell: T.state.cellCss, next: T.state.nextCount }));
    await page.screenshot({ path: path.join(dir, 'shot-landscape.png') });
    await context.close();
  }

  await browser.close();
  console.log(JSON.stringify(out, null, 2));
})().catch(e => { console.error('CHECK CRASHED', e); process.exit(1); });
