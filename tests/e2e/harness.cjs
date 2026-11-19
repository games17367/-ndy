// Gemeinsame Hilfen für die Browser-Tests: Server mit Mock-KI, Mocks für Sprache im Browser.
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '../..');

async function startStack(env = {}) {
  const { startMockUpstream } = await import(pathToFileURL(path.join(root, 'backend/test/mock-upstream.js')));
  const { createApp } = await import(pathToFileURL(path.join(root, 'backend/src/server.js')));
  const { loadConfig } = await import(pathToFileURL(path.join(root, 'backend/src/config.js')));
  const mock = await startMockUpstream();
  const config = loadConfig({
    ANTHROPIC_API_KEY: 'test-key',
    ANTHROPIC_BASE_URL: mock.url,
    OPENAI_BASE_URL: `${mock.url}/openai`,
    SERVER_SPEECH: 'true',
    OPENMETEO_GEOCODING_URL: mock.url,
    OPENMETEO_FORECAST_URL: mock.url,
    WIKIPEDIA_BASE_URL: mock.url,
    BRAVE_BASE_URL: mock.url,
    FRONTEND_DIR: path.join(root, 'frontend'),
    RATE_LIMIT_PER_MINUTE: '10000',
    ...env,
  });
  const server = createApp(config);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base,
    mock,
    async close() {
      await new Promise((r) => server.close(r));
      await mock.close();
    },
  };
}

/** Wird VOR dem Laden der Seite eingesetzt: simuliert Spracherkennung und Sprachausgabe. */
function installSpeechMocks() {
  class MockSR {
    constructor() {
      this.lang = 'de-DE';
      this.continuous = false;
      this.interimResults = false;
      this.maxAlternatives = 1;
      this.active = false;
      window.__sr.instances.push(this);
    }
    start() {
      if (this.active) throw new Error('already started');
      this.active = true;
      window.__sr.current = this;
      window.__sr.starts++;
      setTimeout(() => this.onstart && this.onstart(), 5);
    }
    stop() {
      this._end();
    }
    abort() {
      this._end();
    }
    _end() {
      if (!this.active) return;
      this.active = false;
      setTimeout(() => {
        this.onend && this.onend();
        if (window.__sr.current === this) window.__sr.current = null;
      }, 5);
    }
  }
  window.__sr = {
    instances: [],
    current: null,
    starts: 0,
    emit(text, isFinal = true, alts = []) {
      const r = this.current;
      if (!r || !r.active) return false;
      const res = [{ transcript: text }, ...alts.map((t) => ({ transcript: t }))];
      res.isFinal = isFinal;
      r.onresult && r.onresult({ resultIndex: 0, results: [res] });
      return true;
    },
  };
  window.SpeechRecognition = window.webkitSpeechRecognition = MockSR;

  class Utt {
    constructor(text) {
      this.text = text;
      this.voice = null;
      this.lang = '';
      this.rate = 1;
      this.pitch = 1;
      this.volume = 1;
    }
  }
  const synth = {
    speaking: false,
    paused: false,
    _q: [],
    _cur: null,
    _timer: null,
    spoken: [],
    utts: [],
    getVoices() {
      return [
        { name: 'Anna', lang: 'de-DE', voiceURI: 'Anna', localService: true, default: true },
        { name: 'Markus', lang: 'de-DE', voiceURI: 'Markus', localService: true, default: false },
        { name: 'Google Deutsch', lang: 'de-DE', voiceURI: 'Google Deutsch', localService: false, default: false },
      ];
    },
    addEventListener() {},
    removeEventListener() {},
    speak(u) {
      this._q.push(u);
      if (!this._cur) this._next();
    },
    _next() {
      const u = this._q.shift();
      if (!u) {
        this.speaking = false;
        return;
      }
      this._cur = u;
      this.speaking = true;
      if (u.text.trim()) this.spoken.push(u.text);
      this.utts.push({ text: u.text, voice: u.voice && u.voice.name, pitch: u.pitch, rate: u.rate });
      const words = u.text.split(/\s+/).length;
      setTimeout(() => u.onstart && u.onstart({}), 10);
      for (let i = 0; i < words; i++) setTimeout(() => u.onboundary && u.onboundary({}), 20 + i * 40);
      this._timer = setTimeout(() => {
        this._cur = null;
        u.onend && u.onend({});
        this._next();
      }, 40 + words * (window.__ttsWordMs || 40));
    },
    cancel() {
      clearTimeout(this._timer);
      const u = this._cur;
      this._q = [];
      this._cur = null;
      this.speaking = false;
      if (u) setTimeout(() => u.onerror && u.onerror({ error: 'canceled' }), 0);
    },
    pause() {},
    resume() {},
  };
  Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
  window.SpeechSynthesisUtterance = Utt;
}

module.exports = { startStack, installSpeechMocks, root };
