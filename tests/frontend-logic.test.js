import { test } from 'node:test';
import assert from 'node:assert/strict';

import { detectWake, levenshtein, stripAddress } from '../frontend/js/wake.js';
import { parseLocalCommand } from '../frontend/js/commands.js';
import { splitSentences, cleanForSpeech, echoScore } from '../frontend/js/speech-text.js';
import { toLocalIso, parseLocal, describeWhen, formatCountdown, spokenDuration, inQuietHours, describeNow } from '../frontend/js/datetime.js';
import { buildIcs, googleCalendarUrl, foldLine } from '../frontend/js/ics.js';
import { pick, WAKE_GREETINGS } from '../frontend/js/content.js';

// ---------------------------------------------------------------- Weckwort

test('Weckwort: viele Schreibweisen der Spracherkennung', () => {
  const yes = [
    'Sarvus Ändy',
    'sarvus ändy!',
    'Servus Andy',
    'servus andi',
    'Sarvus Endi',
    'Servas Andy',
    'sar vus andy',
    'Ser vus Ändy',
    'Servus, Ändy.',
    'ok also sarvus ändy was geht',
    'SARVUS ÄNDY!',
    'Servus Handy',
    'Sarvus Ändi',
    'Serwus Andy',
    'Servusandy',
  ];
  for (const t of yes) assert.equal(detectWake(t).matched, true, `soll erkennen: „${t}“`);
});

test('Weckwort: keine Fehlalarme', () => {
  const no = [
    'servus',
    'ändy',
    'andy murray hat gewonnen',
    'ich habe heute einen termin',
    'sarah und andreas kommen',
    'servus mama',
    'servus und tschüss',
    'das ist mein handy',
    'hallo ändy',
    '',
    'Sandy Servus',
  ];
  for (const t of no) assert.equal(detectWake(t).matched, false, `soll NICHT erkennen: „${t}“`);
});

test('Weckwort: lockerer Modus akzeptiert „Hey Ändy“', () => {
  assert.equal(detectWake('hey ändy', { loose: true }).matched, true);
  assert.equal(detectWake('hallo andy', { loose: true }).matched, true);
  assert.equal(detectWake('hey ändy', { loose: false }).matched, false);
});

test('Weckwort: Rest nach dem Weckwort wird extrahiert', () => {
  assert.equal(detectWake('Sarvus Ändy, wie spät ist es?').rest, 'wie spät ist es?');
  assert.equal(detectWake('sarvus ändy').rest, '');
  assert.equal(detectWake('Hey du, Servus Andy! Stell einen Timer').rest, 'Stell einen Timer');
});

test('Levenshtein und Anrede', () => {
  assert.equal(levenshtein('kitten', 'sitting'), 3);
  assert.equal(levenshtein('', 'abc'), 3);
  assert.equal(stripAddress('Ändy, Ruhe.'), 'Ruhe');
  assert.equal(stripAddress('Ruhe Ändy'), 'Ruhe');
  assert.equal(stripAddress('Wie geht es dir'), 'Wie geht es dir');
});

// ---------------------------------------------------------------- Befehle

test('Lokale Befehle: Gespräch beenden', () => {
  for (const t of ['Ändy, Ruhe.', 'Ruhe', 'ruhe bitte', 'Ändy sei still', 'halt die Klappe', 'Ändy, schlaf ein']) {
    assert.deepEqual(parseLocalCommand(t), { type: 'end', farewell: false }, t);
  }
  for (const t of ['Tschüss Ändy', 'Gute Nacht', 'bis später', "das war's", 'Ciao']) {
    assert.deepEqual(parseLocalCommand(t), { type: 'end', farewell: true }, t);
  }
});

test('Lokale Befehle: Unterbrechen, lauter, leiser', () => {
  assert.deepEqual(parseLocalCommand('Stopp'), { type: 'interrupt' });
  assert.deepEqual(parseLocalCommand('Ändy, warte mal'), { type: 'interrupt' });
  assert.deepEqual(parseLocalCommand('lauter'), { type: 'louder' });
  assert.deepEqual(parseLocalCommand('sprich bitte etwas leiser'), { type: 'quieter' });
  assert.deepEqual(parseLocalCommand('Ändy, sei jetzt mal still'), { type: 'end', farewell: false });
  assert.deepEqual(parseLocalCommand('Ändy, leiser bitte'), { type: 'quieter' });
});

