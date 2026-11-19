// ÄNDY-Backend: HTTP-Server ohne externe Abhängigkeiten.
//   GET  /api/health    Status und verfügbare Funktionen
//   POST /api/chat      KI-Gespräch als Server-Sent-Events (Streaming)
//   GET  /api/weather   Wetterdaten
//   POST /api/stt       Server-Spracherkennung (optional)
//   POST /api/tts       Server-Sprachausgabe (optional)
// Außerdem liefert der Server auf Wunsch das Frontend aus (SERVE_FRONTEND).

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadConfig } from './config.js';
import { HttpError, sendJson, readJson, readBody, openSse, clientIp } from './http-utils.js';
import { checkAccessCode, corsHeaders, isOriginForbidden, RateLimiter } from './security.js';
import { buildSystemPrompt, sanitizeSettings, sanitizeContext, sanitizeMemory } from './persona.js';
import { getToolDefinitions } from './tools.js';
import { runChat, sanitizeHistory } from './chat-loop.js';
import { createAnthropicProvider, ProviderError } from './providers/anthropic.js';
import { createOpenAiProvider } from './providers/openai.js';
import { getWeather } from './weather.js';
import { speechAvailable, transcribe, synthesize, TTS_VOICES } from './speech.js';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

const STATIC_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'permissions-policy': 'microphone=(self), geolocation=(self), camera=()',
  'content-security-policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob: data:; connect-src 'self' https: http://localhost:* http://127.0.0.1:*; worker-src 'self'; manifest-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};

function createProvider(config) {
  if (config.provider === 'anthropic' && config.anthropic.apiKey) return createAnthropicProvider(config);
  if (config.provider === 'openai' && config.openai.apiKey) return createOpenAiProvider(config);
  return null;
}

