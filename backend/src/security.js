// Zugangscode, CORS, Ratenbegrenzung und Tageslimit.

import crypto from 'node:crypto';
import { HttpError } from './http-utils.js';

function digest(value) {
  return crypto.createHash('sha256').update(String(value)).digest();
}

export function checkAccessCode(config, req) {
  if (!config.accessCode) return;
  const given = req.headers['x-aendy-code'] || '';
  if (!crypto.timingSafeEqual(digest(given), digest(config.accessCode))) {
    throw new HttpError(401, 'bad_code', 'Zugangscode fehlt oder ist falsch.');
  }
}

/** Liefert CORS-Header für die Anfrage (leer = kein CORS, nur gleiche Herkunft). */
export function corsHeaders(config, req) {
  const origin = req.headers.origin;
  if (!origin) return {};
  const allowed = config.allowedOrigins;
  const ok = allowed.includes('*') || allowed.includes(origin);
  if (!ok) return {};
  return {
    'access-control-allow-origin': allowed.includes('*') ? '*' : origin,
    'access-control-allow-headers': 'content-type, x-aendy-code',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-max-age': '600',
    vary: 'Origin',
  };
}

export function isOriginForbidden(config, req) {
  const origin = req.headers.origin;
  if (!origin) return false;
  // Gleiche Herkunft (Frontend vom selben Server) ist immer erlaubt.
  try {
    const host = req.headers.host;
    if (host && new URL(origin).host === host) return false;
  } catch {
    return true;
  }
  return !(config.allowedOrigins.includes('*') || config.allowedOrigins.includes(origin));
}

export class RateLimiter {
  constructor({ perMinute, dailyCap, now = () => Date.now() }) {
    this.perMinute = perMinute;
    this.dailyCap = dailyCap;
    this.now = now;
    this.hits = new Map(); // ip -> Zeitstempel[]
    this.dayKey = this.#day();
    this.dayCount = 0;
  }

  #day() {
    return new Date(this.now()).toISOString().slice(0, 10);
  }

  check(ip) {
    const t = this.now();
    const today = this.#day();
    if (today !== this.dayKey) {
      this.dayKey = today;
      this.dayCount = 0;
    }
    if (this.dailyCap > 0 && this.dayCount >= this.dailyCap) {
      throw new HttpError(429, 'daily_cap', 'Das Tageslimit des Servers ist erreicht. Morgen geht es weiter.');
    }
    const list = (this.hits.get(ip) || []).filter((ts) => t - ts < 60_000);
    if (this.perMinute > 0 && list.length >= this.perMinute) {
      this.hits.set(ip, list);
      throw new HttpError(429, 'rate_limited', 'Zu viele Anfragen. Kurz durchatmen und noch mal versuchen.');
    }
    list.push(t);
    this.hits.set(ip, list);
    this.dayCount += 1;
    if (this.hits.size > 5000) this.#sweep(t);
  }

  #sweep(t) {
    for (const [ip, list] of this.hits) {
      if (!list.some((ts) => t - ts < 60_000)) this.hits.delete(ip);
    }
  }
}
