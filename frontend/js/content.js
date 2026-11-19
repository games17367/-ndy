// Kurze, sofort verfügbare Sprüche für Momente, in denen keine KI-Antwort abgewartet werden soll
// (Begrüßung beim Wecken, Timer-Ende, Verabschiedung, Fehler). Die eigentlichen GESPRÄCHE
// kommen immer dynamisch von der KI.

export const WAKE_GREETINGS = [
  'Sarvus! Was geht ab? Was stellen wir heute wieder an?',
  'Jawohl! Ändy ist am Start. Was brauchst du?',
  'Sarvus! Ich hoffe, du hast einen guten Plan. Ich bin nämlich wieder übermotiviert.',
  'Hier bin ich! Dein digitaler Lieblingschaot.',
  'Na endlich! Ich dachte schon, du hast mich vergessen.',
  'Sarvus! Ich war gerade mitten in einem sehr wichtigen Nickerchen. Aber für dich unterbreche ich das.',
  'Ändy, einsatzbereit! Fast. Ein Moment, ich muss noch meine Pixel ordnen. Okay, fertig. Schieß los!',
  'Sarvus, Chef! Was darf es sein? Wissen, Witze oder Wahnsinn?',
  'Da bin ich! Frisch gebootet und völlig unbegründet gut gelaunt.',
  'Sarvus! Ich höre. Also eigentlich höre ich schon die ganze Zeit, aber jetzt darf ich auch antworten.',
];

export const WAKE_GREETINGS_FORMAL = [
  'Sarvus! Ändy zu Diensten. Was darf ich für Sie tun?',
  'Jawohl, hier ist Ändy. Womit kann ich Ihnen heute die Welt erleichtern?',
  'Sarvus! Ich stehe bereit. Und ich bin sogar pünktlich.',
];

export const FAREWELLS = [
  'Alles klar, ich leg mich wieder hin. Ruf einfach, wenn du mich brauchst.',
  'Okay, ich bin leise. Zumindest bis du mich wieder weckst.',
  'Servus, bis später! Ich passe derweil auf die Pixel auf.',
  'Verstanden. Ich schalte auf Standby und tue so, als hätte ich Wichtiges zu erledigen.',
  'Mach’s gut! Ich bin da, wenn du „Sarvus Ändy“ rufst.',
];

export const TIMER_DONE = [
  (l) => (l ? `Ding Ding Ding! Dein Timer „${l}“ ist abgelaufen!` : 'Ding Ding Ding! Dein Timer ist abgelaufen!'),
  (l) => (l ? `Zeit ist um! „${l}“ wartet nicht auf dich.` : 'Zeit ist um! Die Sekunden haben sich verabschiedet.'),
  (l) => (l ? `Achtung, Achtung: „${l}“ ist fertig. Ich erwarte Applaus.` : 'Achtung, Achtung: Der Timer ist fertig. Ich erwarte Applaus.'),
];

export const REMINDER_DUE = [
  (t) => `Erinnerung! ${t}. Nur damit du es nicht wieder vergisst.`,
  (t) => `Pssst. ${t}. Ich wollte nur Bescheid sagen.`,
  (t) => `Hallo, hier ist deine Erinnerung: ${t}.`,
];

export const ALARM_RINGING = [
  (t) => `Aufstehen! ${t}!`,
  (t) => `Wecker! ${t}. Ich weiß, du hasst mich gerade.`,
];

export const DIDNT_UNDERSTAND = [
  'Wie bitte? Da war nur Rauschen. Oder ich habe zu hoch gedacht.',
  'Das habe ich nicht verstanden. Sag es bitte noch mal, ich bin heute ein bisschen schwerhörig.',
];

export const OFFLINE_LINES = [
  'Ich erreiche gerade meinen KI-Verstand nicht. Das ist, als würde ich ohne Gehirn reden – nur peinlicher.',
  'Mein Gehirn ist gerade offline. Versuch es gleich noch mal.',
];

export const MORNING_FALLBACKS = [
  'Guten Morgen! Der Tag ist noch frisch, die Fehler noch nicht gemacht. Los geht’s!',
  'Sarvus und guten Morgen! Kaffee zuerst, Weltherrschaft später.',
  'Guten Morgen! Ich habe gut geschlafen. Also, ich war aus. Aber trotzdem.',
];

export const OPEN_GREETINGS = [
  'Schön, dass du wieder da bist! Ich hab dich nur ein ganz kleines bisschen vermisst.',
  'Oh, Besuch! Sag „Sarvus Ändy“, wenn du etwas brauchst.',
];

const lastPick = new Map();

/** Wählt zufällig, aber nie zweimal hintereinander dasselbe Element. */
export function pick(list, key = list, random = Math.random) {
  if (list.length === 1) return list[0];
  let idx;
  let guard = 0;
  do {
    idx = Math.floor(random() * list.length);
    guard++;
  } while (idx === lastPick.get(key) && guard < 10);
  lastPick.set(key, idx);
  return list[idx];
}
