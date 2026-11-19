// Liest die gesamte Konfiguration aus Umgebungsvariablen.
// Es gibt bewusst KEINE Standardwerte für Geheimnisse.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

function num(value, fallback) {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function bool(value, fallback) {
  if (value === undefined || value === '') return fallback;
  return /^(1|true|yes|ja|on)$/i.test(String(value).trim());
}

function list(value) {
  return String(value || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseSpeech(flag, baseUrl) {
  const f = String(flag ?? '').trim().toLowerCase();
  if (['true', '1', 'yes', 'ja'].includes(f)) return true;
  if (['false', '0', 'no', 'nein'].includes(f)) return false;
  if (!baseUrl) return true; // Standard-Adresse = OpenAI
  try {
    return new URL(baseUrl).hostname === 'api.openai.com';
  } catch {
    return false;
  }
}

export function loadConfig(env = process.env) {
  const anthropicKey = env.ANTHROPIC_API_KEY || '';
  const openaiKey = env.OPENAI_API_KEY || '';
  const geminiKey = env.GEMINI_API_KEY || '';

  let provider = (env.AI_PROVIDER || '').toLowerCase();
  if (!['anthropic', 'openai', 'gemini'].includes(provider)) {
    provider = anthropicKey ? 'anthropic' : openaiKey ? 'openai' : geminiKey ? 'gemini' : 'none';
  }
  // Gemini läuft über Googles OpenAI-kompatible Schnittstelle (ein Schlüssel genügt).
  const gemini = provider === 'gemini';
  if (gemini) provider = 'openai';

  return {
    port: num(env.PORT, 8787),
    host: env.HOST || '0.0.0.0',
    provider,

    anthropic: {
      apiKey: anthropicKey,
      model: env.ANTHROPIC_MODEL || 'claude-sonnet-5-5',
      baseUrl: (env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/+$/, ''),
      maxTokens: num(env.MAX_OUTPUT_TOKENS, 700),
    },

    openai: {
      label: gemini ? 'gemini' : 'openai',
      apiKey: gemini ? geminiKey : openaiKey,
      chatModel: gemini ? env.GEMINI_MODEL || 'gemini-3.8-flash' : env.OPENAI_CHAT_MODEL || 'gpt-4o-mini',
      baseUrl: (gemini ? env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta/openai' : env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, ''),
      maxTokens: num(env.MAX_OUTPUT_TOKENS, 700),
      sttModel: env.OPENAI_STT_MODEL || 'gpt-4o-mini-transcribe',
      ttsModel: env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts',
      ttsVoice: env.OPENAI_TTS_VOICE || 'ash',
      // Server-Stimme und -Spracherkennung gibt es nur bei OpenAI selbst. Andere "OpenAI-kompatible"
      // Dienste (z. B. Gemini) bieten sie meist nicht. SERVER_SPEECH=true/false überschreibt die Automatik.
      speech: gemini ? false : parseSpeech(env.SERVER_SPEECH, env.OPENAI_BASE_URL),
    },

    search: {
      braveKey: env.BRAVE_API_KEY || '',
      braveBaseUrl: (env.BRAVE_BASE_URL || 'https://api.search.brave.com').replace(/\/+$/, ''),
      wikipediaBaseUrl: (env.WIKIPEDIA_BASE_URL || 'https://de.wikipedia.org').replace(/\/+$/, ''),
    },

    weather: {
      geocodingBaseUrl: (env.OPENMETEO_GEOCODING_URL || 'https://geocoding-api.open-meteo.com').replace(/\/+$/, ''),
      forecastBaseUrl: (env.OPENMETEO_FORECAST_URL || 'https://api.open-meteo.com').replace(/\/+$/, ''),
    },

    // Sicherheit
    accessCode: env.ACCESS_CODE || '',
    allowedOrigins: list(env.ALLOWED_ORIGINS),
    trustProxy: bool(env.TRUST_PROXY, false),
    rateLimitPerMinute: num(env.RATE_LIMIT_PER_MINUTE, 40),
    dailyRequestCap: num(env.DAILY_REQUEST_CAP, 3000),
    maxBodyBytes: num(env.MAX_BODY_BYTES, 64 * 1024),
    maxAudioBytes: num(env.MAX_AUDIO_BYTES, 8 * 1024 * 1024),
    requestTimeoutMs: num(env.UPSTREAM_TIMEOUT_MS, 45_000),

    // Frontend direkt vom Backend ausliefern (praktisch für Einzel-Hosting)
    serveFrontend: bool(env.SERVE_FRONTEND, true),
    frontendDir: env.FRONTEND_DIR
      ? path.resolve(env.FRONTEND_DIR)
      : path.resolve(here, '../../frontend'),

    version: '1.2.0',
  };
}
