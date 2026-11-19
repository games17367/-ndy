// Erster Sichtcheck: Screenshots in mehreren Größen
const { chromium, devices } = require('playwright');
const { startStack, installSpeechMocks } = require('./harness.cjs');
const fs = require('node:fs');
const out = process.argv[2];

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const stack = await startStack();
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const errors = [];
  const shoot = async (name, ctxOpts, steps) => {
    const ctx = await browser.newContext({ locale: 'de-AT', timezoneId: 'Europe/Vienna', ...ctxOpts });
    const page = await ctx.newPage();
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`[${name}] ${m.text()}`); });
    page.on('pageerror', (e) => errors.push(`[${name}] PAGEERROR ${e.message}`));
    await page.addInitScript(installSpeechMocks);
    await page.goto(stack.base + '/?debug=1');
    await page.waitForTimeout(700);
    await steps(page);
    await page.screenshot({ path: `${out}/${name}.png` });
    await ctx.close();
  };

  await shoot('phone-onboarding', { ...devices['iPhone 13'] }, async () => {});
  await shoot('phone-main', { ...devices['iPhone 13'] }, async (p) => {
    await p.evaluate(() => window.__aendy.store.set('onboarded', true));
    await p.reload(); await p.waitForTimeout(700);
  });
  await shoot('desktop-main', { viewport: { width: 1440, height: 900 } }, async (p) => {
    await p.evaluate(() => window.__aendy.store.set('onboarded', true));
    await p.reload(); await p.waitForTimeout(700);
  });
  await browser.close();
  await stack.close();
  console.log(errors.length ? 'FEHLER:\n' + errors.join('\n') : 'keine Konsolenfehler');
})();
