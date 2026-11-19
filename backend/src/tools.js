// Werkzeuge, die Ändy der KI zur Verfügung stellt.
//  - "server"-Werkzeuge werden hier ausgeführt (Suche, Wetter, Rechner).
//  - "client"-Werkzeuge werden als Aktion an den Browser geschickt (Timer, Notizen, Kalender, ...).

import { evaluate, formatNumber } from './calc.js';
import { getWeather, weatherToText } from './weather.js';
import { webSearch, searchToText } from './search.js';
import { cleanText } from './persona.js';

const str = (description, extra = {}) => ({ type: 'string', description, ...extra });

const SERVER_TOOLS = [
  {
    name: 'web_search',
    description:
      'Sucht aktuelle Informationen im Internet (Nachrichten, Fakten, Preise, Öffnungszeiten, Sport, Personen, Orte). Benutze es, wenn du dir bei aktuellen Dingen nicht sicher bist.',
    input_schema: { type: 'object', properties: { query: str('Suchanfrage, am besten auf Deutsch und knapp.') }, required: ['query'] },
  },
  {
    name: 'get_weather',
    description:
      'Ruft das aktuelle Wetter und die Vorhersage für heute, morgen und übermorgen ab. Ohne Ortsangabe wird der freigegebene Standort des Nutzers verwendet.',
    input_schema: { type: 'object', properties: { location: str('Ort, z. B. „Salzburg“. Leer lassen für den Standort des Nutzers.') } },
  },
  {
    name: 'calculate',
    description:
      'Berechnet einen mathematischen Ausdruck exakt. Unterstützt + - * / ^ ( ) %, sqrt, sin, cos, tan, ln, log, abs, round, floor, ceil, min, max, pi, e. Prozente als Faktor schreiben (z. B. 19 % von 80 → 80*19%).',
    input_schema: { type: 'object', properties: { expression: str('Ausdruck, z. B. „(12.5+7.5)*3“.') }, required: ['expression'] },
  },
];

