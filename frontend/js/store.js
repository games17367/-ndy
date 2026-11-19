// Einstellungen und lokale Daten (Verlauf, Notizen, Erinnerungen, Timer, Gedächtnis).
// Alles bleibt im Browser (localStorage). Nichts wird ohne Zutun an einen Server gesendet,
// außer dem Gesprächstext, den Ändy zum Antworten braucht.

import { Emitter } from './events.js';

export const DEFAULT_SETTINGS = Object.freeze({
  // Stimme
  voiceEngine: 'auto', // auto | browser | cloud
  voiceURI: '',
  cloudVoice: 'ash',
  voiceGender: 'male', // male | female | any
  voiceCharacter: 'clown', // clown | natural
  clownLevel: 35, // 0–100: „ein bisschen Clown, nicht zu sehr“
  speechRate: 1,
  volume: 1,
  lively: true, // leichte Variation von Tempo/Tonhöhe pro Satz
  // Persönlichkeit
  humor: 70,
  cheeky: false,
  length: 'normal', // short | normal | long
  dialect: 'standard', // standard | austrian
  address: 'du', // du | sie
  userName: '',
  customInstruction: '',
  aiGreeting: false,
  // Aktivierung & Gespräch
  activation: 'wake', // wake | button
  wakeLoose: false,
  sttEngine: 'auto', // auto | browser | server
  lang: 'de-DE',
  bargeIn: null, // null = automatisch (Desktop an, Handy aus)
  pauseMs: 1200, // Gesprächspause bei Server-Spracherkennung
  autoSleepMin: 5,
  keepScreenOn: true,
  sounds: true,
  speakTyped: false,
  // Funktionen
  useLocation: false,
  confirmAlways: false,
  // Eigeninitiative
  proactiveMorning: false,
  morningTime: '07:30',
  proactiveOpen: false,
  proactiveSpeakReminders: true,
  quietFrom: '22:00',
  quietTo: '07:00',
  // Speicher (freiwillig)
  saveHistory: false,
  memoryEnabled: false,
  // Verbindung
  apiBase: '',
  accessCode: '',
  // Sonstiges
  onboarded: false,
  lastMorningDate: '',
  lastOpenAt: 0,
});

const KEYS = {
  settings: 'aendy.settings.v1',
  history: 'aendy.history.v1',
  notes: 'aendy.notes.v1',
  reminders: 'aendy.reminders.v1',
  timers: 'aendy.timers.v1',
  facts: 'aendy.facts.v1',
  ui: 'aendy.ui.v1',
};

const LIMITS = { history: 200, notes: 200, reminders: 200, facts: 50 };

export const uid = () =>
  (globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);

function safeGet(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function safeSet(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function safeRemove(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignorieren */
  }
}

const clampNum = (v, lo, hi, fb) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fb;
};

/** Prüft und korrigiert Einstellungen (z. B. nach manueller Änderung oder Update). */
export function normalizeSettings(raw) {
  const s = { ...DEFAULT_SETTINGS, ...(raw && typeof raw === 'object' ? raw : {}) };
  const pick = (v, list, fb) => (list.includes(v) ? v : fb);
  s.voiceEngine = pick(s.voiceEngine, ['auto', 'browser', 'cloud'], 'auto');
  s.voiceGender = pick(s.voiceGender, ['male', 'female', 'any'], 'male');
  s.voiceCharacter = pick(s.voiceCharacter, ['clown', 'natural'], 'clown');
  s.clownLevel = Math.round(clampNum(s.clownLevel, 0, 100, 35));
  s.speechRate = clampNum(s.speechRate, 0.6, 1.6, 1);
  s.volume = clampNum(s.volume, 0, 1, 1);
  s.humor = Math.round(clampNum(s.humor, 0, 100, 70));
  s.length = pick(s.length, ['short', 'normal', 'long'], 'normal');
  s.dialect = pick(s.dialect, ['standard', 'austrian'], 'standard');
  s.address = pick(s.address, ['du', 'sie'], 'du');
  s.activation = pick(s.activation, ['wake', 'button'], 'wake');
  s.sttEngine = pick(s.sttEngine, ['auto', 'browser', 'server'], 'auto');
  s.lang = pick(s.lang, ['de-DE', 'de-AT', 'de-CH'], 'de-DE');
  s.pauseMs = Math.round(clampNum(s.pauseMs, 500, 3000, 1200));
  s.autoSleepMin = Math.round(clampNum(s.autoSleepMin, 0, 60, 5));
  s.bargeIn = s.bargeIn === true || s.bargeIn === false ? s.bargeIn : null;
  s.userName = String(s.userName || '').slice(0, 40);
  s.customInstruction = String(s.customInstruction || '').slice(0, 600);
  s.apiBase = String(s.apiBase || '').trim().replace(/\/+$/, '').slice(0, 300);
  s.accessCode = String(s.accessCode || '').slice(0, 200);
  for (const k of ['morningTime', 'quietFrom', 'quietTo']) {
    if (!/^\d{1,2}:\d{2}$/.test(String(s[k]))) s[k] = DEFAULT_SETTINGS[k];
  }
  return s;
}

