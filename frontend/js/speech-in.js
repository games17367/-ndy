// Spracheingabe. Zwei Engines mit gleicher Schnittstelle:
//  - BrowserRecognizer: Web Speech API (Chrome, Edge, Safari). Unterstützt Weckwort im Dauerbetrieb.
//  - ServerRecognizer:  Mikrofon + Pausenerkennung + Server-Spracherkennung (für iPhone-Homescreen-App,
//                       Firefox u. a.). Läuft nur im Gespräch (Weckwort im Dauerbetrieb wäre zu teuer).
//
// Gemeinsame Rückrufe:
//   onInterim(text)            laufende Zwischenergebnisse
//   onFinal(text, alternatives) abgeschlossene Äußerung
//   onStatus('starting'|'listening'|'stopped')
//   onError({code, message, fatal})
//   onActivity(level 0..1)     Sprach-/Pegelaktivität für die Animation

import { platform } from './platform.js';

const noop = () => {};

class BaseRecognizer {
  onInterim = noop;
  onFinal = noop;
  onStatus = noop;
  onError = noop;
  onActivity = noop;
  running = false;
  async start() {}
  stop() {}
  abort() {}
}

// ---------------------------------------------------------------------------
// Browser-Spracherkennung
// ---------------------------------------------------------------------------

export class BrowserRecognizer extends BaseRecognizer {
  /**
   * @param {{lang?: string, pauseMs?: number, continuous?: boolean}} opts
   */
  constructor({ lang = 'de-DE', pauseMs = 1400, continuous } = {}) {
    super();
    this.kind = 'browser';
    this.lang = lang;
    this.pauseMs = pauseMs;
    // iOS-Safari liefert im Dauermodus unzuverlässige Ergebnisse → Einzel-Äußerungen mit Neustart
    this.continuous = continuous ?? !platform.isIOS;
    this.desired = false;
    this.rec = null;
    this.restartTimer = null;
    this.pauseTimer = null;
    this.lastInterim = '';
    this.lastAlts = [];
    this.sessionStart = 0;
    this.shortSessions = 0;
    this.networkErrors = 0;
    this.generation = 0; // verwirft Ergebnisse alter Sitzungen
    this.committed = false;
  }

  async start() {
    if (this.desired) return;
    this.desired = true;
    this.shortSessions = 0;
    this.networkErrors = 0;
    this.#begin();
  }

  /** Beendet sauber (liefert evtl. noch ein Endergebnis). */
  stop() {
    this.desired = false;
    this.#clearTimers();
    try {
      this.rec?.stop();
    } catch {
      /* ignorieren */
    }
  }

  /** Beendet sofort und verwirft offene Ergebnisse. */
  abort() {
    this.desired = false;
    this.generation++;
    this.#clearTimers();
    this.lastInterim = '';
    try {
      this.rec?.abort();
    } catch {
      /* ignorieren */
    }
    this.running = false;
    this.onStatus('stopped');
  }

  /** Verwirft den aktuellen Puffer und hört frisch weiter (z. B. nach Weckwort). */
  restart() {
    if (!this.desired) return;
    this.generation++;
    this.lastInterim = '';
    this.#clearTimers();
    try {
      this.rec?.abort();
    } catch {
      /* ignorieren */
    }
    // onend löst den Neustart aus
  }

  setLang(lang) {
    this.lang = lang;
  }

  /** Stellt sicher, dass die Erkennung läuft (z. B. nach Rückkehr in den Tab). */
  ensure() {
    if (!this.desired) return this.start();
    if (this.running) return undefined;
    clearTimeout(this.restartTimer);
    this.generation++;
    this.#begin();
    return undefined;
  }

