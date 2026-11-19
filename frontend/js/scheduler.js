// Timer, Erinnerungen, Wecker und Eigeninitiative.
// Alles läuft in der Seite: Zeiten werden als absolute Zeitpunkte gespeichert und bei jedem Tick
// (und beim Zurückkehren in den Tab) geprüft. Browser dürfen Tabs im Hintergrund drosseln –
// im schlimmsten Fall meldet sich Ändy daher ein paar Sekunden zu spät, aber nie gar nicht,
// solange die Seite geöffnet ist.

import { Emitter } from './events.js';
import { inQuietHours, parseLocal, toLocalIso } from './datetime.js';

export class Scheduler extends Emitter {
  /** @param {import('./store.js').Store} store */
  constructor(store) {
    super();
    this.store = store;
    this.interval = null;
    this.lastMinuteCheck = 0;
  }

  start() {
    if (this.interval) return;
    this.interval = setInterval(() => this.tick(), 1000);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) this.tick();
    });
    globalThis.addEventListener?.('focus', () => this.tick());
    this.#reportMissed();
    this.tick();
  }

  // ----- Timer -----

  addTimer({ seconds, label = '' }) {
    return this.store.addTimer({ seconds, label });
  }

  // ----- Erinnerungen -----

  /** @param {{text:string, when:string, alarm?:boolean}} p  when = lokale ISO-Zeit */
  addReminder({ text, when, alarm = false }) {
    const date = parseLocal(when);
    if (!date) throw new Error('Ungültige Zeit.');
    if (date.getTime() < Date.now() - 60_000) throw new Error('Dieser Zeitpunkt liegt in der Vergangenheit.');
    return this.store.addReminder({ text, at: date.getTime(), alarm });
  }

  snooze(reminderId, minutes = 5) {
    return this.store.updateReminder(reminderId, { at: Date.now() + minutes * 60_000, fired: false });
  }

  // ----- Tick -----

  tick() {
    const now = Date.now();

    for (const t of [...this.store.timers]) {
      if (t.endsAt <= now) {
        this.store.removeTimer(t.id);
        this.emit('timer-done', t);
      }
    }

    for (const r of this.store.reminders) {
      if (!r.fired && r.at <= now) {
        // Sehr alte (z. B. beim Laden gefundene) werden separat als „verpasst“ gemeldet
        this.store.updateReminder(r.id, { fired: true });
        const late = now - r.at;
        this.emit('reminder-due', r, { late });
      }
    }

    this.emit('tick', now);

    if (now - this.lastMinuteCheck > 30_000) {
      this.lastMinuteCheck = now;
      this.#checkProactive(new Date(now));
    }
  }

  #reportMissed() {
    const now = Date.now();
    const missed = this.store.reminders.filter((r) => !r.fired && r.at < now - 2 * 60_000);
    for (const r of missed) {
      this.store.updateReminder(r.id, { fired: true });
      this.emit('reminder-missed', r);
    }
  }

  // ----- Eigeninitiative -----

  #checkProactive(now) {
    const s = this.store.settings;
    const today = toLocalIso(now).slice(0, 10);

    if (s.proactiveMorning && s.lastMorningDate !== today) {
      const [h, m] = s.morningTime.split(':').map(Number);
      const due = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m);
      // Nur innerhalb von 3 Stunden nach der Zeit – nicht um 20 Uhr ein „Guten Morgen“
      if (now >= due && now - due < 3 * 3600_000) {
        this.store.set('lastMorningDate', today);
        this.emit('proactive', { kind: 'morning' });
      }
    }
  }

  /** Beim Öffnen der Seite aufgerufen (einmal pro Sitzung). */
  checkOnOpen() {
    const s = this.store.settings;
    const now = Date.now();
    const awayHours = s.lastOpenAt ? (now - s.lastOpenAt) / 3600_000 : 99;
    this.store.set('lastOpenAt', now);
    if (s.proactiveOpen && awayHours >= 3) this.emit('proactive', { kind: 'open' });
  }

  inQuietHours(now = new Date()) {
    const s = this.store.settings;
    return inQuietHours(now, s.quietFrom, s.quietTo);
  }
}

// ---------------------------------------------------------------------------
// Benachrichtigungen (nur wenn der Nutzer sie erlaubt hat)
// ---------------------------------------------------------------------------

export async function requestNotificationPermission() {
  if (typeof Notification === 'undefined') return 'unsupported';
  if (Notification.permission === 'granted') return 'granted';
  if (Notification.permission === 'denied') return 'denied';
  try {
    return await Notification.requestPermission();
  } catch {
    return 'denied';
  }
}

export async function showNotification(title, body, tag) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return false;
  const options = { body, tag, icon: './icons/icon-192.png', badge: './icons/icon-192.png', lang: 'de', renotify: true };
  try {
    const reg = await navigator.serviceWorker?.getRegistration?.();
    if (reg?.showNotification) {
      await reg.showNotification(title, options);
      return true;
    }
  } catch {
    /* weiter mit klassischer Notification */
  }
  try {
    new Notification(title, options);
    return true;
  } catch {
    return false;
  }
}
