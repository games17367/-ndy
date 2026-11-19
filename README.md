# ÄNDY

Dein persönlicher, extrem humorvoller KI-Sprachassistent als Website. Sag **„Sarvus Ändy!“**, stell deine Frage und Ändy antwortet per Stimme: frech, aber nie verletzend.

ÄNDY ist eine installierbare Web-App (PWA) für iPhone, Android, Tablets, Windows und Mac. Sie besteht aus zwei Teilen:

| Teil | Ordner | Läuft auf |
| --- | --- | --- |
| Website (Oberfläche, Sprache, Timer, Speicher) | `frontend/` | GitHub Pages oder jedem Webspace |
| Backend (KI-Anfragen, Wetter, Websuche, optional Sprache) | `backend/` | Render, Railway, Fly.io, eigener Server, Docker |

Das Backend ist nötig, weil API-Schlüssel niemals im Browser oder im Repository stehen dürfen. GitHub Pages kann keinen Server-Code ausführen.

**Keine Abhängigkeiten, kein Build-Schritt:** Das Backend nutzt nur Node.js (ab Version 20), die Website besteht aus nativen ES-Modulen. Es gibt weder `npm install` noch einen Bundler.

## Was Ändy kann

- **Sprache:** Weckwort „Sarvus Ändy“, Endlos-Gespräch bis „Ändy, Ruhe.“ oder Stopp-Taste, Unterbrechen während Ändy spricht, deutsche Sprachausgabe satzweise gestreamt (kurze Wartezeit), einstellbare Geschwindigkeit und Lautstärke. Ändys Stimme ist **männlich mit einem kleinen Clown-Einschlag** (Stimmlage, Charakter und Clown-Anteil einstellbar; am besten klingt die Server-Stimme).
- **Echte KI:** Jede Antwort entsteht dynamisch im Sprachmodell (Anthropic, Google Gemini oder OpenAI-kompatibel). Vorgefertigte Sätze gibt es nur dort, wo Ändy sofort und ohne Internet reagieren muss: Timer- und Wecker-Meldungen, Verabschiedung, „Das habe ich nicht verstanden“ und standardmäßig die Begrüßung beim Wecken (die KI-Begrüßung lässt sich in den Einstellungen einschalten). Sie stammen aus Textsammlungen in `frontend/js/content.js` und wechseln sich ab.
- **Persönlichkeit:** Humorgrad, Frechheitsmodus, Du/Sie, Österreichisch, Antwortlänge und eigene Anweisungen in den Einstellungen.
- **Funktionen:** Websuche, Wetter, Rechnen, Fragen, Texte schreiben, Notizen, Erinnerungen, Wecker, Timer, Kalendertermine (.ics-Datei oder Google-Kalender-Link), Navigation, Musik öffnen, Nachrichten diktieren (du schickst selbst ab).
- **Zustimmung:** Alles, was andere Apps oder Personen betrifft, erscheint als Karte und passiert erst nach deinem Tipp.
- **Eigeninitiative (optional):** Morgengruß, Erinnerungen laut sagen, Ruhezeiten.
- **Gedächtnis (freiwillig):** Verlauf und Langzeitgedächtnis nur auf deinen Wunsch, einsehbar, löschbar, exportierbar.
- **Design:** Dunkles, futuristisches Design mit violettem und blauem Licht. **Dein Foto ist Ändys Gesicht** und gleichzeitig die große Mikrofon- und Aktivierungstaste (einmal tippen: zuhören, nochmal tippen: beenden). Es schwebt im Standby, leuchtet beim Zuhören, pulsiert beim Nachdenken und folgt beim Sprechen der Stimme.

## Ehrlich: Was eine Webseite nicht kann

Eine Webseite oder installierte Web-App darf auf iPhone, Android und am Computer **nicht im Hintergrund mithören**, wenn das Gerät gesperrt, im Standby oder der Browser geschlossen ist. Ändy versucht nicht, das zu umgehen, und verspricht es nicht. Stattdessen gibt es:

- das Weckwort bei geöffneter Seite (inklusive automatischer Wiederaufnahme),
- das Tippen aufs Bild,
- einen Siri-Kurzbefehl auf dem iPhone,
- App-Symbol und Abkürzung „Ändy wecken“ auf Android,
- eine Geräteübersicht in den Einstellungen („Dieses Gerät“), die für dein Gerät zeigt, was geht, was eingeschränkt geht und was nicht.

Details: [docs/PLATFORMS.md](docs/PLATFORMS.md).

## Schnellstart (lokal)

Voraussetzung: [Node.js](https://nodejs.org) 20.6 oder neuer.

```bash
git clone <dein-repo> aendy && cd aendy
cp backend/.env.example backend/.env
# backend/.env öffnen und GEMINI_API_KEY (kostenloser Tarif), ANTHROPIC_API_KEY oder OPENAI_API_KEY eintragen
# Woher der Schlüssel kommt: docs/DEPLOYMENT.md, Abschnitt „Woher bekomme ich einen API-Schlüssel?“
npm run start:env
```

Dann <http://localhost:8787> öffnen. Der Server liefert die Website gleich mit aus. Das Mikrofon funktioniert auf `localhost` und auf `https`-Seiten.

Prüfen, ob alles verbunden ist:

```bash
curl http://localhost:8787/api/health
```

## Veröffentlichen

Kurzfassung (ausführlich in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)):