  #clearTimers() {
    clearTimeout(this.restartTimer);
    clearTimeout(this.pauseTimer);
    this.restartTimer = null;
    this.pauseTimer = null;
  }

  #begin() {
    if (!this.desired) return;
    const Ctor = platform.SpeechRecognition;
    if (!Ctor) {
      this.onError({ code: 'unsupported', message: 'Dieser Browser kann keine Sprache erkennen.', fatal: true });
      this.desired = false;
      return;
    }
    const rec = new Ctor();
    const gen = this.generation;
    rec.lang = this.lang;
    rec.continuous = this.continuous;
    rec.interimResults = true;
    rec.maxAlternatives = 3;
    this.rec = rec;
    this.committed = false;
    this.lastInterim = '';
    this.onStatus('starting');

    rec.onstart = () => {
      if (gen !== this.generation) return;
      this.running = true;
      this.sessionStart = Date.now();
      this.onStatus('listening');
    };

    rec.onsoundstart = rec.onspeechstart = () => {
      if (gen === this.generation) this.onActivity(0.7);
    };

    rec.onresult = (event) => {
      if (gen !== this.generation) return;
      this.networkErrors = 0;
      let interim = '';
      let finalText = '';
      let finalAlts = [];
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const res = event.results[i];
        const best = res[0]?.transcript || '';
        if (res.isFinal) {
          finalText += best;
          for (let a = 0; a < res.length; a++) finalAlts.push(res[a].transcript);
        } else {
          interim += best;
        }
      }
      this.onActivity(0.5 + Math.random() * 0.3);

      if (finalText.trim()) {
        clearTimeout(this.pauseTimer);
        this.lastInterim = '';
        this.committed = true;
        this.onFinal(finalText.trim(), finalAlts.map((s) => s.trim()).filter(Boolean));
        return;
      }
      if (interim.trim()) {
        this.lastInterim = interim.trim();
        this.lastAlts = [this.lastInterim];
        this.onInterim(this.lastInterim);
        // Manche Browser liefern lange kein „final“ → bei Pause selbst abschließen
        clearTimeout(this.pauseTimer);
        this.pauseTimer = setTimeout(() => this.#commitInterim(gen), this.pauseMs);
      }
    };

    rec.onerror = (event) => {
      if (gen !== this.generation) return;
      const code = event.error;
      if (code === 'no-speech' || code === 'aborted') return; // normal, onend startet neu
      if (code === 'not-allowed' || code === 'service-not-allowed') {
        this.desired = false;
        this.onError({
          code: 'denied',
          message: 'Das Mikrofon ist blockiert. Erlaube den Mikrofonzugriff für diese Seite in den Browser-Einstellungen.',
          fatal: true,
        });
      } else if (code === 'audio-capture') {
        this.desired = false;
        this.onError({ code: 'no_mic', message: 'Ich finde kein Mikrofon. Ist eines angeschlossen und nicht von einer anderen App belegt?', fatal: true });
      } else if (code === 'language-not-supported') {
        this.desired = false;
        this.onError({ code: 'lang', message: 'Die gewählte Sprache wird von der Spracherkennung nicht unterstützt.', fatal: true });
      } else if (code === 'network') {
        this.networkErrors++;
        if (this.networkErrors >= 3) {
          this.onError({
            code: 'network',
            message: 'Die Spracherkennung des Browsers braucht Internet und ist gerade nicht erreichbar.',
            fatal: false,
          });
        }
      } else {
        this.onError({ code, message: `Spracherkennung: ${code}`, fatal: false });
      }
    };

    rec.onend = () => {
      if (gen !== this.generation && !this.desired) return;
      this.running = false;
      clearTimeout(this.pauseTimer);
      // Noch nicht abgeschlossene Zwischenergebnisse nicht verlieren
      if (gen === this.generation && this.lastInterim && !this.committed && this.desired) {
        const text = this.lastInterim;
        this.lastInterim = '';
        this.committed = true;
        this.onFinal(text, [text]);
      }
      if (!this.desired) {
        this.onStatus('stopped');
        return;
      }
      // Zu kurze Sitzungen mehrfach hintereinander → Abkühlphase (verhindert Endlosschleifen / Pieptöne)
      const lived = Date.now() - this.sessionStart;
      this.shortSessions = lived < 700 ? this.shortSessions + 1 : 0;
      let delay = 120;
      if (this.shortSessions > 2) delay = Math.min(4000, 300 * 2 ** (this.shortSessions - 2));
      if (this.shortSessions === 12) {
        this.onError({ code: 'unstable', message: 'Die Spracherkennung startet ständig neu. Tippe auf das Mikrofon, um es noch mal zu versuchen.', fatal: false });
      }
      this.restartTimer = setTimeout(() => {
        this.generation++;
        this.#begin();
      }, delay);
    };

    try {
      rec.start();
    } catch (err) {
      // „already started“ → ignorieren, sonst später erneut versuchen
      this.restartTimer = setTimeout(() => {
        this.generation++;
        this.#begin();
      }, 400);
    }
  }

  #commitInterim(gen) {
    if (gen !== this.generation || !this.lastInterim || this.committed) return;
    const text = this.lastInterim;
    this.lastInterim = '';
    this.committed = true;
    this.onFinal(text, [text]);
    // Puffer verwerfen und frisch weiter hören
    this.restart();
  }
}

// ---------------------------------------------------------------------------
// Server-Spracherkennung mit Pausenerkennung
// ---------------------------------------------------------------------------

const MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];

export function pickRecorderMime() {
  if (typeof MediaRecorder === 'undefined') return '';
  for (const m of MIME_CANDIDATES) {
    try {
      if (MediaRecorder.isTypeSupported(m)) return m;
    } catch {
      /* weiter */
    }
  }
  return '';
}

export class ServerRecognizer extends BaseRecognizer {
  /**
   * @param {{api: import('./api.js').ApiClient, lang?: string, pauseMs?: number}} opts
   */
  constructor({ api, lang = 'de-DE', pauseMs = 1200 }) {
    super();
    this.kind = 'server';
    this.api = api;
    this.lang = lang;
    this.pauseMs = pauseMs;
    this.stream = null;
    this.audioCtx = null;
    this.analyser = null;
    this.timer = null;
    this.recorder = null;
    this.chunks = [];
    this.muted = false;
    this.noiseFloor = 0.01;
    this.speechRunMs = 0;
    this.lastVoiceAt = 0;
    this.recStartedAt = 0;
    this.pending = new Set();
    this.mime = pickRecorderMime();
  }

  setLang(lang) {
    this.lang = lang;
  }

