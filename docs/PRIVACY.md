# Datenschutz

Ändy ist so gebaut, dass möglichst wenig Daten anfallen und du die Kontrolle behältst. Dies ist eine technische Beschreibung, keine Rechtsberatung. Wenn du Ändy für andere Personen betreibst, brauchst du eine eigene Datenschutzerklärung.

## Was im Browser bleibt

Einstellungen, Notizen, Erinnerungen, Timer und, **nur wenn du es einschaltest**, Gesprächsverlauf und Langzeitgedächtnis liegen im lokalen Speicher deines Browsers. Verlauf und Gedächtnis sind standardmäßig **aus**. Du kannst beides in den Einstellungen ansehen, löschen und als Datei exportieren (der Zugangscode ist nicht im Export). Es gibt keine Konten, keine Cookies, keine Tracker, und es werden keine Schriften oder Skripte von Fremdservern geladen (Poppins ist selbst gehostet).

## Was an deinen Ändy-Server geht

Der Text deiner Nachrichten (und der letzte Teil des Gesprächs), deine Einstellungen zur Persönlichkeit, Uhrzeit und Zeitzone, die Geräteart („iPhone“), kurze Listen deiner Timer, Erinnerungen und Notizen (damit Ändy sie kennt) und, falls eingeschaltet, deine gemerkten Fakten. Dein Standort wird **nur** mitgeschickt, wenn du ihn in den Einstellungen erlaubt hast, und nur für Wetterfragen.

Der Server reicht das an den KI-Anbieter weiter (Anthropic oder OpenAI-kompatibel), damit Ändy antworten kann. Für Wetter wird Open-Meteo angefragt, für die Suche Brave oder Wikipedia, jeweils nur mit dem Suchbegriff beziehungsweise Ort. Der Server selbst **speichert keine Gespräche** und schreibt Gesprächstexte nicht absichtlich ins Protokoll (dort stehen nur Startmeldungen und technische Fehler). Dein Hoster und dein KI-Anbieter haben aber eigene Protokolle und Aufbewahrungsregeln, die du dort nachlesen solltest.

## Sprache

- **Spracherkennung im Browser** (Standard): Chrome und Edge senden die Aufnahme zur Erkennung an Google beziehungsweise Microsoft, Safari an Apple. Das ist Sache deines Browsers.
- **Beim Lauschen auf das Weckwort** wird alles außer „Sarvus Ändy“ sofort verworfen und nie an Ändys Server gesendet. (Der Browser selbst erkennt dabei trotzdem Sprache, siehe oben.)
- **Server-Spracherkennung** (nur wenn dein Backend einen `OPENAI_API_KEY` hat und du sie wählst): Die Aufnahme geht nur, solange ein Gespräch läuft, an deinen Server und von dort an den Spracherkennungs-Anbieter.
- **Server-Stimme:** Der Text, den Ändy sagen soll, geht an deinen Server und den Sprach-Anbieter.

## Mikrofon

Das Mikrofon ist nur aktiv, wenn du Ändy geweckt hast oder das Weckwort-Lauschen eingeschaltet ist (das Chip oben zeigt „Lauscht auf Sarvus Ändy“). Der Browser zeigt dabei seine eigene Mikrofon-Anzeige. Im Hintergrund, bei gesperrtem Gerät oder geschlossener Seite hört Ändy nicht zu.

## Foto

Das Foto in `frontend/img/andy.jpg` ist Teil der Website. Es wird beim Veröffentlichen öffentlich, siehe [DEPLOYMENT.md](DEPLOYMENT.md#das-foto).

## Zugangscode

Der Zugangscode liegt im lokalen Speicher deines Browsers und wird mit jeder Anfrage an dein Backend geschickt. Er ist ein gemeinsames Passwort, kein Benutzerkonto.
