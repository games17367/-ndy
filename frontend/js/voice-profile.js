// Stimm-Profil: männlich/weiblich erkennen und den „Clown-Einschlag“ berechnen.
// Reine Logik ohne Browser-Zugriff, damit sie sich testen lässt.
//
// Ehrlich zur Technik: Die Browser-Stimme ist die Stimme, die dein Gerät mitbringt. Wir können
// nur Tonhöhe und Tempo verändern – eine echte Clownstimme gibt es nur mit der Server-Stimme.

const MALE_NAMES = /(markus|conrad|florian|stefan|killian|jonas|michael|christoph|yannick|viktor|martin|hans|klaus|reed|rocko|eddy|flo\b|jan\b|male|männlich)/i;
const FEMALE_NAMES = /(anna|petra|katja|amala|hedda|ingrid|vicki|marlene|seraphina|helena|steffi|sandy|shelley|google deutsch|female|weiblich)/i;

/** @returns {'male'|'female'|'unknown'} */
export function guessVoiceGender(voice) {
  const name = `${voice?.name || ''}`;
  if (/\b(female|weiblich)\b/i.test(name)) return 'female';
  if (/\b(male|männlich)\b/i.test(name)) return 'male';
  if (FEMALE_NAMES.test(name)) return 'female';
  if (MALE_NAMES.test(name)) return 'male';
  return 'unknown';
}

const CLOUD_MALE = ['ash', 'ballad', 'echo', 'fable', 'onyx', 'verse'];
const CLOUD_FEMALE = ['coral', 'nova', 'sage', 'shimmer'];

export const CLOUD_VOICE_LABELS = {
  ash: 'Ash (männlich, warm)',
  ballad: 'Ballad (männlich, weich)',
  echo: 'Echo (männlich, klar)',
  fable: 'Fable (männlich, lebhaft)',
  onyx: 'Onyx (männlich, tief)',
  verse: 'Verse (männlich, ausdrucksstark)',
  alloy: 'Alloy (neutral)',
  coral: 'Coral (weiblich)',
  nova: 'Nova (weiblich)',
  sage: 'Sage (weiblich)',
  shimmer: 'Shimmer (weiblich)',
};

/** Passt die Server-Stimme an die gewünschte Stimmlage an (männlich ⇒ nie eine weibliche Stimme). */
export function resolveCloudVoice(voice, gender) {
  if (gender === 'male' && CLOUD_FEMALE.includes(voice)) return 'ash';
  if (gender === 'female' && CLOUD_MALE.includes(voice)) return 'coral';
  return voice;
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * Berechnet Tempo und Tonhöhe für einen Satz.
 * @param {string} text
 * @param {{
 *   rate:number, lively:boolean, gender:'male'|'female'|'any', character:'natural'|'clown',
 *   clownLevel:number, voiceGender:'male'|'female'|'unknown'
 * }} o
 * @param {() => number} [rand]  liefert 0..1 (für Tests ersetzbar)
 */
export function computeProsody(text, o, rand = Math.random) {
  const t = String(text || '').trim();
  const level = clamp(Number(o.clownLevel) / 100 || 0, 0, 1);
  const clown = o.character === 'clown' && level > 0;
  const jitter = (amp) => (o.lively || clown ? (rand() * 2 - 1) * amp : 0);

  // Grundlage: Stimmlage. Fehlt eine männliche Stimme, wird die vorhandene tiefer gestellt.
  let pitch = 1;
  let rate = Number(o.rate) || 1;
  if (o.gender === 'male') {
    if (o.voiceGender === 'female') {
      pitch = 0.78;
      rate *= 0.97;
    } else if (o.voiceGender === 'unknown') {
      pitch = 0.9;
    }
  } else if (o.gender === 'female' && o.voiceGender === 'male') {
    pitch = 1.2;
  }

  // Betonung: Fragen gehen hoch, Ausrufe werden etwas schneller.
  if (/\?$/.test(t)) pitch += 0.06;
  if (/!$/.test(t)) rate *= 1.04;
  pitch += jitter(0.07);
  rate *= 1 + jitter(0.04);

  if (clown) {
    // Dezent: der Pegel (0–1) skaliert alles. Bei 35 % bleibt es ein Schmunzeln.
    pitch += 0.05 * level;
    pitch += jitter(0.18 * level); // lebhafteres Auf und Ab von Satz zu Satz
    if (/!$/.test(t)) {
      pitch += 0.12 * level;
      rate *= 1 + 0.08 * level;
    }
    if (/\?$/.test(t)) pitch += 0.1 * level;
    if (/(\.\.\.|…)$/.test(t)) {
      rate *= 1 - 0.12 * level; // trockene Pause vor der Pointe
      pitch -= 0.06 * level;
    }
    if (/\b(ha){2,}h?\b|hihi|hehe/i.test(t)) pitch += 0.08 * level;
    if (t.length > 90) rate *= 1 - 0.04 * level;
  }

  return { rate: clamp(rate, 0.5, 2), pitch: clamp(pitch, 0.5, 2) };
}
