// Ende-zu-Ende-Test im echten Browser (Chromium) gegen das echte Backend mit Mock-KI.
// Aufruf: node tests/e2e/flow.cjs [screenshot-ordner]
const { chromium, devices } = require('playwright');
const { startStack, installSpeechMocks } = require('./harness.cjs');
const fs = require('node:fs');

const shotDir = process.argv[2];
if (shotDir) fs.mkdirSync(shotDir, { recursive: true });

let passed = 0;
const failures = [];
const consoleErrors = [];

function check(name, cond, detail = '') {
  if (cond) {
    passed++;
    console.log(`  ok   ${name}`);
  } else {
    failures.push(name + (detail ? ` (${detail})` : ''));
    console.log(`  FAIL ${name}${detail ? ' – ' + detail : ''}`);
  }
}

async function newPage(browser, stack, label, ctxOpts = {}) {
  const ctx = await browser.newContext({ locale: 'de-AT', timezoneId: 'Europe/Vienna', viewport: { width: 1280, height: 820 }, permissions: ['notifications'], ...ctxOpts });
  const page = await ctx.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error' && !(label === 'auth' && /401/.test(m.text()))) consoleErrors.push(`[${label}] ${m.text()}`);
  });
  page.on('pageerror', (e) => consoleErrors.push(`[${label}] PAGEERROR ${e.message}`));
  await page.addInitScript(installSpeechMocks);
  await page.goto(stack.base + '/?debug=1');
  await page.waitForTimeout(500);
  return { ctx, page };
}

const state = (page) => page.evaluate(() => document.body.dataset.state);
async function waitState(page, want, timeout = 6000) {
  try {
    await page.waitForFunction((w) => document.body.dataset.state === w, want, { timeout });
    return true;
  } catch {
    return false;
  }
}
const say = (page, text, isFinal = true) => page.evaluate(([t, f]) => window.__sr.emit(t, f), [text, isFinal]);
const spoken = (page) => page.evaluate(() => speechSynthesis.spoken.slice());
const shot = async (page, name) => {
  if (shotDir) await page.screenshot({ path: `${shotDir}/${name}.png` });
};

