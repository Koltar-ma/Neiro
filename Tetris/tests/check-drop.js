// One-off check: fast-fall ticks while ▼ is held, a whistle on "Уронить", sound on by default.
const { chromium } = require('playwright');
const path = require('path');
const url = 'file://' + path.join(__dirname, 'tetris.html');

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 390, height: 760 }, isMobile: true, hasTouch: true });
  await context.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => { window.__tetrisTest = api => { window.T = api; }; });
  await page.goto(url);
  await page.waitForTimeout(300);
  const r = {};
  r.soundDefault = await page.evaluate(() => T.state.sound);
  await page.tap('#veil-main');
  await page.evaluate(() => T.set(a => a.piece({ type: 'T', rot: 0, x: 3, y: 2 })));
  // hold the ▼ key under the screen for 300 ms
  const b = await page.locator('[data-act="down"]').boundingBox();
  const cdp = await context.newCDPSession(page);
  const pt = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [pt] });
  await page.waitForTimeout(300);
  r.whileHeld = await page.evaluate(() => ({ y: T.state.piece && T.state.piece.y, soft: T.state.sfx.soft || 0 }));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(300);
  r.afterRelease = await page.evaluate(() => T.state.sfx.soft || 0);
  await page.tap('[data-act="drop"]');
  await page.waitForTimeout(100);
  r.drop = await page.evaluate(() => T.state.sfx.drop || 0);
  await page.tap('#btn-sound');
  await page.keyboard.press('ArrowDown');
  r.mutedSoftSame = await page.evaluate(() => T.state.sfx.soft || 0);
  r.errors = errors;
  console.log(JSON.stringify(r));
  await browser.close();
})().catch(e => { console.error('CRASH', e); process.exit(1); });
