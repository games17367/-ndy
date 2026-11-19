// Textaufbereitung für die Sprachausgabe: Satzzerlegung für Streaming-TTS,
// Markdown-Bereinigung und Echo-Erkennung (damit Ändy sich nicht selbst „hört“).

// Abkürzungen, nach denen KEIN Satzende kommt.
const ABBREVIATIONS = /(?:\b(?:z\.\s?b|d\.\s?h|u\.\s?a|o\.\s?ä|usw|etc|bzw|ca|vs|dr|nr|prof|hr|fr|str|tel|ggf|evtl|inkl|zzgl|mind|max|ok|uhr|min|sek|std|mio|mrd|jh|ev|kath|geb|gest|vgl|sog)\.)$/i;

/**
 * Zerlegt einen wachsenden Textpuffer in fertige Sätze und einen Rest.
 * Kurze Sätze werden zusammengefasst, damit die Sprachausgabe nicht abgehackt klingt.
 * @param {string} buffer
 * @param {{minLength?: number, flush?: boolean}} [opts]
 */
export function splitSentences(buffer, { minLength = 24, flush = false } = {}) {
  const sentences = [];
  let current = '';
  let i = 0;
  const text = buffer;
  while (i < text.length) {
    const ch = text[i];
    current += ch;
    const isEnd = /[.!?…]/.test(ch);
    if (isEnd) {
      // Mehrfach-Satzzeichen („?!“, „...“) mitnehmen
      while (i + 1 < text.length && /[.!?…"“”')\]]/.test(text[i + 1])) {
        current += text[++i];
      }
      const next = text[i + 1];
      const atEnd = i + 1 >= text.length;
      const nextIsSpace = next !== undefined && /\s/.test(next);
      const isDecimal = ch === '.' && /\d$/.test(current.slice(0, -1)) && next !== undefined && /\d/.test(next);
      const isAbbrev = ch === '.' && ABBREVIATIONS.test(current.trim());
      const isOrdinal = ch === '.' && /\b\d{1,2}\.$/.test(current.trim()) && next !== undefined && /\s/.test(next) && /^\s*[a-zäöü]/.test(text.slice(i + 1, i + 3));
      if (!isDecimal && !isAbbrev && !isOrdinal && (nextIsSpace || (atEnd && flush))) {
        if (current.trim().length >= minLength || (atEnd && flush)) {
          sentences.push(current.trim());
          current = '';
        }
      }
    }
    i++;
  }
  let rest = current;
  if (flush) {
    if (rest.trim()) {
      // Reste an den letzten kurzen Satz anhängen, falls einer zu kurz war
      sentences.push(rest.trim());
    }
    rest = '';
  }
  return { sentences, rest: rest.replace(/^\s+/, '') };
}

/** Entfernt Markdown, Emojis, Links usw., damit nichts Unsinniges vorgelesen wird. */
export function cleanForSpeech(text) {
  return String(text || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/^\s*[-*•]\s+/gm, '')
    .replace(/[*_~]{1,3}([^*_~\n]+)[*_~]{1,3}/g, '$1')
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/[‍️]/g, '')
    .replace(/\s*\n+\s*/g, '. ')
    .replace(/\.{2,}\s*\./g, '...')
    .replace(/([.!?…])\s*\./g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** Für die Chat-Anzeige: nur Steuerzeichen entfernen, Text sonst unverändert lassen. */
export function cleanForDisplay(text) {
  return String(text || '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
}

function words(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Anteil der erkannten Wörter, die in dem gerade gesprochenen Text vorkommen (0–1).
 * Hohe Werte = vermutlich Echo der eigenen Sprachausgabe.
 */
export function echoScore(heard, spoken) {
  const h = words(heard);
  if (!h.length) return 0;
  const pool = new Set(words(spoken));
  let hit = 0;
  for (const w of h) if (pool.has(w)) hit++;
  return hit / h.length;
}

export function countWords(text) {
  return words(text).length;
}
