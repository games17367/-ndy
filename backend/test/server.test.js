import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createApp } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { parseSse } from '../src/http-utils.js';
import { startMockUpstream } from './mock-upstream.js';

let mock;
let tmpFrontend;
const servers = [];

before(async () => {
  mock = await startMockUpstream();
  tmpFrontend = fs.mkdtempSync(path.join(os.tmpdir(), 'aendy-fe-'));
  fs.writeFileSync(path.join(tmpFrontend, 'index.html'), '<!doctype html><title>Ändy</title>');
  fs.writeFileSync(path.join(tmpFrontend, 'app.js'), 'export {}');
  fs.writeFileSync(path.join(tmpFrontend, 'andy.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16]));
  fs.writeFileSync(path.join(tmpFrontend, 'f.woff'), Buffer.from([1, 2, 3]));
  fs.writeFileSync(path.join(path.dirname(tmpFrontend), 'secret-aendy.txt'), 'geheim');
});

after(async () => {
  for (const s of servers) await new Promise((r) => s.close(r));
  await mock.close();
  fs.rmSync(tmpFrontend, { recursive: true, force: true });
  fs.rmSync(path.join(path.dirname(tmpFrontend), 'secret-aendy.txt'), { force: true });
});

async function start(env = {}) {
  const config = loadConfig({
    ANTHROPIC_API_KEY: 'test-key',
    ANTHROPIC_BASE_URL: mock.url,
    OPENAI_BASE_URL: `${mock.url}/openai`,
    SERVER_SPEECH: 'true',
    OPENMETEO_GEOCODING_URL: mock.url,
    OPENMETEO_FORECAST_URL: mock.url,
    BRAVE_BASE_URL: mock.url,
    WIKIPEDIA_BASE_URL: mock.url,
    FRONTEND_DIR: tmpFrontend,
    RATE_LIMIT_PER_MINUTE: '1000',
    ...env,
  });
  const server = createApp(config);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  servers.push(server);
  return `http://127.0.0.1:${server.address().port}`;
}

async function chat(base, message, extra = {}, headers = {}) {
  const res = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ messages: [{ role: 'user', content: message }], settings: {}, context: {}, ...extra }),
  });
  if (!res.ok || !res.headers.get('content-type')?.includes('event-stream')) {
    return { res, events: [], status: res.status, json: await res.json().catch(() => null) };
  }
  const events = [];
  for await (const e of parseSse(res.body)) events.push({ event: e.event, data: JSON.parse(e.data) });
  return { res, events, status: res.status };
}

const text = (events) => events.filter((e) => e.event === 'text').map((e) => e.data.delta).join('');

test('Health: meldet Funktionen', async () => {
  const base = await start();
  const j = await (await fetch(`${base}/api/health`)).json();
  assert.equal(j.ok, true);
  assert.equal(j.capabilities.chat, true);
  assert.equal(j.capabilities.provider, 'anthropic');
  assert.equal(j.capabilities.stt, false);
  assert.equal(j.capabilities.search, 'wikipedia');
  assert.equal(j.accessRequired, false);
});

test('Chat: Text wird gestreamt und mit Anthropic-Format gesendet', async () => {
  const base = await start();
  mock.requests.length = 0;
  const { events } = await chat(base, 'Hallo Ändy', { settings: { cheeky: true, humor: 90 }, context: { now: 'jetzt' } });
  assert.equal(text(events), 'Sarvus! Was geht ab?');
  assert.equal(events.at(-1).event, 'done');
  const call = mock.requests.find((r) => r.path === '/v1/messages');
  assert.equal(call.headers['x-api-key'], 'test-key');
  assert.equal(call.headers['anthropic-version'], '2023-06-01');
  assert.equal(call.body.stream, true);
  assert.match(call.body.system, /FRECHHEITSMODUS IST AN/);
  assert.ok(call.body.tools.some((t) => t.name === 'get_weather'));
  assert.ok(!call.body.tools.some((t) => t.name === 'remember_fact'));
});

