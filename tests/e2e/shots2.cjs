const { chromium, devices } = require('playwright');
const { startStack, installSpeechMocks } = require('./harness.cjs');
const out = process.argv[2];
(async () => {
  const stack = await startStack();
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const errs = [];
  for (const [name, opts] of [['phone', devices['iPhone 13']], ['desktop', { viewport: { width: 1280, height: 820 } }]]) {
    const ctx = await b.newContext({ locale: 'de-AT', ...opts });
    const p = await ctx.newPage();
    p.on('console', m => m.type() === 'error' && errs.push(m.text()));
    p.on('pageerror', e => errs.push(e.message));
    await p.addInitScript(installSpeechMocks);
    await p.goto(stack.base + '/?debug=1'); await p.waitForTimeout(500);
    await p.click('#ob-text-only'); await p.waitForTimeout(800);
    await p.screenshot({ path: `${out}/img-${name}-sleep.png` });
    await p.click('#core-tap', { force: true }); await p.waitForFunction(() => document.body.dataset.state === 'listening', null, { timeout: 8000 }); await p.waitForTimeout(700);
    await p.screenshot({ path: `${out}/img-${name}-listen.png` });
    await p.evaluate(() => { window.__ttsWordMs = 500; });
    await p.evaluate(() => window.__sr.emit('Hallo wie geht es dir', true));
    await p.waitForFunction(() => document.body.dataset.state === 'speaking', null, { timeout: 8000 }).catch(() => {});
    await p.waitForTimeout(600);
    await p.screenshot({ path: `${out}/img-${name}-speak.png` });
    await ctx.close();
  }
  await b.close(); await stack.close();
  console.log(errs.length ? errs.join('\n') : 'keine Fehler');
})();