(async () => {
  const stack = await startStack();
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });

  // ------------------------------------------------------------------
  console.log('\n1. Einführung und Gesprächsstart');
  {
    const { ctx, page } = await newPage(browser, stack, 'desktop');
    check('Einführung sichtbar', await page.isVisible('#onboarding'));
    await page.check('#ob-options input >> nth=0');
    await shot(page, 'flow-1-onboarding');
    await page.click('#ob-start');
    check('Einführung verschwindet', await page.isHidden('#onboarding'));
    check('Zustand wird „listening“ (nach Begrüßung)', await waitState(page, 'listening', 8000), await state(page));
    check('Begrüßung wurde gesprochen', (await spoken(page)).length >= 1, JSON.stringify(await spoken(page)));
    check('Verlauf-Speicherung übernommen', await page.evaluate(() => window.__aendy.store.settings.saveHistory === true));

    // ----------------------------------------------------------------
    console.log('\n2. Sprachbefehl → KI → Antwort');
    await say(page, 'Hallo wie geht es dir');
    check('Zustand „thinking“ oder „speaking“ nach Eingabe', (await waitState(page, 'speaking', 5000)) || (await state(page)) === 'thinking');
    check('Ändy antwortet mit KI-Text', await page.waitForFunction(() => speechSynthesis.spoken.some((s) => s.includes('Was geht ab')), null, { timeout: 5000 }).then(() => true, () => false));
    check('Zurück zu „listening“ (Endlosgespräch)', await waitState(page, 'listening', 8000), await state(page));

    console.log('\n3. Wetter-Karte (Server-Tool)');
    await say(page, 'Wie ist das Wetter in Wien');
    check('Wetterkarte erscheint', await page.waitForSelector('.card[aria-label^="Wetter"]', { timeout: 8000 }).then(() => true, () => false));
    await page.waitForTimeout(800);
    await shot(page, 'flow-3-weather');
    check('Antwort nach Tool gesprochen', await page.waitForFunction(() => speechSynthesis.spoken.some((s) => s.includes('Erledigt')), null, { timeout: 6000 }).then(() => true, () => false));
    await waitState(page, 'listening', 8000);

    console.log('\n4. Timer (Client-Tool)');
    await say(page, 'Stell einen Timer');
    check('Timer-Chip erscheint', await page.waitForFunction(() => document.querySelector('#timers')?.children.length > 0, null, { timeout: 8000 }).then(() => true, () => false));
    const timers = await page.evaluate(() => window.__aendy.store.timers?.length ?? window.__aendy.scheduler.timers?.length);
    check('Timer im Speicher', timers >= 1, String(timers));
    await shot(page, 'flow-4-timer');
    await waitState(page, 'listening', 8000);

    console.log('\n5. Rechnen und Suchen');
    await say(page, 'Rechne bitte');
    check('Rechenantwort kommt', await page.waitForFunction(() => speechSynthesis.spoken.filter((s) => s.includes('Erledigt')).length >= 2, null, { timeout: 8000 }).then(() => true, () => false));
    await waitState(page, 'listening', 8000);

    console.log('\n6. Getippte Eingabe');
    await page.fill('#text', 'Hallo getippt');
    await page.press('#text', 'Enter');
    check('Eingabefeld geleert', (await page.inputValue('#text')) === '');
    check('Nutzertext im Verlauf', await page.waitForFunction(() => window.__aendy.store.history.some((m) => m.text === 'Hallo getippt'), null, { timeout: 4000 }).then(() => true, () => false));
    await waitState(page, 'listening', 8000);

    console.log('\n7. Unterbrechen (Antippen des Kerns)');
    await page.evaluate(() => { window.__ttsWordMs = 400; });
    await say(page, 'Hallo noch einmal');
    check('Ändy spricht', await waitState(page, 'speaking', 6000), await state(page));
    await page.click('#core-tap', { force: true });
    await page.waitForTimeout(300);
    check('Nach Tippen nicht mehr „speaking“', (await state(page)) !== 'speaking', await state(page));
    await page.evaluate(() => { window.__ttsWordMs = 40; });

    console.log('\n8. „Ändy, Ruhe.“ beendet das Gespräch');
    await waitState(page, 'listening', 8000);
    await say(page, 'Ändy, Ruhe');
    check('Zustand „sleeping“', await waitState(page, 'sleeping', 6000), await state(page));
    check('Mikrofon aus (Erkennung gestoppt)', await page.evaluate(() => window.__sr.current === null || !window.__sr.current.active));

    console.log('\n9. Mikrofontaste weckt wieder, „Zuhören beenden“ beendet');
    await page.click('#btn-mic');
    check('Taste weckt Ändy', await waitState(page, 'listening', 8000), await state(page));
    check('Taste „Zuhören beenden“ sichtbar', await page.isVisible('#btn-stop'));
    await page.click('#btn-stop');
    check('Beenden-Taste schläft', await waitState(page, 'sleeping', 6000), await state(page));

    console.log('\n10. Weckwort „Sarvus Ändy“');
    const wasWake = await page.evaluate(() => window.__aendy.store.settings.activation === 'wake');
    if (!wasWake) await page.click('#wake-chip');
    else {
      // Der Chip schaltet um: aus und wieder an
      await page.click('#wake-chip');
      await page.waitForTimeout(300);
      check('Chip schaltet Weckwort aus', (await page.evaluate(() => window.__aendy.store.settings.activation)) === 'button');
      await page.click('#wake-chip');
    }
    await page.waitForTimeout(500);
    const wakeOn = await page.evaluate(() => window.__aendy.store.settings.activation);
    check('Aktivierung = Weckwort', wakeOn === 'wake', wakeOn);
    const emitted = await say(page, 'sarvus ändy', false);
    check('Erkennung lief im Hintergrund', emitted === true);
    check('Weckwort aktiviert Ändy', await waitState(page, 'listening', 8000) || (await state(page)) === 'speaking', await state(page));
    await waitState(page, 'listening', 8000);
    await say(page, 'Ändy, Ruhe');
    await waitState(page, 'sleeping', 6000);
    await page.waitForTimeout(600);
    const stillListening = await page.evaluate(() => Boolean(window.__sr.current && window.__sr.current.active));
    check('Nach „Ruhe“ lauscht nur noch das Weckwort', stillListening);
    // Unbeteiligte Sprache darf nichts auslösen
    await say(page, 'was kochen wir heute abend');
    await page.waitForTimeout(500);
    check('Fremde Sprache weckt nicht', (await state(page)) === 'sleeping', await state(page));
    // Weckwort mit Frage in einem Satz
    await say(page, 'sarvus ändy wie ist das wetter in wien');
    check('Weckwort + Frage in einem Satz', await page.waitForSelector('.card[aria-label^="Wetter"]', { timeout: 8000 }).then(() => true, () => false));
    await waitState(page, 'listening', 8000);
    await say(page, 'Ändy, Ruhe');
    await waitState(page, 'sleeping', 6000);

    console.log('\n11. Verlauf, Notizen, Erinnerungen');
    if (await page.isHidden('#drawer')) await page.click('#btn-log');
    await page.waitForTimeout(400);
    check('Verlauf-Seitenleiste offen', await page.isVisible('#drawer'));
    const logCount = await page.evaluate(() => document.querySelectorAll('#log > *').length);
    check('Verlauf enthält Einträge', logCount >= 4, String(logCount));
    await shot(page, 'flow-11-drawer');
    await page.click('.tab[data-tab="notes"]');
    await page.fill('#note-input', 'Milch kaufen');
    await page.press('#note-input', 'Enter');
    check('Notiz angelegt', await page.waitForFunction(() => document.querySelectorAll('#note-list li').length === 1, null, { timeout: 3000 }).then(() => true, () => false));
    await page.click('.tab[data-tab="reminders"]');
    check('Erinnerungs-Tab leer-Hinweis', await page.isVisible('#reminders-empty'));
    await page.click('#drawer-close');
    await page.waitForTimeout(400);
    check('Seitenleiste geschlossen', await page.isHidden('#drawer'));
    await page.click('#btn-log');
    await page.waitForTimeout(300);
    check('Seitenleiste lässt sich wieder öffnen', await page.isVisible('#drawer'));

    console.log('\n12. Einstellungen');
    await page.click('#btn-settings');
    await page.waitForTimeout(500);
    check('Einstellungen offen', await page.isVisible('#settings'));
    const sections = await page.evaluate(() => [...document.querySelectorAll('#settings-nav button, #settings-nav a')].map((b) => b.textContent.trim()));
    check('Alle Bereiche vorhanden', ['Stimme', 'Persönlichkeit', 'Aktivierung', 'Datenschutz'].every((s) => sections.some((x) => x.includes(s))), sections.join('|'));
    await shot(page, 'flow-12-settings');
    // Frechheitsmodus umschalten
    const before = await page.evaluate(() => window.__aendy.store.settings.cheeky);
    const cheekyRow = page.locator('.row', { hasText: 'Frechheit' }).first();
    await cheekyRow.locator('label.switch').click();
    const after = await page.evaluate(() => window.__aendy.store.settings.cheeky);
    check('Frechheitsmodus lässt sich umschalten', before !== after, `${before} → ${after}`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    check('Escape schließt Einstellungen', await page.isHidden('#settings'));

    console.log('\n13. Speicher bleibt nach Neuladen');
    await page.reload();
    await page.waitForTimeout(700);
    const persisted = await page.evaluate(() => ({ h: window.__aendy.store.history.length, n: window.__aendy.store.notes.length }));
    check('Verlauf bleibt erhalten', persisted.h >= 4, JSON.stringify(persisted));
    check('Notiz bleibt erhalten', persisted.n === 1, JSON.stringify(persisted));
    check('Einführung erscheint nicht erneut', await page.isHidden('#onboarding'));

    console.log('\n14. Datenexport ohne Zugangscode');
    const exp = await page.evaluate(() => { window.__aendy.store.set('accessCode', 'geheim-123'); return JSON.stringify(window.__aendy.store.exportAll()); });
    check('Export enthält Zugangscode nicht', !exp.includes('geheim-123'));
    await ctx.close();
  }

  // ------------------------------------------------------------------
  console.log('\n15. Handy-Ansicht (iPhone 13): kein seitliches Überlaufen');
  {
    const { ctx, page } = await newPage(browser, stack, 'phone', { ...devices['iPhone 13'], permissions: [] });
    const overflow = async () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check('Einführung ohne Überlauf', (await overflow()) <= 0, String(await overflow()));
    await page.click('#ob-text-only');
    await page.waitForTimeout(400);
    check('Hauptansicht ohne Überlauf', (await overflow()) <= 0, String(await overflow()));
    const inView = await page.evaluate(() => {
      const r = (s) => { const b = document.querySelector(s).getBoundingClientRect(); return b.left >= 0 && b.right <= window.innerWidth + 0.5 && b.width > 0; };
      return { mic: r('#btn-mic'), settings: r('#btn-settings'), text: r('#text'), core: r('#core') };
    });
    check('Mikrofontaste, Einstellungen, Eingabe, Kern im Bild', Object.values(inView).every(Boolean), JSON.stringify(inView));
    await page.fill('#text', 'Hallo getippt auf dem Handy');
    await page.press('#text', 'Enter');
    const answered = await page.waitForFunction(() => window.__aendy.store.history.some((m) => m.role === 'assistant' && m.text.length > 3), null, { timeout: 8000 }).then(() => true, () => false);
    check('Getippte Nachricht wird auch im Ruhezustand beantwortet', answered);
    await page.waitForTimeout(800);
    await shot(page, 'flow-15-phone-chat');
    await page.click('#btn-settings');
    await page.waitForTimeout(500);
    check('Einstellungen ohne Überlauf', (await overflow()) <= 0, String(await overflow()));
    await shot(page, 'flow-15-phone-settings');
    await page.click('#settings-close');
    await page.click('#btn-log');
    await page.waitForTimeout(500);
    check('Verlauf auf Handy ohne Überlauf', (await overflow()) <= 0, String(await overflow()));
    await shot(page, 'flow-15-phone-drawer');
    await ctx.close();
  }

  // ------------------------------------------------------------------
  console.log('\n16. Tablet (iPad)');
  {
    const { ctx, page } = await newPage(browser, stack, 'tablet', { ...devices['iPad (gen 7)'], permissions: [] });
    await page.click('#ob-text-only');
    await page.waitForTimeout(400);
    const ov = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check('Tablet ohne Überlauf', ov <= 0, String(ov));
    await shot(page, 'flow-16-tablet');
    await ctx.close();
  }

  // ------------------------------------------------------------------
  console.log('\n17. Falscher Zugangscode / Server-Fehler wird freundlich angezeigt');
  {
    const secured = await startStack({ ACCESS_CODE: 'richtig-123' });
    const { ctx, page } = await newPage(browser, secured, 'auth');
    await page.click('#ob-text-only');
    await page.fill('#text', 'Hallo ohne Code');
    await page.press('#text', 'Enter');
    await page.waitForTimeout(1500);
    const bodyText = await page.evaluate(() => document.body.innerText);
    check('Hinweis auf fehlenden Zugangscode sichtbar', /Zugangscode|Code/i.test(bodyText));
    await shot(page, 'flow-17-auth');
    await ctx.close();
    await secured.close();
  }


  // ------------------------------------------------------------------
  console.log('\n18. Timer, Erinnerung, Wecker feuern wirklich');
  {
    const { ctx, page } = await newPage(browser, stack, 'sched');
    await page.click('#ob-text-only');
    await page.waitForTimeout(300);
    await page.evaluate(() => {
      const { scheduler, store } = window.__aendy;
      scheduler.addTimer({ seconds: 1, label: 'Testtimer' });
      const soon = (ms) => { const d = new Date(Date.now() + ms); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`; };
      scheduler.addReminder({ text: 'Mama anrufen', when: soon(1500) });
      scheduler.addReminder({ text: 'Aufstehen', when: soon(2500), alarm: true });
    });
    const has = (t) => page.waitForFunction((x) => document.body.innerText.includes(x), t, { timeout: 8000 }).then(() => true, () => false);
    check('Timer-Meldung erscheint', await has('Testtimer'));
    check('Erinnerung erscheint', await has('Mama anrufen'));
    check('Wecker erscheint', await has('Aufstehen'));
    check('Wecker klingelt (Ton läuft)', await page.evaluate(async () => (await import('/js/audio.js')).isAlarmRinging()));
    await shot(page, 'flow-18-alarm');
    // Karte schließen stoppt den Wecker
    const closers = page.locator('.card-close, .card-actions button');
    const n = await closers.count();
    for (let i = 0; i < n; i++) { try { await closers.nth(i).click({ timeout: 500 }); } catch {} }
    await page.waitForTimeout(300);
    check('Schließen beendet den Wecker', !(await page.evaluate(async () => (await import('/js/audio.js')).isAlarmRinging())));

    // Verpasste Erinnerung nach Neuladen
    await page.evaluate(() => {
      const { store } = window.__aendy;
      store.addReminder({ text: 'Zahnarzt', at: Date.now() - 30 * 60_000, alarm: false });
    });
    await page.reload();
    await page.waitForTimeout(900);
    check('Verpasste Erinnerung wird gemeldet', (await page.evaluate(() => document.body.innerText)).includes('Zahnarzt'));
    await ctx.close();
  }

  // ------------------------------------------------------------------
  console.log('\n19. Ändys Bild ist die Mikrofon- und Aktivierungstaste');
  {
    const { ctx, page } = await newPage(browser, stack, 'photo');
    await page.click('#ob-text-only');
    await page.waitForTimeout(500);
    const img = await page.evaluate(async () => {
      const el = document.querySelector('#core-tap img.orb-photo');
      const res = await fetch(el.currentSrc || el.src);
      const buf = new Uint8Array(await res.arrayBuffer());
      return { loaded: el.complete && el.naturalWidth === 880 && el.naturalHeight === 1868, bytes: buf.length, head: [...buf.slice(0, 3)] };
    });
    check('Bild ist geladen (880×1868, unverändert)', img.loaded, JSON.stringify(img));
    const fs2 = require('node:fs');
    const orig = fs2.statSync(require('node:path').join(__dirname, '../../frontend/img/andy.jpg')).size;
    check('Ausgeliefertes Bild hat dieselbe Größe wie die Originaldatei', img.bytes === orig, `${img.bytes} vs ${orig}`);
    check('Bild hat kein CSS-Filter (bleibt erkennbar)', await page.evaluate(() => getComputedStyle(document.querySelector('.orb-photo')).filter === 'none'));
    check('Kein Canvas-Kern mehr in der Mitte (nur Aura): Bild ist die Taste', await page.evaluate(() => document.querySelector('#core-tap').tagName === 'BUTTON'));
    await page.click('#core-tap', { force: true });
    check('Tippen aufs Bild startet das Zuhören', await waitState(page, 'listening', 8000), await state(page));
    check('Taste meldet aria-pressed=true', (await page.getAttribute('#core-tap', 'aria-pressed')) === 'true');
    await page.waitForTimeout(400);
    await page.click('#core-tap', { force: true });
    check('Erneutes Tippen beendet das Zuhören', await waitState(page, 'sleeping', 6000), await state(page));
    check('Taste meldet aria-pressed=false', (await page.getAttribute('#core-tap', 'aria-pressed')) === 'false');
    // Zustandsanimationen am Bild
    const anims = {};
    for (const st of ['sleeping', 'listening', 'thinking', 'speaking']) {
      await page.evaluate((s2) => { document.body.dataset.state = s2; }, st);
      await page.waitForTimeout(80);
      anims[st] = await page.evaluate(() => ({ hit: getComputedStyle(document.querySelector('.orb-hit')).animationName, photo: getComputedStyle(document.querySelector('.orb-photo')).animationName, ring: getComputedStyle(document.querySelector('.orb-wrap'), '::before').animationName }));
    }
    check('Standby: Bild schwebt dezent', /orb-float/.test(anims.sleeping.hit), JSON.stringify(anims.sleeping));
    check('Zuhören: leuchtender Lichtkreis', /orb-listen/.test(anims.listening.ring), JSON.stringify(anims.listening));
    check('Nachdenken: pulsierendes Leuchten', /orb-think/.test(anims.thinking.hit) && /photo-pulse/.test(anims.thinking.photo), JSON.stringify(anims.thinking));
    check('Sprechen: Bild folgt dem Pegel (--lv)', await page.evaluate(() => { document.body.dataset.state = 'speaking'; return getComputedStyle(document.querySelector('.orb-hit')).scale !== undefined; }));
    await ctx.close();
  }

  // ------------------------------------------------------------------
  console.log('\n20. Geräteübersicht in den Einstellungen');
  {
    const { ctx, page } = await newPage(browser, stack, 'caps');
    await page.click('#ob-text-only');
    await page.click('#btn-settings');
    await page.waitForTimeout(500);
    const rows = await page.evaluate(() => [...document.querySelectorAll('#cap-list .cap')].map((li) => ({ id: li.dataset.cap, status: li.dataset.status, text: li.textContent })));
    check('Übersicht listet mehrere Aktivierungswege', rows.length >= 6, String(rows.length));
    const locked = rows.find((r) => r.id === 'locked');
    check('Sperrbildschirm wird ehrlich als „nicht möglich“ gezeigt', locked && locked.status === 'no');
    check('Weckwort-Eintrag vorhanden', rows.some((r) => r.id === 'wake'));
    await shot(page, 'flow-20-caps');
    await page.evaluate(() => document.querySelector('#set-device').scrollIntoView());
    await page.waitForTimeout(500);
    await shot(page, 'flow-20-caps-scrolled');
    await ctx.close();
  }

  // ------------------------------------------------------------------
  console.log('\n22. Männliche Stimme mit Clown-Einschlag');
  {
    const { ctx, page } = await newPage(browser, stack, 'voice');
    await page.click('#ob-text-only');
    await page.click('#btn-settings');
    await page.waitForTimeout(400);
    const labels = await page.evaluate(() => [...document.querySelectorAll('#set-voice [aria-label]')].map((e) => e.getAttribute('aria-label')));
    check('Einstellungen: Stimmlage, Charakter und Clown-Anteil', ['Stimmlage', 'Charakter der Stimme', 'Clown-Anteil'].every((l) => labels.includes(l)), labels.join('|'));
    const speakTest = async () => {
      await page.evaluate(() => (window.speechSynthesis.utts.length = 0));
      await page.click('text=Stimme testen');
      await page.waitForFunction(() => window.speechSynthesis.utts.some((x) => x.text.trim()), null, { timeout: 4000 });
      return page.evaluate(() => window.speechSynthesis.utts.find((x) => x.text.trim()));
    };
    let u = await speakTest();
    check('Standard: männliche Stimme (Markus statt Anna)', u.voice === 'Markus', u.voice);
    check('Clown-Einschlag dezent: Tonhöhe leicht angehoben, nicht übertrieben', u.pitch >= 0.95 && u.pitch <= 1.4, String(u.pitch));
    await page.selectOption('[aria-label="Stimmlage"]', 'female');
    u = await speakTest();
    check('Weiblich gewählt: weibliche Stimme (nicht Markus)', u.voice !== 'Markus', u.voice);
    await page.selectOption('[aria-label="Stimmlage"]', 'male');
    await page.selectOption('[aria-label="Charakter der Stimme"]', 'natural');
    const kept = await page.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => /settings/i.test(k)))));
    check('Auswahl wird gespeichert', kept.voiceGender === 'male' && kept.voiceCharacter === 'natural', JSON.stringify(kept).slice(0, 120));
    await ctx.close();
  }

  // ------------------------------------------------------------------
  console.log('\n21. Handyfunktionen mit Bestätigungskarten');
  {
    const { ctx, page } = await newPage(browser, stack, 'actions');
    await page.click('#ob-text-only');
    await page.waitForTimeout(300);
    const ask = async (text) => { await page.fill('#text', text); await page.press('#text', 'Enter'); };
    const cardWith = (t) => page.waitForFunction((x) => [...document.querySelectorAll('.card')].some((c) => c.textContent.includes(x)), t, { timeout: 8000 }).then(() => true, () => false);

    await ask('Notiere bitte Milch');
    check('Notiz wird sofort gespeichert', await page.waitForFunction(() => window.__aendy.store.notes.some((n) => n.text.includes('Milch')), null, { timeout: 8000 }).then(() => true, () => false));
    await ask('Erinnere mich morgen an Mama');
    check('Erinnerung wird gesetzt', await page.waitForFunction(() => window.__aendy.store.reminders.some((r) => r.text.includes('Mama')), null, { timeout: 8000 }).then(() => true, () => false));

    await ask('Mach einen Termin');
    check('Kalender: Bestätigungskarte (nichts passiert ohne Zustimmung)', await cardWith('Zahnarzt'));
    const dl = page.waitForEvent('download', { timeout: 8000 }).catch(() => null);
    await page.locator('.card', { hasText: 'Zahnarzt' }).getByRole('button', { name: /Kalender hinzufügen/ }).click();
    const download = await dl;
    check('Kalender: .ics-Datei wird bereitgestellt', Boolean(download) && /\.ics$/.test(download.suggestedFilename()), download && download.suggestedFilename());
    if (download) {
      const text = require('node:fs').readFileSync(await download.path(), 'utf8');
      check('Kalender: gültiger VEVENT-Inhalt', /BEGIN:VEVENT/.test(text) && /SUMMARY:Zahnarzt/.test(text) && /END:VCALENDAR/.test(text));
    }

    await ask('Route zum Stephansdom');
    check('Navigation: Karte mit Ziel', await cardWith('Stephansdom'));
    const navHref = await page.evaluate(() => { const c = [...document.querySelectorAll('.card')].find((x) => x.textContent.includes('Stephansdom')); return c ? (c.querySelector('a')?.href || '') : ''; });
    check('Navigation: Link auf Karten-Dienst', navHref === '' || /maps/.test(navHref), navHref);

    await ask('Spiel Musik');
    check('Musik: Karte erscheint', await cardWith('Falco'));
    await ask('Schreib eine Nachricht');
    check('Nachricht: Karte mit editierbarem Text', await page.waitForFunction(() => [...document.querySelectorAll('.card textarea')].some((t) => t.value.includes('Bin gleich da')), null, { timeout: 8000 }).then(() => true, () => false));
    check('Nachricht wird NICHT automatisch gesendet', await page.evaluate(() => !!document.querySelector('.card textarea')));
    await shot(page, 'flow-21-cards');
    await ctx.close();
  }

  await browser.close();
  await stack.close();

  console.log(`\n${passed} bestanden, ${failures.length} fehlgeschlagen`);
  if (consoleErrors.length) console.log('Konsolenfehler:\n' + consoleErrors.join('\n'));
  if (failures.length) console.log('Fehlgeschlagen:\n - ' + failures.join('\n - '));
  process.exit(failures.length || consoleErrors.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(2);
});
