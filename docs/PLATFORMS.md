# iPhone, Android, Desktop

## Die wichtige Grenze

Browser und installierte Web-Apps (PWA) dürfen **nicht im Hintergrund mithören**: nicht bei gesperrtem Gerät, nicht im Standby, nicht bei geschlossenem Browser. Das ist eine Schutzfunktion der Betriebssysteme. Ändy umgeht sie nicht (keine versteckte Mikrofonüberwachung, keine Tricks mit stummen Audio-Schleifen) und verspricht sie nicht. In den Einstellungen unter **„Dieses Gerät“** zeigt Ändy für dein Gerät ehrlich an, was geht.

## Übersicht

| | Weckwort „Sarvus Ändy“ | Tippen aufs Bild | Gesperrt / Standby |
| --- | --- | --- | --- |
| **Windows / Mac (Chrome, Edge)** | ja, solange Tab oder App-Fenster offen ist | ja | nein |
| **Mac (Safari)** | ja, solange der Tab offen ist | ja | nein |
| **Android (Chrome)** | eingeschränkt: nur bei offener Seite, pausiert bei ausgeschaltetem Display | ja | nein; Abkürzung „Ändy wecken“, ggf. „Hey Google, öffne Ändy“ |
| **iPhone / iPad (Safari-Tab)** | eingeschränkt: nur bei offener, sichtbarer Seite | ja | nein; Siri-Kurzbefehl öffnet Ändy, danach ein Tipp |
| **iPhone / iPad (Homescreen-App)** | **nein**: iOS bietet dort keine Browser-Spracherkennung | nur mit Server-Spracherkennung | nein; Siri-Kurzbefehl |
| **Firefox** | nein (keine eingebaute Spracherkennung) | nur mit Server-Spracherkennung | nein |

„Server-Spracherkennung“ bedeutet: Dein Backend hat einen `OPENAI_API_KEY` und nimmt die Aufnahme zur Texterkennung entgegen (siehe [PRIVACY.md](PRIVACY.md)). Dann funktioniert das Tippen aufs Bild fast überall, ein dauerhaftes Weckwort aber nicht.

## Automatische Wiederaufnahme

Wenn du zu Ändy zurückkehrst (Tab oder Fenster wird wieder sichtbar), startet das Lauschen auf das Weckwort von selbst neu. Auf dem iPhone verlangt iOS dafür manchmal einen Tipp.

## iPhone: Siri-Kurzbefehl „Sarvus Ändy“

1. App **Kurzbefehle** öffnen, **+** tippen.
2. Aktion **URL** hinzufügen, als Adresse die Start-Adresse eintragen: `https://DEINE-ADRESSE/?start=1` (die genaue Adresse zeigt dir Ändy in den Einstellungen unter *Siri und Installation* an).
3. Danach die Aktion **URLs öffnen** hinzufügen.
4. Kurzbefehl **„Sarvus Ändy“** nennen. Versteht Siri den Namen nicht, nimm **„Ändy“**.
5. Sagen: „Hey Siri, Sarvus Ändy“.

Was dann passiert, ehrlich: Siri öffnet Ändy. Bei gesperrtem iPhone verlangt iOS zum Öffnen einer Seite in der Regel das Entsperren (Face ID, Touch ID oder Code). Ändy zeigt „Ändy ist bereit“, und du tippst **einmal** auf **Ändy wecken**. Dieser Tipp ist nötig, weil iOS das Mikrofon nur nach einer Berührung freigibt. Danach läuft das Gespräch bis „Ändy, Ruhe.“.

Zusätzlich lässt sich der Kurzbefehl über die **Action-Taste**, den **Zurück-Tipp** (Einstellungen, Bedienungshilfen, Tippen, Zurück-Tipp) oder ein Widget auf dem Home-Bildschirm auslösen. Ob diese Auslöser bei gesperrtem Gerät funktionieren, hängt von iOS-Version und Einstellungen ab.

### Auf den Home-Bildschirm legen

Safari, **Teilen**, **Zum Home-Bildschirm**. Hinweis: In dieser Homescreen-App fehlt unter iOS die Browser-Spracherkennung. Willst du das Weckwort nutzen, öffne Ändy in Safari. Hast du eine Server-Spracherkennung eingerichtet, funktioniert das Tippen aufs Bild auch in der Homescreen-App.

## Android

- Chrome, Menü, **App installieren** (oder „Zum Startbildschirm“).
- Langes Drücken auf das Ändy-Symbol zeigt die Abkürzung **„Ändy wecken“**. Sie öffnet Ändy und wartet auf einen Tipp aufs Bild.
- Je nach Gerät kann der Google Assistent installierte Apps mit „Hey Google, öffne Ändy“ starten. Ob das klappt, hängt von Telefon und Version ab. Ein eigenes Weckwort lässt sich dort für eine Web-App nicht anmelden.
- Bei ausgeschaltetem Display pausiert Chrome das Mikrofon. Beim Zurückkommen startet Ändy das Lauschen wieder.

## Windows und Mac

- Chrome oder Edge: Installieren-Symbol in der Adressleiste, dann startet Ändy in einem eigenen Fenster, das du offen lassen kannst.
- Das Mikrofon muss einmal erlaubt werden. Ist es schon erlaubt, nimmt Ändy das Lauschen nach dem Öffnen von selbst auf.

## Erinnerungen und Timer

Timer, Erinnerungen und Wecker laufen **in der geöffneten Seite**. Ist Ändy geschlossen, kann nichts klingeln (eine Webseite kann sich nicht selbst starten). Erlaubte Benachrichtigungen melden sie auch aus einem Hintergrund-Tab. Erinnerungen, die in der Zwischenzeit fällig waren, zeigt Ändy beim nächsten Öffnen als „Verpasst“ an. Für Wecker, die wirklich klingeln müssen, nutze zusätzlich die Wecker-App deines Geräts.

## Weitere Grenzen

- Musik: Ändy öffnet Spotify, Apple Music oder YouTube Music mit einer Suche. Laufende Musik in anderen Apps kann eine Webseite nicht steuern.
- Kalender: Ändy erzeugt eine `.ics`-Datei oder einen Google-Kalender-Link. Du bestätigst und übernimmst den Termin.
- Nachrichten: Ändy bereitet den Text vor. Du schickst ihn selbst ab (SMS, WhatsApp, E-Mail).
- Anrufe tätigen oder Geräteeinstellungen ändern ist für eine Webseite nicht möglich.
