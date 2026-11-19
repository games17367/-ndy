// Verbindung zum Backend: Gespräch (Streaming), Gesundheitscheck, Server-STT/TTS.

export class ApiError extends Error {
  constructor(code, message, status = 0) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export const NO_BACKEND =
  'Hier antwortet nur die Website, aber kein Ändy-Server. Ohne Server kann ich nicht denken. Trage die Adresse deines Servers in den Einstellungen unter „Verbindung“ ein.';

function friendlyHttp(status, fallback) {
  if (status === 401) return ['bad_code', 'Der Zugangscode fehlt oder ist falsch. Du kannst ihn in den Einstellungen unter „Verbindung“ eintragen.'];
  if (status === 403) return ['origin', 'Der Server erlaubt diese Website nicht (ALLOWED_ORIGINS im Backend prüfen).'];
  if (status === 429) return ['rate_limited', fallback || 'Zu viele Anfragen. Kurz durchatmen und noch mal versuchen.'];
  if (status === 503) return ['no_provider', fallback || 'Auf dem Server ist noch keine KI eingerichtet.'];
  if (status === 404 || status === 405) return ['no_backend', NO_BACKEND];
  if (status >= 500) return ['server', 'Der Server hat gerade einen Schluckauf.'];
  return ['http', fallback || `Unerwartete Antwort (${status}).`];
}

export class ApiClient {
  constructor(store) {
    this.store = store;
  }

  get base() {
    const configured = this.store.settings.apiBase || globalThis.AENDY_CONFIG?.apiBase || '';
    return String(configured).replace(/\/+$/, '');
  }

  get hasBackend() {
    return true;
  }

  #headers(json = true) {
    const h = {};
    if (json) h['content-type'] = 'application/json';
    const code = this.store.settings.accessCode;
    if (code) h['x-aendy-code'] = code;
    return h;
  }

  async #fetch(path, options = {}) {
    try {
      return await fetch(`${this.base}${path}`, options);
    } catch (err) {
      if (err?.name === 'AbortError') throw err;
      const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
      throw new ApiError(
        offline ? 'offline' : 'network',
        offline ? 'Du bist offline.' : 'Ich erreiche meinen Server nicht. Läuft das Backend und stimmt die Server-Adresse in den Einstellungen?'
      );
    }
  }

  async #errorFrom(res) {
    let message = '';
    let code = '';
    try {
      const j = await res.json();
      message = j?.error?.message || '';
      code = j?.error?.code || '';
    } catch {
      /* ignorieren */
    }
    const [c, m] = friendlyHttp(res.status, message);
    const useOwn = res.status === 401 || res.status === 403 || c === 'no_backend';
    return new ApiError(c === 'no_backend' ? c : code || c, useOwn ? m : message || m, res.status);
  }

  async health(signal) {
    const res = await this.#fetch('/api/health', { headers: this.#headers(false), signal });
    if (!res.ok) throw await this.#errorFrom(res);
    try {
      const h = await res.json();
      if (h && h.name === 'aendy') return h;
    } catch {
      /* keine JSON-Antwort */
    }
    // 200, aber keine Ändy-Antwort: z. B. eine Webseite statt des Servers
    throw new ApiError('no_backend', NO_BACKEND, 404);
  }

  /**
   * Gespräch mit Streaming. handlers: onText(delta), onStatus(s), onAction(a), onCard(c), onDone(d)
   * Wirft ApiError bei Fehlern (auch bei SSE-„error“-Ereignissen).
   */
  async chat({ messages, settings, context, memory, signal, handlers = {} }) {
    const res = await this.#fetch('/api/chat', {
      method: 'POST',
      headers: this.#headers(true),
      body: JSON.stringify({ messages, settings, context, memory }),
      signal,
    });
    if (!res.ok) throw await this.#errorFrom(res);
    if (!res.body) throw new ApiError('no_stream', 'Dieser Browser kann keine Streams lesen.');

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let finished = false;

    const dispatch = (event, raw) => {
      let data;
      try {
        data = JSON.parse(raw);
      } catch {
        return;
      }
      switch (event) {
        case 'text':
          handlers.onText?.(data.delta);
          break;
        case 'status':
          handlers.onStatus?.(data);
          break;
        case 'action':
          handlers.onAction?.(data);
          break;
        case 'card':
          handlers.onCard?.(data);
          break;
        case 'done':
          finished = true;
          handlers.onDone?.(data);
          break;
        case 'error':
          throw new ApiError(data.code || 'chat', data.message || 'Unbekannter Fehler.');
        default:
          break;
      }
    };

    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buffer.search(/\r?\n\r?\n/)) !== -1) {
          const block = buffer.slice(0, idx);
          buffer = buffer.slice(idx).replace(/^\r?\n\r?\n/, '');
          let event = 'message';
          let data = '';
          for (const line of block.split(/\r?\n/)) {
            if (!line || line.startsWith(':')) continue;
            const c = line.indexOf(':');
            const field = c === -1 ? line : line.slice(0, c);
            const value2 = c === -1 ? '' : line.slice(c + 1).replace(/^ /, '');
            if (field === 'event') event = value2;
            else if (field === 'data') data += (data ? '\n' : '') + value2;
          }
          if (data) dispatch(event, data);
        }
      }
    } finally {
      try {
        reader.releaseLock();
      } catch {
        /* ignorieren */
      }
    }
    if (!finished && !signal?.aborted) throw new ApiError('cut_off', 'Die Antwort wurde unterbrochen.');
  }

  async transcribe(blob, lang = 'de', signal) {
    const res = await this.#fetch(`/api/stt?lang=${encodeURIComponent(lang.slice(0, 2))}`, {
      method: 'POST',
      headers: { ...this.#headers(false), 'content-type': blob.type || 'audio/webm' },
      body: blob,
      signal,
    });
    if (!res.ok) throw await this.#errorFrom(res);
    const j = await res.json();
    return String(j.text || '').trim();
  }

  /** Liefert ein Audio-Blob (mp3) der Sprachausgabe. */
  async synthesize({ text, voice, speed, style, intensity }, signal) {
    const res = await this.#fetch('/api/tts', {
      method: 'POST',
      headers: this.#headers(true),
      body: JSON.stringify({ text, voice, speed, style, intensity }),
      signal,
    });
    if (!res.ok) throw await this.#errorFrom(res);
    return res.blob();
  }
}