test('Lokale Befehle: normale Sätze sind keine Befehle', () => {
  for (const t of [
    'Ruhe in Frieden war ein toller Film',
    'Kannst du mir sagen, wann die Ruhe vor dem Sturm endet',
    'Stopp die Zeit, ich brauche noch einen Kaffee heute',
    'Ich brauche Ruhe zum Lernen',
    'Wie wird das Wetter morgen',
    '',
  ]) {
    assert.equal(parseLocalCommand(t), null, t);
  }
});

// ---------------------------------------------------------------- Sprachtext

test('Satzzerlegung für Streaming-TTS', () => {
  let r = splitSentences('Das ist der allererste Satz. Und hier fängt der zweite an');
  assert.deepEqual(r.sentences, ['Das ist der allererste Satz.']);
  assert.equal(r.rest, 'Und hier fängt der zweite an');

  r = splitSentences('Das ist der allererste Satz. Und hier ist der zweite Satz!', { flush: true });
  assert.deepEqual(r.sentences, ['Das ist der allererste Satz.', 'Und hier ist der zweite Satz!']);
  assert.equal(r.rest, '');

  // Kürzere Mindestlänge (für den ersten Satz → schneller Sprechbeginn)
  r = splitSentences('Das ist der erste Satz. Und weiter', { minLength: 12 });
  assert.deepEqual(r.sentences, ['Das ist der erste Satz.']);
  r = splitSentences('Das ist der erste Satz. Und weiter');
  assert.deepEqual(r.sentences, []); // unter der Standard-Mindestlänge: wird abgewartet

  // Abkürzungen und Dezimalzahlen sind keine Satzenden
  r = splitSentences('Das kostet z. B. 3.5 Euro und dauert ca. fünf Minuten. Danach ist Schluss damit.', { flush: true });
  assert.equal(r.sentences.length, 2);
  assert.match(r.sentences[0], /^Das kostet z\. B\. 3\.5 Euro/);

  // Kurze Sätze werden zusammengefasst
  r = splitSentences('Oha. Na gut. Das ist jetzt ein deutlich längerer Satz zum Schluss.', { flush: true });
  assert.equal(r.sentences.length, 1);

  // Ohne Satzende kein Abschluss, bis geflusht wird
  assert.deepEqual(splitSentences('Noch kein Ende in Sicht').sentences, []);
  assert.deepEqual(splitSentences('Noch kein Ende in Sicht', { flush: true }).sentences, ['Noch kein Ende in Sicht']);

  // Mehrfach-Satzzeichen
  r = splitSentences('Wirklich?! Das hätte ich nie gedacht, dass das klappt. Rest', {});
  assert.ok(r.sentences[0].startsWith('Wirklich?!'));
});

test('Satzzerlegung: Inkrementell identisch mit einmaliger Zerlegung', () => {
  const full = 'Sarvus! Heute wird es sonnig bei dir, mit zwanzig Grad. Am Abend kühlt es auf zehn Grad ab. Nimm also eine Jacke mit!';
  const streamed = [];
  let buf = '';
  for (const ch of full) {
    buf += ch;
    const { sentences, rest } = splitSentences(buf);
    streamed.push(...sentences);
    buf = rest;
  }
  streamed.push(...splitSentences(buf, { flush: true }).sentences);
  assert.equal(streamed.join(' '), splitSentences(full, { flush: true }).sentences.join(' '));
  assert.equal(streamed.join(' ').replace(/\s+/g, ' '), full);
});

test('Sprach-Bereinigung entfernt Markdown, Links und Emojis', () => {
  assert.equal(cleanForSpeech('**Wichtig:** Das ist `Code` und [ein Link](https://x.de)!'), 'Wichtig: Das ist Code und ein Link!');
  assert.equal(cleanForSpeech('Hallo 😀 Welt 🎉'), 'Hallo Welt');
  assert.equal(cleanForSpeech('Siehe https://example.com/foo bar'), 'Siehe bar');
  assert.equal(cleanForSpeech('- Eins\n- Zwei'), 'Eins. Zwei');
  assert.equal(cleanForSpeech('# Titel\nText'), 'Titel. Text');
  assert.equal(cleanForSpeech('Zeile eins\n\nZeile zwei'), 'Zeile eins. Zeile zwei');
  assert.equal(cleanForSpeech('Wirklich?\nJa!'), 'Wirklich? Ja!');
});

