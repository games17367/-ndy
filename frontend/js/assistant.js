// Ändys Gehirn auf der Client-Seite: Zustandsmaschine für Weckwort, Endlos-Gespräch,
// KI-Anfragen mit Streaming, satzweise Sprachausgabe, Unterbrechen und Eigeninitiative.
//
// Zustände:  sleeping → listening → thinking → speaking → listening ...
// "engaged" = Gesprächsmodus ist aktiv (nach „Sarvus Ändy“ oder Tippen auf das Mikrofon).

import { Emitter } from './events.js';
import { platform, browserSpeechRecognitionUsable } from './platform.js';
import { BrowserRecognizer, ServerRecognizer } from './speech-in.js';
import { detectWake } from './wake.js';
import { parseLocalCommand } from './commands.js';
import { splitSentences, cleanForSpeech, echoScore, countWords } from './speech-text.js';
import { describeNow, describeWhen, formatCountdown, inQuietHours } from './datetime.js';
import { ApiError } from './api.js';
import * as sound from './audio.js';
import {
  WAKE_GREETINGS,
  WAKE_GREETINGS_FORMAL,
  FAREWELLS,
  TIMER_DONE,
  REMINDER_DUE,
  ALARM_RINGING,
  OFFLINE_LINES,
  MORNING_FALLBACKS,
  OPEN_GREETINGS,
  pick,
} from './content.js';
import { showNotification } from './scheduler.js';

const WAKE_DEBOUNCE_MS = 650;

export class Assistant extends Emitter {
  /**
   * @param {{store: import('./store.js').Store, api: import('./api.js').ApiClient,
   *          speaker: import('./speech-out.js').Speaker, scheduler: import('./scheduler.js').Scheduler}} deps
   */
  constructor({ store, api, speaker, scheduler }) {
    super();
    this.store = store;
    this.api = api;
    this.speaker = speaker;
    this.scheduler = scheduler;
    this.actions = null; // wird von main.js gesetzt

    this.state = 'sleeping';
    this.engaged = false;
    this.micActive = false;
    this.caps = { chat: false, stt: false, tts: false, provider: 'none', search: 'wikipedia' };
    this.online = true;
    this.healthChecked = false;

    this.recognizer = null;
    this.recognizerKind = 'none'; // browser | server | none
    this.micPaused = false;
    this.turn = null;
    this.pendingAnnouncements = [];
    this.wakeCandidate = null;
    this.idleTimer = null;
    this.lastFinal = { text: '', at: 0 };
    this.wakeLock = null;
    this.coords = null;
    this.audioReady = false;
  }

  // ======================================================================
  // Start
  // ======================================================================

  async init() {
    const speaker = this.speaker;
    speaker.onStart = () => this.#onSpeakStart();
    speaker.onDrain = () => this.#onSpeakDrain();
    speaker.onProblem = (text) => this.emit('banner', { id: 'tts', kind: 'warn', text });

    this.store.on('setting', (key) => this.#onSetting(key));
    this.#wireScheduler();
    this.#wireBrowserEvents();

    await this.refreshHealth();
    this.#chooseRecognizer();
    this.emit('ready');
    this.#emitMic();
  }

  async refreshHealth() {
    try {
      const h = await this.api.health();
      this.online = true;
      this.healthChecked = true;
      if (h.accessRequired && !h.authorized) {
        this.caps = { ...this.caps, chat: false };
        this.emit('banner', {
          id: 'conn',
          kind: 'error',
          text: 'Dieser Server ist mit einem Zugangscode geschützt. Trage ihn in den Einstellungen unter „Verbindung“ ein.',
          action: { id: 'open-settings', label: 'Einstellungen' },
        });
      } else {
        this.caps = { ...this.caps, ...(h.capabilities || {}) };
        this.emit('banner-clear', 'conn');
        if (!this.caps.chat) {
          this.emit('banner', {
            id: 'conn',
            kind: 'warn',
            text: 'Der Server läuft, aber es ist noch keine KI eingerichtet (ANTHROPIC_API_KEY oder OPENAI_API_KEY fehlt).',
          });
        }
      }
    } catch (err) {
      this.online = false;
      this.caps = { ...this.caps, chat: false };
      this.emit('banner', {
        id: 'conn',
        kind: 'error',
        text: err?.message || 'Ich erreiche meinen Server nicht.',
        action: { id: 'open-settings', label: err?.code === 'no_backend' ? 'Server eintragen' : 'Server prüfen' },
      });
    }
    this.speaker.cloudAvailable = Boolean(this.caps.tts);
    this.emit('caps', this.caps);
    return this.caps;
  }

  // ======================================================================
  // Spracherkennung wählen / aufbauen
  // ======================================================================

  /** Welche Engine ist verfügbar und gewünscht? */
  #resolveKind() {
    const pref = this.store.settings.sttEngine;
    const serverOk = Boolean(this.caps.stt) && platform.hasMediaDevices && platform.hasMediaRecorder;
    const browserOk = browserSpeechRecognitionUsable();
    if (pref === 'browser') return browserOk ? 'browser' : 'none';
    if (pref === 'server') return serverOk ? 'server' : 'none';
    if (browserOk) return 'browser';
    if (serverOk) return 'server';
    return 'none';
  }