const CLIENT_TOOLS = [
  {
    name: 'set_timer',
    description: 'Startet einen Timer (Countdown) im Browser. Läuft, solange Ändy geöffnet ist.',
    input_schema: {
      type: 'object',
      properties: {
        seconds: { type: 'integer', description: 'Dauer in Sekunden (1 bis 86400).', minimum: 1, maximum: 86400 },
        label: str('Kurzer Name des Timers, z. B. „Nudeln“.'),
      },
      required: ['seconds'],
    },
  },
  {
    name: 'cancel_timer',
    description: 'Bricht einen oder alle Timer ab.',
    input_schema: { type: 'object', properties: { label: str('Name des Timers oder „alle“.') }, required: ['label'] },
  },
  {
    name: 'add_reminder',
    description:
      'Legt eine Erinnerung oder einen Wecker an. Klingelt/benachrichtigt nur, solange Ändy im Browser oder als installierte App geöffnet ist.',
    input_schema: {
      type: 'object',
      properties: {
        text: str('Woran erinnert werden soll, z. B. „Mama anrufen“.'),
        when: str('Zeitpunkt in der lokalen Zeit des Nutzers im Format YYYY-MM-DDTHH:MM (ohne Zeitzone).'),
        alarm: { type: 'boolean', description: 'true = Wecker, der hartnäckig klingelt, bis der Nutzer ihn ausmacht.' },
      },
      required: ['text', 'when'],
    },
  },
  {
    name: 'delete_reminder',
    description: 'Löscht eine Erinnerung anhand eines Stichworts aus ihrem Text.',
    input_schema: { type: 'object', properties: { match: str('Stichwort aus dem Erinnerungstext oder „alle“.') }, required: ['match'] },
  },
  {
    name: 'create_note',
    description: 'Speichert eine Notiz auf dem Gerät des Nutzers.',
    input_schema: {
      type: 'object',
      properties: { text: str('Inhalt der Notiz.'), title: str('Optionaler kurzer Titel.') },
      required: ['text'],
    },
  },
  {
    name: 'delete_note',
    description: 'Löscht eine Notiz anhand eines Stichworts aus Titel oder Text.',
    input_schema: { type: 'object', properties: { match: str('Stichwort oder „alle“.') }, required: ['match'] },
  },
  {
    name: 'create_calendar_event',
    description:
      'Bereitet einen Kalendertermin vor. Der Nutzer bestätigt auf dem Bildschirm und übernimmt ihn in seinen Kalender (Datei oder Kalender-Link).',
    input_schema: {
      type: 'object',
      properties: {
        title: str('Titel des Termins.'),
        start: str('Beginn, lokale Zeit, Format YYYY-MM-DDTHH:MM.'),
        end: str('Ende, lokale Zeit, Format YYYY-MM-DDTHH:MM. Leer = eine Stunde nach Beginn.'),
        location: str('Ort (optional).'),
        notes: str('Notizen (optional).'),
        all_day: { type: 'boolean', description: 'Ganztägiger Termin (dann zählt nur das Datum).' },
      },
      required: ['title', 'start'],
    },
  },
  {
    name: 'start_navigation',
    description: 'Bereitet eine Navigation vor. Der Nutzer bestätigt, dann öffnet sich seine Karten-App.',
    input_schema: {
      type: 'object',
      properties: {
        destination: str('Ziel: Adresse, Ort oder Name eines Geschäfts.'),
        mode: { type: 'string', enum: ['driving', 'walking', 'transit', 'bicycling'], description: 'Fortbewegung (Standard: driving).' },
      },
      required: ['destination'],
    },
  },
  {
    name: 'play_music',
    description:
      'Öffnet eine Musik-App mit Suche (Titel, Künstler, Playlist oder Stimmung). Steuert KEINE laufende Musik anderer Apps.',
    input_schema: {
      type: 'object',
      properties: {
        query: str('Was gespielt werden soll.'),
        service: { type: 'string', enum: ['spotify', 'apple_music', 'youtube_music'], description: 'Musikdienst (Standard: spotify).' },
      },
      required: ['query'],
    },
  },
  {
    name: 'compose_message',
    description:
      'Bereitet eine Nachricht vor (diktiert), die der Nutzer prüft und selbst abschickt. Ändy sendet niemals selbst.',
    input_schema: {
      type: 'object',
      properties: {
        channel: { type: 'string', enum: ['sms', 'whatsapp', 'email', 'share'], description: 'Kanal.' },
        body: str('Der fertig formulierte Nachrichtentext.'),
        recipient: str('Empfänger (Telefonnummer oder E-Mail), nur wenn der Nutzer sie genannt hat.'),
        subject: str('Betreff (nur E-Mail).'),
      },
      required: ['channel', 'body'],
    },
  },
  {
    name: 'open_url',
    description: 'Öffnet eine Webseite im Browser – nur auf ausdrücklichen Wunsch des Nutzers. Der Nutzer bestätigt.',
    input_schema: { type: 'object', properties: { url: str('Vollständige https-Adresse.'), title: str('Anzeigename.') }, required: ['url'] },
  },
  {
    name: 'set_setting',
    description: 'Ändert eine Einstellung von Ändy auf Wunsch des Nutzers.',
    input_schema: {
      type: 'object',
      properties: {
        key: { type: 'string', enum: ['speechRate', 'volume', 'humor', 'cheeky'], description: 'speechRate 0.6–1.6 (1 = normal), volume 0–1, humor 0–100, cheeky true/false.' },
        value: { type: ['number', 'boolean'], description: 'Neuer Wert.' },
      },
      required: ['key', 'value'],
    },
  },
];

const MEMORY_TOOLS = [
  {
    name: 'remember_fact',
    description:
      'Merkt sich dauerhaft einen Fakt über den Nutzer (nur wenn er ihn selbst genannt hat und er dauerhaft nützlich ist). Keine Passwörter, Zahlungsdaten, Gesundheitsdetails.',
    input_schema: { type: 'object', properties: { fact: str('Der Fakt in einem kurzen Satz, z. B. „Hat einen Hund namens Bruno“.') }, required: ['fact'] },
  },
  {
    name: 'forget_fact',
    description: 'Vergisst einen gemerkten Fakt anhand eines Stichworts.',
    input_schema: { type: 'object', properties: { match: str('Stichwort aus dem Fakt.') }, required: ['match'] },
  },
];