  /** Pausiert die Erkennung (z. B. während Ändy spricht), ohne das Mikrofon freizugeben. */
  setMuted(muted) {
    this.muted = muted;
    if (muted) this.#discardRecording();
  }

  async start() {
    if (this.running) return;
    this.onStatus('starting');
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (err) {
      const denied = err?.name === 'NotAllowedError' || err?.name === 'SecurityError';
      this.onError({
        code: denied ? 'denied' : 'no_mic',
        message: denied
          ? 'Das Mikrofon ist blockiert. Erlaube den Mikrofonzugriff für diese Seite in den Browser-Einstellungen.'
          : 'Ich finde kein Mikrofon.',
        fatal: true,
      });
      this.onStatus('stopped');
      return;
    }
    const Ctor = globalThis.AudioContext || globalThis.webkitAudioContext;
    this.audioCtx = new Ctor();
    if (this.audioCtx.state === 'suspended') await this.audioCtx.resume().catch(() => {});
    const source = this.audioCtx.createMediaStreamSource(this.stream);
    this.analyser = this.audioCtx.createAnalyser();
    this.analyser.fftSize = 1024;
    source.connect(this.analyser);
    this.samples = new Float32Array(this.analyser.fftSize);

    this.running = true;
    this.speechRunMs = 0;
    this.lastVoiceAt = 0;
    this.timer = setInterval(() => this.#tick(), 50);
    this.onStatus('listening');
  }

  stop() {
    this.#teardown(false);
  }

  abort() {
    this.#teardown(true);
  }

  #teardown() {
    clearInterval(this.timer);
    this.timer = null;
    this.#discardRecording();
    try {
      this.stream?.getTracks().forEach((t) => t.stop());
    } catch {
      /* ignorieren */
    }
    try {
      this.audioCtx?.close();
    } catch {
      /* ignorieren */
    }
    this.stream = null;
    this.audioCtx = null;
    this.analyser = null;
    for (const c of this.pending) c.abort();
    this.pending.clear();
    if (this.running) this.onStatus('stopped');
    this.running = false;
  }

  #rms() {
    this.analyser.getFloatTimeDomainData(this.samples);
    let sum = 0;
    for (let i = 0; i < this.samples.length; i++) sum += this.samples[i] * this.samples[i];
    return Math.sqrt(sum / this.samples.length);
  }

  #tick() {
    if (!this.analyser) return;
    const rms = this.#rms();
    const now = Date.now();
    this.onActivity(Math.min(1, rms * 9));
    if (this.muted) return;

    const threshold = Math.max(0.02, this.noiseFloor * 3.2);
    const voice = rms > threshold;

    if (!this.recorder) {
      // Ruhe → Grundrauschen nachführen
      if (!voice) this.noiseFloor = this.noiseFloor * 0.95 + rms * 0.05;
      this.speechRunMs = voice ? this.speechRunMs + 50 : 0;
      if (this.speechRunMs >= 100) this.#startRecording(now);
      return;
    }

    if (voice) this.lastVoiceAt = now;
    const silentFor = now - this.lastVoiceAt;
    const length = now - this.recStartedAt;
    if (silentFor >= this.pauseMs || length > 30_000) this.#finishRecording();
  }

  #startRecording(now) {
    try {
      this.chunks = [];
      this.recorder = new MediaRecorder(this.stream, this.mime ? { mimeType: this.mime } : undefined);
      this.recorder.ondataavailable = (e) => {
        if (e.data && e.data.size) this.chunks.push(e.data);
      };
      this.recorder.start(250);
      this.recStartedAt = now;
      this.lastVoiceAt = now;
      this.onInterim('…');
    } catch {
      this.recorder = null;
      this.onError({ code: 'recorder', message: 'Dieser Browser kann nicht aufnehmen.', fatal: true });
    }
  }

  #discardRecording() {
    const r = this.recorder;
    this.recorder = null;
    this.speechRunMs = 0;
    if (r && r.state !== 'inactive') {
      r.ondataavailable = null;
      r.onstop = null;
      try {
        r.stop();
      } catch {
        /* ignorieren */
      }
    }
    this.chunks = [];
  }

  #finishRecording() {
    const r = this.recorder;
    if (!r) return;
    this.recorder = null;
    this.speechRunMs = 0;
    const duration = Date.now() - this.recStartedAt;
    const type = r.mimeType || this.mime || 'audio/webm';
    r.onstop = async () => {
      const blob = new Blob(this.chunks, { type });
      this.chunks = [];
      this.onInterim('');
      if (duration < 450 || blob.size < 1500) return; // Räuspern, Klacken ...
      const controller = new AbortController();
      this.pending.add(controller);
      try {
        const text = await this.api.transcribe(blob, this.lang, controller.signal);
        if (text) this.onFinal(text, [text]);
      } catch (err) {
        if (err?.name !== 'AbortError') {
          this.onError({ code: err.code || 'stt', message: err.message || 'Spracherkennung fehlgeschlagen.', fatal: false });
        }
      } finally {
        this.pending.delete(controller);
      }
    };
    try {
      r.stop();
    } catch {
      /* ignorieren */
    }
  }
}
