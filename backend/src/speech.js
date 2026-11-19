// Server-Spracherkennung (STT) und Sprachausgabe (TTS) über eine OpenAI-kompatible API.
// Optional: Ohne OPENAI_API_KEY nutzt die Website die Sprachfunktionen des Browsers.

import { fetchWithTimeout, HttpError } from './http-utils.js';

const ALLOWED_AUDIO = /^audio\/(webm|ogg|mp4|mpeg|mp3|wav|x-wav|x-m4a|m4a|aac|flac)(;.*)?$/i;
const EXTENSIONS = { webm: 'webm', ogg: 'ogg', mp4: 'm4a', mpeg: 'mp3', mp3: 'mp3', wav: 'wav', 'x-wav': 'wav', 'x-m4a': 'm4a', m4a: 'm4a', aac: 'aac', flac: 'flac' };

export const TTS_VOICES = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer', 'verse'];

export function speechAvailable(config) {
  return Boolean(config.openai.apiKey) && config.openai.speech !== false;
}

export async function transcribe(config, audio, contentType, language, signal) {
  if (!speechAvailable(config)) throw new HttpError(501, 'no_stt', 'Server-Spracherkennung ist nicht eingerichtet.');
  if (!ALLOWED_AUDIO.test(contentType || '')) throw new HttpError(415, 'bad_audio', 'Dieses Audioformat wird nicht unterstützt.');
  if (audio.length < 800) return ''; // praktisch leer

  const subtype = (contentType.match(/^audio\/([a-z0-9-]+)/i) || [])[1]?.toLowerCase() || 'webm';
  const ext = EXTENSIONS[subtype] || 'webm';
  const form = new FormData();
  form.append('file', new Blob([audio], { type: contentType.split(';')[0] }), `speech.${ext}`);
  form.append('model', config.openai.sttModel);
  form.append('language', /^[a-z]{2}$/i.test(language || '') ? language.toLowerCase() : 'de');
  form.append('response_format', 'json');
  // Hinweis erhöht die Trefferquote für Name und Weckwort
  form.append('prompt', 'Gespräch mit dem Sprachassistenten Ändy. Sarvus Ändy.');

  let res;
  try {
    res = await fetchWithTimeout(
      `${config.openai.baseUrl}/audio/transcriptions`,
      { method: 'POST', headers: { authorization: `Bearer ${config.openai.apiKey}` }, body: form },
      config.requestTimeoutMs,
      signal
    );
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new HttpError(502, 'stt_network', 'Spracherkennung nicht erreichbar.');
  }
  if (!res.ok) throw new HttpError(502, 'stt_failed', 'Spracherkennung fehlgeschlagen.');
  const data = await res.json();
  return String(data.text || '').trim();
}

export const TTS_STYLES = ['natural', 'clown'];

/**
 * Betonungsanweisung für Modelle wie gpt-4o-mini-tts.
 * `intensity` (0–100) steuert, wie stark der Clown-Einschlag ist: Standard ist „ein bisschen, nicht zu sehr“.
 */
export function ttsInstructions(style, intensity) {
  if (style !== 'clown') {
    return 'Sprich Deutsch mit natürlicher, lebendiger Betonung, wie ein witziger, schlagfertiger Freund. Locker, mit Humor in der Stimme, nicht monoton und nicht übertrieben theatralisch.';
  }
  const n = Number.isFinite(Number(intensity)) ? Math.min(100, Math.max(0, Number(intensity))) : 35;
  const degree =
    n < 34
      ? 'nur ganz dezent, kaum mehr als ein Schmunzeln in der Stimme'
      : n < 67
        ? 'dezent, ein klein wenig wie ein gutmütiger Clown'
        : 'deutlich spürbar wie ein gutmütiger Clown, aber nie schrill und nie kindisch';
  return (
    'Sprich Deutsch mit einer männlichen, warmen Stimme. Der Charakter ist verspielt und schelmisch, ' +
    degree +
    ': leicht überzogene Betonung bei Pointen, mal etwas höher und quirliger, dann wieder trocken und tief, ' +
    'gelegentlich ein kurzes Schmunzeln oder Kichern. Immer klar verständlich, mit natürlichem Sprechtempo.'
  );
}

export async function synthesize(config, { text, voice, speed, style, intensity }, signal) {
  if (!speechAvailable(config)) throw new HttpError(501, 'no_tts', 'Server-Sprachausgabe ist nicht eingerichtet.');
  const input = String(text || '').trim().slice(0, 1200);
  if (!input) throw new HttpError(400, 'empty', 'Kein Text.');
  const chosen = TTS_VOICES.includes(voice) ? voice : config.openai.ttsVoice;
  const rate = Math.min(1.6, Math.max(0.6, Number(speed) || 1));

  const body = {
    model: config.openai.ttsModel,
    input,
    voice: chosen,
    response_format: 'mp3',
    speed: rate,
  };
  // Neuere Modelle verstehen Betonungsanweisungen – für einen lebendigen, witzigen Ton.
  if (/gpt-4o.*tts/i.test(config.openai.ttsModel)) {
    body.instructions = ttsInstructions(TTS_STYLES.includes(style) ? style : 'natural', intensity);
  }

  let res;
  try {
    res = await fetchWithTimeout(
      `${config.openai.baseUrl}/audio/speech`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${config.openai.apiKey}` },
        body: JSON.stringify(body),
      },
      config.requestTimeoutMs,
      signal
    );
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new HttpError(502, 'tts_network', 'Sprachausgabe nicht erreichbar.');
  }
  if (!res.ok) throw new HttpError(502, 'tts_failed', 'Sprachausgabe fehlgeschlagen.');
  return res;
}