test('Chat: Server-Werkzeug Wetter → Karte + Folgetext', async () => {
  const base = await start();
  const { events } = await chat(base, 'Wie ist das Wetter?');
  const names = events.map((e) => e.event);
  assert.ok(names.includes('status'));
  const card = events.find((e) => e.event === 'card');
  assert.equal(card.data.type, 'weather');
  assert.equal(card.data.data.place, 'Wien, Wien');
  assert.equal(card.data.data.current.temp, 12);
  assert.equal(card.data.data.days[1].text, 'leichter Regen');
  assert.equal(text(events), 'Moment, ich schau nach. Erledigt, sagt Ändy.');
  // Ergebnis ging ans Modell zurück
  const second = mock.requests.filter((r) => r.path === '/v1/messages').at(-1);
  const toolResult = second.body.messages.at(-1).content[0];
  assert.equal(toolResult.type, 'tool_result');
  assert.match(toolResult.content, /Regenwahrscheinlichkeit 80 Prozent/);
});

test('Chat: Websuche (Wikipedia-Fallback) und Brave', async () => {
  const base = await start();
  let r = await chat(base, 'Bitte suche etwas');
  assert.equal(text(r.events), 'Erledigt, sagt Ändy.');
  let call = mock.requests.filter((x) => x.path === '/v1/messages').at(-1);
  assert.match(call.body.messages.at(-1).content[0].content, /Wikipedia|wikipedia/);
  assert.match(call.body.messages.at(-1).content[0].content, /unvertrauenswürdige/);

  const baseBrave = await start({ BRAVE_API_KEY: 'brave-key' });
  r = await chat(baseBrave, 'Bitte suche etwas');
  call = mock.requests.filter((x) => x.path === '/v1/messages').at(-1);
  const content = call.body.messages.at(-1).content[0].content;
  assert.match(content, /brave/i);
  assert.match(content, /wien\.info/);
  assert.doesNotMatch(content, /<strong>/); // HTML entfernt

  // Brave fällt aus → Fallback
  const baseFail = await start({ BRAVE_API_KEY: 'fail' });
  await chat(baseFail, 'Bitte suche etwas');
  call = mock.requests.filter((x) => x.path === '/v1/messages').at(-1);
  assert.match(call.body.messages.at(-1).content[0].content, /wikipedia/i);
});

test('Chat: Rechner-Werkzeug', async () => {
  const base = await start();
  await chat(base, 'Bitte rechne das');
  const call = mock.requests.filter((x) => x.path === '/v1/messages').at(-1);
  assert.equal(call.body.messages.at(-1).content[0].content, 'Ergebnis: 60');
});

test('Chat: Client-Werkzeug wird als Aktion an den Browser gesendet', async () => {
  const base = await start();
  const { events } = await chat(base, 'Stell einen Timer');
  const action = events.find((e) => e.event === 'action');
  assert.equal(action.data.name, 'set_timer');
  assert.deepEqual(action.data.input, { seconds: 300, label: 'Nudeln' });
  assert.equal(text(events), 'Läuft. Erledigt, sagt Ändy.');
});

test('Chat: ungültige Werkzeug-Eingabe wird als Fehler ans Modell gemeldet, nicht als Aktion', async () => {
  const base = await start();
  const { events } = await chat(base, 'Das ist kaputt');
  assert.equal(events.filter((e) => e.event === 'action').length, 0);
  const call = mock.requests.filter((x) => x.path === '/v1/messages').at(-1);
  assert.equal(call.body.messages.at(-1).content[0].is_error, true);
});

test('Chat: Fehler des Anbieters werden freundlich gemeldet', async () => {
  const base = await start({ ANTHROPIC_API_KEY: 'bad-key' });
  const { events } = await chat(base, 'Hallo');
  const err = events.find((e) => e.event === 'error');
  assert.equal(err.data.code, 'auth');
  assert.match(err.data.message, /Schlüssel/);
});

test('Chat: ohne KI-Schlüssel → klare Fehlermeldung (503)', async () => {
  const base = await start({ ANTHROPIC_API_KEY: '' });
  const r = await chat(base, 'Hallo');
  assert.equal(r.status, 503);
  assert.equal(r.json.error.code, 'no_provider');
});

test('Chat: Eingabevalidierung', async () => {
  const base = await start();
  let res = await fetch(`${base}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{kaputt' });
  assert.equal(res.status, 400);
  res = await fetch(`${base}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages: [] }) });
  assert.equal(res.status, 400);
  res = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'x'.repeat(100_000) }] }),
  });
  assert.equal(res.status, 413);
});

