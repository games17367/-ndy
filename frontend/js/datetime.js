// Datum und Zeit: lokale ISO-Formate, deutsche Formulierungen für Ausgabe und KI-Kontext.

const pad = (n) => String(n).padStart(2, '0');

/** Date → „YYYY-MM-DDTHH:MM“ in lokaler Zeit */
export function toLocalIso(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** „YYYY-MM-DDTHH:MM“ oder „YYYY-MM-DD“ (lokal) → Date; null bei Fehler */
export function parseLocal(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(String(value || ''));
  if (!m) return null;
  const [, y, mo, d, h = '0', mi = '0', s = '0'] = m;
  const date = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
  if (Number.isNaN(date.getTime())) return null;
  // Ungültige Daten wie 31.02. abfangen
  if (date.getMonth() !== Number(mo) - 1) return null;
  return date;
}

/** Für den KI-Kontext: „Dienstag, 17. November 2026, 20:07 Uhr“ */
export function describeNow(now = new Date(), locale = 'de-AT') {
  try {
    const date = new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(now);
    return `${date}, ${pad(now.getHours())}:${pad(now.getMinutes())} Uhr (ISO lokal: ${toLocalIso(now)})`;
  } catch {
    return toLocalIso(now);
  }
}

/** „in 5 Minuten“, „morgen um 08:00“ – knapp und gut lesbar */
export function describeWhen(date, now = new Date(), locale = 'de-AT') {
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  const startOf = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOf(date) - startOf(now)) / 86400000);
  if (days === 0) return `heute um ${time} Uhr`;
  if (days === 1) return `morgen um ${time} Uhr`;
  if (days === 2) return `übermorgen um ${time} Uhr`;
  try {
    const day = new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short' }).format(date);
    return `${day}, ${time} Uhr`;
  } catch {
    return `${toLocalIso(date)}`;
  }
}

/** 90 → „1 Min 30 Sek“; Countdown-Anzeige: 3725 → „1:02:05“ */
export function formatCountdown(totalSeconds) {
  const s = Math.max(0, Math.ceil(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

/** 300 → „5 Minuten“, 90 → „1 Minute 30 Sekunden“ (zum Vorlesen) */
export function spokenDuration(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const parts = [];
  if (h) parts.push(`${h} ${h === 1 ? 'Stunde' : 'Stunden'}`);
  if (m) parts.push(`${m} ${m === 1 ? 'Minute' : 'Minuten'}`);
  if (sec || !parts.length) parts.push(`${sec} ${sec === 1 ? 'Sekunde' : 'Sekunden'}`);
  return parts.join(' ');
}

/** Ist die Uhrzeit (HH:MM) im Ruhezeitraum? Unterstützt Zeiträume über Mitternacht. */
export function inQuietHours(now, from, to) {
  const toMin = (s) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || ''));
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  };
  const a = toMin(from);
  const b = toMin(to);
  if (a === null || b === null || a === b) return false;
  const cur = now.getHours() * 60 + now.getMinutes();
  return a < b ? cur >= a && cur < b : cur >= a || cur < b;
}
