# Veröffentlichen

Ändy besteht aus **Website** (`frontend/`) und **Backend** (`backend/`). GitHub Pages kann nur die Website hosten, das Backend braucht einen Server. Es gibt zwei Wege.

| Weg | Wann | Aufwand |
| --- | --- | --- |
| **A. Alles auf einem Server** (Backend liefert die Website mit aus) | Einfachster Weg, ein Link für alles | gering |
| **B. Website auf GitHub Pages, Backend separat** | Wenn die Website bei GitHub liegen soll | mittel |

In beiden Fällen gilt: **API-Schlüssel nur als Umgebungsvariablen beim Backend-Hoster**, nie im Repository.

## 1. Code auf GitHub bringen

```bash
cd aendy
git init
git add .
git status          # kontrollieren: keine .env, keine Schlüssel
git commit -m "ÄNDY"
git branch -M main
git remote add origin https://github.com/DEINNAME/aendy.git
git push -u origin main
```

`.gitignore` schließt `.env`-Dateien aus. Prüfe trotzdem mit `git status`, dass keine Datei mit Schlüsseln dabei ist.

### Das Foto

`frontend/img/andy.jpg` (und die Icons in `frontend/icons/`) zeigen dein Foto. In einem **öffentlichen** Repository und auf GitHub Pages kann es jeder sehen und herunterladen, auch wenn du die Adresse nie weitergibst. Mögliche Wege:

- Repository auf **privat** stellen. GitHub Pages aus privaten Repositories braucht einen bezahlten GitHub-Tarif. Alternativ den Weg A mit privatem Repository nutzen: Der Hoster (z. B. Render) liest das private Repo, und die Website ist unter seiner Adresse erreichbar. Auch dann ist sie für jeden mit dem Link sichtbar, solange du den Zugang nicht beschränkst.
- Oder das Bild bewusst veröffentlichen, wenn du das möchtest.
- Oder durch ein anderes Bild ersetzen: Datei `frontend/img/andy.jpg` austauschen (Hochformat, ca. 4:5 wirkt am besten) und die Icons neu erzeugen (siehe unten).

Hinweis: Die Website ist durch den `ACCESS_CODE` nicht verborgen, geschützt wird nur das Backend (also die Kosten und die KI).

### Icons neu erzeugen

Die App-Symbole sind quadratische Ausschnitte des Fotos. Bei einem neuen Bild kannst du sie mit Python und Pillow selbst erzeugen: Ausschnitt wählen, auf 512, 192, 180 (`apple-touch-icon.png`), 32 und 16 Pixel verkleinern und für `icon-maskable-512.png` rund 12 % dunklen Rand lassen.

## Weg A: Alles auf einem Server (Render)

1. Auf <https://render.com> anmelden, *New, Blueprint*, dein GitHub-Repository wählen. Render liest `render.yaml`.
2. Im Dashboard beim Dienst *Environment* öffnen und eintragen:
   - `ANTHROPIC_API_KEY` (oder `GEMINI_API_KEY` oder `OPENAI_API_KEY`)
   - `ACCESS_CODE` (ein langes, zufälliges Passwort)
   - optional `BRAVE_API_KEY`, `OPENAI_API_KEY` für Server-Stimme und -Spracherkennung
   - `ALLOWED_ORIGINS` kann leer bleiben, solange die Website vom selben Server kommt.
3. Warten, bis der Dienst läuft, dann die Adresse (z. B. `https://aendy.onrender.com`) öffnen.
4. Beim ersten Start in den Einstellungen unter *Verbindung* den Zugangscode eintragen.

Der kostenlose Render-Tarif schläft nach einiger Zeit ein. Die erste Anfrage danach dauert dann einige Sekunden bis zu einer Minute. Für ein flottes Gefühl lohnt sich ein bezahlter Tarif oder ein anderer Hoster.

Anderer Hoster oder eigener Server: Docker (`docker build -t aendy . && docker run -p 8787:8787 --env-file backend/.env aendy`) oder direkt `node backend/src/server.js` mit gesetzten Umgebungsvariablen. Vor das Ganze gehört **HTTPS** (Caddy, Nginx, Cloudflare Tunnel oder der Hoster erledigt es). Ohne HTTPS gibt es auf Handys kein Mikrofon.

## Weg B: Website auf GitHub Pages, Backend separat