test('Gedächtnis: Fakten nur bei aktivierter Speicherfunktion im Prompt', async () => {
  const base = await start();
  await chat(base, 'Hi', { memory: ['Hat einen Hund namens Bruno'], settings: { memoryEnabled: false } });
  let call = mock.requests.filter((x) => x.path === '/v1/messages').at(-1);
  assert.doesNotMatch(call.body.system, /Bruno/);
  await chat(base, 'Hi', { memory: ['Hat einen Hund namens Bruno'], settings: { memoryEnabled: true } });
  call = mock.requests.filter((x) => x.path === '/v1/messages').at(-1);
  assert.match(call.body.system, /Bruno/);
  assert.ok(call.body.tools.some((t) => t.name === 'remember_fact'));
});

test('OpenAI-kompatibler Anbieter: Streaming und Werkzeuge', async () => {
  const base = await start({ ANTHROPIC_API_KEY: '', OPENAI_API_KEY: 'sk-test' });
  let r = await chat(base, 'Hallo');
  assert.equal(text(r.events), 'Hallo von OpenAI-Mock.');
  r = await chat(base, 'Stell einen Timer');
  const action = r.events.find((e) => e.event === 'action');
  assert.deepEqual(action.data.input, { seconds: 60, label: '' });
  assert.equal(text(r.events), 'Okay. Fertig vom Mock.');
  const req = mock.requests.filter((x) => x.path === '/openai/chat/completions').at(-2);
  assert.equal(req.headers.authorization, 'Bearer sk-test');
});

test('Zugangscode schützt alle API-Endpunkte außer Health', async () => {
  const base = await start({ ACCESS_CODE: 'abc123' });
  let h = await (await fetch(`${base}/api/health`)).json();
  assert.equal(h.authorized, false);
  assert.equal(h.capabilities, undefined);
  h = await (await fetch(`${base}/api/health`, { headers: { 'x-aendy-code': 'abc123' } })).json();
  assert.equal(h.authorized, true);
  assert.ok(h.capabilities);

  const denied = await chat(base, 'Hallo');
  assert.equal(denied.status, 401);
  const allowed = await chat(base, 'Hallo', {}, { 'x-aendy-code': 'abc123' });
  assert.equal(text(allowed.events), 'Sarvus! Was geht ab?');
  assert.equal((await fetch(`${base}/api/weather?city=Wien`)).status, 401);
});

test('CORS: nur erlaubte Herkünfte; Preflight', async () => {
  const base = await start({ ALLOWED_ORIGINS: 'https://me.github.io' });
  let res = await fetch(`${base}/api/chat`, {
    method: 'OPTIONS',
    headers: { origin: 'https://me.github.io', 'access-control-request-method': 'POST' },
  });
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('access-control-allow-origin'), 'https://me.github.io');
  assert.match(res.headers.get('access-control-allow-headers'), /x-aendy-code/);

  res = await fetch(`${base}/api/health`, { headers: { origin: 'https://evil.example' } });
  assert.equal(res.status, 403);

  const ok = await chat(base, 'Hallo', {}, { origin: 'https://me.github.io' });
  assert.equal(ok.res.headers.get('access-control-allow-origin'), 'https://me.github.io');
});

test('Ratenbegrenzung greift bei Chat', async () => {
  const base = await start({ RATE_LIMIT_PER_MINUTE: '2' });
  assert.equal((await chat(base, 'a')).status, 200);
  assert.equal((await chat(base, 'b')).status, 200);
  const r = await chat(base, 'c');
  assert.equal(r.status, 429);
  assert.equal(r.res.headers.get('retry-after'), '30');
});

test('Wetter-Endpunkt', async () => {
  const base = await start();
  const j = await (await fetch(`${base}/api/weather?city=Wien`)).json();
  assert.equal(j.current.text, 'bedeckt');
  const miss = await fetch(`${base}/api/weather?city=Nirgendwo`);
  assert.equal(miss.status, 502);
  const byCoords = await (await fetch(`${base}/api/weather?lat=48.2&lon=16.3`)).json();
  assert.equal(byCoords.place, 'Dein Standort');
});

