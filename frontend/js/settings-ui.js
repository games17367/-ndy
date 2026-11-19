// Einstellungsbereich. Baut alle Bereiche aus einer Beschreibung und bindet sie an den Store.

import { CLOUD_VOICE_LABELS } from './voice-profile.js';
import { el, $ } from './ui.js';
import { icon } from './icons.js';
import { platform, browserSpeechRecognitionUsable } from './platform.js';
import { evaluateActivation, STATUS_LABEL } from './capabilities.js';
import { requestNotificationPermission } from './scheduler.js';

const HUMOR_LABELS = [
  [15, 'trocken'],
  [45, 'unterhaltsam'],
  [75, 'richtig witzig'],
  [101, 'Comedy-Motor'],
];
const humorText = (v) => HUMOR_LABELS.find(([max]) => v < max)[1];

export class SettingsUI {
  /**
   * @param {{store: import('./store.js').Store, assistant: import('./assistant.js').Assistant,
   *          speaker: import('./speech-out.js').Speaker, ui: import('./ui.js').UI,
   *          getInstallPrompt: () => any}} deps
   */
  constructor({ store, assistant, speaker, ui, getInstallPrompt }) {
    this.store = store;
    this.assistant = assistant;
    this.speaker = speaker;
    this.ui = ui;
    this.getInstallPrompt = getInstallPrompt;
    this.opened = false;
    this.dynamic = {};
    $('#settings-close').addEventListener('click', () => this.close());
    this.store.on('facts', () => this.opened && this.#renderFacts());
    this.assistant.on('caps', () => this.opened && this.#refreshStatuses());
    this.assistant.on('mic', () => this.opened && this.#refreshStatuses());
    if (platform.hasSpeechSynthesis) speechSynthesis.addEventListener?.('voiceschanged', () => this.opened && this.#fillVoices());
  }

  open(section) {
    if (!this.opened) {
      this.#render();
      this.opened = true;
    }
    $('#settings').hidden = false;
    $('#btn-settings').setAttribute('aria-expanded', 'true');
    if (section) this.#scrollTo(section);
    $('#settings-close').focus();
  }

  close() {
    $('#settings').hidden = true;
    this.opened = false;
    $('#btn-settings').focus();
  }

  // ======================================================================
  // Bausteine
  // ======================================================================

  #row({ label, hint, control, stack = false }) {
    return el(
      'div',
      { class: `row${stack ? ' stack' : ''}` },
      el('span', { class: 'row-label', text: label }),
      el('div', { class: 'row-control' }, control),
      hint ? el('span', { class: 'row-hint', text: hint }) : null
    );
  }

  #toggle(key, label, hint, { onChange } = {}) {
    const input = el('input', { type: 'checkbox', role: 'switch', 'aria-label': label });
    input.checked = Boolean(this.store.settings[key]);
    input.addEventListener('change', () => {
      this.store.set(key, input.checked);
      onChange?.(input.checked);
    });
    this.store.on('setting', (k) => {
      if (k === key && input.isConnected) input.checked = Boolean(this.store.settings[key]);
    });
    return this.#row({ label, hint, control: el('label', { class: 'switch' }, input, el('span', { class: 'knob' })) });
  }

  #range(key, label, { min, max, step, format = (v) => String(v), hint } = {}) {
    const input = el('input', { class: 'range', type: 'range', min, max, step, 'aria-label': label });
    const out = el('span', { class: 'row-value' });
    const paint = () => {
      const v = Number(input.value);
      out.textContent = format(v);
      input.style.setProperty('--pct', `${((v - min) / (max - min)) * 100}%`);
    };
    input.value = String(this.store.settings[key]);
    paint();
    input.addEventListener('input', () => {
      paint();
      this.store.set(key, Number(input.value));
    });
    this.store.on('setting', (k) => {
      if (k === key && input.isConnected && Number(input.value) !== this.store.settings[key]) {
        input.value = String(this.store.settings[key]);
        paint();
      }
    });
    return this.#row({ label, hint, stack: true, control: [input, out] });
  }

  #select(key, label, options, hint, { nullable = false } = {}) {
    const select = el('select', { class: 'select', 'aria-label': label });
    for (const [value, text, disabled] of options) {
      select.append(el('option', { value: String(value), text, disabled: disabled || undefined }));
    }
    const cur = this.store.settings[key];
    select.value = cur === null && nullable ? 'auto' : String(cur);
    select.addEventListener('change', () => {
      const v = select.value;
      this.store.set(key, nullable ? (v === 'auto' ? null : v === 'true') : v);
    });
    return this.#row({ label, hint, control: select });
  }

