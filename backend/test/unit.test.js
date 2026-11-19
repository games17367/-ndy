import { test } from 'node:test';
import assert from 'node:assert/strict';

import { evaluate, formatNumber } from '../src/calc.js';
import { buildSystemPrompt, sanitizeSettings, sanitizeContext, cleanText } from '../src/persona.js';
import { RateLimiter, checkAccessCode, corsHeaders, isOriginForbidden } from '../src/security.js';
import { getToolDefinitions, runTool } from '../src/tools.js';
import { sanitizeHistory } from '../src/chat-loop.js';
import { toWireMessages as anthropicWire } from '../src/providers/anthropic.js';
import { toWireMessages as openaiWire } from '../src/providers/openai.js';
import { loadConfig } from '../src/config.js';

test('Rechner: Grundrechenarten, Klammern, Potenz, Prozent', () => {
  assert.equal(evaluate('2+3*4'), 14);
  assert.equal(evaluate('(2+3)*4'), 20);
  assert.equal(evaluate('2^3^2'), 512); // rechtsassoziativ
  assert.equal(evaluate('-2^2'), -4);
  assert.equal(evaluate('80*19%'), 15.2);
  assert.equal(evaluate('2(3+4)'), 14);
  assert.equal(evaluate('3,5*2'), 7);
  assert.equal(evaluate('10 ÷ 4'), 2.5);
  assert.ok(Math.abs(evaluate('sqrt(2)^2') - 2) < 1e-12);
  assert.equal(evaluate('max(3, 9, 4)'), 9);
  assert.equal(evaluate('round(2.5)'), 3);
  assert.ok(Math.abs(evaluate('2pi') - 2 * Math.PI) < 1e-12);
  assert.equal(formatNumber(0.1 + 0.2), '0.3');
});

test('Rechner: Fehler und Sicherheit (kein eval)', () => {
  assert.throws(() => evaluate('1/0'), /null/);
  assert.throws(() => evaluate('2+'), /endet/);
  assert.throws(() => evaluate('foo(1)'), /Funktion/);
  assert.throws(() => evaluate('process.exit()'), /Unerwartet|Unbekannt/);
  assert.throws(() => evaluate('require("fs")'), /Funktion|Unerwartet/);
  assert.throws(() => evaluate('(' .repeat(40) + '1' + ')'.repeat(40)), /tief/);
  assert.throws(() => evaluate('9^9^9^9'), /endlich/);
  assert.throws(() => evaluate('1'.repeat(300)), /lang/);
  assert.throws(() => evaluate(''), /Kein/);
});

test('Persona: Einstellungen werden begrenzt und bereinigt', () => {
  const s = sanitizeSettings({ humor: 999, cheeky: 1, length: 'x', dialect: 'x', userName: 'A\nB'.repeat(50), customInstruction: 'x'.repeat(5000) });
  assert.equal(s.humor, 100);
  assert.equal(s.cheeky, true);
  assert.equal(s.length, 'normal');
  assert.equal(s.dialect, 'standard');
  assert.ok(s.userName.length <= 40 && !s.userName.includes('\n'));
  assert.equal(s.customInstruction.length, 600);
  assert.equal(cleanText('a\u0000b\n\nc', 10), 'a b c');
});

test('Persona: Frechheitsmodus und Gedächtnis erscheinen nur bei Aktivierung', () => {
  const tools = getToolDefinitions({ memoryEnabled: false });
  const off = buildSystemPrompt({ settings: { cheeky: false }, context: {}, memory: ['Hund heißt Bruno'], tools });
  assert.match(off, /Frechheitsmodus ist AUS/);
  assert.doesNotMatch(off, /Bruno/); // Gedächtnis aus → keine Fakten
  assert.match(off, /Langzeitgedächtnis ist aus/);

  const on = buildSystemPrompt({
    settings: { cheeky: true, memoryEnabled: true, userName: 'Simon', dialect: 'austrian' },
    context: { now: 'Dienstag, 17. November 2026, 20:07', tz: 'Europe/Vienna' },
    memory: ['Hund heißt Bruno'],
    tools: getToolDefinitions({ memoryEnabled: true }),
  });
  assert.match(on, /FRECHHEITSMODUS IST AN/);
  assert.match(on, /Bruno/);
  assert.match(on, /Simon/);
  assert.match(on, /österreichisch/);
  assert.match(on, /17\. November 2026/);
  assert.match(on, /remember_fact/);
});