export function createApp(config = loadConfig()) {
  const provider = createProvider(config);
  const limiter = new RateLimiter({ perMinute: config.rateLimitPerMinute, dailyCap: config.dailyRequestCap });

  function capabilities() {
    return {
      chat: Boolean(provider),
      provider: provider?.name || 'none',
      model: provider?.model || '',
      stt: speechAvailable(config),
      tts: speechAvailable(config),
      ttsVoices: speechAvailable(config) ? TTS_VOICES : [],
      search: config.search.braveKey ? 'brave' : 'wikipedia',
      weather: true,
    };
  }

  // ----- Handler ---------------------------------------------------------

  async function handleHealth(req, res, cors) {
    let authorized = true;
    try {
      checkAccessCode(config, req);
    } catch {
      authorized = false;
    }
    sendJson(
      res,
      200,
      {
        ok: true,
        name: 'aendy',
        version: config.version,
        accessRequired: Boolean(config.accessCode),
        authorized,
        ...(authorized ? { capabilities: capabilities() } : {}),
      },
      cors
    );
  }

  async function handleChat(req, res, cors) {
    if (!provider) {
      throw new HttpError(503, 'no_provider', 'Auf dem Server ist noch kein KI-Schlüssel eingerichtet (ANTHROPIC_API_KEY, GEMINI_API_KEY oder OPENAI_API_KEY).');
    }
    const body = await readJson(req, config.maxBodyBytes);
    const history = sanitizeHistory(body.messages);
    if (!history.length || history[history.length - 1].role !== 'user') {
      throw new HttpError(400, 'bad_messages', 'Die Nachricht fehlt.');
    }
    const settings = sanitizeSettings(body.settings);
    const context = sanitizeContext(body.context);
    const memory = sanitizeMemory(body.memory);
    const tools = getToolDefinitions({ memoryEnabled: settings.memoryEnabled });
    const system = buildSystemPrompt({ settings, context, memory, tools });

    // SSE-Header setzt openSse; CORS-Header müssen vorher gesetzt werden.
    for (const [k, v] of Object.entries(cors)) res.setHeader(k, v);
    const sse = openSse(res);

    const controller = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) controller.abort(new Error('client_closed'));
    });

    try {
      await runChat({
        provider,
        system,
        history,
        tools,
        context,
        config,
        signal: controller.signal,
        emit: (event, data) => sse.send(event, data),
      });
    } catch (err) {
      if (!controller.signal.aborted) {
        const known = err instanceof ProviderError;
        if (!known) console.error('[chat] Fehler:', err);
        sse.send('error', {
          code: known ? err.code : 'internal',
          message: known ? err.message : 'Da ist bei mir etwas schiefgelaufen. Versuch es gleich noch mal.',
        });
      }
    } finally {
      sse.close();
    }
  }

  async function handleWeather(req, res, url, cors) {
    const location = url.searchParams.get('city') || '';
    const lat = Number(url.searchParams.get('lat'));
    const lon = Number(url.searchParams.get('lon'));
    const coords = Number.isFinite(lat) && Number.isFinite(lon) && url.searchParams.has('lat') ? { lat, lon } : null;
    try {
      const data = await getWeather(config, { location, coords });
      sendJson(res, 200, data, cors);
    } catch (err) {
      throw new HttpError(502, 'weather_failed', err.message);
    }
  }

  async function handleStt(req, res, url, cors) {
    const audio = await readBody(req, config.maxAudioBytes);
    const text = await transcribe(config, audio, req.headers['content-type'] || '', url.searchParams.get('lang') || 'de');
    sendJson(res, 200, { text }, cors);
  }

  async function handleTts(req, res, cors) {
    const body = await readJson(req, config.maxBodyBytes);
    const controller = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) controller.abort(new Error('client_closed'));
    });
    const upstream = await synthesize(config, body, controller.signal);
    res.writeHead(200, { 'content-type': 'audio/mpeg', 'cache-control': 'no-store', ...cors });
    try {
      for await (const chunk of upstream.body) {
        if (!res.write(chunk)) await new Promise((r) => res.once('drain', r));
      }
    } finally {
      res.end();
    }
  }

  // ----- Statische Dateien ---------------------------------------------

  function serveStatic(req, res, url) {
    if (!config.serveFrontend) return false;
    if (req.method !== 'GET' && req.method !== 'HEAD') return false;
    let rel;
    try {
      rel = decodeURIComponent(url.pathname);
    } catch {
      return false;
    }
    if (rel.endsWith('/')) rel += 'index.html';
    const root = path.resolve(config.frontendDir);
    const file = path.resolve(root, '.' + path.sep + rel);
    if (file !== root && !file.startsWith(root + path.sep)) return false;
    let stat;
    try {
      stat = fs.statSync(file);
    } catch {
      return false;
    }
    if (!stat.isFile()) return false;
    const ext = path.extname(file).toLowerCase();
    const noCache = ext === '.html' || path.basename(file) === 'sw.js' || ext === '.webmanifest';
    res.writeHead(200, {
      'content-type': MIME[ext] || 'application/octet-stream',
      'content-length': stat.size,
      'cache-control': noCache ? 'no-cache' : 'public, max-age=3600',
      ...STATIC_HEADERS,
    });
    if (req.method === 'HEAD') res.end();
    else fs.createReadStream(file).pipe(res);
    return true;
  }

  // ----- Haupt-Router ---------------------------------------------------

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');
    const isApi = url.pathname.startsWith('/api/');

    try {
      if (!isApi) {
        if (serveStatic(req, res, url)) return;
        throw new HttpError(404, 'not_found', 'Nicht gefunden.');
      }

      if (isOriginForbidden(config, req)) {
        throw new HttpError(403, 'origin', 'Diese Herkunft ist nicht erlaubt (ALLOWED_ORIGINS).');
      }
      const cors = corsHeaders(config, req);

      if (req.method === 'OPTIONS') {
        res.writeHead(204, cors);
        res.end();
        return;
      }

      // Health-Check ist ohne Zugangscode erreichbar, verrät dann aber nichts.
      if (url.pathname === '/api/health' && req.method === 'GET') {
        await handleHealth(req, res, cors);
        return;
      }

      try {
        checkAccessCode(config, req);
        limiter.check(clientIp(req, config.trustProxy));

        if (url.pathname === '/api/chat' && req.method === 'POST') return await handleChat(req, res, cors);
        if (url.pathname === '/api/weather' && req.method === 'GET') return await handleWeather(req, res, url, cors);
        if (url.pathname === '/api/stt' && req.method === 'POST') return await handleStt(req, res, url, cors);
        if (url.pathname === '/api/tts' && req.method === 'POST') return await handleTts(req, res, cors);
        throw new HttpError(404, 'not_found', 'Unbekannter Endpunkt.');
      } catch (err) {
        err.cors = cors;
        throw err;
      }
    } catch (err) {
      if (res.headersSent) {
        if (!res.writableEnded) res.end();
        return;
      }
      if (err instanceof HttpError) {
        const headers = { ...(err.cors || {}) };
        if (err.status === 429) headers['retry-after'] = '30';
        sendJson(res, err.status, { error: { code: err.code, message: err.message } }, headers);
        return;
      }
      console.error('[server] Unerwarteter Fehler:', err);
      sendJson(res, 500, { error: { code: 'internal', message: 'Interner Fehler.' } }, err.cors || {});
    }
  });

  server.requestTimeout = 0; // lange Streams erlauben
  server.headersTimeout = 20_000;
  return server;
}

// Direkter Start: `node src/server.js`
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const config = loadConfig();
  const server = createApp(config);
  server.listen(config.port, config.host, () => {
    const caps = {
      KI: config.provider === 'none' ? 'NICHT eingerichtet' : config.provider,
      Zugangscode: config.accessCode ? 'aktiv' : 'AUS (empfohlen: ACCESS_CODE setzen!)',
      'Server-Sprache (STT/TTS)': speechAvailable(config) ? 'aktiv' : 'aus (Browser-Sprache)',
      Websuche: config.search.braveKey ? 'Brave' : 'Wikipedia-Fallback',
      Frontend: config.serveFrontend ? config.frontendDir : 'wird nicht ausgeliefert',
    };
    console.log(`ÄNDY-Backend läuft auf http://${config.host}:${config.port}`);
    for (const [k, v] of Object.entries(caps)) console.log(`  ${k}: ${v}`);
  });
  const shutdown = () => server.close(() => process.exit(0));
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