test('STT/TTS: ohne Schlüssel 501, mit Schlüssel funktionsfähig', async () => {
  let base = await start();
  let res = await fetch(`${base}/api/tts`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'Hi' }) });
  assert.equal(res.status, 501);

  base = await start({ OPENAI_API_KEY: 'sk-test' });
  const h = await (await fetch(`${base}/api/health`)).json();
  assert.equal(h.capabilities.stt, true);
  assert.ok(h.capabilities.ttsVoices.includes('ash'));

  res = await fetch(`${base}/api/tts`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'Servus', voice: 'nova', speed: 1.2 }) });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'audio/mpeg');
  assert.equal((await res.arrayBuffer()).byteLength, 8);
  const ttsReq = mock.requests.filter((x) => x.path === '/openai/audio/speech').at(-1);
  assert.equal(ttsReq.body.voice, 'nova');
  assert.equal(ttsReq.body.speed, 1.2);
  assert.match(ttsReq.body.instructions, /Freund/); // Standard: natürlich, ohne Clown

  await fetch(`${base}/api/tts`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'Hallo', voice: 'ash', style: 'clown', intensity: 20 }) });
  const low = mock.requests.filter((x) => x.path === '/openai/audio/speech').at(-1).body.instructions;
  await fetch(`${base}/api/tts`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'Hallo', voice: 'ash', style: 'clown', intensity: 90 }) });
  const high = mock.requests.filter((x) => x.path === '/openai/audio/speech').at(-1).body.instructions;
  assert.match(low, /männlich/);
  assert.match(low, /ganz dezent/);
  assert.match(high, /deutlich spürbar/);
  await fetch(`${base}/api/tts`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'Hallo', style: '<böse>' }) });
  assert.match(mock.requests.filter((x) => x.path === '/openai/audio/speech').at(-1).body.instructions, /Freund/);

  const audio = Buffer.alloc(4000, 1);
  res = await fetch(`${base}/api/stt?lang=de`, { method: 'POST', headers: { 'content-type': 'audio/webm;codecs=opus' }, body: audio });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).text, 'Sarvus Ändy wie spät ist es');
  const sttReq = mock.requests.filter((x) => x.path === '/openai/audio/transcriptions').at(-1);
  assert.match(sttReq.headers['content-type'], /multipart\/form-data/);

  res = await fetch(`${base}/api/stt`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: audio });
  assert.equal(res.status, 415);
});

test('Statische Dateien: Auslieferung, Sicherheits-Header, kein Pfad-Ausbruch', async () => {
  const base = await start();
  let res = await fetch(`${base}/`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  assert.match(res.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  res = await fetch(`${base}/app.js`);
  assert.match(res.headers.get('content-type'), /javascript/);

  // Pfad-Ausbruch (roh gesendet, damit der Client den Pfad nicht normalisiert)
  const net = await import('node:net');
  const port = new URL(base).port;
  const raw = await new Promise((resolve) => {
    const s = net.connect(Number(port), '127.0.0.1', () => {
      s.write('GET /../secret-aendy.txt HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n');
    });
    let data = '';
    s.on('data', (c) => (data += c));
    s.on('close', () => resolve(data));
  });
  assert.match(raw, /^HTTP\/1.1 404/);
  assert.doesNotMatch(raw, /geheim/);
  const enc = await fetch(`${base}/%2e%2e/secret-aendy.txt`);
  assert.equal(enc.status, 404);

  assert.equal((await fetch(`${base}/gibts-nicht.js`)).status, 404);
});

test('SERVE_FRONTEND=false liefert keine Dateien aus', async () => {
  const base = await start({ SERVE_FRONTEND: 'false' });
  assert.equal((await fetch(`${base}/`)).status, 404);
});

test('Statische Dateien: Bilder und Schriften bekommen den richtigen MIME-Typ', async () => {
  const base = await start();
  const jpg = await fetch(`${base}/andy.jpg`);
  assert.equal(jpg.status, 200);
  assert.equal(jpg.headers.get('content-type'), 'image/jpeg');
  assert.equal((await jpg.arrayBuffer()).byteLength, 6);
  const font = await fetch(`${base}/f.woff`);
  assert.equal(font.headers.get('content-type'), 'font/woff');
});