test('Echo-Erkennung', () => {
  const spoken = 'Sarvus! Ich hoffe, du hast einen guten Plan. Ich bin nämlich wieder übermotiviert.';
  assert.ok(echoScore('ich hoffe du hast einen guten plan', spoken) > 0.9);
  assert.ok(echoScore('wie spät ist es', spoken) < 0.3);
  assert.equal(echoScore('', spoken), 0);
});

// ---------------------------------------------------------------- Datum

test('Datum: lokale ISO-Formate', () => {
  const d = new Date(2026, 10, 17, 8, 5);
  assert.equal(toLocalIso(d), '2026-11-17T08:05');
  assert.equal(parseLocal('2026-11-17T08:05').getHours(), 8);
  assert.equal(parseLocal('2026-02-31T10:00'), null);
  assert.equal(parseLocal('morgen'), null);
  assert.equal(parseLocal('2026-11-17').getDate(), 17);
  assert.match(describeNow(d), /17\. November 2026/);
});

test('Datum: Beschreibung, Countdown, Dauer', () => {
  const now = new Date(2026, 10, 17, 20, 0);
  assert.equal(describeWhen(new Date(2026, 10, 17, 21, 30), now), 'heute um 21:30 Uhr');
  assert.equal(describeWhen(new Date(2026, 10, 18, 7, 0), now), 'morgen um 07:00 Uhr');
  assert.equal(describeWhen(new Date(2026, 10, 19, 7, 0), now), 'übermorgen um 07:00 Uhr');
  assert.equal(formatCountdown(65), '1:05');
  assert.equal(formatCountdown(3725), '1:02:05');
  assert.equal(formatCountdown(-3), '0:00');
  assert.equal(spokenDuration(300), '5 Minuten');
  assert.equal(spokenDuration(90), '1 Minute 30 Sekunden');
  assert.equal(spokenDuration(3600), '1 Stunde');
  assert.equal(spokenDuration(0), '0 Sekunden');
});

test('Ruhezeiten (auch über Mitternacht)', () => {
  const at = (h, m = 0) => new Date(2026, 10, 17, h, m);
  assert.equal(inQuietHours(at(23), '22:00', '07:00'), true);
  assert.equal(inQuietHours(at(3), '22:00', '07:00'), true);
  assert.equal(inQuietHours(at(7), '22:00', '07:00'), false);
  assert.equal(inQuietHours(at(12), '22:00', '07:00'), false);
  assert.equal(inQuietHours(at(13), '12:00', '14:00'), true);
  assert.equal(inQuietHours(at(12), '', ''), false);
});

// ---------------------------------------------------------------- Kalender

test('ICS: gültiger Termin mit Alarm, Escaping und CRLF', () => {
  const ics = buildIcs({
    title: 'Zahnarzt; wichtig, bitte!',
    start: '2026-11-18T14:30',
    end: '2026-11-18T15:15',
    location: 'Hauptstraße 1, Wien',
    notes: 'Zeile 1\nZeile 2',
    now: new Date(Date.UTC(2026, 10, 17, 19, 0, 0)),
    uid: 'test@aendy',
  });
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n'));
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
  assert.match(ics, /DTSTART:20261118T143000\r\n/);
  assert.match(ics, /DTEND:20261118T151500\r\n/);
  assert.match(ics, /DTSTAMP:20261117T190000Z\r\n/);
  assert.match(ics, /SUMMARY:Zahnarzt\\; wichtig\\, bitte!\r\n/);
  assert.match(ics, /LOCATION:Hauptstraße 1\\, Wien\r\n/);
  assert.match(ics, /DESCRIPTION:Zeile 1\\nZeile 2\r\n/);
  assert.match(ics, /TRIGGER:-PT15M/);
  assert.ok(!/[^\r]\n/.test(ics.replace(/\r\n/g, '')), 'keine einzelnen LF');
});

test('ICS: Standarddauer, Ganztägig, Falten langer Zeilen', () => {
  const a = buildIcs({ title: 'X', start: '2026-11-18T10:00', now: new Date(0) });
  assert.match(a, /DTEND:20261118T110000/);
  const b = buildIcs({ title: 'Urlaub', start: '2026-12-24', allDay: true, now: new Date(0) });
  assert.match(b, /DTSTART;VALUE=DATE:20261224/);
  assert.match(b, /DTEND;VALUE=DATE:20261225/);
  assert.doesNotMatch(b, /VALARM/);
  const long = foldLine('DESCRIPTION:' + 'ä'.repeat(100));
  for (const l of long.split('\r\n')) assert.ok(new TextEncoder().encode(l).length <= 75);
  assert.equal(long.replace(/\r\n /g, ''), 'DESCRIPTION:' + 'ä'.repeat(100));
  assert.throws(() => buildIcs({ title: 'X', start: 'kaputt' }), /Beginn/);
});

