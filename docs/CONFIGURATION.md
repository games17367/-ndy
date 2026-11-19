# Konfiguration

Das Backend liest ausschließlich **Umgebungsvariablen**. Lokal kommen sie aus `backend/.env` (Vorlage: `backend/.env.example`, gestartet mit `npm run start:env`), auf einem Hoster aus dessen Dashboard. Geheimnisse stehen nie im Code, nie im Frontend und nie im Repository.

## KI

| Variable | Standard | Bedeutung |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | – | Schlüssel für Anthropic. Aktiviert das Gespräch. |
| `ANTHROPIC_MODEL` | `claude-sonnet-5-5` | Modellname. |
| `GEMINI_API_KEY` | – | Schlüssel für Google Gemini (aus [Google AI Studio](https://aistudio.google.com)). Aktiviert das Gespräch über Googles OpenAI-kompatible Schnittstelle. Keine Server-Stimme. |
| `GEMINI_MODEL` | `gemini-3.8-flash` | Gemini-Modell. Passe es an, wenn Google das Modell umbenennt. |
| `OPENAI_API_KEY` | – | Schlüssel für eine OpenAI-kompatible Schnittstelle. Gespräch (falls kein Anthropic-Schlüssel), **Server-Spracherkennung und Server-Stimme**. |
| `OPENAI_CHAT_MODEL` | `gpt-4o-mini` | Modell für das Gespräch über OpenAI. |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | Eigene Adresse, z. B. für kompatible Dienste. |
| `OPENAI_STT_MODEL` | `gpt-4o-mini-transcribe` | Spracherkennung. |
| `OPENAI_TTS_MODEL` | `gpt-4o-mini-tts` | Sprachausgabe. |
| `OPENAI_TTS_VOICE` | `ash` | Standard-Stimme der Server-Sprachausgabe. |
| `SERVER_SPEECH` | automatisch | `true` oder `false`. Schaltet Server-Stimme und Server-Spracherkennung. Automatisch nur an, wenn die OpenAI-Adresse `api.openai.com` ist (bei Gemini & Co. aus). |
| `AI_PROVIDER` | automatisch | `anthropic`, `gemini` oder `openai`. Leer: Anthropic, wenn dessen Schlüssel gesetzt ist, sonst OpenAI, sonst Gemini. |
| `MAX_OUTPUT_TOKENS` | `700` | Obergrenze pro Antwort (Kosten und Länge). |

Ohne mindestens einen Schlüssel läuft der Server, antwortet aber auf `/api/chat` mit `503 no_provider`. Die Website zeigt dann einen Hinweis.

## Suche und Wetter

| Variable | Standard | Bedeutung |
| --- | --- | --- |
| `BRAVE_API_KEY` | – | Echte Websuche über Brave. Ohne Schlüssel sucht Ändy in der deutschen Wikipedia. |
| `WIKIPEDIA_BASE_URL` | `https://de.wikipedia.org` | Anderes Wikipedia. |
| `OPENMETEO_GEOCODING_URL`, `OPENMETEO_FORECAST_URL` | Open-Meteo | Das Wetter braucht keinen Schlüssel. |

## Sicherheit

| Variable | Standard | Bedeutung |
| --- | --- | --- |
| `ACCESS_CODE` | leer | Gemeinsamer Zugangscode. Wenn gesetzt, verlangt jede API-Anfrage den Header `x-aendy-code`. Du trägst ihn in der Website unter *Einstellungen, Verbindung* ein. **Dringend empfohlen**, sobald das Backend im Internet steht. |
| `ALLOWED_ORIGINS` | leer | Kommagetrennte Liste erlaubter Website-Adressen (CORS), z. B. `https://deinname.github.io`. Leer: nur die eigene Herkunft (Website und Backend auf demselben Server). `*` erlaubt alle (nicht empfohlen). Wichtig: Es steht **nur die Herkunft** drin (Schema und Host), kein Pfad. |
| `TRUST_PROXY` | `false` | Auf `true` setzen, wenn der Server hinter einem Proxy läuft (Render, Railway, Fly, Nginx), damit die Ratenbegrenzung die echte Besucher-IP sieht. Nicht setzen, wenn der Server direkt erreichbar ist (die IP ließe sich sonst fälschen). |
| `RATE_LIMIT_PER_MINUTE` | `40` | Anfragen pro Minute und IP. `0` schaltet ab. |
| `DAILY_REQUEST_CAP` | `3000` | Tageslimit insgesamt, schützt vor unerwarteten Kosten. `0` schaltet ab. |
| `MAX_BODY_BYTES` | `65536` | Größte erlaubte JSON-Anfrage. |
| `MAX_AUDIO_BYTES` | `8388608` | Größte Audioaufnahme für die Server-Spracherkennung. |
| `UPSTREAM_TIMEOUT_MS` | `45000` | Zeitlimit für Anfragen an KI- und Sprachdienste. |

Der Zugangscode ist ein **gemeinsames Passwort**: Wer ihn kennt, kann Ändy nutzen. Er liegt im Browser des Nutzers (in dessen lokalem Speicher). Er schützt vor Fremden, die deine Adresse zufällig finden, ersetzt aber keine Benutzerkonten. Lege für Gäste ggf. einen anderen Code fest und ändere ihn bei Bedarf.

## Betrieb

| Variable | Standard | Bedeutung |
| --- | --- | --- |
| `PORT` | `8787` | Port. Hoster setzen ihn meist selbst. |
| `HOST` | `0.0.0.0` | Netzwerkadresse. Lokal nur für dich: `127.0.0.1`. |
| `SERVE_FRONTEND` | `true` | Der Server liefert `frontend/` mit aus. Auf `false`, wenn die Website nur auf GitHub Pages liegt. |
| `FRONTEND_DIR` | `../frontend` | Anderer Ordner für die Website. |

## Website (`frontend/config.js`)

```js
window.AENDY_CONFIG = { apiBase: '' };
```

- `apiBase: ''`: Das Backend liefert die Website selbst aus (gleicher Server).
- `apiBase: 'https://aendy.onrender.com'`: Backend liegt woanders (z. B. bei GitHub Pages). Bei GitHub Pages schreibt der Workflow den Wert aus der Repository-Variable `AENDY_API_BASE` in diese Datei. Die Datei enthält **keine Geheimnisse**.
- Nutzer können die Adresse zusätzlich in den Einstellungen unter „Verbindung“ ändern.

## Einstellungen in der Website

Alle weiteren Einstellungen (Stimme, Geschwindigkeit, Lautstärke, Humorgrad, Frechheitsmodus, Aktivierung, Verlauf, Gedächtnis, Eigeninitiative, Ruhezeiten, Datenschutz) liegen im Browser des Nutzers und werden über das Zahnrad geändert. Standardwerte: Humor 70, Frechheitsmodus aus, Verlauf und Gedächtnis aus, Eigeninitiative aus.
