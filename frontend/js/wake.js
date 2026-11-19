// Weckwort-Erkennung für „Sarvus Ändy“.
// Spracherkennung schreibt Namen unterschiedlich („Servus Andy“, „Sarvus Endi“, „Servas Handy“ ...).
// Deshalb wird tolerant verglichen (Levenshtein-Abstand) statt exakt.

export function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

const GREETINGS = ['servus', 'sarvus', 'serwus', 'sarwus', 'servas', 'sarvas'];
const NAMES = ['andy', 'ändy', 'andi', 'endy', 'endi', 'ändi', 'handy'];
const LOOSE_PREFIXES = ['hey', 'hallo', 'hi', 'ok', 'okay', 'hej', 'he'];

function fold(s) {
  return s
    .toLowerCase()
    .normalize('NFC')
    .replace(/ß/g, 'ss');
}

export function tokenize(text) {
  const tokens = [];
  const re = /[\p{L}\p{N}]+/gu;
  let m;
  while ((m = re.exec(text))) tokens.push({ raw: m[0], norm: fold(m[0]), start: m.index, end: m.index + m[0].length });
  return tokens;
}

function isGreeting(word) {
  if (word.length < 4) return false;
  return GREETINGS.some((g) => levenshtein(word, g) <= (word.length >= 6 ? 2 : 1));
}

function isName(word) {
  if (word.length < 3 || word.length > 7) return false;
  return NAMES.some((n) => levenshtein(word, n) <= 1);
}

function isLoosePrefix(word) {
  return LOOSE_PREFIXES.includes(word);
}

function restAfter(text, endIndex) {
  return text.slice(endIndex).replace(/^[\s,.:;!?…–—-]+/, '').trim();
}

/**
 * Sucht das Weckwort im Text.
 * @param {string} text  Erkennungstext
 * @param {{loose?: boolean}} [options]  loose: auch „Hey Ändy“ / „Hallo Ändy“ akzeptieren
 * @returns {{matched: boolean, rest: string, phrase: string}}
 */
export function detectWake(text, options = {}) {
  const none = { matched: false, rest: '', phrase: '' };
  if (!text || typeof text !== 'string') return none;
  const tokens = tokenize(text);
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];

    // 1) „Sarvus Ändy“ – Gruß und Name als getrennte Wörter
    const next = tokens[i + 1];
    if (next && isGreeting(t.norm) && isName(next.norm)) {
      return { matched: true, rest: restAfter(text, next.end), phrase: text.slice(t.start, next.end) };
    }
    // 2) Gruß zerlegt: „Ser vus Ändy“, „Sar wus Ändy“
    const after = tokens[i + 2];
    if (next && after && isGreeting(t.norm + next.norm) && isName(after.norm)) {
      return { matched: true, rest: restAfter(text, after.end), phrase: text.slice(t.start, after.end) };
    }
    // 3) Zusammengeschrieben: „Servusandy“
    if (t.norm.length >= 8 && t.norm.length <= 13) {
      for (const g of GREETINGS) {
        if (t.norm.startsWith(g.slice(0, 4)) && isName(t.norm.slice(g.length - 1)) ) {
          return { matched: true, rest: restAfter(text, t.end), phrase: t.raw };
        }
      }
    }
    // 4) Locker: „Hey Ändy“
    if (options.loose && next && isLoosePrefix(t.norm) && isName(next.norm)) {
      return { matched: true, rest: restAfter(text, next.end), phrase: text.slice(t.start, next.end) };
    }
  }
  return none;
}

/** Ist im Text jemand dabei, „Ändy“ direkt anzusprechen (z. B. „Ändy, Ruhe“)? */
export function stripAddress(text) {
  const tokens = tokenize(text);
  let out = text;
  // Nur Anrede am Anfang oder Ende entfernen
  if (tokens.length && isName(tokens[0].norm)) out = out.slice(tokens[0].end);
  else if (tokens.length > 1 && isName(tokens[tokens.length - 1].norm)) out = out.slice(0, tokens[tokens.length - 1].start);
  return out.replace(/^[\s,.:;!?…–—-]+|[\s,.:;!?…–—-]+$/g, '').trim();
}