test('Google-Kalender-Link', () => {
  const url = googleCalendarUrl({ title: 'Test & Co', start: '2026-11-18T10:00', location: 'Wien' });
  assert.match(url, /^https:\/\/calendar\.google\.com\/calendar\/render\?/);
  const p = new URL(url).searchParams;
  assert.equal(p.get('text'), 'Test & Co');
  assert.equal(p.get('dates'), '20261118T100000/20261118T110000');
  assert.equal(p.get('location'), 'Wien');
});

// ---------------------------------------------------------------- Inhalte

test('Zufallsauswahl wiederholt nie direkt dasselbe', () => {
  const seq = [];
  for (let i = 0; i < 200; i++) seq.push(pick(WAKE_GREETINGS, 'test'));
  for (let i = 1; i < seq.length; i++) assert.notEqual(seq[i], seq[i - 1]);
});

// ---------------------------------------------------------------------------
// Aktivierungsübersicht (ehrliche Aussagen pro Gerät)
// ---------------------------------------------------------------------------

import { evaluateActivation } from '../frontend/js/capabilities.js';

const baseEnv = {
  label: 'Windows-PC', isIOS: false, isAndroid: false, isMobile: false, isStandalone: false, isFirefox: false,
  browserRecognition: true, serverStt: false, hasMic: true, hasNotifications: true, notificationPermission: 'default',
  hasWakeLock: true, canInstall: false, secureContext: true,
};
const byId = (rows, id) => rows.find((r) => r.id === id);

test('Aktivierung: Sperrbildschirm/Standby wird auf KEINEM Gerät versprochen', () => {
  for (const env of [baseEnv, { ...baseEnv, isIOS: true, isMobile: true }, { ...baseEnv, isAndroid: true, isMobile: true }]) {
    assert.equal(byId(evaluateActivation(env), 'locked').status, 'no');
  }
});

test('Aktivierung: Desktop mit Spracherkennung → Weckwort verfügbar', () => {
  const rows = evaluateActivation(baseEnv);
  assert.equal(byId(rows, 'wake').status, 'ok');
  assert.equal(byId(rows, 'tap').status, 'ok');
  assert.ok(byId(rows, 'install'));
});

test('Aktivierung: iPhone in Safari → Weckwort nur eingeschränkt, Siri-Kurzbefehl vorhanden', () => {
  const rows = evaluateActivation({ ...baseEnv, isIOS: true, isMobile: true });
  assert.equal(byId(rows, 'wake').status, 'limited');
  assert.ok(byId(rows, 'siri'));
  assert.match(byId(rows, 'siri').text, /entsperren/i);
});

test('Aktivierung: iPhone-Homescreen-App → kein Browser-Weckwort, Hinweis auf Safari', () => {
  const rows = evaluateActivation({ ...baseEnv, isIOS: true, isMobile: true, isStandalone: true, browserRecognition: false });
  assert.equal(byId(rows, 'wake').status, 'no');
  assert.match(byId(rows, 'wake').text, /Safari/);
});

test('Aktivierung: Android → Verknüpfung und Assistent als Einschränkung, nie als sicher', () => {
  const rows = evaluateActivation({ ...baseEnv, isAndroid: true, isMobile: true });
  assert.equal(byId(rows, 'wake').status, 'limited');
  assert.ok(byId(rows, 'shortcut'));
  assert.equal(byId(rows, 'assistant').status, 'limited');
});

test('Aktivierung: Firefox ohne Server-Erkennung → Tippen aufs Bild startet nichts', () => {
  const rows = evaluateActivation({ ...baseEnv, isFirefox: true, browserRecognition: false });
  assert.equal(byId(rows, 'wake').status, 'no');
  assert.equal(byId(rows, 'tap').status, 'limited');
});

test('Aktivierung: Server-Spracherkennung macht das Bild auch ohne Browser-Erkennung zur Taste', () => {
  const rows = evaluateActivation({ ...baseEnv, browserRecognition: false, serverStt: true });
  assert.equal(byId(rows, 'tap').status, 'ok');
  assert.equal(byId(rows, 'wake').status, 'no');
});