test('Kontext: ungültige Koordinaten werden verworfen', () => {
  assert.equal(sanitizeContext({ coords: { lat: 'abc', lon: 3 } }).coords, null);
  assert.deepEqual(sanitizeContext({ coords: { lat: 999, lon: 3 } }).coords, { lat: 90, lon: 3 });
});

test('Verlauf: beginnt mit Nutzer, wird gekürzt und bereinigt', () => {
  const h = sanitizeHistory([
    { role: 'assistant', content: 'Hi' },
    { role: 'user', content: '  Hallo ' },
    { role: 'system', content: 'böse' },
    { role: 'assistant', content: 42 },
    { role: 'assistant', content: 'Sarvus' },
  ]);
  assert.deepEqual(h, [
    { role: 'user', content: 'Hallo' },
    { role: 'assistant', content: 'Sarvus' },
  ]);
  const long = Array.from({ length: 80 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: String(i) }));
  assert.ok(sanitizeHistory(long).length <= 30);
});

test('Zugangscode, CORS, Herkunft', () => {
  const cfg = { accessCode: 'geheim', allowedOrigins: ['https://me.github.io'] };
  assert.throws(() => checkAccessCode(cfg, { headers: {} }), /Zugangscode/);
  assert.throws(() => checkAccessCode(cfg, { headers: { 'x-aendy-code': 'falsch' } }));
  assert.doesNotThrow(() => checkAccessCode(cfg, { headers: { 'x-aendy-code': 'geheim' } }));
  assert.doesNotThrow(() => checkAccessCode({ accessCode: '' }, { headers: {} }));

  const good = { headers: { origin: 'https://me.github.io', host: 'api.example.com' } };
  const bad = { headers: { origin: 'https://evil.example', host: 'api.example.com' } };
  const same = { headers: { origin: 'https://api.example.com', host: 'api.example.com' } };
  assert.equal(corsHeaders(cfg, good)['access-control-allow-origin'], 'https://me.github.io');
  assert.deepEqual(corsHeaders(cfg, bad), {});
  assert.equal(isOriginForbidden(cfg, good), false);
  assert.equal(isOriginForbidden(cfg, bad), true);
  assert.equal(isOriginForbidden(cfg, same), false);
  assert.equal(isOriginForbidden(cfg, { headers: {} }), false);
});

test('Ratenbegrenzung und Tageslimit', () => {
  let t = 1_000_000;
  const rl = new RateLimiter({ perMinute: 3, dailyCap: 5, now: () => t });
  rl.check('a');
  rl.check('a');
  rl.check('a');
  assert.throws(() => rl.check('a'), /Zu viele/);
  rl.check('b'); // andere IP
  t += 61_000;
  rl.check('a'); // Fenster vorbei → Tageslimit (5) erreicht beim nächsten
  assert.throws(() => rl.check('c'), /Tageslimit/);
  t += 24 * 3600_000;
  rl.check('c'); // neuer Tag
});

test('Werkzeuge: Auswahl und Validierung', async () => {
  const base = getToolDefinitions({ memoryEnabled: false }).map((t) => t.name);
  assert.ok(base.includes('web_search') && base.includes('set_timer'));
  assert.ok(!base.includes('remember_fact'));
  assert.ok(getToolDefinitions({ memoryEnabled: true }).some((t) => t.name === 'remember_fact'));

  const ctx = { config: loadConfig({}), context: {} };
  const ok = await runTool('set_timer', { seconds: 90.4, label: '  Tee ' }, ctx);
  assert.equal(ok.kind, 'action');
  assert.deepEqual(ok.input, { seconds: 90, label: 'Tee' });

  assert.equal((await runTool('set_timer', { seconds: 0 }, ctx)).kind, 'error');
  assert.equal((await runTool('add_reminder', { text: 'x', when: 'morgen' }, ctx)).kind, 'error');
  assert.equal((await runTool('add_reminder', { text: 'Mama', when: '2026-11-18T08:00' }, ctx)).kind, 'action');
  assert.equal((await runTool('open_url', { url: 'http://unsicher.example' }, ctx)).kind, 'error'); // nur https
  assert.equal((await runTool('open_url', { url: 'javascript:alert(1)' }, ctx)).kind, 'error');
  assert.equal((await runTool('compose_message', { channel: 'fax', body: 'x' }, ctx)).kind, 'error');
  assert.equal((await runTool('set_setting', { key: 'apiKey', value: 1 }, ctx)).kind, 'error'); // nicht erlaubt
  assert.deepEqual((await runTool('set_setting', { key: 'speechRate', value: 9 }, ctx)).input, { key: 'speechRate', value: 1.6 });
  assert.equal((await runTool('nicht_da', {}, ctx)).kind, 'error');
  const calc = await runTool('calculate', { expression: '(12.5+7.5)*3' }, ctx);
  assert.equal(calc.text, 'Ergebnis: 60');
  assert.equal((await runTool('calculate', { expression: '1/0' }, ctx)).kind, 'error');
});

