// Sprachausgabe mit zwei Engines:
//  - Browser: speechSynthesis (kostenlos, Qualität hängt vom Gerät ab)
//  - Cloud:   /api/tts des Backends (sehr natürliche Stimme), satzweise vorgeladen
// Sätze werden in eine Warteschlange gestellt, damit Ändy schon spricht, während die KI noch schreibt.

import { platform } from './platform.js';
import { computeProsody, guessVoiceGender, resolveCloudVoice } from './voice-profile.js';
import { createElementLevelMeter, getContext, isAudioUnlocked, setMasterVolume } from './audio.js';

const NATURAL_HINTS = /(neural|natural|online|premium|enhanced|siri|google|anna|markus|vicki|katja|conrad|amala|florian|seraphina)/i;

/** Wählt die beste verfügbare deutsche Stimme. */
export function pickBestVoice(voices, preferredLang = 'de-DE', voiceURI = '', gender = 'any') {
  if (!voices?.length) return null;
  if (voiceURI) {
    const exact = voices.find((v) => v.voiceURI === voiceURI);
    if (exact) return exact;
  }
  const german = voices.filter((v) => /^de(-|_|$)/i.test(v.lang));
  if (!german.length) return null;
  const score = (v) => {
    let s = 0;
    if (v.lang.replace('_', '-').toLowerCase() === preferredLang.toLowerCase()) s += 4;
    if (NATURAL_HINTS.test(v.name)) s += 5;
    if (/premium|enhanced|neural|natural/i.test(v.name)) s += 3;
    if (!v.localService) s += 1;
    if (gender === 'male' || gender === 'female') {
      const g = guessVoiceGender(v);
      if (g === gender) s += 12;
      else if (g !== 'unknown') s -= 12;
    }
    if (/compact|espeak/i.test(v.name + v.voiceURI)) s -= 6;
    return s;
  };
  return [...german].sort((a, b) => score(b) - score(a))[0];
}

export class Speaker {
  /**
   * @param {{store: import('./store.js').Store, api: import('./api.js').ApiClient}} deps
   */
  constructor({ store, api }) {
    this.store = store;
    this.api = api;
    this.cloudAvailable = false;
    this.queue = [];
    this.playing = false;
    this.generation = 0;
    this.current = null;
    this.currentText = '';
    this.spokenText = ''; // alles, was seit dem letzten Start gesprochen wurde (für Echo-Filter)
    this.pulse = 0;
    this.cloudFailed = false;
    this.warnedSilent = false;

    // Rückrufe
    this.onStart = () => {};
    this.onDrain = () => {};
    this.onProblem = () => {};

    this.voices = [];
    this.audio = null;
    this.meter = () => 0;
    this.#loadVoices();
  }

  // ----- Stimmen (Browser) -----

