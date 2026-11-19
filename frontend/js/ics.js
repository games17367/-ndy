// Kalender-Export: .ics-Datei (öffnet sich in Apple Kalender, Google Kalender, Outlook ...)
// und Link für Google Kalender. Zeiten werden als „schwebende“ lokale Zeit geschrieben,
// d. h. so, wie der Nutzer sie genannt hat – ohne Zeitzonen-Verschiebung.

import { parseLocal } from './datetime.js';

const pad = (n) => String(n).padStart(2, '0');

function icsEscape(text) {
  return String(text || '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/** Zeilen auf maximal 75 Byte falten (RFC 5545), ohne UTF-8-Zeichen zu zerreißen. */
export function foldLine(line) {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out = [];
  let cur = '';
  let curBytes = 0;
  let limit = 75;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    if (curBytes + b > limit) {
      out.push(cur);
      cur = ' ';
      curBytes = 1;
      limit = 75;
    }
    cur += ch;
    curBytes += b;
  }
  out.push(cur);
  return out.join('\r\n');
}

const fmtLocal = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
const fmtDate = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
const fmtUtc = (d) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;

function resolveTimes({ start, end, allDay }) {
  const s = parseLocal(start);
  if (!s) throw new Error('Ungültiger Beginn.');
  let e = end ? parseLocal(end) : null;
  if (allDay) {
    const endDay = e || s;
    const exclusive = new Date(endDay.getFullYear(), endDay.getMonth(), endDay.getDate() + 1);
    return { s, e: exclusive };
  }
  if (!e || e <= s) e = new Date(s.getTime() + 60 * 60 * 1000);
  return { s, e };
}

/**
 * @param {{title:string,start:string,end?:string,location?:string,notes?:string,allDay?:boolean,alarmMinutes?:number,uid?:string,now?:Date}} ev
 */
export function buildIcs(ev) {
  const { s, e } = resolveTimes(ev);
  const now = ev.now || new Date();
  const uid = ev.uid || `${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 10)}@aendy`;
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Aendy//Sprachassistent//DE',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${fmtUtc(now)}`,
    ev.allDay ? `DTSTART;VALUE=DATE:${fmtDate(s)}` : `DTSTART:${fmtLocal(s)}`,
    ev.allDay ? `DTEND;VALUE=DATE:${fmtDate(e)}` : `DTEND:${fmtLocal(e)}`,
    `SUMMARY:${icsEscape(ev.title)}`,
  ];
  if (ev.location) lines.push(`LOCATION:${icsEscape(ev.location)}`);
  if (ev.notes) lines.push(`DESCRIPTION:${icsEscape(ev.notes)}`);
  const alarm = Number.isFinite(ev.alarmMinutes) ? ev.alarmMinutes : 15;
  if (alarm >= 0 && !ev.allDay) {
    lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsEscape(ev.title)}`, `TRIGGER:-PT${Math.round(alarm)}M`, 'END:VALARM');
  }
  lines.push('END:VEVENT', 'END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}

export function googleCalendarUrl(ev) {
  const { s, e } = resolveTimes(ev);
  const dates = ev.allDay ? `${fmtDate(s)}/${fmtDate(e)}` : `${fmtLocal(s)}/${fmtLocal(e)}`;
  const params = new URLSearchParams({ action: 'TEMPLATE', text: ev.title, dates });
  if (ev.notes) params.set('details', ev.notes);
  if (ev.location) params.set('location', ev.location);
  return `https://calendar.google.com/calendar/render?${params}`;
}