1. **Backend** wie in Weg A bei einem Hoster starten, aber:
   - `SERVE_FRONTEND=false` (optional),
   - `ALLOWED_ORIGINS=https://DEINNAME.github.io` (nur Herkunft, ohne Pfad und ohne Schrägstrich am Ende),
   - `ACCESS_CODE` setzen.
2. In GitHub: *Settings, Secrets and variables, Actions, Variables, New repository variable*: Name `AENDY_API_BASE`, Wert die Backend-Adresse (`https://aendy.onrender.com`, nur `https`).
3. In GitHub: *Settings, Pages, Build and deployment, Source: GitHub Actions*.
4. Auf `main` pushen (oder den Workflow *Website veröffentlichen* unter *Actions* manuell starten). Der Workflow schreibt die Backend-Adresse in `frontend/config.js` und veröffentlicht den Ordner `frontend/`.
5. Die Website liegt unter `https://DEINNAME.github.io/aendy/`. Dort in den Einstellungen unter *Verbindung* den Zugangscode eintragen.

Alle Pfade in der Website sind relativ, deshalb funktioniert sie auch unter dem Unterpfad `/aendy/`.

## Warum braucht Ändy einen Server, und was kostet das?

**Warum:** Die Website allein (GitHub Pages) kann nur Dateien ausliefern. Das Denken übernimmt ein KI-Dienst, und dafür braucht es einen **API-Schlüssel**. Der darf nicht in die Website, weil jeder ihn dort auslesen könnte. Darum gibt es das Backend: Es hält den Schlüssel geheim und fragt die KI für dich. Siehst du in Ändy die Meldung „kein Ändy-Server“ oder früher „404“, fehlt genau dieses Backend oder seine Adresse in den Einstellungen unter *Verbindung*.

**Was kostenlos ist und was nicht** (Stand November 2026, Preise ändern sich, prüfe die Seiten der Anbieter):