export class Store extends Emitter {
  settings;
  history = []; // {id, role:'user'|'assistant'|'system', text, ts, hidden?, interrupted?}
  notes = []; // {id, title, text, ts}
  reminders = []; // {id, text, at, alarm, fired, ts}
  timers = []; // {id, label, endsAt, createdAt}
  facts = []; // {id, text, ts}
  ui = {};

  constructor() {
    super();
    this.settings = normalizeSettings(safeGet(KEYS.settings));
    this.notes = this.#list(KEYS.notes, LIMITS.notes);
    this.reminders = this.#list(KEYS.reminders, LIMITS.reminders);
    this.timers = this.#list(KEYS.timers, 50);
    this.ui = safeGet(KEYS.ui) || {};
    if (this.settings.saveHistory) this.history = this.#list(KEYS.history, LIMITS.history);
    if (this.settings.memoryEnabled) this.facts = this.#list(KEYS.facts, LIMITS.facts);
  }

  #list(key, max) {
    const v = safeGet(key);
    return Array.isArray(v) ? v.filter((x) => x && typeof x === 'object').slice(-max) : [];
  }

  // ----- Einstellungen -----

  get(key) {
    return this.settings[key];
  }

  set(key, value) {
    if (!(key in DEFAULT_SETTINGS)) return;
    const next = normalizeSettings({ ...this.settings, [key]: value });
    const changed = next[key] !== this.settings[key];
    this.settings = next;
    safeSet(KEYS.settings, this.settings);
    if (key === 'saveHistory') this.#onSaveHistoryChanged();
    if (key === 'memoryEnabled') this.#onMemoryChanged();
    if (changed || key === 'saveHistory' || key === 'memoryEnabled') this.emit('setting', key, this.settings[key]);
  }

  setMany(obj) {
    for (const [k, v] of Object.entries(obj)) this.set(k, v);
  }

  resolve(key) {
    return this.settings[key];
  }

  #onSaveHistoryChanged() {
    if (this.settings.saveHistory) this.#persist('history');
    else safeRemove(KEYS.history); // Verlauf bleibt nur noch im Arbeitsspeicher
  }

  #onMemoryChanged() {
    if (this.settings.memoryEnabled) this.#persist('facts');
    else {
      // Beim Ausschalten bleiben Fakten bewusst gespeichert, werden aber nicht mehr genutzt.
      // Löschen geht über „Gedächtnis löschen“.
    }
  }

  #persist(name) {
    if (name === 'history' && !this.settings.saveHistory) return;
    if (name === 'facts' && !this.settings.memoryEnabled) return;
    const data = this[name].slice(-LIMITS[name] || -200);
    if (!safeSet(KEYS[name], data) && data.length > 20) {
      // Speicher voll → älteste Hälfte verwerfen und erneut versuchen
      this[name] = data.slice(Math.floor(data.length / 2));
      safeSet(KEYS[name], this[name]);
    }
  }

  // ----- Verlauf -----

  addMessage(msg) {
    const entry = { id: uid(), ts: Date.now(), ...msg };
    this.history.push(entry);
    if (this.history.length > LIMITS.history) this.history.splice(0, this.history.length - LIMITS.history);
    this.#persist('history');
    this.emit('history', entry);
    return entry;
  }

  updateMessage(id, patch) {
    const m = this.history.find((x) => x.id === id);
    if (!m) return null;
    Object.assign(m, patch);
    this.#persist('history');
    this.emit('history-update', m);
    return m;
  }

  clearHistory() {
    this.history = [];
    safeRemove(KEYS.history);
    this.emit('history-clear');
  }

  /** Nachrichten im Format der API (nur Nutzer/Ändy, ohne Systemzeilen), begrenzt. */
  messagesForApi(limit = 24) {
    return this.history
      .filter((m) => (m.role === 'user' || m.role === 'assistant') && m.text && !m.error)
      .slice(-limit)
      .map((m) => ({ role: m.role, content: m.text }));
  }

  // ----- Notizen -----

  addNote({ title = '', text }) {
    const note = { id: uid(), title: String(title).slice(0, 80), text: String(text).slice(0, 2000), ts: Date.now() };
    this.notes.push(note);
    this.#persist('notes');
    this.emit('notes');
    return note;
  }

  deleteNotes(match) {
    const before = this.notes.length;
    const q = String(match || '').toLowerCase().trim();
    this.notes = this.notes.filter((n) => {
      if (q === 'alle' || q === 'all') return false;
      return !(n.title + ' ' + n.text).toLowerCase().includes(q);
    });
    this.#persist('notes');
    this.emit('notes');
    return before - this.notes.length;
  }

  deleteNoteById(id) {
    this.notes = this.notes.filter((n) => n.id !== id);
    this.#persist('notes');
    this.emit('notes');
  }

  // ----- Erinnerungen -----

  addReminder({ text, at, alarm = false }) {
    const r = { id: uid(), text: String(text).slice(0, 200), at, alarm: Boolean(alarm), fired: false, ts: Date.now() };
    this.reminders.push(r);
    this.#persist('reminders');
    this.emit('reminders');
    return r;
  }

  updateReminder(id, patch) {
    const r = this.reminders.find((x) => x.id === id);
    if (!r) return null;
    Object.assign(r, patch);
    this.#persist('reminders');
    this.emit('reminders');
    return r;
  }

  deleteReminders(match) {
    const before = this.reminders.length;
    const q = String(match || '').toLowerCase().trim();
    this.reminders = this.reminders.filter((r) => {
      if (q === 'alle' || q === 'all') return false;
      return !r.text.toLowerCase().includes(q);
    });
    this.#persist('reminders');
    this.emit('reminders');
    return before - this.reminders.length;
  }

  deleteReminderById(id) {
    this.reminders = this.reminders.filter((r) => r.id !== id);
    this.#persist('reminders');
    this.emit('reminders');
  }

  // ----- Timer -----

  addTimer({ label = '', seconds }) {
    const now = Date.now();
    const t = { id: uid(), label: String(label).slice(0, 60), endsAt: now + seconds * 1000, createdAt: now, seconds };
    this.timers.push(t);
    this.#persist('timers');
    this.emit('timers');
    return t;
  }

  removeTimer(id) {
    const before = this.timers.length;
    this.timers = this.timers.filter((t) => t.id !== id);
    this.#persist('timers');
    if (before !== this.timers.length) this.emit('timers');
  }

  cancelTimers(label) {
    const q = String(label || '').toLowerCase().trim();
    const before = this.timers.length;
    this.timers = this.timers.filter((t) => {
      if (q === 'alle' || q === 'all' || q === '') return false;
      return !t.label.toLowerCase().includes(q);
    });
    this.#persist('timers');
    this.emit('timers');
    return before - this.timers.length;
  }

  // ----- Gedächtnis -----

  addFact(text) {
    const t = String(text).trim().slice(0, 200);
    if (!t) return null;
    if (this.facts.some((f) => f.text.toLowerCase() === t.toLowerCase())) return null;
    const fact = { id: uid(), text: t, ts: Date.now() };
    this.facts.push(fact);
    if (this.facts.length > LIMITS.facts) this.facts.shift();
    this.#persist('facts');
    this.emit('facts');
    return fact;
  }

  deleteFacts(match) {
    const q = String(match || '').toLowerCase().trim();
    const before = this.facts.length;
    this.facts = this.facts.filter((f) => !f.text.toLowerCase().includes(q));
    safeSet(KEYS.facts, this.facts);
    this.emit('facts');
    return before - this.facts.length;
  }

  deleteFactById(id) {
    this.facts = this.facts.filter((f) => f.id !== id);
    safeSet(KEYS.facts, this.facts);
    this.emit('facts');
  }

  clearFacts() {
    this.facts = [];
    safeRemove(KEYS.facts);
    this.emit('facts');
  }

  /** Fakten, wie sie an die KI gesendet werden (nur wenn Gedächtnis aktiv). */
  factsForApi() {
    return this.settings.memoryEnabled ? this.facts.map((f) => f.text) : [];
  }

  // ----- UI-Zustand (nur Komfort) -----

  setUi(key, value) {
    this.ui[key] = value;
    safeSet(KEYS.ui, this.ui);
  }

  // ----- Export / Zurücksetzen -----

  exportAll() {
    const { accessCode, ...settings } = this.settings; // Zugangscode nie exportieren
    return {
      app: 'aendy',
      exportedAt: new Date().toISOString(),
      settings,
      history: this.history,
      notes: this.notes,
      reminders: this.reminders,
      facts: this.facts,
    };
  }

  resetAll() {
    for (const k of Object.values(KEYS)) safeRemove(k);
    this.settings = normalizeSettings(null);
    this.history = [];
    this.notes = [];
    this.reminders = [];
    this.timers = [];
    this.facts = [];
    this.ui = {};
    this.emit('reset');
  }
}
