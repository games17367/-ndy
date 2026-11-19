// Führt die Aktionen aus, die die KI per Werkzeug anfordert (Timer, Notizen, Kalender, Navigation ...).
// Harmloses (Timer, Notiz, Erinnerung) läuft sofort. Alles, was Dritte oder andere Apps betrifft
// (Kalender, Navigation, Musik, Nachrichten, Webseiten), wird als Karte zur Bestätigung angezeigt –
// der Nutzer tippt selbst auf „Bestätigen“. Das ist zugleich die Nutzergeste, die Browser für
// das Öffnen von Apps und Links verlangen.

import { platform } from './platform.js';
import { buildIcs, googleCalendarUrl } from './ics.js';
import { describeWhen, parseLocal, spokenDuration } from './datetime.js';

/** Aktionen, die immer bestätigt werden müssen. */
const ALWAYS_CONFIRM = new Set(['create_calendar_event', 'start_navigation', 'play_music', 'compose_message', 'open_url']);

const isHttps = (u) => {
  try {
    return new URL(u).protocol === 'https:';
  } catch {
    return false;
  }
};

export function navigationUrl(destination, mode = 'driving') {
  const d = encodeURIComponent(destination);
  if (platform.isIOS) {
    const flag = { driving: 'd', walking: 'w', transit: 'r', bicycling: 'w' }[mode] || 'd';
    return `https://maps.apple.com/?daddr=${d}&dirflg=${flag}`;
  }
  return `https://www.google.com/maps/dir/?api=1&destination=${d}&travelmode=${mode}`;
}

export function musicUrl(service, query) {
  const q = encodeURIComponent(query);
  switch (service) {
    case 'apple_music':
      return `https://music.apple.com/search?term=${q}`;
    case 'youtube_music':
      return `https://music.youtube.com/search?q=${q}`;
    default:
      return `https://open.spotify.com/search/${q}`;
  }
}

export function messageLinks({ channel, body, recipient = '', subject = '' }) {
  const text = encodeURIComponent(body);
  const to = recipient.trim();
  if (channel === 'sms') {
    const num = to.replace(/[^\d+]/g, '');
    return { href: `sms:${num}${platform.isIOS ? '&' : '?'}body=${text}`, label: 'In Nachrichten öffnen' };
  }
  if (channel === 'whatsapp') {
    const num = to.replace(/[^\d]/g, '');
    return { href: `https://wa.me/${num}?text=${text}`, label: 'In WhatsApp öffnen' };
  }
  if (channel === 'email') {
    return { href: `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${text}`, label: 'In E-Mail öffnen' };
  }
  return { href: '', label: 'Teilen' };
}

export class ActionRunner {
  /**
   * @param {{store: import('./store.js').Store, scheduler: import('./scheduler.js').Scheduler,
   *          ui: any, log: (text: string) => void, applySetting: (key: string, value: any) => void}} deps
   */
  constructor({ store, scheduler, ui, log, applySetting }) {
    this.store = store;
    this.scheduler = scheduler;
    this.ui = ui;
    this.log = log;
    this.applySetting = applySetting;
  }

  /** Verarbeitet eine Aktion der KI. */
  handle(action) {
    const { name, input } = action;
    const needsConfirm = ALWAYS_CONFIRM.has(name) || (this.store.settings.confirmAlways && !['remember_fact', 'forget_fact'].includes(name));
    if (!needsConfirm) return this.#run(name, input);
    this.ui.showActionCard({
      id: action.id,
      ...this.#describe(name, input),
      onConfirm: (card) => this.#confirm(name, input, card),
    });
  }

  // ----- Sofort-Ausführung -----