  #chooseRecognizer() {
    const kind = this.#resolveKind();
    if (this.recognizer && this.recognizerKind === kind) return;
    this.#teardownRecognizer();
    this.recognizerKind = kind;
    if (kind === 'browser') {
      this.recognizer = new BrowserRecognizer({ lang: this.store.settings.lang });
    } else if (kind === 'server') {
      this.recognizer = new ServerRecognizer({ api: this.api, lang: this.store.settings.lang, pauseMs: this.store.settings.pauseMs });
    }
    if (this.recognizer) {
      const r = this.recognizer;
      r.onInterim = (t) => this.#onInterim(t);
      r.onFinal = (t, alts) => this.#onFinal(t, alts);
      r.onActivity = (lvl) => {
        this.inputLevel = lvl;
      };
      r.onStatus = (s) => {
        this.micActive = s === 'listening' || s === 'starting';
        this.#emitMic();
      };
      r.onError = (e) => this.#onRecognizerError(e);
    }
    this.#emitMic();
  }

  #teardownRecognizer() {
    try {
      this.recognizer?.abort();
    } catch {
      /* ignorieren */
    }
    this.recognizer = null;
    this.micActive = false;
  }

  get wakeCapable() {
    return this.recognizerKind === 'browser';
  }

  get wakeWanted() {
    return this.store.settings.activation === 'wake' && this.wakeCapable;
  }

  /** Aktuelle Pegel für die Animation (Mikrofon oder Ausgabe) */
  get level() {
    if (this.state === 'speaking') return this.speaker.level;
    if (this.state === 'listening') return Math.max(this.inputLevel || 0, 0) * 0.9;
    return 0;
  }

  #emitMic() {
    this.emit('mic', {
      active: this.micActive,
      kind: this.recognizerKind,
      wakeWanted: this.wakeWanted,
      wakeCapable: this.wakeCapable,
      engaged: this.engaged,
      paused: this.micPaused,
    });
  }

  #onRecognizerError(e) {
    if (e.fatal) {
      this.micActive = false;
      this.#emitMic();
      this.emit('banner', {
        id: 'mic',
        kind: 'error',
        text: e.message,
        action: e.code === 'denied' ? { id: 'mic-help', label: 'So geht’s' } : { id: 'retry-mic', label: 'Erneut versuchen' },
      });
      if (this.engaged) this.#setState('listening');
    } else {
      this.emit('banner', { id: 'mic', kind: 'warn', text: e.message, action: { id: 'retry-mic', label: 'Erneut versuchen' } });
    }
  }

  // ======================================================================
  // Öffentliche Steuerung (aus Gesten heraus aufrufen!)
  // ======================================================================

  /** Entsperrt Audio und startet – nötig nach dem Laden, vor allem auf iPhone/Android. */
  async prepareFromGesture() {
    this.speaker.unlock();
    this.audioReady = await sound.unlockAudio();
    this.emit('banner-clear', 'tts');
    this.emit('banner-clear', 'mic');
    return this.audioReady;
  }

  /** Aktiviert das Dauerlauschen auf „Sarvus Ändy“ (wenn möglich). */
  async enableWake() {
    await this.prepareFromGesture();
    this.#chooseRecognizer();
    if (this.store.settings.activation !== 'wake') this.store.set('activation', 'wake');
    if (!this.wakeCapable) {
      this.emit('toast', {
        text: this.recognizerKind === 'server'
          ? 'Mit der Server-Spracherkennung geht „Sarvus Ändy“ nicht im Dauerbetrieb. Tippe auf mein Gesicht, um mich zu wecken.'
          : 'Auf diesem Gerät ist kein Weckwort möglich. Tippe auf mein Gesicht, um mich zu wecken.',
      });
      return false;
    }
    if (!this.engaged) await this.#startRecognizer();
    return true;
  }

  async disableWake() {
    this.store.set('activation', 'button');
    if (!this.engaged) {
      this.recognizer?.abort();
      this.micActive = false;
      this.#emitMic();
      this.#setState('sleeping');
    }
  }

  /** Mikrofontaste. */
  async micButton() {
    await this.prepareFromGesture();
    if (this.state === 'speaking' || this.state === 'thinking') {
      this.interrupt();
      return;
    }
    if (this.engaged) {
      this.endConversation({ farewell: false });
    } else {
      await this.engage({ source: 'button' });
    }
  }

  /** Taste „Zuhören beenden“ */
  stopListening() {
    if (this.engaged) this.endConversation({ farewell: false });
    else if (this.micActive) {
      this.recognizer?.abort();
      this.micActive = false;
      this.#emitMic();
    }
  }

  /** Tippen auf den Kern: Unterbrechen, sonst aufwecken. */
  async coreTap() {
    await this.prepareFromGesture();
    if (this.state === 'speaking' || this.state === 'thinking') this.interrupt();
    else if (!this.engaged) await this.engage({ source: 'button' });
  }

  async submitText(text) {
    const t = String(text || '').trim();
    if (!t) return;
    await this.prepareFromGesture();
    if (sound.isAlarmRinging()) sound.stopAlarm();
    // Textbefehl „Ruhe“ etc. funktioniert auch getippt
    const cmd = parseLocalCommand(t);
    if (cmd && this.engaged) {
      this.#runCommand(cmd);
      return;
    }
    this.#resetIdle();
    await this.sendText(t, { via: 'text' });
  }

  // ======================================================================
  // Aktivieren / Beenden
  // ======================================================================

  async engage({ source = 'wake', rest = '' } = {}) {
    clearTimeout(this.wakeCandidate?.timer);
    this.wakeCandidate = null;
    if (this.engaged) {
      if (rest) this.#handleUserText(rest, 'voice');
      return;
    }
    this.engaged = true;
    this.emit('engaged', true);
    if (this.store.settings.sounds) sound.playWake();
    this.#acquireWakeLock();
    this.emit('banner-clear', 'mic');

    // Eingabe starten (frisch, damit das Weckwort nicht noch einmal ausgewertet wird)
    this.#chooseRecognizer();
    if (this.recognizer) {
      if (this.recognizerKind === 'browser' && this.recognizer.desired) this.recognizer.restart();
      else await this.#startRecognizer();
    } else if (source !== 'text') {
      this.emit('banner', {
        id: 'mic',
        kind: 'info',
        text: 'Spracheingabe ist hier nicht verfügbar. Du kannst mir schreiben – ich antworte trotzdem laut.',
      });
    }
    this.#emitMic();

    if (rest) {
      this.#handleUserText(rest, 'voice');
    } else {
      await this.#greet();
    }
    this.#resetIdle();
  }

  async #greet() {
    const s = this.store.settings;
    if (s.aiGreeting && this.caps.chat && this.online) {
      await this.sendText('(Der Nutzer hat dich gerade mit „Sarvus Ändy“ geweckt. Begrüße ihn in einem kurzen, witzigen Satz und frag, was er braucht.)', {
        via: 'voice',
        hidden: true,
      });
      return;
    }
    const text = pick(s.address === 'sie' ? WAKE_GREETINGS_FORMAL : WAKE_GREETINGS, 'greet');
    this.#sayLocal(text);
  }

  /** Beendet den Gesprächsmodus. */
  endConversation({ farewell = false, silent = false } = {}) {
    if (!this.engaged && !farewell) return;
    this.#cancelTurn();
    this.engaged = false;
    this.emit('engaged', false);
    this.#clearIdle();
    this.#releaseWakeLock();
    this.emit('caption', { who: 'user', text: '' });

    // Mikrofon: im Weckwort-Modus weiter lauschen, sonst aus
    if (this.wakeWanted) {
      if (this.recognizerKind === 'browser') {
        this.recognizer?.restart?.();
        this.recognizer?.ensure?.();
      }
    } else {
      this.recognizer?.abort();
      this.micActive = false;
    }
    this.micPaused = false;
    this.#emitMic();

    if (farewell && this.speaker.available && this.audioReady) {
      this.#sayLocal(pick(FAREWELLS, 'farewell'), { announcement: true });
    } else {
      if (!silent && this.store.settings.sounds) sound.playSleep();
      this.#setState('sleeping');
    }
  }

  /** Unterbricht Sprechen/Nachdenken; im Gesprächsmodus geht es mit Zuhören weiter. */
  interrupt() {
    if (!this.turn) {
      this.speaker.cancel();
      this.#afterTurn();
      return;
    }
    const msgId = this.turn.msgId;
    if (msgId) this.store.updateMessage(msgId, { interrupted: true });
    this.#cancelTurn();
    this.#afterTurn();
  }

  // ======================================================================
  // Erkennungs-Ereignisse
  // ======================================================================

  async #startRecognizer() {
    if (!this.recognizer) return;
    try {
      await this.recognizer.start();
    } catch (err) {
      this.#onRecognizerError({ code: 'start', message: 'Das Mikrofon konnte nicht gestartet werden.', fatal: false });
    }
    this.#emitMic();
  }

  #onInterim(text) {
    if (!text) {
      this.emit('caption', { who: 'user', text: '' });
      return;
    }
    if (!this.engaged) {
      if (this.wakeWanted) this.#checkWakeInterim(text);
      return;
    }
    this.#resetIdle();

    // Sprach-Unterbrechung während Ändy spricht
    if (this.state === 'speaking' && this.#bargeInEnabled()) {
      if (countWords(text) >= 2 && echoScore(text, this.speaker.spokenText) < 0.5) {
        this.interrupt();
      }
      return;
    }
    if (this.state === 'speaking') return; // Echo ignorieren
    this.emit('caption', { who: 'user', text });
  }

  #checkWakeInterim(text) {
    const w = detectWake(text, { loose: this.store.settings.wakeLoose });
    if (!w.matched) {
      return;
    }
    // Sofortiges visuelles Feedback, Aktivierung nach kurzer Pause (damit Folgesatz mitkommt)
    this.emit('wake-heard');
    clearTimeout(this.wakeCandidate?.timer);
    this.wakeCandidate = {
      rest: w.rest,
      timer: setTimeout(() => {
        const rest = this.wakeCandidate?.rest || '';
        this.wakeCandidate = null;
        this.engage({ source: 'wake', rest });
      }, WAKE_DEBOUNCE_MS),
    };
  }

  #onFinal(text, alts = []) {
    const now = Date.now();
    if (text === this.lastFinal.text && now - this.lastFinal.at < 800) return; // Doppelmeldung
    this.lastFinal = { text, at: now };

    if (!this.engaged) {
      if (!this.wakeWanted) return;
      for (const candidate of [text, ...alts]) {
        const w = detectWake(candidate, { loose: this.store.settings.wakeLoose });
        if (w.matched) {
          clearTimeout(this.wakeCandidate?.timer);
          this.wakeCandidate = null;
          this.engage({ source: 'wake', rest: w.rest });
          return;
        }
      }
      return; // Alles andere wird bewusst verworfen (Datenschutz)
    }

    // Eigene Sprachausgabe nicht als Nutzereingabe werten
    if (this.state === 'speaking') {
      if (echoScore(text, this.speaker.spokenText) >= 0.6) return;
      if (!this.#bargeInEnabled()) return;
    }

    // Weckwort mitten im Gespräch abschneiden („Sarvus Ändy, ...“)
    const w = detectWake(text, { loose: this.store.settings.wakeLoose });
    const clean = w.matched ? w.rest : text;
    if (!clean) {
      if (this.state === 'speaking' || this.state === 'thinking') this.interrupt();
      return;
    }
    this.#handleUserText(clean, 'voice');
  }

  #handleUserText(text, via) {
    this.#resetIdle();
    this.emit('caption', { who: 'user', text: '' });
    const cmd = parseLocalCommand(text);
    if (cmd) {
      this.#runCommand(cmd, text);
      return;
    }
    if (sound.isAlarmRinging()) sound.stopAlarm();
    this.sendText(text, { via });
  }

  #runCommand(cmd, originalText = '') {
    switch (cmd.type) {
      case 'end':
        if (originalText) this.store.addMessage({ role: 'user', text: originalText });
        this.endConversation({ farewell: cmd.farewell });
        break;
      case 'interrupt':
        if (this.state === 'speaking' || this.state === 'thinking') this.interrupt();
        break;
      case 'louder':
      case 'quieter': {
        const v = this.store.settings.volume;
        const next = Math.min(1, Math.max(0.1, v + (cmd.type === 'louder' ? 0.2 : -0.2)));
        this.store.set('volume', Number(next.toFixed(2)));
        this.emit('toast', { text: `Lautstärke: ${Math.round(next * 100)} %` });
        this.#sayLocal(cmd.type === 'louder' ? 'Lauter! Jetzt hört mich sogar die Nachbarschaft.' : 'Leiser. Ich flüstere ab jetzt.');
        break;
      }
      default:
        break;
    }
  }

  #bargeInEnabled() {
    const s = this.store.settings;
    if (s.bargeIn === true || s.bargeIn === false) return s.bargeIn;
    return !platform.isMobile; // Handy-Lautsprecher erzeugen Echo → standardmäßig aus
  }

  // ======================================================================
  // Anfrage an die KI
  // ======================================================================

  /** Baut den Kontext, den die KI für Datum, Ort und Geräte-Zustand braucht. */
  #buildContext() {
    const now = new Date();
    const s = this.store.settings;
    return {
      now: describeNow(now),
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
      locale: navigator.language || 'de-AT',
      platform: platform.label(),
      coords: s.useLocation && this.coords ? { lat: this.coords.lat, lon: this.coords.lon } : null,
      state: {
        timers: this.store.timers.map((t) => `${t.label || 'Timer'} (noch ${formatCountdown((t.endsAt - Date.now()) / 1000)})`),
        reminders: this.store.reminders
          .filter((r) => !r.fired)
          .sort((a, b) => a.at - b.at)
          .slice(0, 15)
          .map((r) => `${r.text} – ${describeWhen(new Date(r.at), now)}${r.alarm ? ' (Wecker)' : ''}`),
        notes: this.store.notes.slice(-10).map((n) => n.title || n.text.slice(0, 60)),
      },
    };
  }

  #apiSettings() {
    const s = this.store.settings;
    return {
      humor: s.humor,
      cheeky: s.cheeky,
      length: s.length,
      dialect: s.dialect,
      address: s.address,
      userName: s.userName,
      customInstruction: s.customInstruction,
      memoryEnabled: s.memoryEnabled,
    };
  }

  /**
   * Schickt Text an die KI und spricht die Antwort satzweise, während sie noch eintrifft.
   * @param {string} text
   * @param {{via?: 'voice'|'text'|'proactive', hidden?: boolean}} [opts]
   */
  async sendText(text, { via = 'text', hidden = false } = {}) {
    const clean = String(text).trim().slice(0, 1500);
    if (!clean) return;

    this.#cancelTurn();
    const s = this.store.settings;
    const voiceReply = (via === 'voice' || this.engaged || s.speakTyped || (via === 'proactive' && this.audioReady)) && this.speaker.available;

    this.store.addMessage({ role: 'user', text: clean, hidden });
    this.#setState('thinking');
    this.#pauseRecognizerIfNeeded();

    const turn = {
      id: Math.random().toString(36).slice(2),
      abort: new AbortController(),
      buffer: '',
      text: '',
      msgId: null,
      first: true,
      spoken: false,
      streamDone: false,
      voiceReply,
      announcement: false,
    };
    this.turn = turn;

    if (!this.caps.chat && this.healthChecked === false) await this.refreshHealth();

    try {
      await this.api.chat({
        messages: this.store.messagesForApi(),
        settings: this.#apiSettings(),
        context: this.#buildContext(),
        memory: this.store.factsForApi(),
        signal: turn.abort.signal,
        handlers: {
          onText: (delta) => this.#onTextDelta(turn, delta),
          onStatus: (st) => this.#onToolStatus(turn, st),
          onAction: (a) => this.actions?.handle(a),
          onCard: (c) => this.emit('card', c),
          onDone: () => this.#onStreamDone(turn),
        },
      });
      this.online = true;
    } catch (err) {
      if (err?.name === 'AbortError' || turn.abort.signal.aborted) return;
      this.#onChatError(turn, err);
    }
  }

  #onTextDelta(turn, delta) {
    if (this.turn !== turn) return;
    turn.text += delta;
    if (!turn.msgId) {
      turn.msgId = this.store.addMessage({ role: 'assistant', text: turn.text }).id;
    } else {
      this.store.updateMessage(turn.msgId, { text: turn.text });
    }
    this.emit('caption', { who: 'andy', text: turn.text });
    if (turn.voiceReply) {
      turn.buffer += delta;
      this.#flushSentences(turn, false);
    }
  }

  #onToolStatus(turn, st) {
    if (this.turn !== turn) return;
    this.emit('status', st);
    if (this.state !== 'thinking' && !this.speaker.speaking) this.#setState('thinking');
  }

  #flushSentences(turn, final) {
    const { sentences, rest } = splitSentences(turn.buffer, { minLength: turn.first ? 14 : 28, flush: final });
    turn.buffer = rest;
    for (const sentence of sentences) {
      const speakable = cleanForSpeech(sentence);
      if (!speakable) continue;
      turn.first = false;
      turn.spoken = true;
      this.speaker.enqueue(speakable);
    }
  }

  #onStreamDone(turn) {
    if (this.turn !== turn) return;
    if (turn.voiceReply) this.#flushSentences(turn, true);
    turn.streamDone = true;
    this.emit('status', null);
    if (!turn.msgId && !turn.spoken) {
      // Die KI hat nichts gesagt (z. B. nur eine Aktion ausgeführt)
      this.#afterTurn();
      return;
    }
    if (!this.speaker.speaking) this.#afterTurn();
  }

  #onChatError(turn, err) {
    if (this.turn !== turn) return;
    turn.streamDone = true;
    this.emit('status', null);
    const e = err instanceof ApiError ? err : new ApiError('unknown', 'Da ist etwas schiefgelaufen.');
    if (e.code === 'offline' || e.code === 'network') this.online = false;
    const message = e.message;
    this.store.addMessage({ role: 'assistant', text: message, error: true });
    this.emit('caption', { who: 'andy', text: message });
    if (e.code === 'bad_code') this.emit('banner', { id: 'conn', kind: 'error', text: message, action: { id: 'open-settings', label: 'Einstellungen' } });
    if (e.code === 'no_backend') {
      this.caps = { ...this.caps, chat: false };
      this.emit('banner', { id: 'conn', kind: 'error', text: message, action: { id: 'open-settings', label: 'Server eintragen' } });
    }
    if (turn.voiceReply) {
      const spoken =
        e.code === 'offline' || e.code === 'network'
          ? pick(OFFLINE_LINES, 'offline')
          : e.code === 'no_backend'
            ? 'Ich habe noch keinen Server. Trag in den Einstellungen unter Verbindung die Adresse ein, dann kann ich denken.'
            : 'Da stimmt etwas nicht. Schau mal in die Einstellungen oder versuch es gleich noch mal.';
      turn.spoken = true;
      this.speaker.enqueue(spoken);
    } else {
      this.#afterTurn();
    }
  }

  /** Abbrechen ohne Folgeaktion. */
  #cancelTurn() {
    if (this.turn) {
      this.turn.abort.abort();
      this.turn = null;
    }
    this.speaker.cancel();
    this.emit('status', null);
  }

  /** Lokaler Satz (Begrüßung, Verabschiedung ...) wie eine Antwort sprechen und anzeigen. */
  #sayLocal(text, { announcement = false } = {}) {
    this.#cancelTurn();
    this.store.addMessage({ role: 'assistant', text });
    this.emit('caption', { who: 'andy', text });
    if (!this.speaker.available || !this.audioReady) {
      this.#afterTurn();
      return;
    }
    this.turn = { id: 'local', abort: new AbortController(), streamDone: true, spoken: true, voiceReply: true, announcement };
    this.#setState('thinking');
    this.#pauseRecognizerIfNeeded();
    this.speaker.enqueue(cleanForSpeech(text));
  }

  // ======================================================================
  // Sprachausgabe-Ereignisse
  // ======================================================================

  #onSpeakStart() {
    this.#setState('speaking');
    this.#pauseRecognizerIfNeeded();
  }

  #onSpeakDrain() {
    const turn = this.turn;
    if (!turn) return;
    if (turn.streamDone) this.#afterTurn();
    else if (this.state === 'speaking') this.#setState('thinking'); // wartet auf den nächsten Satz
  }

  #pauseRecognizerIfNeeded() {
    if (!this.recognizer || this.#bargeInEnabled()) return;
    if (this.recognizerKind === 'server') this.recognizer.setMuted(true);
    else if (this.micActive && !this.micPaused) {
      this.micPaused = true;
      this.recognizer.abort();
      this.micActive = false;
      this.#emitMic();
    }
  }

  async #resumeRecognizer() {
    if (!this.recognizer) return;
    if (this.recognizerKind === 'server') {
      this.recognizer.setMuted(false);
      return;
    }
    if (this.micPaused || (!this.micActive && (this.engaged || this.wakeWanted))) {
      this.micPaused = false;
      await this.#startRecognizer();
    }
  }

  /** Nach jeder Antwort: zurück zum Zuhören (Gesprächsmodus) oder Schlafen. */
  #afterTurn() {
    this.turn = null;
    this.emit('status', null);
    if (this.pendingAnnouncements.length && !this.engaged) {
      const next = this.pendingAnnouncements.shift();
      this.announce(next.text, next.opts);
      return;
    }
    if (this.engaged) {
      this.#setState('listening');
      this.#resumeRecognizer();
      this.#resetIdle();
    } else {
      this.#setState('sleeping');
      if (this.wakeWanted) this.#resumeRecognizer();
    }
    this.emit('caption', { who: 'andy', text: '' });
  }

  // ======================================================================
  // Zustand
  // ======================================================================

  #setState(state) {
    if (this.state === state) return;
    this.state = state;
    this.emit('state', { state, engaged: this.engaged });
  }

  // ======================================================================
  // Leerlauf, Bildschirm, Einstellungen, Browser-Ereignisse
  // ======================================================================

  #resetIdle() {
    this.#clearIdle();
    const min = this.store.settings.autoSleepMin;
    if (!this.engaged || !min) return;
    this.idleTimer = setTimeout(() => {
      if (this.engaged && (this.state === 'listening' || this.state === 'sleeping')) {
        this.emit('toast', { text: 'Ändy hat sich schlafen gelegt. Sag „Sarvus Ändy“, um ihn zu wecken.' });
        this.endConversation({ silent: false });
      } else {
        this.#resetIdle();
      }
    }, min * 60_000);
  }

  #clearIdle() {
    clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }

  async #acquireWakeLock() {
    if (!platform.hasWakeLock || !this.store.settings.keepScreenOn || this.wakeLock) return;
    try {
      this.wakeLock = await navigator.wakeLock.request('screen');
      this.wakeLock.addEventListener('release', () => {
        this.wakeLock = null;
      });
    } catch {
      this.wakeLock = null;
    }
  }

  #releaseWakeLock() {
    try {
      this.wakeLock?.release();
    } catch {
      /* ignorieren */
    }
    this.wakeLock = null;
  }

  #onSetting(key) {
    switch (key) {
      case 'sttEngine':
      case 'lang':
      case 'activation':
      case 'pauseMs': {
        const wasRunning = this.micActive;
        this.#teardownRecognizer();
        this.recognizerKind = 'none';
        this.#chooseRecognizer();
        if (wasRunning && (this.engaged || this.wakeWanted)) this.#startRecognizer();
        break;
      }
      case 'volume':
        sound.setMasterVolume(this.store.settings.volume);
        break;
      case 'apiBase':
      case 'accessCode':
        this.refreshHealth().then(() => this.#chooseRecognizer());
        break;
      case 'useLocation':
        if (this.store.settings.useLocation) this.refreshLocation();
        else this.coords = null;
        break;
      case 'voiceEngine':
      case 'cloudVoice':
        this.speaker.cloudFailed = false;
        break;
      default:
        break;
    }
  }

  /** Setzt eine Einstellung auf Wunsch der KI (set_setting), mit Rückmeldung. */
  applySetting(key, value) {
    if (!['speechRate', 'volume', 'humor', 'cheeky'].includes(key)) return;
    this.store.set(key, value);
    const label = { speechRate: 'Sprechtempo', volume: 'Lautstärke', humor: 'Humorgrad', cheeky: 'Frechheitsmodus' }[key];
    this.emit('toast', { text: `${label}: ${typeof value === 'boolean' ? (value ? 'an' : 'aus') : value}` });
  }

  async refreshLocation() {
    if (!platform.hasGeolocation) return null;
    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          this.coords = { lat: pos.coords.latitude, lon: pos.coords.longitude, ts: Date.now() };
          resolve(this.coords);
        },
        () => {
          this.coords = null;
          this.emit('toast', { text: 'Standort nicht verfügbar. Prüfe die Berechtigung im Browser.', kind: 'warn' });
          resolve(null);
        },
        { maximumAge: 600_000, timeout: 10_000 }
      );
    });
  }

  #wireBrowserEvents() {
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) return;
      if (this.engaged) this.#acquireWakeLock();
      if (this.micActive || this.engaged || this.wakeWanted) this.recognizer?.ensure?.();
    });
    window.addEventListener('online', () => {
      this.online = true;
      this.refreshHealth();
    });
    window.addEventListener('offline', () => {
      this.online = false;
      this.emit('banner', { id: 'conn', kind: 'warn', text: 'Du bist offline. Ohne Internet kann ich nicht denken – nur Timer und Notizen funktionieren.' });
    });
  }

  // ======================================================================
  // Timer, Erinnerungen, Eigeninitiative
  // ======================================================================

  #wireScheduler() {
    const s = () => this.store.settings;

    this.scheduler.on('timer-done', (t) => {
      if (s().sounds) sound.playChime();
      const line = pick(TIMER_DONE, 'timer')(t.label);
      this.emit('notice', { kind: 'timer', title: t.label ? `Timer „${t.label}“ ist fertig` : 'Timer ist fertig', text: line, id: t.id });
      showNotification('Ändy: Timer', t.label ? `„${t.label}“ ist abgelaufen` : 'Dein Timer ist abgelaufen', `timer-${t.id}`);
      this.announce(line, { quietOk: true });
    });

    this.scheduler.on('reminder-due', (r, info) => {
      const stale = info.late > 10 * 60_000;
      if (r.alarm && !stale) {
        sound.startAlarm();
      } else if (s().sounds) sound.playChime();
      const line = r.alarm ? pick(ALARM_RINGING, 'alarm')(r.text) : pick(REMINDER_DUE, 'reminder')(r.text);
      this.emit('notice', { kind: r.alarm ? 'alarm' : 'reminder', title: r.alarm ? 'Wecker' : 'Erinnerung', text: r.text, id: r.id, reminderId: r.id });
      showNotification(r.alarm ? 'Ändy: Wecker' : 'Ändy: Erinnerung', r.text, `rem-${r.id}`);
      if (s().proactiveSpeakReminders || r.alarm) this.announce(line, { quietOk: r.alarm });
    });

    this.scheduler.on('reminder-missed', (r) => {
      this.emit('notice', { kind: 'missed', title: 'Verpasste Erinnerung', text: `${r.text} (${describeWhen(new Date(r.at))})`, id: r.id });
    });

    this.scheduler.on('proactive', ({ kind }) => this.#onProactive(kind));
  }

  /**
   * Spricht eine Meldung von sich aus – nur wenn Ton freigeschaltet ist, kein Gespräch gestört wird
   * und keine Ruhezeit herrscht (Wecker und Timer dürfen auch dann klingeln).
   */
  announce(text, { quietOk = false } = {}) {
    const quiet = inQuietHours(new Date(), this.store.settings.quietFrom, this.store.settings.quietTo);
    if (quiet && !quietOk) return;
    if (!this.audioReady || !this.speaker.available) return;
    if (this.turn) {
      this.pendingAnnouncements.push({ text, opts: { quietOk } });
      return;
    }
    this.#sayLocal(text, { announcement: true });
  }

  async #onProactive(kind) {
    if (this.turn) return;
    const quiet = inQuietHours(new Date(), this.store.settings.quietFrom, this.store.settings.quietTo);
    const prompt =
      kind === 'morning'
        ? '(Es ist Morgen und der Nutzer hat die App offen. Begrüße ihn kurz und witzig zum Tag. Erwähne, falls vorhanden, seine anstehenden Erinnerungen von heute. Maximal drei Sätze.)'
        : '(Der Nutzer ist nach längerer Zeit zurückgekommen. Begrüße ihn in einem kurzen, witzigen Satz.)';
    const fallback = pick(kind === 'morning' ? MORNING_FALLBACKS : OPEN_GREETINGS, kind);

    this.emit('notice', { kind: 'info', title: kind === 'morning' ? 'Guten Morgen!' : 'Willkommen zurück!', text: '', id: `pro-${kind}` });
    if (quiet) return;
    if (this.caps.chat && this.online) {
      await this.sendText(prompt, { via: 'proactive', hidden: true });
    } else {
      this.announce(fallback);
      if (!this.audioReady) this.store.addMessage({ role: 'assistant', text: fallback });
    }
    if (document.hidden && kind === 'morning') showNotification('Ändy', fallback, 'morning');
  }

  /** Nach dem Laden einmal aufrufen. */
  startProactive() {
    this.scheduler.checkOnOpen();
  }
}