const SERVER_NAMES = new Set(SERVER_TOOLS.map((t) => t.name));

export function getToolDefinitions({ memoryEnabled = false } = {}) {
  return [...SERVER_TOOLS, ...CLIENT_TOOLS, ...(memoryEnabled ? MEMORY_TOOLS : [])];
}

export const isServerTool = (name) => SERVER_NAMES.has(name);

// ---------------------------------------------------------------------------
// Eingabeprüfung der Client-Werkzeuge (liefert bereinigte Eingabe oder wirft Fehler)
// ---------------------------------------------------------------------------

const LOCAL_DT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;
const LOCAL_D = /^\d{4}-\d{2}-\d{2}$/;

function requireText(v, label, max = 400) {
  const t = cleanText(v, max);
  if (!t) throw new Error(`„${label}“ fehlt.`);
  return t;
}

function requireLocalDateTime(v, label, allowDateOnly = false) {
  const t = cleanText(v, 25);
  if (LOCAL_DT.test(t) || (allowDateOnly && LOCAL_D.test(t))) return t;
  throw new Error(`„${label}“ muss im Format YYYY-MM-DDTHH:MM angegeben werden.`);
}

const VALIDATORS = {
  set_timer(i) {
    const seconds = Math.round(Number(i.seconds));
    if (!Number.isFinite(seconds) || seconds < 1 || seconds > 86400) throw new Error('„seconds“ muss zwischen 1 und 86400 liegen.');
    return { seconds, label: cleanText(i.label, 60) };
  },
  cancel_timer: (i) => ({ label: requireText(i.label, 'label', 60) }),
  add_reminder: (i) => ({
    text: requireText(i.text, 'text', 200),
    when: requireLocalDateTime(i.when, 'when'),
    alarm: Boolean(i.alarm),
  }),
  delete_reminder: (i) => ({ match: requireText(i.match, 'match', 80) }),
  create_note: (i) => ({ text: requireText(i.text, 'text', 2000), title: cleanText(i.title, 80) }),
  delete_note: (i) => ({ match: requireText(i.match, 'match', 80) }),
  create_calendar_event(i) {
    const allDay = Boolean(i.all_day);
    return {
      title: requireText(i.title, 'title', 120),
      start: requireLocalDateTime(i.start, 'start', allDay),
      end: i.end ? requireLocalDateTime(i.end, 'end', allDay) : '',
      location: cleanText(i.location, 160),
      notes: cleanText(i.notes, 500),
      allDay,
    };
  },
  start_navigation: (i) => ({
    destination: requireText(i.destination, 'destination', 200),
    mode: ['driving', 'walking', 'transit', 'bicycling'].includes(i.mode) ? i.mode : 'driving',
  }),
  play_music: (i) => ({
    query: requireText(i.query, 'query', 150),
    service: ['spotify', 'apple_music', 'youtube_music'].includes(i.service) ? i.service : 'spotify',
  }),
  compose_message(i) {
    if (!['sms', 'whatsapp', 'email', 'share'].includes(i.channel)) throw new Error('„channel“ ist ungültig.');
    return {
      channel: i.channel,
      body: requireText(i.body, 'body', 1500),
      recipient: cleanText(i.recipient, 120),
      subject: cleanText(i.subject, 150),
    };
  },
  open_url(i) {
    const url = cleanText(i.url, 500);
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error('„url“ ist keine gültige Adresse.');
    }
    if (parsed.protocol !== 'https:') throw new Error('Nur https-Adressen sind erlaubt.');
    return { url: parsed.toString(), title: cleanText(i.title, 80) };
  },
  set_setting(i) {
    const key = i.key;
    if (key === 'speechRate') return { key, value: Math.min(1.6, Math.max(0.6, Number(i.value) || 1)) };
    if (key === 'volume') return { key, value: Math.min(1, Math.max(0, Number(i.value))) };
    if (key === 'humor') return { key, value: Math.min(100, Math.max(0, Math.round(Number(i.value)))) };
    if (key === 'cheeky') return { key, value: i.value === true || i.value === 'true' };
    throw new Error('Diese Einstellung kann nicht geändert werden.');
  },
  remember_fact: (i) => ({ fact: requireText(i.fact, 'fact', 200) }),
  forget_fact: (i) => ({ match: requireText(i.match, 'match', 80) }),
};

