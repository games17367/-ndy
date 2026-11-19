// Gemeinsamer Audio-Kontext: Entsperren (iOS/Android verlangen eine Nutzergeste),
// Aktivierungs- und Signaltöne sowie Alarm. Alle Töne werden live synthetisiert – keine Audiodateien.

let ctx = null;
let master = null;
let unlocked = false;
let alarmTimer = null;
let alarmGain = null;

export function getContext() {
  if (ctx) return ctx;
  const Ctor = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!Ctor) return null;
  try {
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(ctx.destination);
  } catch {
    ctx = null;
  }
  return ctx;
}

export function setMasterVolume(v) {
  if (master) master.gain.value = Math.min(1, Math.max(0, v)) * 0.9;
}

/** Muss in einer Nutzergeste (Tippen/Klick) aufgerufen werden. */
export async function unlockAudio() {
  const c = getContext();
  if (!c) return false;
  try {
    if (c.state === 'suspended') await c.resume();
    // Stiller Puffer „weckt“ iOS-Safari zuverlässig auf
    const buf = c.createBuffer(1, 1, 22050);
    const src = c.createBufferSource();
    src.buffer = buf;
    src.connect(c.destination);
    src.start(0);
    unlocked = c.state === 'running';
  } catch {
    unlocked = false;
  }
  return unlocked;
}

export const isAudioUnlocked = () => unlocked && ctx?.state === 'running';

function tone({ freq, start = 0, duration = 0.18, type = 'sine', gain = 0.25, slideTo = null }) {
  const c = getContext();
  if (!c || c.state !== 'running') return;
  const t0 = c.currentTime + start;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + duration);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.connect(g);
  g.connect(master);
  osc.start(t0);
  osc.stop(t0 + duration + 0.05);
}

/** Weck-Bestätigung: kurzes, aufsteigendes „Blip“ */
export function playWake() {
  tone({ freq: 520, slideTo: 880, duration: 0.14, gain: 0.18 });
  tone({ freq: 1040, start: 0.1, duration: 0.18, gain: 0.12, type: 'triangle' });
}

/** Gespräch beendet: absteigend */
export function playSleep() {
  tone({ freq: 760, slideTo: 420, duration: 0.2, gain: 0.14 });
}

/** Mikro „bereit“ nach Antwort – sehr dezent */
export function playReady() {
  tone({ freq: 660, duration: 0.07, gain: 0.07, type: 'triangle' });
}

export function playError() {
  tone({ freq: 300, slideTo: 200, duration: 0.25, gain: 0.14, type: 'sawtooth' });
}

/** Timer fertig / Erinnerung: freundliches Dreiklang-Glöckchen */
export function playChime() {
  [660, 830, 990].forEach((f, i) => tone({ freq: f, start: i * 0.14, duration: 0.5, gain: 0.2, type: 'triangle' }));
}

/** Wecker: wiederholte Pieptöne, bis stopAlarm() */
export function startAlarm() {
  stopAlarm();
  const c = getContext();
  if (!c) return;
  const beep = () => {
    if (c.state !== 'running') return;
    for (let i = 0; i < 3; i++) tone({ freq: 880, start: i * 0.22, duration: 0.14, gain: 0.3, type: 'square' });
    try {
      navigator.vibrate?.([200, 100, 200, 100, 200]);
    } catch {
      /* ignorieren */
    }
  };
  beep();
  alarmTimer = setInterval(beep, 1800);
  alarmGain = true;
}

export function stopAlarm() {
  if (alarmTimer) clearInterval(alarmTimer);
  alarmTimer = null;
  alarmGain = null;
  try {
    navigator.vibrate?.(0);
  } catch {
    /* ignorieren */
  }
}

export const isAlarmRinging = () => Boolean(alarmTimer);

/**
 * Pegel (0–1) eines Audio-Elements, z. B. der Cloud-Sprachausgabe, für die Animation.
 * Gibt eine Funktion zurück, die den aktuellen Pegel liefert.
 */
export function createElementLevelMeter(audioEl) {
  const c = getContext();
  if (!c) return () => 0;
  try {
    const source = c.createMediaElementSource(audioEl);
    const analyser = c.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.6;
    source.connect(analyser);
    analyser.connect(master);
    const data = new Uint8Array(analyser.fftSize);
    return () => {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) {
        const v = (data[i] - 128) / 128;
        sum += v * v;
      }
      return Math.min(1, Math.sqrt(sum / data.length) * 3.2);
    };
  } catch {
    return () => 0;
  }
}
