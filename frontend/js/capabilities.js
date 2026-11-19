// Ehrliche Übersicht: Welche Aktivierungswege gibt es auf diesem Gerät – und welche nicht?
// Reine Logik ohne Zugriff auf den Browser, damit sie sich testen lässt.
// Grundsatz: Eine Webseite oder installierte Web-App darf im Hintergrund nicht heimlich lauschen.
// Ändy versucht das nicht und verspricht es nicht. Stattdessen werden die offiziell
// unterstützten Wege gezeigt (Weckwort bei geöffneter Seite, Tippen aufs Bild, Siri-Kurzbefehl,
// Verknüpfungen) und klar benannt, was nicht geht.

/**
 * @typedef {{
 *   label: string, isIOS: boolean, isAndroid: boolean, isMobile: boolean, isStandalone: boolean,
 *   isFirefox: boolean, browserRecognition: boolean, serverStt: boolean, hasMic: boolean,
 *   hasNotifications: boolean, notificationPermission: string, hasWakeLock: boolean,
 *   canInstall: boolean, secureContext: boolean
 * }} DeviceEnv
 */

/** @param {DeviceEnv} env */
export function evaluateActivation(env) {
  const rows = [];
  const add = (id, title, status, text) => rows.push({ id, title, status, text });
  const anyVoice = env.hasMic && (env.browserRecognition || env.serverStt);

  // 1) Weckwort bei geöffneter Seite
  if (!env.secureContext) {
    add('wake', 'Weckwort „Sarvus Ändy“', 'no', 'Das Mikrofon gibt es nur auf Seiten mit https. Öffne Ändy über seine https-Adresse.');
  } else if (env.browserRecognition && env.hasMic) {
    if (env.isIOS) {
      add(
        'wake',
        'Weckwort „Sarvus Ändy“',
        'limited',
        'Geht in Safari, solange die Seite offen und sichtbar ist. iOS stoppt die Erkennung, sobald der Bildschirm ausgeht oder du die App wechselst. Danach genügt ein Tipp aufs Bild.'
      );
    } else if (env.isAndroid) {
      add(
        'wake',
        'Weckwort „Sarvus Ändy“',
        'limited',
        'Geht in Chrome, solange die Seite offen ist. Bei ausgeschaltetem Display oder in einem anderen Tab pausiert der Browser das Mikrofon. Beim Zurückkommen startet Ändy das Lauschen wieder.'
      );
    } else {
      add('wake', 'Weckwort „Sarvus Ändy“', 'ok', 'Geht, solange Ändy in einem Tab oder als installierte App geöffnet ist und das Mikrofon erlaubt wurde.');
    }
  } else if (env.isIOS && env.isStandalone) {
    add(
      'wake',
      'Weckwort „Sarvus Ändy“',
      'no',
      'In der Homescreen-App erlaubt iOS keine Browser-Spracherkennung. Öffne Ändy in Safari, wenn du das Weckwort willst. Tippen aufs Bild geht auch hier' + (env.serverStt ? ' (mit Server-Spracherkennung).' : ' nur, wenn dein Server Spracherkennung anbietet.')
    );
  } else if (env.isFirefox) {
    add('wake', 'Weckwort „Sarvus Ändy“', 'no', 'Firefox hat keine eingebaute Spracherkennung. Nutze Chrome, Edge oder Safari – oder tippe aufs Bild, wenn dein Server Spracherkennung anbietet.');
  } else {
    add('wake', 'Weckwort „Sarvus Ändy“', 'no', 'Dieser Browser bietet keine Spracherkennung. Du kannst Ändy schreiben' + (env.serverStt ? ' oder per Tippen aufs Bild mit ihm sprechen.' : '.'));
  }

  // 2) Tippen aufs Bild
  if (anyVoice) {
    add(
      'tap',
      'Tippen auf Ändys Bild',
      'ok',
      'Ein Tipp startet das Zuhören, ein zweiter beendet es. Das geht auf jedem Gerät mit Mikrofon' + (env.browserRecognition ? '.' : ' über die Server-Spracherkennung.')
    );
  } else {
    add('tap', 'Tippen auf Ändys Bild', 'limited', 'Hier ist keine Spracherkennung verfügbar. Das Bild startet nichts; schreibe Ändy stattdessen im Eingabefeld.');
  }

  // 3) Gesperrt / Standby / geschlossen
  add(
    'locked',
    'Bei gesperrtem Gerät, im Standby oder mit geschlossenem Browser',
    'no',
    'Das ist technisch nicht möglich: Browser und installierte Web-Apps dürfen im Hintergrund nicht mithören, und Ändy versucht es auch nicht heimlich. Die Wege unten kommen dem am nächsten.'
  );

  // 4) Plattform-spezifische Wege
  if (env.isIOS) {
    add(
      'siri',
      'Siri-Kurzbefehl',
      'limited',
      '„Hey Siri, Sarvus Ändy“ öffnet Ändy (Einrichtung unten). Das funktioniert auch vom Sperrbildschirm aus, doch zum Öffnen der Seite verlangt iOS meist das Entsperren per Face ID, Touch ID oder Code. Danach tippst du einmal aufs Bild, weil iOS das Mikrofon nur nach einer Berührung freigibt.'
    );
    add(
      'home',
      'Symbol auf dem Home-Bildschirm',
      env.isStandalone ? 'ok' : 'limited',
      env.isStandalone ? 'Ändy läuft als App vom Home-Bildschirm.' : 'In Safari: Teilen, dann „Zum Home-Bildschirm“. Das gibt dir ein App-Symbol, auch für Siri und die Suche. Beachte: In dieser Homescreen-App fehlt die Browser-Spracherkennung (siehe oben).'
    );
  } else if (env.isAndroid) {
    add(
      'shortcut',
      'App-Symbol und Kurzbefehl „Ändy wecken“',
      env.isStandalone ? 'ok' : env.canInstall ? 'limited' : 'limited',
      env.isStandalone
        ? 'Langes Drücken auf das Ändy-Symbol zeigt die Abkürzung „Ändy wecken“. Sie öffnet Ändy und wartet auf einen Tipp aufs Bild.'
        : 'In Chrome: Menü, „App installieren“. Dann hast du ein Symbol auf dem Startbildschirm, und langes Drücken zeigt „Ändy wecken“.'
    );
    add(
      'assistant',
      'Sprachassistent des Telefons',
      'limited',
      'Je nach Gerät kann der Google Assistent installierte Apps mit „Hey Google, öffne Ändy“ starten. Ob und wie gut das klappt, hängt von Telefon und Version ab. Ein eigenes Weckwort kann Ändy darin nicht anmelden. Bei gesperrtem Telefon musst du meist entsperren.'
    );
  } else {
    add(
      'install',
      'Als App installieren',
      env.isStandalone ? 'ok' : env.canInstall ? 'limited' : 'info',
      env.isStandalone
        ? 'Ändy läuft als eigene App mit eigenem Fenster.'
        : env.canInstall
          ? 'Tippe in den Einstellungen auf „Als App installieren“. Dann startet Ändy in einem eigenen Fenster, das du offen lassen kannst.'
          : 'In Chrome oder Edge zeigt die Adressleiste ein Installieren-Symbol. Dann läuft Ändy in einem eigenen Fenster, das du offen lassen kannst.'
    );
  }

  // 5) Wiederaufnahme
  add(
    'resume',
    'Automatische Wiederaufnahme',
    env.browserRecognition ? (env.isIOS ? 'limited' : 'ok') : 'no',
    env.browserRecognition
      ? env.isIOS
        ? 'Kommst du zu Ändy zurück, startet das Lauschen auf das Weckwort wieder. iOS verlangt dafür manchmal einen Tipp.'
        : 'Kommst du zu Ändy zurück (Tab oder Fenster wieder sichtbar), startet das Lauschen auf das Weckwort von selbst wieder.'
      : 'Ohne Browser-Spracherkennung gibt es kein Dauerlauschen, das wieder anlaufen könnte.'
  );

  // 6) Bildschirm wachhalten
  add(
    'wakelock',
    'Bildschirm im Gespräch anlassen',
    env.hasWakeLock ? 'ok' : 'no',
    env.hasWakeLock
      ? 'Solange ein Gespräch läuft, hält Ändy das Display an, damit das Mikrofon nicht pausiert (abschaltbar in den Einstellungen).'
      : 'Dein Browser kann das Display nicht wachhalten. Stelle die Bildschirmsperre bei Bedarf länger ein.'
  );

  // 7) Benachrichtigungen
  const perm = env.notificationPermission;
  if (!env.hasNotifications) {
    add('notify', 'Benachrichtigungen für Timer und Erinnerungen', 'no', 'Dieser Browser unterstützt keine Benachrichtigungen. Timer und Erinnerungen melden sich nur auf dem Bildschirm und mit Ton.');
  } else if (env.isIOS && !env.isStandalone) {
    add('notify', 'Benachrichtigungen für Timer und Erinnerungen', 'limited', 'Auf dem iPhone gibt es Benachrichtigungen nur für Web-Apps vom Home-Bildschirm (ab iOS 16.4).');
  } else if (perm === 'granted') {
    add('notify', 'Benachrichtigungen für Timer und Erinnerungen', 'ok', 'Erlaubt. Ändy meldet Timer und Erinnerungen auch aus dem Hintergrund-Tab, solange die Seite geöffnet bleibt. Bei geschlossener Seite kann Ändy nicht erinnern.');
  } else if (perm === 'denied') {
    add('notify', 'Benachrichtigungen für Timer und Erinnerungen', 'no', 'In deinem Browser blockiert. Erlaube sie in den Seiteneinstellungen.');
  } else {
    add('notify', 'Benachrichtigungen für Timer und Erinnerungen', 'limited', 'Noch nicht erlaubt. Du kannst das unter „Funktionen“ einschalten. Bei geschlossener Seite kann Ändy trotzdem nicht erinnern.');
  }

  return rows;
}

export const STATUS_LABEL = { ok: 'Verfügbar', limited: 'Mit Einschränkung', no: 'Nicht möglich', info: 'Hinweis' };
