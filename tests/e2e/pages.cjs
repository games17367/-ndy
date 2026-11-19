// Simuliert GitHub Pages: Website unter /aendy/ auf einem ANDEREN Server als das Backend
// (CORS, Zugangscode, Service Worker, relative Pfade).
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { startStack, installSpeechMocks, root } = require('./harness.cjs');

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff': 'font/woff' };
let passed = 0; const fails = [];
const check = (n, c, d = '') => { if (c) { passed++; console.log('  ok  ', n); } else { fails.push(n); console.log('  FAIL', n, d); } };

(async () => {
  // Statischer Server wie GitHub Pages: nur unter /aendy/, ohne Backend
  let pagesOrigin = '';
  const pages = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (!u.pathname.startsWith('/aendy/')) { res.writeHead(404); return res.end(); }
    let rel = u.pathname.slice('/aendy/'.length) || 'index.html';
    if (rel.endsWith('/')) rel += 'index.html';
    let file = path.join(root, 'frontend', rel);
    if (rel === 'config.js') { // so schreibt der Workflow die Datei
      res.writeHead(200, { 'content-type': 'text/javascript' });
      return res.end('window.AENDY_CONFIG = ' + JSON.stringify({ apiBase: global.__backend }) + ';\n');
    }
    if (!file.startsWith(path.join(root, 'frontend')) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((r) => pages.listen(0, '127.0.0.1', r));
  pagesOrigin = `http://127.0.0.1:${pages.address().port}`;

  const stack = await startStack({ ACCESS_CODE: 'richtig-123', ALLOWED_ORIGINS: pagesOrigin, SERVE_FRONTEND: 'false' });
  global.__backend = stack.base;

  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ locale: 'de-AT' });
  const page = await ctx.newPage();
  const bad = []; const errors = [];
  page.on('response', (r) => { if (r.status() >= 400 && !/\/api\/chat$/.test(r.url())) bad.push(`${r.status()} ${r.url()}`); });
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(installSpeechMocks);

  console.log('\nGitHub-Pages-Simulation');
  await page.goto(`${pagesOrigin}/aendy/?debug=1`);
  await page.waitForTimeout(1200);
  check('Seite lädt unter /aendy/ ohne 404', bad.filter((b) => !/favicon|sw\.js/.test(b)).length === 0, bad.join(', '));
  check('Backend-Adresse aus config.js übernommen', await page.evaluate(() => window.AENDY_CONFIG.apiBase) === stack.base);
  check('Zugangscode-Hinweis erscheint (Backend verlangt Code)', (await page.evaluate(() => document.body.innerText)).includes('Zugangscode'));
  check('Service Worker ist (auf localhost) registriert', await page.evaluate(async () => (await navigator.serviceWorker.getRegistration('./')) !== undefined));

  await page.click('#ob-text-only');
  await page.evaluate(() => window.__aendy.store.set('accessCode', 'falsch'));
  await page.evaluate(() => window.__aendy.assistant.refreshHealth());
  check('Falscher Code: weiterhin gesperrt', (await page.evaluate(() => window.__aendy.assistant.caps.chat)) === false);
  await page.evaluate(() => window.__aendy.store.set('accessCode', 'richtig-123'));
  await page.evaluate(() => window.__aendy.assistant.refreshHealth());
  check('Richtiger Code über CORS akzeptiert, KI bereit', (await page.evaluate(() => window.__aendy.assistant.caps.chat)) === true);

  await page.fill('#text', 'Hallo von GitHub Pages');
  await page.press('#text', 'Enter');
  const answered = await page.waitForFunction(() => window.__aendy.store.history?.some((m) => m.role === 'assistant') || document.querySelector('#log .line-andy, .line-andy'), null, { timeout: 8000 }).then(() => true, () => false);
  await page.evaluate(() => window.__aendy.store.set('saveHistory', true));
  check('Antwort kommt über Cross-Origin-Streaming', answered);

  // Unbefugte Herkunft wird abgewiesen
  const rogue = await fetch(`${stack.base}/api/health`, { headers: { origin: 'https://boese.example' } });
  check('Fremde Herkunft bekommt 403', rogue.status === 403, String(rogue.status));
  const noCode = await (await fetch(`${stack.base}/api/health`, { headers: { origin: pagesOrigin } })).json();
  check('Ohne Code: keine Funktionsliste', noCode.authorized === false && !noCode.capabilities);
  const chatNoCode = await fetch(`${stack.base}/api/chat`, { method: 'POST', headers: { origin: pagesOrigin, 'content-type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }) });
  check('Chat ohne Code: 401', chatNoCode.status === 401, String(chatNoCode.status));
  check('Backend liefert die Website NICHT aus (SERVE_FRONTEND=false)', (await fetch(stack.base + '/')).status === 404);

  // Offline: Oberfläche kommt aus dem Service-Worker-Cache
  await page.waitForTimeout(800);
  await ctx.setOffline(true);
  await page.reload();
  await page.waitForTimeout(1000);
  check('Offline: Oberfläche lädt aus dem Cache', await page.evaluate(() => Boolean(document.querySelector('#core-tap'))));
  check('Offline: Bild ist da', await page.evaluate(() => document.querySelector('.orb-photo').naturalWidth === 880));
  await ctx.setOffline(false);

  // Nur Website, kein Server (häufigster Fehler: GitHub Pages ohne Backend)
  global.__backend = '';
  const ctx2 = await browser.newContext({ locale: 'de-AT' });
  const p2 = await ctx2.newPage();
  await p2.addInitScript(installSpeechMocks);
  await p2.goto(`${pagesOrigin}/aendy/?debug=1`);
  await p2.waitForTimeout(1000);
  await p2.click('#ob-text-only');
  const banner = await p2.evaluate(() => document.querySelector('#banners')?.innerText || '');
  check('Ohne Server: klare Meldung statt „404“', /kein Ändy-Server/.test(banner) && !/Unerwartete Antwort/.test(banner), banner);
  check('Ohne Server: Knopf führt zur Server-Adresse', /Server eintragen/.test(banner), banner);
  await p2.fill('#text', 'Hallo');
  await p2.press('#text', 'Enter');
  await p2.waitForTimeout(1200);
  const log = await p2.evaluate(() => document.body.innerText);
  check('Ohne Server: Antwort im Chat erklärt das Problem', /kein Ändy-Server/.test(log));
  await ctx2.close();

  check('Keine Konsolenfehler', errors.filter((e) => !/401|403|Failed to load resource|net::ERR/.test(e)).length === 0, errors.join(' | '));
  await browser.close(); await stack.close(); await new Promise((r) => pages.close(r));
  console.log(`\n${passed} bestanden, ${fails.length} fehlgeschlagen`);
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