| Baustein | Kosten |
| --- | --- |
| Website auf GitHub Pages | kostenlos (öffentliche Repositories) |
| Backend auf Render, Tarif „Free“ | kostenlos, mit Grenzen: schläft nach 15 Minuten ohne Besuch ein, der Neustart dauert etwa eine Minute, 750 Stunden pro Monat ([Render](https://render.com/docs/free)) |
| **KI-Antworten** | **Nicht kostenlos bei Anthropic und OpenAI**: Abrechnung pro Nutzung. Ein Claude-Abo oder der kostenlose Claude-Zugang enthält **keinen** API-Schlüssel. Den holst du extra in der Entwicklerkonsole. |
| Server-Stimme und -Spracherkennung (optional) | kostenpflichtig bei OpenAI. Ohne sie nutzt Ändy Stimme und Erkennung deines Geräts, das ist kostenlos. |
| Websuche | kostenlos über Wikipedia, Brave nur optional |
| Wetter | kostenlos (Open-Meteo) |

**Grobe Größenordnung bei Anthropic** ([Preisliste](https://platform.claude.com/docs/en/about-claude/pricing)): Claude Haiku 5.5 kostet 0,10 US-Dollar pro Million Eingabe-Token und 0,50 US-Dollar pro Million Ausgabe-Token, Claude Sonnet 5.5 kostet 2 beziehungsweise 10 US-Dollar. Ein kurzer Sprachaustausch hat etwa 1.500 Eingabe- und 150 Ausgabe-Token. Das ergibt grob **0,02 Cent mit Haiku** und **0,5 Cent mit Sonnet** pro Frage. Das ist eine Schätzung von mir, keine Garantie. Ändy nutzt standardmäßig Sonnet. Für den Alltag spart `ANTHROPIC_MODEL=claude-haiku-5-5` viel Geld. Setze beim Anbieter ein **Ausgabenlimit** und nutze `DAILY_REQUEST_CAP`.

## Woher bekomme ich einen API-Schlüssel?

Du brauchst **einen** der drei. Der Schlüssel kommt nur ins Backend (Render-Dashboard oder `backend/.env`), nie in die Website und nie ins Repository.

| Anbieter | Wo | Kosten |
| --- | --- | --- |
| **Google Gemini** | [aistudio.google.com](https://aistudio.google.com), mit Google-Konto anmelden, *Get API key*, *Create API key*. Kopieren und als `GEMINI_API_KEY` eintragen. | Kostenloser Tarif mit Mengenbegrenzung, keine Kreditkarte nötig. |
| **Anthropic (Claude)** | [platform.claude.com/settings/keys](https://platform.claude.com/settings/keys), *Create Key*. Der Schlüssel beginnt mit `sk-ant-` und wird nur **einmal** angezeigt. Vorher Guthaben aufladen. | Bezahlt pro Nutzung. Ein Claude-Abo oder der kostenlose Chat enthält keinen Schlüssel. |
| **OpenAI** | [platform.openai.com](https://platform.openai.com), Bereich *API keys*. | Bezahlt pro Nutzung. Nur damit gibt es Server-Stimme und Server-Spracherkennung. |

**Ja, Gemini geht.** In `backend/.env` oder im Render-Dashboard genügt:

```
GEMINI_API_KEY=<dein Schlüssel aus Google AI Studio>
# GEMINI_MODEL=gemini-3.8-flash   (nur ändern, wenn Google das Modell umbenennt)
```

Ändy spricht dann über Googles OpenAI-kompatible Schnittstelle mit Gemini. Hinweise, die du kennen solltest (Stand November 2026, nicht von mir mit einem echten Schlüssel getestet):

- Beim kostenlosen Gemini-Tarif dürfen Eingaben laut Google zur Produktverbesserung genutzt werden. Prüfe die Bedingungen, bevor du private Dinge fragst, und ob der kostenlose Zugang in deinem Land verfügbar ist.
- Gemini bietet über diese Schnittstelle keine Server-Stimme. Ändy nutzt dann die Stimme deines Geräts (männlich mit Clown-Einschlag, soweit das Gerät es hergibt). Die Server-Stimme mit dem stärksten Clown-Klang gibt es nur mit OpenAI-Schlüssel.
- Ob Werkzeuge wie Timer, Wetter und Websuche mit Gemini genauso zuverlässig laufen wie mit Claude, habe ich nicht geprüft.
- Ist der Modellname veraltet, meldet Ändy einen Fehler vom Anbieter. Dann den aktuellen Namen in AI Studio nachsehen und `GEMINI_MODEL` setzen.

## Kurzprüfung nach dem Start

Ändy wurde in der Entwicklung nur gegen Mock-Dienste getestet. Prüfe deshalb einmal selbst mit deinen echten Schlüsseln:

1. `curl https://DEINE-ADRESSE/api/health`: erwartet `"ok": true` und `"chat": true`.
2. Website öffnen, ins Textfeld „Hallo“ schreiben: Es muss eine Antwort kommen.
3. Fragen: „Wie ist das Wetter in Wien?“ (Wetterkarte), „Stell einen Timer auf 10 Sekunden“, „Rechne 12 mal 7“.
4. Aufs Bild tippen, Mikrofon erlauben, „Sarvus Ändy, wie spät ist es?“ sagen.
5. Auf dem Handy: Seite zum Home-Bildschirm legen und den Siri-Kurzbefehl einrichten (siehe [PLATFORMS.md](PLATFORMS.md)).

Wenn etwas hakt, zeigen die Einstellungen unter *Verbindung* den Zustand des Servers und der Funktionen.

## Kosten und Schutz

- Jede Antwort kostet bei deinem KI-Anbieter Geld. Setze dort ein **Ausgabenlimit**.
- `ACCESS_CODE`, `RATE_LIMIT_PER_MINUTE` und `DAILY_REQUEST_CAP` schützen dich vor Missbrauch. Behalte den Code für dich.
- Server-Stimme (`/api/tts`) und Server-Spracherkennung (`/api/stt`) sind kostenpflichtig beim Anbieter. Ohne `OPENAI_API_KEY` sind sie aus, und Ändy nutzt Stimme und Erkennung des Geräts.
- Schlüssel, die versehentlich im Repository gelandet sind, sofort beim Anbieter widerrufen und neu erzeugen. Löschen im Git-Verlauf reicht nicht.

## Aktualisieren

Neue Version pushen. Der Service Worker (`frontend/sw.js`) erkennt die neue Version (`VERSION` erhöhen, wenn du Dateien änderst) und lädt sie beim nächsten Öffnen. Das Backend baut der Hoster automatisch neu.