  #loadVoices() {
    if (!platform.hasSpeechSynthesis) return;
    const load = () => {
      this.voices = speechSynthesis.getVoices() || [];
    };
    load();
    speechSynthesis.addEventListener?.('voiceschanged', load);
  }

  germanVoices() {
    return this.voices.filter((v) => /^de(-|_|$)/i.test(v.lang));
  }

  // ----- Engine-Wahl -----

  get engine() {
    const pref = this.store.settings.voiceEngine;
    if (pref === 'cloud') return this.cloudAvailable && !this.cloudFailed ? 'cloud' : this.#browserOrNone();
    if (pref === 'browser') return this.#browserOrNone();
    // auto: Cloud, wenn verfügbar (natürlichere Stimme), sonst Browser
    return this.cloudAvailable && !this.cloudFailed ? 'cloud' : this.#browserOrNone();
  }

  #browserOrNone() {
    return platform.hasSpeechSynthesis ? 'browser' : 'none';
  }

  get available() {
    return this.engine !== 'none';
  }

  get speaking() {
    return this.playing || this.queue.length > 0;
  }

  /** Aktueller Ausgabepegel 0–1 (für die Animation) */
  get level() {
    if (this.engine === 'cloud' && this.playing) return Math.max(this.meter(), this.pulse);
    return this.playing ? this.pulse : 0;
  }

  /** Muss in einer Nutzergeste aufgerufen werden, damit iOS/Android Ton erlauben. */
  unlock() {
    if (platform.hasSpeechSynthesis) {
      try {
        const u = new SpeechSynthesisUtterance(' ');
        u.volume = 0;
        speechSynthesis.speak(u);
      } catch {
        /* ignorieren */
      }
    }
    if (!this.audio) {
      this.audio = new Audio();
      this.audio.preload = 'auto';
      this.audio.playsInline = true;
      this.audio.setAttribute('playsinline', '');
    }
    // Stilles Mini-WAV spielen, um das Element für spätere Wiedergabe freizuschalten
    try {
      this.audio.src =
        'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA=';
      const p = this.audio.play();
      p?.catch?.(() => {});
    } catch {
      /* ignorieren */
    }
  }

  // ----- Öffentliche API -----

  /** Fügt einen Satz zur Warteschlange hinzu. */
  enqueue(text) {
    const t = String(text || '').trim();
    if (!t || !this.available) return;
    const item = { text: t, blobPromise: null };
    if (this.engine === 'cloud') item.blobPromise = this.#prefetch(t, this.generation);
    this.queue.push(item);
    this.spokenText += ` ${t}`;
    if (!this.playing) this.#next();
  }

  /** Bricht alles sofort ab. */
  cancel() {
    this.generation++;
    this.queue = [];
    this.spokenText = '';
    this.currentText = '';
    this.pulse = 0;
    try {
      if (platform.hasSpeechSynthesis) speechSynthesis.cancel();
    } catch {
      /* ignorieren */
    }
    if (this.audio) {
      try {
        this.audio.pause();
        this.audio.onended = null;
        this.audio.onerror = null;
      } catch {
        /* ignorieren */
      }
    }
    this.current = null;
    const was = this.playing;
    this.playing = false;
    return was;
  }

  // ----- Wiedergabe -----

  async #next() {
    if (this.playing) return;
    const item = this.queue.shift();
    if (!item) {
      this.currentText = '';
      this.onDrain();
      return;
    }
    this.playing = true;
    this.currentText = item.text;
    const gen = this.generation;
    try {
      if (item.blobPromise) {
        const ok = await this.#playCloud(item, gen);
        if (!ok && gen === this.generation) await this.#playBrowser(item.text, gen);
      } else {
        await this.#playBrowser(item.text, gen);
      }
    } catch {
      /* einzelne Sätze dürfen nie das Gespräch blockieren */
    }
    if (gen !== this.generation) return; // abgebrochen → neuer Ablauf übernimmt
    this.playing = false;
    this.pulse = 0;
    this.#next();
  }

  #prefetch(text, gen) {
    const s = this.store.settings;
    return this.api
      .synthesize({
        text,
        voice: resolveCloudVoice(s.cloudVoice, s.voiceGender),
        speed: s.speechRate,
        style: s.voiceCharacter,
        intensity: s.clownLevel,
      })
      .then((blob) => (gen === this.generation ? blob : null))
      .catch((err) => {
        if (err?.name === 'AbortError') return null;
        this.cloudFailed = true;
        this.onProblem('Die natürliche Server-Stimme ist gerade nicht erreichbar. Ich nutze die Stimme deines Geräts.');
        return null;
      });
  }

  async #playCloud(item, gen) {
    const blob = await item.blobPromise;
    if (gen !== this.generation) return true; // abgebrochen
    if (!blob) return false;
    if (!this.audio) this.unlock();
    const audio = this.audio;
    if (!this.metered) {
      this.meter = createElementLevelMeter(audio);
      this.metered = true;
    }
    const ctx = getContext();
    if (ctx?.state === 'suspended') await ctx.resume().catch(() => {});
    const url = URL.createObjectURL(blob);
    return new Promise((resolve) => {
      let settled = false;
      const done = (ok) => {
        if (settled) return;
        settled = true;
        audio.onended = null;
        audio.onerror = null;
        URL.revokeObjectURL(url);
        resolve(ok);
      };
      audio.onended = () => done(true);
      audio.onerror = () => done(false);
      // iOS ignoriert audio.volume – die Lautstärke läuft daher über den Audio-Graphen.
      audio.volume = 1;
      setMasterVolume(this.store.settings.volume);
      audio.src = url;
      audio
        .play()
        .then(() => {
          if (gen === this.generation) {
            this.onStart();
            this.#startPulseDecay();
          }
        })
        .catch(() => {
          this.onProblem('Der Browser blockiert den Ton. Tippe einmal auf den Bildschirm und versuch es noch mal.');
          done(false);
        });
    });
  }

  #playBrowser(text, gen) {
    return new Promise((resolve) => {
      if (!platform.hasSpeechSynthesis) return resolve();
      const s = this.store.settings;
      const u = new SpeechSynthesisUtterance(text);
      const voice = pickBestVoice(this.voices.length ? this.voices : speechSynthesis.getVoices(), s.lang, s.voiceURI, s.voiceGender);
      if (voice) {
        u.voice = voice;
        u.lang = voice.lang;
      } else {
        u.lang = s.lang;
      }
      const prosody = computeProsody(text, {
        rate: s.speechRate,
        lively: s.lively,
        gender: s.voiceGender,
        character: s.voiceCharacter,
        clownLevel: s.clownLevel,
        voiceGender: voice ? guessVoiceGender(voice) : 'unknown',
      });
      u.rate = prosody.rate;
      u.pitch = prosody.pitch;
      u.volume = s.volume;
      let started = false;
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        clearTimeout(watchdog);
        clearInterval(keepAlive);
        this.current = null;
        resolve();
      };
      u.onstart = () => {
        started = true;
        if (gen === this.generation) {
          this.onStart();
          this.#startPulseDecay();
        }
      };
      u.onboundary = () => {
        this.pulse = Math.min(1, 0.55 + Math.random() * 0.45);
      };
      u.onend = finish;
      u.onerror = (e) => {
        if (e.error && e.error !== 'canceled' && e.error !== 'interrupted' && !this.warnedSilent) {
          this.warnedSilent = true;
          this.onProblem('Die Sprachausgabe deines Geräts meldet einen Fehler. Prüfe Lautstärke und Stumm-Schalter.');
        }
        finish();
      };
      // Falls der Browser nie „start“ meldet (iOS im Stumm-Modus, gesperrtes Audio), nicht hängen bleiben.
      const watchdog = setTimeout(() => {
        if (!started) {
          if (!this.warnedSilent) {
            this.warnedSilent = true;
            this.onProblem(
              isAudioUnlocked()
                ? 'Ich bekomme keinen Ton heraus. Prüfe Lautstärke und den Stumm-Schalter deines Geräts.'
                : 'Der Browser blockiert den Ton. Tippe einmal auf den Bildschirm.'
            );
          }
          try {
            speechSynthesis.cancel();
          } catch {
            /* ignorieren */
          }
          finish();
        }
      }, 5000);
      // Chrome beendet lange Äußerungen nach ~15 s still: regelmäßig anschubsen
      const keepAlive = setInterval(() => {
        try {
          if (speechSynthesis.speaking && !speechSynthesis.paused) {
            speechSynthesis.pause();
            speechSynthesis.resume();
          }
        } catch {
          /* ignorieren */
        }
      }, 10000);
      this.current = u; // Referenz halten, sonst räumt Chrome die Äußerung vorzeitig weg
      try {
        speechSynthesis.speak(u);
      } catch {
        finish();
      }
    });
  }

  #startPulseDecay() {
    if (this.decayTimer) return;
    this.decayTimer = setInterval(() => {
      this.pulse *= 0.82;
      if (!this.playing && this.pulse < 0.02) {
        clearInterval(this.decayTimer);
        this.decayTimer = null;
        this.pulse = 0;
      }
    }, 50);
  }

  /** Spricht einen Probetext (für Einstellungen). */
  test(text = 'Sarvus! So klinge ich. Gar nicht übel, oder?') {
    this.cancel();
    this.unlock();
    this.cloudFailed = false;
    this.enqueue(text);
  }
}
