// Builds tetris.html: the same game as one ordinary web page that opens in any browser.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const dir = __dirname;
const src = fs.readFileSync(path.join(dir, 'pocket-tetris.html'), 'utf8');
const cut = src.indexOf('</style>') + '</style>'.length;
const html = `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<style>:root{padding:env(safe-area-inset-top,0px) 0 env(safe-area-inset-bottom,0px)}[hidden]{display:none!important}</style>
${src.slice(0, cut).trim()}
</head>
<body>
${src.slice(cut).trim()}
</body>
</html>
`;
const out = path.join(dir, 'tetris.html');
fs.writeFileSync(out, html);

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 390, height: 760 }, isMobile: true, hasTouch: true });
  await context.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => { window.__tetrisTest = api => { window.T = api; }; });
  await page.goto('file://' + out);
  await page.waitForTimeout(300);
  const title = await page.title();
  await page.tap('#veil-main');
  await page.tap('[data-act="drop"]');
  await page.waitForTimeout(100);
  const s = await page.evaluate(() => ({
    mode: T.state.mode,
    score: T.state.score,
    veilHidden: getComputedStyle(document.getElementById('veil')).display === 'none',
    standards: document.compatMode,
  }));
  console.log(JSON.stringify({ bytes: html.length, title, errors, ...s, hasToastFix: html.includes("if (mode !== 'play') el.toast.hidden = true") }));
  await browser.close();
})().catch(e => { console.error('BUILD CHECK CRASHED', e); process.exit(1); });