  #run(name, i) {
    try {
      switch (name) {
        case 'set_timer': {
          this.scheduler.addTimer({ seconds: i.seconds, label: i.label });
          this.log(`Timer gestartet: ${i.label ? `${i.label}, ` : ''}${spokenDuration(i.seconds)}`);
          break;
        }
        case 'cancel_timer': {
          const n = this.store.cancelTimers(i.label);
          this.log(n ? `${n} Timer abgebrochen` : 'Kein passender Timer gefunden');
          break;
        }
        case 'add_reminder': {
          const r = this.scheduler.addReminder({ text: i.text, when: i.when, alarm: i.alarm });
          this.log(`${i.alarm ? 'Wecker' : 'Erinnerung'} gesetzt: ${i.text} (${describeWhen(new Date(r.at))})`);
          break;
        }
        case 'delete_reminder': {
          const n = this.store.deleteReminders(i.match);
          this.log(n ? `${n} Erinnerung${n > 1 ? 'en' : ''} gelöscht` : 'Keine passende Erinnerung gefunden');
          break;
        }
        case 'create_note': {
          this.store.addNote({ title: i.title, text: i.text });
          this.log(`Notiz gespeichert${i.title ? `: ${i.title}` : ''}`);
          break;
        }
        case 'delete_note': {
          const n = this.store.deleteNotes(i.match);
          this.log(n ? `${n} Notiz${n > 1 ? 'en' : ''} gelöscht` : 'Keine passende Notiz gefunden');
          break;
        }
        case 'set_setting': {
          this.applySetting(i.key, i.value);
          break;
        }
        case 'remember_fact': {
          if (this.store.settings.memoryEnabled && this.store.addFact(i.fact)) this.log(`Gemerkt: ${i.fact}`);
          break;
        }
        case 'forget_fact': {
          if (this.store.settings.memoryEnabled) {
            const n = this.store.deleteFacts(i.match);
            if (n) this.log('Vergessen');
          }
          break;
        }
        default:
          break;
      }
    } catch (err) {
      this.ui.toast(`Aktion fehlgeschlagen: ${err.message}`, 'error');
    }
  }

  // ----- Bestätigungskarten -----

  #describe(name, i) {
    switch (name) {
      case 'create_calendar_event': {
        const start = parseLocal(i.start);
        return {
          icon: 'calendar',
          title: 'Kalendertermin',
          lines: [i.title, start ? (i.allDay ? `am ${start.toLocaleDateString('de-AT')}` : describeWhen(start)) : i.start, i.location].filter(Boolean),
          confirmLabel: 'Zum Kalender hinzufügen',
          secondary: [{ label: 'Google Kalender', href: this.#safeGcal(i) }],
        };
      }
      case 'start_navigation':
        return {
          icon: 'map',
          title: 'Navigation',
          lines: [i.destination, { driving: 'Mit dem Auto', walking: 'Zu Fuß', transit: 'Öffentlich', bicycling: 'Mit dem Rad' }[i.mode]],
          confirmLabel: 'Route öffnen',
          href: navigationUrl(i.destination, i.mode),
        };
      case 'play_music':
        return {
          icon: 'music',
          title: 'Musik',
          lines: [i.query, { spotify: 'Spotify', apple_music: 'Apple Music', youtube_music: 'YouTube Music' }[i.service]],
          confirmLabel: 'Öffnen',
          href: musicUrl(i.service, i.query),
        };
      case 'compose_message': {
        const links = messageLinks(i);
        return {
          icon: 'message',
          title: { sms: 'SMS', whatsapp: 'WhatsApp', email: 'E-Mail', share: 'Nachricht' }[i.channel],
          lines: [i.recipient ? `An: ${i.recipient}` : '', i.subject ? `Betreff: ${i.subject}` : ''].filter(Boolean),
          editable: i.body,
          confirmLabel: links.label,
          href: links.href,
          compose: i,
        };
      }
      case 'open_url':
        return {
          icon: 'link',
          title: 'Webseite öffnen',
          lines: [i.title || new URL(i.url).hostname, new URL(i.url).hostname],
          confirmLabel: 'Öffnen',
          href: isHttps(i.url) ? i.url : '',
        };
      default: {
        // Alles andere (nur bei „immer bestätigen“)
        return {
          icon: 'check',
          title: 'Aktion bestätigen',
          lines: [this.#plainDescription(name, i)],
          confirmLabel: 'Ausführen',
        };
      }
    }
  }

  #plainDescription(name, i) {
    switch (name) {
      case 'set_timer':
        return `Timer ${i.label ? `„${i.label}“ ` : ''}für ${spokenDuration(i.seconds)}`;
      case 'add_reminder':
        return `${i.alarm ? 'Wecker' : 'Erinnerung'}: ${i.text} – ${describeWhen(parseLocal(i.when) || new Date())}`;
      case 'create_note':
        return `Notiz: ${i.text.slice(0, 80)}`;
      case 'set_setting':
        return `Einstellung ${i.key} auf ${i.value}`;
      case 'cancel_timer':
        return `Timer abbrechen: ${i.label}`;
      case 'delete_reminder':
        return `Erinnerung löschen: ${i.match}`;
      case 'delete_note':
        return `Notiz löschen: ${i.match}`;
      default:
        return name;
    }
  }

  #safeGcal(i) {
    try {
      return googleCalendarUrl({ title: i.title, start: i.start, end: i.end, location: i.location, notes: i.notes, allDay: i.allDay });
    } catch {
      return '';
    }
  }

  /** Wird beim Tippen auf „Bestätigen“ aufgerufen (Nutzergeste!). */
  #confirm(name, i, card) {
    switch (name) {
      case 'create_calendar_event': {
        try {
          const ics = buildIcs({ title: i.title, start: i.start, end: i.end, location: i.location, notes: i.notes, allDay: i.allDay });
          const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `${i.title.replace(/[^\p{L}\p{N}]+/gu, '-').slice(0, 40) || 'termin'}.ics`;
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 30_000);
          this.log(`Kalendertermin bereitgestellt: ${i.title}`);
        } catch (err) {
          this.ui.toast(`Termin konnte nicht erstellt werden: ${err.message}`, 'error');
        }
        return true;
      }
      case 'start_navigation':
      case 'play_music':
      case 'open_url': {
        const href = card.href;
        if (!href || !isHttps(href)) return false;
        window.open(href, '_blank', 'noopener');
        this.log(name === 'start_navigation' ? `Navigation geöffnet: ${i.destination}` : name === 'play_music' ? `Musik geöffnet: ${i.query}` : `Webseite geöffnet: ${i.url}`);
        return true;
      }
      case 'compose_message': {
        const body = card.getEditedBody?.() ?? i.body;
        if (i.channel === 'share') {
          if (platform.hasShare) {
            navigator.share({ text: body }).catch(() => {});
          } else {
            navigator.clipboard?.writeText(body).then(() => this.ui.toast('Text in die Zwischenablage kopiert.'));
          }
          this.log('Nachricht zum Teilen bereitgestellt');
          return true;
        }
        const href = messageLinks({ ...i, body }).href;
        window.location.href = href;
        this.log(`Nachricht vorbereitet (${i.channel})`);
        return true;
      }
      default:
        this.#run(name, i);
        return true;
    }
  }
}