test('Aktivierung: ohne https kein Mikrofon', () => {
  assert.equal(byId(evaluateActivation({ ...baseEnv, secureContext: false }), 'wake').status, 'no');
});

test('Aktivierung: blockierte Benachrichtigungen werden benannt', () => {
  const rows = evaluateActivation({ ...baseEnv, notificationPermission: 'denied' });
  assert.equal(byId(rows, 'notify').status, 'no');
});

import { guessVoiceGender, computeProsody, resolveCloudVoice, CLOUD_VOICE_LABELS } from '../frontend/js/voice-profile.js';

test('Stimme: Geschlecht anhand des Stimmnamens', () => {
  assert.equal(guessVoiceGender({ name: 'Microsoft Conrad Online (Natural) - German (Germany)' }), 'male');
  assert.equal(guessVoiceGender({ name: 'Markus' }), 'male');
  assert.equal(guessVoiceGender({ name: 'Microsoft Katja Online (Natural)' }), 'female');
  assert.equal(guessVoiceGender({ name: 'Anna' }), 'female');
  assert.equal(guessVoiceGender({ name: 'Google Deutsch' }), 'female');
  assert.equal(guessVoiceGender({ name: 'Irgendwas' }), 'unknown');
});

test('Stimme: männlich ersetzt weibliche Server-Stimmen, jede Stimme hat ein Label', () => {
  assert.equal(resolveCloudVoice('nova', 'male'), 'ash');
  assert.equal(resolveCloudVoice('onyx', 'male'), 'onyx');
  assert.equal(resolveCloudVoice('onyx', 'female'), 'coral');
  assert.equal(resolveCloudVoice('nova', 'any'), 'nova');
  for (const v of ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer', 'verse']) {
    assert.ok(CLOUD_VOICE_LABELS[v], v);
  }
});

test('Prosodie: männlich auf weiblicher Stimme wird tiefer, Clown bleibt dezent und im Rahmen', () => {
  const mid = () => 0.5; // kein Zufall
  const base = { rate: 1, lively: true, gender: 'male', character: 'natural', clownLevel: 35 };
  const male = computeProsody('Hallo.', { ...base, voiceGender: 'male' }, mid);
  const onFemale = computeProsody('Hallo.', { ...base, voiceGender: 'female' }, mid);
  assert.equal(male.pitch, 1);
  assert.ok(onFemale.pitch < 0.85 && onFemale.pitch >= 0.5);

  const clown = computeProsody('Das war ein Witz!', { ...base, character: 'clown', voiceGender: 'male' }, mid);
  const plain = computeProsody('Das war ein Witz!', { ...base, voiceGender: 'male' }, mid);
  assert.ok(clown.pitch > plain.pitch, 'Clown ist lebhafter');
  assert.ok(clown.pitch - plain.pitch < 0.25, 'aber nicht zu sehr');

  const off = computeProsody('Das war ein Witz!', { ...base, character: 'clown', clownLevel: 0, voiceGender: 'male' }, mid);
  assert.equal(off.pitch, plain.pitch);

  // Extremwerte bleiben in den Grenzen der Sprachausgabe
  for (const r of [0, 0.5, 1]) {
    const x = computeProsody('Hahaha!', { rate: 1.6, lively: true, gender: 'male', character: 'clown', clownLevel: 100, voiceGender: 'female' }, () => r);
    assert.ok(x.rate >= 0.5 && x.rate <= 2 && x.pitch >= 0.5 && x.pitch <= 2);
  }
});

test('Einstellungen: neue Stimm-Felder haben Standardwerte und werden geprüft', async () => {
  const { normalizeSettings, DEFAULT_SETTINGS } = await import('../frontend/js/store.js');
  assert.equal(DEFAULT_SETTINGS.voiceGender, 'male');
  assert.equal(DEFAULT_SETTINGS.voiceCharacter, 'clown');
  assert.equal(DEFAULT_SETTINGS.clownLevel, 35);
  const bad = normalizeSettings({ voiceGender: 'x', voiceCharacter: 'y', clownLevel: 999 });
  assert.equal(bad.voiceGender, 'male');
  assert.equal(bad.voiceCharacter, 'clown');
  assert.equal(bad.clownLevel, 100);
  assert.equal(normalizeSettings({ speechRate: 1 }).clownLevel, 35); // alte gespeicherte Einstellungen
});
