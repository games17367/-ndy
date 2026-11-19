// Lokale Sprachbefehle, die ohne KI sofort funktionieren müssen (auch offline):
// Gespräch beenden („Ändy, Ruhe“), Unterbrechen („Stopp“), lauter/leiser.
// Es werden nur kurze, eindeutige Äußerungen erkannt – nie Teilsätze eines normalen Gesprächs.

import { stripAddress, tokenize } from './wake.js';

const END_QUIET = [
  /^ruhe( bitte| jetzt)?$/,
  /^sei (jetzt |mal )?(still|ruhig)( bitte)?$/,
  /^(halt|halte) die klappe$/,
  /^schlaf( jetzt| wieder)?( ein)?$/,
  /^schlafen$/,
  /^ende$/,
  /^(hör|hoer) auf zuzuhören$/,
  /^nicht mehr zuhören$/,
];

const END_FAREWELL = [
  /^(tschüss|tschüssi|tschüs|tschau|ciao|servus und tschüss|pfiat di|baba|bye|auf wiedersehen|auf wiederschauen)$/,
  /^(gute nacht|nacht)( ändy)?$/,
  /^bis (später|dann|bald|morgen)$/,
  /^das war'?s( (für|fürs) (heute|jetzt))?( danke)?$/,
  /^danke,? das war'?s$/,
  /^feierabend$/,
  /^(mach'?s|machs) gut$/,
];

const INTERRUPT = [/^(stopp?|halt|warte|warte mal|moment|moment mal|pause|sei kurz still|genug)( bitte)?$/];
const LOUDER = [/^(etwas |bisschen |ein bisschen )?lauter( bitte)?$/, /^(sprich|sprech|rede|mach) (etwas |bisschen |ein bisschen )?lauter( bitte)?$/];
const QUIETER = [/^(etwas |bisschen |ein bisschen )?leiser( bitte)?$/, /^(sprich|sprech|rede|mach) (etwas |bisschen |ein bisschen )?leiser( bitte)?$/];

function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[„“"'`´]/g, (c) => (c === "'" ? "'" : ''))
    .replace(/[.,!?;:…]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const testAny = (list, s) => list.some((re) => re.test(s));

/**
 * @param {string} text
 * @returns {null | {type: 'end', farewell: boolean} | {type: 'interrupt'} | {type: 'louder'} | {type: 'quieter'}}
 */
export function parseLocalCommand(text) {
  if (!text) return null;
  if (tokenize(text).length > 6) return null; // lange Sätze sind nie Befehle
  // Füllwörter („bitte“, „mal“, „doch“, „jetzt“) stören nur beim Abgleich.
  const core = normalize(stripAddress(text))
    .replace(/\b(bitte|mal|doch|jetzt)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!core) return null;
  if (testAny(END_QUIET, core)) return { type: 'end', farewell: false };
  if (testAny(END_FAREWELL, core)) return { type: 'end', farewell: true };
  if (testAny(INTERRUPT, core)) return { type: 'interrupt' };
  if (testAny(LOUDER, core)) return { type: 'louder' };
  if (testAny(QUIETER, core)) return { type: 'quieter' };
  return null;
}