1. Repository auf GitHub anlegen und den Code hochladen.
2. **Backend** bei Render (oder ähnlich) starten. Die Datei `render.yaml` ist vorbereitet. Schlüssel nur im Dashboard eintragen. Dazu `ACCESS_CODE` und `ALLOWED_ORIGINS` setzen.
3. In GitHub unter *Settings, Pages* als Quelle „GitHub Actions“ wählen und unter *Settings, Secrets and variables, Actions, Variables* die Variable `AENDY_API_BASE` mit der Backend-Adresse anlegen.
4. Pushen. Der Workflow `.github/workflows/pages.yml` veröffentlicht die Website.
5. Auf dem iPhone in Safari öffnen, *Teilen, Zum Home-Bildschirm*. Siri-Kurzbefehl einrichten (Anleitung in den Einstellungen unter „Siri und Installation“).

> **Wichtig vor dem Veröffentlichen:** Das Foto in `frontend/img/andy.jpg` wird mit dem Repository und der Website öffentlich, sobald du beides veröffentlichst. Mach das Repository auf „private“ (GitHub Pages aus privaten Repos braucht einen bezahlten GitHub-Tarif), oder tausche das Bild aus, wenn du das nicht möchtest. Siehe [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#das-foto).

## Projektstruktur

```
aendy/
├─ frontend/                Website (statisch, direkt auf GitHub Pages lauffähig)
│  ├─ index.html, config.js, manifest.webmanifest, sw.js
│  ├─ css/app.css           Design
│  ├─ img/andy.jpg          Ändys Gesicht (Mikrofon-/Aktivierungstaste)
│  ├─ icons/                App-Symbole (aus dem Foto)
│  ├─ fonts/                Poppins (selbst gehostet, OFL)
│  └─ js/
│     ├─ main.js            Start, Einführung, Installation
│     ├─ assistant.js       Zentrale Steuerung (Zustände, Gespräch, KI)
│     ├─ speech-in.js       Spracherkennung (Browser oder Server)
│     ├─ speech-out.js      Sprachausgabe (Browser oder Server)
│     ├─ voice-profile.js   Männliche Stimme und Clown-Einschlag (Tonhöhe, Tempo)
│     ├─ wake.js            Weckwort-Erkennung (unscharfer Vergleich)
│     ├─ commands.js        Lokale Befehle („Ändy, Ruhe“, lauter, leiser …)
│     ├─ core-canvas.js     Lichtringe und Pegelanzeige um das Bild
│     ├─ scheduler.js       Timer, Erinnerungen, Wecker, Eigeninitiative
│     ├─ actions.js         Kalender, Navigation, Musik, Nachrichten (mit Zustimmung)
│     ├─ capabilities.js    Ehrliche Geräteübersicht
│     ├─ store.js           Lokaler Speicher (Verlauf/Gedächtnis nur freiwillig)
│     └─ ui.js, settings-ui.js, api.js, audio.js, platform.js, …
├─ backend/
│  ├─ src/server.js         HTTP-Server, Routen, statische Auslieferung
│  ├─ src/chat-loop.js      Gespräch und Werkzeug-Schleife (Streaming)
│  ├─ src/providers/        Anthropic und OpenAI-kompatibel (auch für Gemini)
│  ├─ src/tools.js          Werkzeuge (Suche, Wetter, Rechnen, Timer, Notizen …)
│  ├─ src/persona.js        Ändys Persönlichkeit (System-Prompt)
│  ├─ src/security.js       Zugangscode, CORS, Ratenbegrenzung
│  └─ .env.example          Konfigurationsvorlage (ohne Geheimnisse)
├─ tests/                   Unit- und Browser-Tests
├─ docs/                    Konfiguration, API, Deployment, Plattformen, Datenschutz
├─ .github/workflows/       Tests und GitHub-Pages-Veröffentlichung
├─ Dockerfile, render.yaml
└─ LICENSE
```

## Tests

```bash
npm test            # Unit-Tests und Server-Tests mit Mock-KI (keine Schlüssel nötig)
npm run test:e2e    # Browser-Test mit Chromium (benötigt: npm i -D playwright)
```

- Die **Server-Tests** starten das echte Backend gegen einen Mock der KI-, Wetter- und Suchdienste.
- Die **Browser-Tests** (`tests/e2e/flow.cjs`) laden die echte Website in Chromium mit simulierter Spracherkennung und Sprachausgabe und prüfen Gespräch, Weckwort, Unterbrechen, Timer/Wecker, Karten, Einstellungen, Speicher und Layout auf Handy, Tablet und Desktop.

**Ehrlicher Teststatus:** Die Verbindung zu den echten KI-, Sprach- und Suchdiensten wurde ohne echte Schlüssel gegen Mocks getestet. Das Verhalten auf echten iPhones und Android-Geräten (Mikrofon, Siri, Sperrbildschirm) konnte nicht an echter Hardware geprüft werden. Mache nach dem Einrichten die Kurzprüfung in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#kurzprüfung-nach-dem-start).

## Weitere Dokumentation

- [docs/CONFIGURATION.md](docs/CONFIGURATION.md): alle Umgebungsvariablen
- [docs/API.md](docs/API.md): Schnittstellen des Backends
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md): GitHub Pages, Render, Docker, Kosten und Sicherheit
- [docs/PLATFORMS.md](docs/PLATFORMS.md): iPhone, Android, Desktop, Siri-Kurzbefehl, Grenzen
- [docs/PRIVACY.md](docs/PRIVACY.md): welche Daten wohin gehen

## Lizenz

MIT für den Code (siehe [LICENSE](LICENSE)). Das Foto und die daraus abgeleiteten Icons sind ausgenommen. Poppins steht unter der SIL Open Font License.