// Was die KI als Werkzeug-Ergebnis zurückbekommt, wenn eine Aktion an den Browser übergeben wurde.
const CLIENT_RESULTS = {
  set_timer: 'Timer wurde im Browser gestartet. Er klingelt nur, solange Ändy geöffnet ist.',
  cancel_timer: 'Timer-Abbruch wurde an den Browser übergeben.',
  add_reminder: 'Erinnerung wurde gespeichert. Sie meldet sich nur, solange Ändy im Browser oder als installierte App geöffnet ist.',
  delete_reminder: 'Löschen der Erinnerung wurde an den Browser übergeben.',
  create_note: 'Notiz wurde auf dem Gerät gespeichert.',
  delete_note: 'Löschen der Notiz wurde an den Browser übergeben.',
  create_calendar_event: 'Der Termin ist VORBEREITET und wartet auf die Bestätigung des Nutzers auf dem Bildschirm. Noch nicht im Kalender.',
  start_navigation: 'Die Navigation ist VORBEREITET und wartet auf die Bestätigung des Nutzers auf dem Bildschirm.',
  play_music: 'Die Musik-Suche ist VORBEREITET und wartet auf die Bestätigung des Nutzers auf dem Bildschirm.',
  compose_message: 'Die Nachricht ist VORBEREITET. Der Nutzer prüft sie und sendet sie selbst ab. Es wurde noch nichts gesendet.',
  open_url: 'Die Webseite wartet auf die Bestätigung des Nutzers auf dem Bildschirm.',
  set_setting: 'Einstellung wurde geändert.',
  remember_fact: 'Fakt wurde gespeichert.',
  forget_fact: 'Fakt wurde vergessen.',
};

/**
 * Führt einen Werkzeugaufruf aus.
 * Rückgabe: { kind: 'result', text, card? } für Server-Werkzeuge,
 *           { kind: 'action', input, text } für Client-Werkzeuge,
 *           { kind: 'error', text } bei ungültiger Eingabe.
 */
export async function runTool(name, rawInput, { config, context, signal }) {
  const input = rawInput && typeof rawInput === 'object' ? rawInput : {};

  if (name === 'calculate') {
    try {
      const value = evaluate(String(input.expression ?? ''));
      return { kind: 'result', text: `Ergebnis: ${formatNumber(value)}` };
    } catch (err) {
      return { kind: 'error', text: `Rechenfehler: ${err.message}` };
    }
  }

  if (name === 'get_weather') {
    try {
      const w = await getWeather(config, { location: input.location, coords: context.coords }, signal);
      return { kind: 'result', text: weatherToText(w), card: { type: 'weather', data: w } };
    } catch (err) {
      if (signal?.aborted) throw err;
      return { kind: 'error', text: `Wetter nicht verfügbar: ${err.message}` };
    }
  }

  if (name === 'web_search') {
    try {
      const out = await webSearch(config, input.query, signal);
      return { kind: 'result', text: searchToText(out) };
    } catch (err) {
      if (signal?.aborted) throw err;
      return { kind: 'error', text: `Websuche nicht verfügbar: ${err.message}` };
    }
  }

  const validate = VALIDATORS[name];
  if (!validate) return { kind: 'error', text: `Unbekanntes Werkzeug „${name}“.` };
  try {
    return { kind: 'action', input: validate(input), text: CLIENT_RESULTS[name] };
  } catch (err) {
    return { kind: 'error', text: `Ungültige Eingabe: ${err.message}` };
  }
}