  #text(key, label, { type = 'text', placeholder = '', hint, multiline = false, maxlength = 100, autocomplete = 'off' } = {}) {
    const input = multiline
      ? el('textarea', { 'aria-label': label, placeholder, maxlength, rows: 3 })
      : el('input', { class: 'text', type, 'aria-label': label, placeholder, maxlength, autocomplete, spellcheck: 'false' });
    input.value = this.store.settings[key] || '';
    input.addEventListener('change', () => this.store.set(key, input.value));
    return this.#row({ label, hint, stack: true, control: input });
  }

  #time(key, label, hint) {
    const input = el('input', { class: 'time', type: 'time', 'aria-label': label });
    input.value = this.store.settings[key];
    input.addEventListener('change', () => {
      if (input.value) this.store.set(key, input.value);
    });
    return this.#row({ label, hint, control: input });
  }

  #button(text, onClick, cls = 'pill') {
    return el('button', { class: cls, type: 'button', text, onclick: onClick });
  }

  /** Zweistufiger Knopf für Löschen – verhindert versehentliche Klicks. */
  #dangerButton(text, confirmText, onConfirm) {
    const btn = el('button', { class: 'pill pill-danger', type: 'button', text });
    let timer = null;
    btn.addEventListener('click', () => {
      if (btn.dataset.armed === '1') {
        clearTimeout(timer);
        btn.dataset.armed = '';
        btn.textContent = text;
        onConfirm();
        return;
      }
      btn.dataset.armed = '1';
      btn.textContent = confirmText;
      timer = setTimeout(() => {
        btn.dataset.armed = '';
        btn.textContent = text;
      }, 4000);
    });
    return btn;
  }

  #status(id, text, tone = '') {
    const node = el('p', { class: 'status', id: `st-${id}`, dataset: { tone }, text });
    return node;
  }

  #group(id, title, lead, ...children) {
    return el('section', { class: 'set-group', id: `set-${id}` }, el('h3', { text: title }), lead ? el('p', { class: 'lead', text: lead }) : null, ...children);
  }

  // ======================================================================
  // Aufbau
  // ======================================================================

  #render() {
    const s = this.store;
    const a = this.assistant;
    const sections = [];

    // ---- Stimme -----------------------------------------------------
    const voiceSelect = el('select', { class: 'select', id: 'voice-uri', 'aria-label': 'Stimme des Geräts' });
    voiceSelect.addEventListener('change', () => s.set('voiceURI', voiceSelect.value));
    this.dynamic.voiceSelect = voiceSelect;
    const cloudVoice = el('select', { class: 'select', id: 'cloud-voice', 'aria-label': 'Server-Stimme' });
    cloudVoice.addEventListener('change', () => s.set('cloudVoice', cloudVoice.value));
    this.dynamic.cloudVoice = cloudVoice;

    sections.push({
      id: 'voice',
      title: 'Stimme',
      node: this.#group(
        'voice',
        'Stimme',
        'So klingt Ändy. Die Server-Stimme klingt am natürlichsten, die Stimme deines Geräts funktioniert immer.',
        this.#select('voiceGender', 'Stimmlage', [
          ['male', 'Männlich'],
          ['female', 'Weiblich'],
          ['any', 'Egal'],
        ], 'Ändy ist standardmäßig männlich. Fehlt deinem Gerät eine männliche Stimme, senkt Ändy die vorhandene tiefer.'),
        this.#select('voiceCharacter', 'Charakter der Stimme', [
          ['clown', 'Ein bisschen Clown'],
          ['natural', 'Natürlich'],
        ], 'Mit der Server-Stimme klingt der Clown-Einschlag am besten. Die Stimme deines Geräts kann nur Tonhöhe und Tempo anpassen.'),
        this.#range('clownLevel', 'Clown-Anteil', {
          min: 0,
          max: 100,
          step: 5,
          format: (v) => (v === 0 ? 'aus' : v < 34 ? 'dezent' : v < 67 ? 'spürbar' : 'kräftig'),
          hint: 'Standard: ein bisschen, nicht zu sehr.',
        }),
        this.#select('voiceEngine', 'Stimmen-Quelle', [
          ['auto', 'Automatisch (beste verfügbare)'],
          ['browser', 'Stimme dieses Geräts'],
          ['cloud', 'Server-Stimme (natürlicher)'],
        ]),
        this.#row({ label: 'Stimme dieses Geräts', hint: 'Deutsche Stimmen deines Browsers. „Automatisch“ wählt die natürlichste.', control: voiceSelect }),
        this.#row({ label: 'Server-Stimme', hint: 'Nur verfügbar, wenn der Server Sprachausgabe anbietet.', control: cloudVoice }),
        this.#range('speechRate', 'Sprechgeschwindigkeit', { min: 0.6, max: 1.6, step: 0.05, format: (v) => `${v.toFixed(2).replace('.', ',')}×` }),
        this.#range('volume', 'Lautstärke', { min: 0, max: 1, step: 0.05, format: (v) => `${Math.round(v * 100)} %` }),
        this.#toggle('lively', 'Lebendige Betonung', 'Ändy variiert Tempo und Tonhöhe leicht von Satz zu Satz, damit er nicht monoton klingt.'),
        el('div', { class: 'row-actions' }, this.#button('Stimme testen', () => this.speaker.test()))
      ),
    });

    // ---- Persönlichkeit ---------------------------------------------
    sections.push({
      id: 'personality',
      title: 'Persönlichkeit',
      node: this.#group(
        'personality',
        'Persönlichkeit',
        'Wie Ändy tickt. Bei ernsten Themen schaltet er den Humor von selbst ab.',
        this.#range('humor', 'Humorgrad', { min: 0, max: 100, step: 5, format: humorText }),
        this.#toggle('cheeky', 'Frechheitsmodus', 'Ändy darf dich aufziehen, sarkastisch sein und freche Diskussionen anfangen. Nie verletzend.'),
        this.#select('length', 'Länge der Antworten', [
          ['short', 'Kurz'],
          ['normal', 'Normal'],
          ['long', 'Ausführlich'],
        ]),
        this.#select('dialect', 'Sprachstil', [
          ['standard', 'Hochdeutsch'],
          ['austrian', 'Österreichisch angehaucht'],
        ]),
        this.#select('address', 'Anrede', [
          ['du', 'Du'],
          ['sie', 'Sie'],
        ]),
        this.#text('userName', 'Dein Name', { placeholder: 'Wie soll Ändy dich nennen?', maxlength: 40, autocomplete: 'given-name' }),
        this.#text('customInstruction', 'Eigene Wünsche an Ändys Stil', {
          multiline: true,
          maxlength: 600,
          placeholder: 'z. B. „Mach öfter Wortspiele mit Kaffee.“',
          hint: 'Ändys Grundregeln (Ehrlichkeit, Sicherheit) bleiben bestehen.',
        }),
        this.#toggle('aiGreeting', 'Begrüßung von der KI schreiben lassen', 'Jede Begrüßung ist neu und passt zur Situation. Dauert etwas länger als die sofortige Begrüßung.')
      ),
    });

    // ---- Aktivierung & Gespräch ---------------------------------------
    sections.push({
      id: 'activation',
      title: 'Aktivierung',
      node: this.#group(
        'activation',
        'Aktivierung und Gespräch',
        'So weckst du Ändy und wie das Gespräch abläuft.',
        this.#status('activation', ''),
        this.#select('activation', 'Aktivierung', [
          ['wake', 'Weckwort „Sarvus Ändy“ und Taste'],
          ['button', 'Nur per Taste'],
        ]),
        this.#toggle('wakeLoose', 'Auch „Hey Ändy“ und „Hallo Ändy“', 'Weckt Ändy leichter, kann aber auch öfter versehentlich auslösen.'),
        this.#select('sttEngine', 'Spracherkennung', [
          ['auto', 'Automatisch'],
          ['browser', 'Browser (kostenlos, Weckwort möglich)'],
          ['server', 'Server (funktioniert fast überall, nur per Taste)'],
        ]),
        this.#select('lang', 'Sprache und Region', [
          ['de-DE', 'Deutsch (Deutschland)'],
          ['de-AT', 'Deutsch (Österreich)'],
          ['de-CH', 'Deutsch (Schweiz)'],
        ]),
        this.#select(
          'bargeIn',
          'Ändy beim Sprechen unterbrechen',
          [
            ['auto', 'Automatisch (am Computer an, am Handy aus)'],
            ['true', 'Per Sprache möglich'],
            ['false', 'Nur per Tippen'],
          ],
          'Am Handy hört das Mikrofon sonst Ändys eigene Stimme. Mit Kopfhörern funktioniert die Spracherkennung besser.',
          { nullable: true }
        ),
        this.#range('pauseMs', 'Gesprächspause (Server-Spracherkennung)', { min: 500, max: 3000, step: 100, format: (v) => `${(v / 1000).toFixed(1).replace('.', ',')} s` }),
        this.#range('autoSleepMin', 'Automatisch schlafen nach Stille', { min: 0, max: 30, step: 1, format: (v) => (v === 0 ? 'nie' : `${v} min`) }),
        this.#toggle('keepScreenOn', 'Bildschirm im Gespräch anlassen', 'Verhindert, dass das Display während des Gesprächs ausgeht (wenn dein Browser das erlaubt).'),
        this.#toggle('sounds', 'Signaltöne', 'Kurzer Ton beim Wecken und Einschlafen.'),
        this.#toggle('speakTyped', 'Getippte Fragen laut beantworten', 'Sonst antwortet Ändy auf Getipptes nur im Text, solange kein Gespräch läuft.')
      ),
    });

    // ---- Funktionen --------------------------------------------------
    const notifStatus = this.#status('notif', '');
    const refreshNotif = () => {
      const p = typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
      notifStatus.textContent =
        p === 'granted'
          ? 'Benachrichtigungen sind erlaubt. Ändy meldet Timer und Erinnerungen auch, wenn der Tab im Hintergrund ist (die Seite muss geöffnet bleiben).'
          : p === 'denied'
          ? 'Benachrichtigungen sind in deinem Browser blockiert. Du kannst sie in den Seiteneinstellungen wieder erlauben.'
          : p === 'unsupported'
          ? 'Dieser Browser unterstützt keine Benachrichtigungen.'
          : 'Benachrichtigungen sind noch nicht erlaubt.';
      notifStatus.dataset.tone = p === 'granted' ? 'ok' : p === 'denied' ? 'bad' : '';
    };
    refreshNotif();
    sections.push({
      id: 'features',
      title: 'Funktionen',
      node: this.#group(
        'features',
        'Funktionen',
        'Ändy läuft im Browser und hat keine Handy-Rechte. Alles, was andere Apps oder Personen betrifft, bestätigst du zuerst.',
        this.#toggle('useLocation', 'Standort für Wetter und „hier“ verwenden', 'Dein Standort wird nur mit deinen Fragen an die KI gesendet, wenn das nötig ist, und nirgends gespeichert.'),
        this.#toggle('confirmAlways', 'Immer nachfragen', 'Auch Timer, Notizen und Erinnerungen musst du dann erst bestätigen.'),
        notifStatus,
        el(
          'div',
          { class: 'row-actions' },
          this.#button('Benachrichtigungen erlauben', async () => {
            await requestNotificationPermission();
            refreshNotif();
          })
        )
      ),
    });

    // ---- Eigeninitiative -----------------------------------------------
    sections.push({
      id: 'proactive',
      title: 'Eigeninitiative',
      node: this.#group(
        'proactive',
        'Eigeninitiative',
        'Ändy meldet sich nur, solange die Seite geöffnet ist, und nie in der Ruhezeit (Wecker und Timer ausgenommen).',
        this.#toggle('proactiveSpeakReminders', 'Erinnerungen laut ansagen', 'Sonst erscheint nur eine Karte mit Ton.'),
        this.#toggle('proactiveMorning', 'Lustige Morgenbegrüßung', 'Beim ersten Öffnen nach der eingestellten Uhrzeit.'),
        this.#time('morningTime', 'Uhrzeit der Morgenbegrüßung'),
        this.#toggle('proactiveOpen', 'Begrüßung bei Rückkehr', 'Wenn du nach mehr als drei Stunden wieder auftauchst.'),
        this.#time('quietFrom', 'Ruhezeit von', 'In dieser Zeit sagt Ändy von sich aus nichts.'),
        this.#time('quietTo', 'Ruhezeit bis')
      ),
    });

    // ---- Gedächtnis & Daten ---------------------------------------------
    const factsBox = el('div', { id: 'facts-box' });
    this.dynamic.facts = factsBox;
    sections.push({
      id: 'memory',
      title: 'Gedächtnis',
      node: this.#group(
        'memory',
        'Gedächtnis und Verlauf',
        'Beides ist freiwillig und bleibt auf diesem Gerät. Ohne Verlauf vergisst Ändy alles, sobald du die Seite schließt.',
        this.#toggle('saveHistory', 'Gesprächsverlauf auf diesem Gerät speichern', 'Ändy erinnert sich beim nächsten Öffnen an das letzte Gespräch.'),
        this.#toggle('memoryEnabled', 'Langzeitgedächtnis', 'Ändy darf sich dauerhaft Dinge merken, die du ihm erzählst (z. B. deinen Hund oder deinen Lieblingskaffee). Die gemerkten Dinge werden mit deinen Fragen an die KI gesendet.'),
        factsBox,
        el(
          'div',
          { class: 'row-actions' },
          this.#dangerButton('Verlauf löschen', 'Wirklich löschen?', () => {
            s.clearHistory();
            this.ui.toast('Verlauf gelöscht.');
          }),
          this.#dangerButton('Gedächtnis löschen', 'Wirklich löschen?', () => {
            s.clearFacts();
            this.ui.toast('Gedächtnis gelöscht.');
          })
        )
      ),
    });

    // ---- Datenschutz & Daten --------------------------------------------
    sections.push({
      id: 'privacy',
      title: 'Datenschutz',
      node: this.#group(
        'privacy',
        'Datenschutz',
        'Was wohin geht – ohne Kleingedrucktes.',
        this.#status('privacy', ''),
        el(
          'div',
          { class: 'row-actions' },
          this.#button('Meine Daten exportieren', () => this.#exportData()),
          this.#dangerButton('Alles zurücksetzen', 'Wirklich alles löschen?', () => {
            s.resetAll();
            this.ui.toast('Alle Daten dieses Geräts wurden gelöscht. Seite wird neu geladen.');
            setTimeout(() => location.reload(), 900);
          })
        )
      ),
    });

    // ---- Verbindung -----------------------------------------------------
    const connStatus = this.#status('conn', '');
    sections.push({
      id: 'connection',
      title: 'Verbindung',
      node: this.#group(
        'connection',
        'Verbindung',
        'Ändy denkt auf einem eigenen Server (Backend). Dort liegen die API-Schlüssel – niemals in dieser Website. Liegt die Website auf GitHub Pages, trägst du hier die Adresse deines Servers ein, zum Beispiel von Render. Ohne Server antwortet Ändy nicht.',
        this.#text('apiBase', 'Server-Adresse', {
          placeholder: 'leer = derselbe Server wie die Website',
          maxlength: 300,
          hint: 'Beispiel: https://aendy-backend.onrender.com',
        }),
        this.#text('accessCode', 'Zugangscode', { type: 'password', maxlength: 200, autocomplete: 'off', hint: 'Nur nötig, wenn dein Server mit einem Code geschützt ist.' }),
        connStatus,
        el(
          'div',
          { class: 'row-actions' },
          this.#button('Verbindung testen', async (e) => {
            const btn = e.currentTarget;
            btn.disabled = true;
            btn.textContent = 'Teste …';
            await a.refreshHealth();
            btn.disabled = false;
            btn.textContent = 'Verbindung testen';
            this.#refreshStatuses();
          })
        )
      ),
    });

    // ---- Siri & Installation --------------------------------------------
    const startUrl = new URL('./?start=1', location.href).toString();
    const installBtn = this.#button('Ändy installieren', async () => {
      const p = this.getInstallPrompt();
      if (!p) return;
      p.prompt();
      await p.userChoice.catch(() => {});
      installBtn.hidden = true;
    });
    installBtn.hidden = !this.getInstallPrompt();
    this.dynamic.installBtn = installBtn;
    sections.push({
      id: 'device',
      title: 'Dieses Gerät',
      node: this.#group(
        'device',
        `Aktivierung auf deinem ${platform.label()}`,
        'Ehrlich und ohne Beschönigung: Das geht hier, das geht nur eingeschränkt, und das geht nicht.',
        el('ul', { class: 'caps', id: 'cap-list' })
      ),
    });
    sections.push({
      id: 'shortcut',
      title: 'Siri und Installation',
      node: this.#group(
        'shortcut',
        'Siri-Kurzbefehl und Installation',
        'Eine Webseite kann im Hintergrund nicht dauerhaft lauschen. Dafür gibt es diese Wege, Ändy mit einem Handgriff zu starten.',
        el('h4', { text: 'iPhone: Ändy mit Siri starten', style: 'margin:1rem 0 .25rem;font-weight:500;font-size:.9375rem' }),
        el(
          'ol',
          { class: 'steps' },
          el('li', { text: 'Öffne die App „Kurzbefehle“ und tippe auf das Plus.' }),
          el('li', {}, 'Füge die Aktion „URL“ hinzu und trage diesen Link ein: ', el('code', { text: startUrl })),
          el('li', { text: 'Füge danach die Aktion „URLs öffnen“ hinzu.' }),
          el('li', { text: 'Nenne den Kurzbefehl „Sarvus Ändy“. Wenn Siri den Namen nicht versteht, nimm „Ändy“.' }),
          el('li', { text: 'Jetzt kannst du sagen: „Hey Siri, Sarvus Ändy“. Ändy öffnet sich und wartet auf einen Tipp zum Wecken. iOS verlangt diesen einen Tipp für das Mikrofon.' })
        ),
        el('h4', { text: 'Auf den Home-Bildschirm legen', style: 'margin:1rem 0 .25rem;font-weight:500;font-size:.9375rem' }),
        el(
          'ol',
          { class: 'steps' },
          el('li', { text: 'iPhone und iPad (Safari): Teilen-Symbol, dann „Zum Home-Bildschirm“.' }),
          el('li', { text: 'Android (Chrome): Menü, dann „App installieren“ oder „Zum Startbildschirm“. Langes Drücken auf das Symbol bietet die Abkürzung „Ändy wecken“.' }),
          el('li', { text: 'Windows und Mac (Chrome, Edge): Installieren-Symbol in der Adressleiste.' })
        ),
        el('p', { class: 'status', text: 'Hinweis: In der Homescreen-App auf dem iPhone steht die Browser-Spracherkennung nicht zur Verfügung. Dort nutzt Ändy die Server-Spracherkennung (wenn dein Server sie anbietet) oder du öffnest ihn in Safari.' }),
        el(
          'div',
          { class: 'row-actions' },
          this.#button('Link kopieren', async () => {
            try {
              await navigator.clipboard.writeText(startUrl);
              this.ui.toast('Link kopiert.');
            } catch {
              this.ui.toast('Kopieren nicht möglich. Markiere den Link von Hand.', 'warn');
            }
          }),
          installBtn
        )
      ),
    });

    // ---- Über -------------------------------------------------------------
    sections.push({
      id: 'about',
      title: 'Über Ändy',
      node: this.#group(
        'about',
        'Über Ändy',
        null,
        el('p', { class: 'status', text: 'Ändy 1.0 – ein humorvoller KI-Sprachassistent im Browser. Schrift: Poppins (SIL Open Font License). Keine Tracker, keine Cookies, keine Fremdserver für Schriften oder Skripte.' })
      ),
    });

    // Einbauen
    const body = $('#settings-body');
    body.replaceChildren(el('div', { class: 'sheet-inner' }, ...sections.map((x) => x.node)));
    const nav = $('#settings-nav');
    nav.replaceChildren(
      ...sections.map((x, i) =>
        el('button', {
          type: 'button',
          text: x.title,
          'aria-current': i === 0 ? 'true' : 'false',
          dataset: { target: x.id },
          onclick: () => this.#scrollTo(x.id),
        })
      )
    );
    body.addEventListener('scroll', () => this.#syncNav(), { passive: true });

    this.#fillVoices();
    this.#renderFacts();
    this.#refreshStatuses();
  }

  #scrollTo(id) {
    const node = $(`#set-${id}`);
    if (node) node.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  #syncNav() {
    const body = $('#settings-body');
    const top = body.getBoundingClientRect().top;
    let current = null;
    for (const g of body.querySelectorAll('.set-group')) {
      if (g.getBoundingClientRect().top - top < 80) current = g.id.replace('set-', '');
    }
    for (const b of $('#settings-nav').children) b.setAttribute('aria-current', String(b.dataset.target === current));
  }

  // ======================================================================
  // Dynamische Teile
  // ======================================================================

  #fillVoices() {
    const sel = this.dynamic.voiceSelect;
    if (sel) {
      const voices = this.speaker.germanVoices();
      sel.replaceChildren(el('option', { value: '', text: 'Automatisch (beste Stimme)' }));
      for (const v of voices) sel.append(el('option', { value: v.voiceURI, text: `${v.name} (${v.lang})` }));
      sel.value = this.store.settings.voiceURI;
      if (sel.value !== this.store.settings.voiceURI) sel.value = '';
      sel.disabled = !platform.hasSpeechSynthesis;
    }
    const cloud = this.dynamic.cloudVoice;
    if (cloud) {
      const list = this.assistant.caps.ttsVoices || [];
      cloud.replaceChildren(...(list.length ? list.map((v) => el('option', { value: v, text: CLOUD_VOICE_LABELS[v] || v })) : [el('option', { value: '', text: 'Nicht verfügbar' })]));
      cloud.disabled = !list.length;
      if (list.length) cloud.value = list.includes(this.store.settings.cloudVoice) ? this.store.settings.cloudVoice : list[0];
    }
  }

  #renderFacts() {
    const box = this.dynamic.facts;
    if (!box) return;
    const facts = this.store.facts;
    box.replaceChildren();
    if (!this.store.settings.memoryEnabled) {
      box.append(el('p', { class: 'status', text: 'Das Langzeitgedächtnis ist aus. Ändy merkt sich nichts.' }));
      return;
    }
    if (!facts.length) {
      box.append(el('p', { class: 'status', text: 'Noch nichts gemerkt. Sag zum Beispiel: „Ändy, merk dir, dass ich Kaffee mit Hafermilch trinke.“' }));
      return;
    }
    for (const f of facts) {
      box.append(el('div', { class: 'fact' }, el('span', { text: f.text }), el('button', { type: 'button', 'aria-label': `„${f.text}“ vergessen`, html: icon('trash'), onclick: () => this.store.deleteFactById(f.id) })));
    }
  }

  #refreshStatuses() {
    const a = this.assistant;
    const s = this.store.settings;

    const act = $('#st-activation');
    if (act) {
      let text;
      let tone = 'ok';
      if (a.recognizerKind === 'browser') {
        text = 'Spracherkennung des Browsers ist aktiv. Das Weckwort „Sarvus Ändy“ funktioniert, solange diese Seite geöffnet ist.';
        if (platform.isIOS) {
          text += ' Auf dem iPhone fragt Safari eventuell öfter nach dem Mikrofon und die Erkennung pausiert, wenn der Bildschirm ausgeht.';
          tone = 'warn';
        }
      } else if (a.recognizerKind === 'server') {
        text = 'Server-Spracherkennung ist aktiv. Tippe auf das Mikrofon, um Ändy zu wecken. Danach hört er zu, bis du „Ändy, Ruhe“ sagst. Ein Weckwort im Dauerbetrieb gibt es hier nicht.';
        tone = 'warn';
      } else {
        text = this.ui.platformNote(a) || 'Es ist keine Spracherkennung verfügbar. Du kannst Ändy schreiben.';
        tone = 'bad';
      }
      act.textContent = text;
      act.dataset.tone = tone;
    }

    const conn = $('#st-conn');
    if (conn) {
      const c = a.caps;
      if (!a.healthChecked) {
        conn.textContent = 'Noch nicht geprüft.';
        conn.dataset.tone = '';
      } else if (!a.online) {
        conn.textContent = 'Der Server ist nicht erreichbar. Läuft das Backend und stimmt die Adresse?';
        conn.dataset.tone = 'bad';
      } else {
        const parts = [
          c.chat ? `KI bereit (${c.provider}${c.model ? `, ${c.model}` : ''})` : 'KI nicht eingerichtet',
          `Websuche: ${c.search === 'brave' ? 'Brave' : 'Wikipedia'}`,
          c.stt ? 'Server-Spracherkennung: ja' : 'Server-Spracherkennung: nein',
          c.tts ? 'Server-Stimme: ja' : 'Server-Stimme: nein',
        ];
        conn.textContent = parts.join(' · ');
        conn.dataset.tone = c.chat ? 'ok' : 'warn';
      }
    }

    const pr = $('#st-privacy');
    if (pr) {
      const lines = [
        'Einstellungen, Notizen, Erinnerungen und (wenn erlaubt) Verlauf und Gedächtnis liegen nur in diesem Browser.',
        'Was du sagst oder schreibst, geht an deinen Ändy-Server und von dort an den KI-Anbieter, damit Ändy antworten kann.',
        a.recognizerKind === 'server'
          ? 'Deine Sprache wird zur Erkennung als Aufnahme an deinen Server und den Spracherkennungs-Anbieter gesendet – aber nur, solange ein Gespräch läuft.'
          : 'Die Spracherkennung macht dein Browser: Chrome und Edge senden die Aufnahme dafür an Google bzw. Microsoft, Safari an Apple. Beim Lauschen auf das Weckwort wird alles außer „Sarvus Ändy“ sofort verworfen und nie an Ändys Server gesendet.',
        s.useLocation ? 'Dein Standort wird nur für Wetterfragen mitgesendet.' : 'Dein Standort wird nicht verwendet.',
        'Ändy nutzt keine Cookies, keine Tracker und lädt keine Schriften oder Skripte von Fremdservern.',
      ];
      pr.replaceChildren(...lines.flatMap((l, i) => (i ? [el('br'), el('br'), l] : [l])));
    }
    if (this.dynamic.installBtn) this.dynamic.installBtn.hidden = !this.getInstallPrompt();
    this.#renderCapabilities();
  }

  #renderCapabilities() {
    const list = $('#cap-list');
    if (!list) return;
    const a = this.assistant;
    const rows = evaluateActivation({
      label: platform.label(),
      isIOS: platform.isIOS,
      isAndroid: platform.isAndroid,
      isMobile: platform.isMobile,
      isStandalone: platform.isStandalone,
      isFirefox: platform.isFirefox,
      browserRecognition: browserSpeechRecognitionUsable(),
      serverStt: Boolean(a.caps.stt) && platform.hasMediaRecorder,
      hasMic: platform.hasMediaDevices,
      hasNotifications: platform.hasNotifications,
      notificationPermission: typeof Notification === 'undefined' ? 'unsupported' : Notification.permission,
      hasWakeLock: platform.hasWakeLock,
      canInstall: Boolean(this.getInstallPrompt()),
      secureContext: platform.secureContext,
    });
    list.replaceChildren(
      ...rows.map((r) =>
        el(
          'li',
          { class: 'cap', dataset: { status: r.status, cap: r.id } },
          el('div', { class: 'cap-head' }, el('span', { class: 'cap-dot', 'aria-hidden': 'true' }), el('h4', { text: r.title }), el('span', { class: 'cap-badge', text: STATUS_LABEL[r.status] })),
          el('p', { text: r.text })
        )
      )
    );
  }

  #exportData() {
    const data = this.store.exportAll();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: `aendy-daten-${new Date().toISOString().slice(0, 10)}.json` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}
