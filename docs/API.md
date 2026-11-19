# Schnittstellen des Backends

Alle Pfade beginnen mit `/api/`. Fehler kommen als JSON: `{ "error": { "code": "...", "message": "..." } }` mit passendem HTTP-Status. Ist `ACCESS_CODE` gesetzt, schicke bei jeder Anfrage (außer dem Health-Check) den Header `x-aendy-code`.

## `GET /api/health`

Status und Funktionen. Funktioniert auch ohne Zugangscode (dann ohne `capabilities`).

```json
{
  "ok": true, "name": "aendy", "version": "1.2.0",
  "accessRequired": false, "authorized": true,
  "capabilities": {
    "chat": true, "provider": "anthropic", "model": "claude-sonnet-5-5",
    "stt": false, "tts": false, "ttsVoices": [],
    "search": "wikipedia", "weather": true
  }
}
```

## `POST /api/chat`

Das Gespräch, als **Server-Sent Events** gestreamt (`content-type: text/event-stream`).

Anfrage (JSON):

```json
{
  "messages": [{ "role": "user", "content": "Wie wird das Wetter in Wien?" }],
  "settings": { "humor": 70, "cheeky": false, "length": "normal", "dialect": "standard",
                "address": "du", "userName": "", "customInstruction": "", "memoryEnabled": false },
  "context":  { "now": "2026-11-18T21:00", "tz": "Europe/Vienna", "locale": "de-AT", "platform": "iPhone",
                "coords": null, "state": { "timers": [], "reminders": [], "notes": [] } },
  "memory":   ["Hat einen Hund namens Bruno"]
}
```

Der Server prüft und kürzt alle Felder (Länge, Typ, Anzahl). `messages` muss mit einer Nutzernachricht enden. Es zählen höchstens die letzten Nachrichten des Verlaufs.

Ereignisse der Antwort:

| Ereignis | Daten | Bedeutung |
| --- | --- | --- |
| `text` | `{ "delta": "…" }` | Ein Stück der Antwort (zum sofortigen Vorlesen). |
| `status` | `{ "phase": "tool", "name": "get_weather" }` | Ändy nutzt gerade ein Server-Werkzeug (Suche, Wetter, Rechnen). |
| `card` | `{ "type": "weather", "data": { … } }` | Daten für eine Karte auf dem Bildschirm. |
| `action` | `{ "id": "…", "name": "set_timer", "input": { … } }` | Aktion, die **der Browser** ausführt (Timer, Notiz, Erinnerung, Kalender, Navigation, Musik, Nachricht, Link, Einstellung, Gedächtnis). Kalender, Navigation, Musik, Nachricht und Link werden dem Nutzer erst zur Bestätigung gezeigt. |
| `done` | `{ "text": "…", "usage": { … } }` | Fertig, mit dem vollständigen Antworttext. |
| `error` | `{ "code": "…", "message": "…" }` | Fehler mitten im Gespräch. |

Der Server führt **Server-Werkzeuge** selbst aus (`web_search`, `get_weather`, `calculate`) und füttert das Ergebnis der KI zurück. **Browser-Werkzeuge** bekommt die KI als „vorbereitet, wartet auf Bestätigung“ zurückgemeldet. So behauptet Ändy nicht, etwas sei erledigt, was der Nutzer noch bestätigen muss. Maximal 5 Werkzeugrunden pro Anfrage.

Werkzeuge der KI: `web_search`, `get_weather`, `calculate`, `set_timer`, `cancel_timer`, `add_reminder`, `delete_reminder`, `create_note`, `delete_note`, `create_calendar_event`, `start_navigation`, `play_music`, `compose_message`, `open_url`, `set_setting`, dazu bei eingeschaltetem Gedächtnis `remember_fact` und `forget_fact`. Die Beschreibungen stehen in `backend/src/tools.js`.

Beispiel:

```bash
curl -N http://localhost:8787/api/chat \
  -H 'content-type: application/json' \
  -d '{"messages":[{"role":"user","content":"Erzähl einen Witz über Wiener Linien"}]}'
```

## `GET /api/weather`

Wetter ohne KI. Parameter: `city=Wien` oder `lat=48.2&lon=16.37`.

## `POST /api/stt?lang=de` (optional)

Server-Spracherkennung. Der Body ist die rohe Audioaufnahme (z. B. `audio/webm`, `audio/mp4`), `content-type` entsprechend. Antwort: `{ "text": "…" }`. Braucht `OPENAI_API_KEY`, sonst `501 no_stt`. Größe begrenzt durch `MAX_AUDIO_BYTES`.

## `POST /api/tts` (optional)

Server-Sprachausgabe. JSON `{ "text": "…", "voice": "ash", "speed": 1.0, "style": "clown", "intensity": 35 }`. `style` ist `natural` (Standard) oder `clown`, `intensity` (0 bis 100) bestimmt den Clown-Anteil. Beides wirkt bei Modellen mit Betonungsanweisung wie `gpt-4o-mini-tts`. Antwort: `audio/mpeg`, gestreamt. Text bis 1200 Zeichen, Tempo 0,6 bis 1,6. Stimmen: `alloy, ash, ballad, coral, echo, fable, nova, onyx, sage, shimmer, verse`. Braucht `OPENAI_API_KEY`, sonst `501 no_tts`.

## Fehlercodes

| Status | Code | Bedeutung |
| --- | --- | --- |
| 400 | `bad_json`, `bad_messages`, `empty` | Ungültige Anfrage |
| 401 | `bad_code` | Zugangscode fehlt oder falsch |
| 403 | `origin` | Herkunft nicht in `ALLOWED_ORIGINS` |
| 413 | `too_large` | Anfrage zu groß |
| 415 | `bad_audio` | Audioformat nicht unterstützt |
| 429 | `rate_limited`, `daily_cap` | Zu viele Anfragen / Tageslimit |
| 501 | `no_stt`, `no_tts` | Funktion nicht eingerichtet |
| 502 | `weather_failed`, `stt_failed`, `tts_failed`, … | Ein Dienst im Hintergrund ist ausgefallen |
| 503 | `no_provider` | Kein KI-Schlüssel eingerichtet |

## Statische Website

Ist `SERVE_FRONTEND=true`, liefert der Server alles außerhalb von `/api/` aus dem Ordner `frontend/` aus, mit `nosniff`, Content-Security-Policy und Schutz gegen Pfad-Tricks (`../`).