test('Provider-Nachrichtenformate', () => {
  const msgs = [
    { role: 'user', content: 'Timer' },
    { role: 'assistant', content: 'Okay', toolCalls: [{ id: 't1', name: 'set_timer', input: { seconds: 5 } }] },
    { role: 'tool', results: [{ id: 't1', text: 'ok' }] },
  ];
  const a = anthropicWire(msgs);
  assert.equal(a[1].content[1].type, 'tool_use');
  assert.equal(a[2].content[0].type, 'tool_result');
  assert.equal(a[2].content[0].tool_use_id, 't1');
  const o = openaiWire('SYS', msgs);
  assert.equal(o[0].role, 'system');
  assert.equal(o[2].tool_calls[0].function.arguments, '{"seconds":5}');
  assert.equal(o[3].role, 'tool');
});

test('Konfiguration: Provider-Erkennung und Standardwerte', () => {
  assert.equal(loadConfig({}).provider, 'none');
  assert.equal(loadConfig({ ANTHROPIC_API_KEY: 'x' }).provider, 'anthropic');
  assert.equal(loadConfig({ OPENAI_API_KEY: 'x' }).provider, 'openai');
  assert.equal(loadConfig({ ANTHROPIC_API_KEY: 'x', AI_PROVIDER: 'openai' }).provider, 'openai');
  assert.equal(loadConfig({ PORT: '1234' }).port, 1234);
  assert.equal(loadConfig({ ALLOWED_ORIGINS: 'a, b ,' }).allowedOrigins.length, 2);
  assert.equal(loadConfig({}).accessCode, '');
});

test('Config: Server-Sprache nur bei OpenAI selbst automatisch an (nicht bei Gemini & Co.)', () => {
  assert.equal(loadConfig({ OPENAI_API_KEY: 'x' }).openai.speech, true);
  assert.equal(loadConfig({ OPENAI_API_KEY: 'x', OPENAI_BASE_URL: 'https://api.openai.com/v1' }).openai.speech, true);
  assert.equal(loadConfig({ OPENAI_API_KEY: 'x', OPENAI_BASE_URL: 'https://generativelanguage.googleapis.com/v1beta/openai/' }).openai.speech, false);
  assert.equal(loadConfig({ OPENAI_API_KEY: 'x', OPENAI_BASE_URL: 'https://example.org/v1', SERVER_SPEECH: 'true' }).openai.speech, true);
  assert.equal(loadConfig({ OPENAI_API_KEY: 'x', SERVER_SPEECH: 'false' }).openai.speech, false);
});

test('Config: GEMINI_API_KEY genügt – Gemini-Adresse, Modell, keine Server-Sprache', () => {
  const c = loadConfig({ GEMINI_API_KEY: 'g' });
  assert.equal(c.provider, 'openai');
  assert.equal(c.openai.label, 'gemini');
  assert.equal(c.openai.apiKey, 'g');
  assert.equal(c.openai.baseUrl, 'https://generativelanguage.googleapis.com/v1beta/openai');
  assert.ok(c.openai.chatModel.startsWith('gemini'));
  assert.equal(c.openai.speech, false);
  assert.equal(loadConfig({ GEMINI_API_KEY: 'g', GEMINI_MODEL: 'gemini-x' }).openai.chatModel, 'gemini-x');
});

test('Config: Anthropic hat Vorrang, AI_PROVIDER=gemini erzwingt Gemini', () => {
  assert.equal(loadConfig({ ANTHROPIC_API_KEY: 'a', GEMINI_API_KEY: 'g' }).provider, 'anthropic');
  const forced = loadConfig({ ANTHROPIC_API_KEY: 'a', GEMINI_API_KEY: 'g', AI_PROVIDER: 'gemini' });
  assert.equal(forced.provider, 'openai');
  assert.equal(forced.openai.label, 'gemini');
});
