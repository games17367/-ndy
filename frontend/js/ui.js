// Die sichtbare Oberfläche: Zustandsanzeige, Untertitel, Verlauf, Notizen, Erinnerungen,
// Timer, Karten (Wetter, Aktionen, Meldungen), Hinweise und Toasts.
// Alles Dynamische wird über DOM-APIs mit textContent gebaut – nie über innerHTML mit fremdem Text.

import { icon } from './icons.js';
import { formatCountdown, describeWhen } from './datetime.js';
import { platform } from './platform.js';

const $ = (sel, root = document) => root.querySelector(sel);

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v; // nur für eigene, feste SVG-Icons
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return node;
}

export { el, $ };

const STATE_LABELS = {
  sleeping: 'Ändy schläft',
  listening: 'Ändy hört zu',
  thinking: 'Ändy denkt nach',
  speaking: 'Ändy spricht',
};

const TOOL_LABELS = {
  web_search: 'Ändy sucht im Netz',
  get_weather: 'Ändy schaut aus dem Fenster',
  calculate: 'Ändy rechnet',
};

const fmtTime = (ts) => new Date(ts).toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' });

export class UI {
  /**
   * @param {{store: import('./store.js').Store, assistant: import('./assistant.js').Assistant,
   *          scheduler: import('./scheduler.js').Scheduler, core: import('./core-canvas.js').AndyCore}} deps
   */
  constructor({ store, assistant, scheduler, core }) {
    this.store = store;
    this.assistant = assistant;
    this.scheduler = scheduler;
    this.core = core;
    this.toolLabel = '';
    this.lastLogWho = null;
    this.banners = new Map();
    this.timerEls = new Map();
    this.cardEls = new Map();
    this.currentTab = 'log';
    this.assistantMsgEls = new Map();
    this.#icons();
    this.#bind();
  }

  // ----- Grundaufbau -----

  #icons() {
    $('#btn-log').innerHTML = icon('log');
    $('#btn-settings').innerHTML = icon('gear');
    $('#drawer-close').innerHTML = icon('close');
    $('#settings-close').innerHTML = icon('close');
    $('#btn-mic').innerHTML = icon('mic');
    $('#btn-send').innerHTML = icon('send');
    $('#btn-vol').innerHTML = icon('volume');
  }

  #bind() {
    const a = this.assistant;
    const store = this.store;

    // Zustand, Mikrofon, Untertitel ...
    a.on('state', ({ state }) => this.#renderState(state));
    a.on('engaged', () => this.#renderMic());
    a.on('mic', () => this.#renderMic());
    a.on('status', (st) => {
      this.toolLabel = st?.name ? TOOL_LABELS[st.name] || 'Ändy arbeitet' : '';
      this.#renderState(a.state);
    });
    a.on('caption', ({ who, text }) => this.setCaption(who, text));
    a.on('toast', ({ text, kind }) => this.toast(text, kind));
    a.on('banner', (b) => this.showBanner(b));
    a.on('banner-clear', (id) => this.clearBanner(id));
    a.on('card', (c) => this.#onCard(c));
    a.on('notice', (n) => this.showNotice(n));
    a.on('wake-heard', () => this.core.pulse(1));
    a.on('caps', () => this.#renderMic());

    // Verlauf
    store.on('history', (m) => this.#appendLine(m));
    store.on('history-update', (m) => this.#updateLine(m));
    store.on('history-clear', () => this.renderLog());
    store.on('notes', () => this.renderNotes());
    store.on('reminders', () => this.renderReminders());
    store.on('timers', () => this.renderTimers());
    store.on('reset', () => {
      this.renderLog();
      this.renderNotes();
      this.renderReminders();
      this.renderTimers();
    });
    store.on('setting', (key) => {
      if (key === 'volume') this.#renderVolume();
      if (key === 'activation' || key === 'sttEngine') this.#renderMic();
    });
    this.scheduler.on('tick', () => this.#tickTimers());

    // Bedienelemente
    $('#btn-mic').addEventListener('click', () => a.micButton());
    $('#core-tap').addEventListener('click', () => a.micButton());
    $('#btn-stop').addEventListener('click', () => a.stopListening());
    $('#wake-chip').addEventListener('click', () => this.#onWakeChip());
    $('#btn-log').addEventListener('click', () => this.toggleDrawer());
    $('#drawer-close').addEventListener('click', () => this.toggleDrawer(false));
    $('#scrim').addEventListener('click', () => {
      this.toggleDrawer(false);
      this.onCloseSettings?.();
    });
    $('#btn-settings').addEventListener('click', () => this.onOpenSettings?.());

    const input = $('#text');
    input.addEventListener('input', () => {
      $('#btn-send').hidden = !input.value.trim();
    });
    $('#composer').addEventListener('submit', (e) => {
      e.preventDefault();
      const t = input.value.trim();
      if (!t) return;
      input.value = '';
      $('#btn-send').hidden = true;
      a.submitText(t);
    });

    // Tabs
    for (const tab of document.querySelectorAll('.tab')) {
      tab.addEventListener('click', () => this.selectTab(tab.dataset.tab));
    }
    $('#note-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const i = $('#note-input');
      const t = i.value.trim();
      if (t) store.addNote({ text: t });
      i.value = '';
    });

    // Lautstärke
    $('#btn-vol').addEventListener('click', () => {
      const pop = $('#vol-pop');
      pop.hidden = !pop.hidden;
      $('#btn-vol').setAttribute('aria-expanded', String(!pop.hidden));
    });
    document.addEventListener('pointerdown', (e) => {
      const pop = $('#vol-pop');
      if (!pop.hidden && !e.target.closest('.vol')) {
        pop.hidden = true;
        $('#btn-vol').setAttribute('aria-expanded', 'false');
      }
    });
    $('#vol').addEventListener('input', (e) => store.set('volume', Number(e.target.value)));
    this.#renderVolume();

    // Tastatur: Escape schließt/unterbricht
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (!$('#settings').hidden) this.onCloseSettings?.();
      else if (!$('#drawer').hidden && !this.#drawerDocked()) this.toggleDrawer(false);
      else if (a.state === 'speaking' || a.state === 'thinking') a.interrupt();
    });

    // Drawer: auf breiten Bildschirmen standardmäßig offen
    const wanted = store.ui.drawerOpen;
    if (wanted === true || (wanted === undefined && this.#drawerDocked())) this.toggleDrawer(true, { persist: false });

    this.renderLog();
    this.renderNotes();
    this.renderReminders();
    this.renderTimers();
    this.#renderState('sleeping');
    this.#renderMic();
  }

  #drawerDocked() {
    return window.matchMedia('(min-width: 1000px)').matches;
  }

  // ----- Zustand -----

  #renderState(state) {
    document.body.dataset.state = state;
    this.core.setState(state);
    const label = $('#state-label');
    label.replaceChildren();
    let text = STATE_LABELS[state];
    if (state === 'thinking' && this.toolLabel) text = this.toolLabel;
    label.append(text);
    if (state === 'thinking') label.append(el('span', { class: 'dots', 'aria-hidden': 'true' }, el('i'), el('i'), el('i')));
    this.#renderHint();
    this.#renderMic();
  }

  #renderHint() {
    const a = this.assistant;
    const s = this.store.settings;
    let text = '';
    if (a.state === 'speaking') text = 'Tippe auf mein Gesicht oder sag „Stopp“, um mich zu unterbrechen.';
    else if (a.state === 'thinking') text = 'Tippe auf mein Gesicht, um abzubrechen.';
    else if (a.engaged) text = 'Ich höre zu. Tippe erneut auf mein Gesicht oder sag „Ändy, Ruhe“, wenn wir fertig sind.';
    else if (a.wakeWanted && a.micActive) text = 'Sag „Sarvus Ändy“ oder tippe auf mein Gesicht.';
    else if (s.activation === 'wake' && a.wakeCapable) text = 'Tippe auf mein Gesicht, um mich zu wecken und das Weckwort zu aktivieren.';
    else text = 'Tippe auf mein Gesicht, um mit mir zu sprechen.';
    $('#hint').textContent = text;
  }

  #renderMic() {
    const a = this.assistant;
    const s = this.store.settings;
    const mic = $('#btn-mic');
    const engaged = a.engaged;
    mic.setAttribute('aria-pressed', String(engaged));
    mic.setAttribute('aria-label', engaged ? 'Gespräch beenden' : 'Ändy wecken');
    mic.innerHTML = icon(engaged ? 'micStop' : 'mic');
    const orb = $('#core-tap');
    orb.setAttribute('aria-pressed', String(engaged));
    orb.setAttribute('aria-label', a.state === 'speaking' || a.state === 'thinking' ? 'Ändy unterbrechen' : engaged ? 'Zuhören beenden' : 'Ändy wecken und zuhören lassen');
    $('#btn-stop').hidden = !engaged;

    // Chip
    const chip = $('#wake-chip');
    let mode = 'off';
    let text = 'Mikro aus';
    if (engaged) {
      mode = 'engaged';
      text = 'Im Gespräch';
    } else if (a.wakeWanted && a.micActive) {
      mode = 'wake';
      text = 'Lauscht auf Sarvus Ändy';
    } else if (a.wakeWanted) {
      mode = 'off';
      text = 'Weckwort aus';
    } else if (s.activation === 'button' || !a.wakeCapable) {
      mode = 'button';
      text = 'Nur per Taste';
    }
    chip.dataset.mode = mode;
    $('#wake-text').textContent = text;
    chip.setAttribute('aria-label', `Weckwort: ${text}`);
    this.#renderHint();
  }

  #onWakeChip() {
    const a = this.assistant;
    if (a.engaged) return;
    if (!a.wakeCapable) {
      this.toast(
        a.recognizerKind === 'server'
          ? 'Mit der Server-Spracherkennung gibt es kein Dauerlauschen. Tippe auf mein Gesicht.'
          : 'Auf diesem Gerät ist keine Spracherkennung für das Weckwort verfügbar. Tippe auf mein Gesicht oder schreib mir.'
      );
      return;
    }
    if (a.micActive && this.store.settings.activation === 'wake') a.disableWake();
    else a.enableWake();
  }

  #renderVolume() {
    const v = this.store.settings.volume;
    const range = $('#vol');
    range.value = String(v);
    range.style.setProperty('--pct', `${Math.round(v * 100)}%`);
    $('#btn-vol').innerHTML = icon(v === 0 ? 'volumeOff' : 'volume');
  }

  setCaption(who, text) {
    const c = $('#caption');
    c.dataset.who = who;
    c.textContent = text || '';
  }

  // ----- Hinweise & Toasts -----

  showBanner({ id, kind = 'warn', text, action }) {
    this.clearBanner(id);
    const node = el(
      'div',
      { class: 'banner', dataset: { kind } },
      el('p', { text }),
      action ? el('button', { type: 'button', text: action.label, onclick: () => this.onBannerAction?.(action.id) }) : null,
      el('button', { type: 'button', 'aria-label': 'Hinweis schließen', html: icon('close'), onclick: () => this.clearBanner(id) })
    );
    node.querySelector('button:last-child').style.cssText = 'width:1.75rem;height:1.75rem;padding:0;display:grid;place-items:center';
    node.querySelector('button:last-child svg').style.cssText = 'width:.9rem;height:.9rem';
    $('#banners').append(node);
    this.banners.set(id, node);
  }

  clearBanner(id) {
    this.banners.get(id)?.remove();
    this.banners.delete(id);
  }

  toast(text, kind = 'info') {
    const node = el('div', { class: 'toast', dataset: { kind }, text });
    $('#toasts').append(node);
    setTimeout(() => node.remove(), 4200);
  }

  // ----- Verlauf -----

  #speakerName(role) {
    if (role === 'user') return this.store.settings.userName || 'Du';
    return 'Ändy';
  }

  #makeLine(m) {
    if (m.hidden) return null;
    const role = m.role;
    const cls = m.error ? 'line-err' : role === 'user' ? 'line-user' : role === 'system' ? 'line-sys' : 'line-andy';
    const who = role === 'system' ? null : role;
    const start = who !== this.lastLogWho;
    this.lastLogWho = who;
    const node = el('p', { class: `line ${cls}${start ? ' start' : ''}`, dataset: { id: m.id } });
    if (role !== 'system' && start) node.append(el('span', { class: 'who', text: this.#speakerName(role) }));
    node.append(el('span', { class: 'txt', text: m.text }));
    if (m.interrupted) node.append(el('span', { class: 'cut', text: ' … (unterbrochen)' }));
    node.title = fmtTime(m.ts);
    return node;
  }

  renderLog() {
    const log = $('#log');
    log.replaceChildren();
    this.lastLogWho = null;
    for (const m of this.store.history) {
      const n = this.#makeLine(m);
      if (n) log.append(n);
    }
    $('#log-empty').hidden = log.childElementCount > 0;
    this.#scrollLog();
  }

  #appendLine(m) {
    const n = this.#makeLine(m);
    if (!n) return;
    $('#log').append(n);
    $('#log-empty').hidden = true;
    this.#scrollLog();
  }

  #updateLine(m) {
    const n = $(`.line[data-id="${CSS.escape(m.id)}"]`);
    if (!n) return;
    const txt = n.querySelector('.txt');
    if (txt) txt.textContent = m.text;
    if (m.interrupted && !n.querySelector('.cut')) n.append(el('span', { class: 'cut', text: ' … (unterbrochen)' }));
    this.#scrollLog();
  }

  #scrollLog() {
    const panel = $('#panel-log');
    requestAnimationFrame(() => {
      panel.scrollTop = panel.scrollHeight;
    });
  }

  /** Kurze Systemzeile (Aktionen wie „Timer gestartet“) */
  log(text) {
    this.store.addMessage({ role: 'system', text });
  }

  // ----- Drawer -----

  toggleDrawer(force, { persist = true } = {}) {
    const drawer = $('#drawer');
    const open = force ?? drawer.hidden;
    drawer.hidden = !open;
    document.body.classList.toggle('log-open', open);
    $('#btn-log').setAttribute('aria-expanded', String(open));
    $('#scrim').hidden = !open || this.#drawerDocked();
    if (persist) this.store.setUi('drawerOpen', open);
    if (open) {
      this.selectTab(this.currentTab);
      this.#scrollLog();
    }
    // Kern nach Layoutwechsel neu messen
    requestAnimationFrame(() => this.core.resize?.());
    setTimeout(() => this.core.resize?.(), 380);
  }

  selectTab(name) {
    this.currentTab = name;
    for (const tab of document.querySelectorAll('.tab')) tab.setAttribute('aria-selected', String(tab.dataset.tab === name));
    for (const p of document.querySelectorAll('.panel')) p.hidden = p.dataset.panel !== name;
    if (name === 'log') this.#scrollLog();
  }

  renderNotes() {
    const list = $('#note-list');
    list.replaceChildren();
    for (const n of [...this.store.notes].reverse()) {
      list.append(
        el(
          'li',
          { class: 'item' },
          el('div', { class: 'item-main' }, n.title ? el('strong', { text: n.title }) : null, n.title ? el('br') : null, n.text, el('small', { text: new Date(n.ts).toLocaleString('de-AT', { dateStyle: 'medium', timeStyle: 'short' }) })),
          el('button', { type: 'button', 'aria-label': 'Notiz löschen', html: icon('trash'), onclick: () => this.store.deleteNoteById(n.id) })
        )
      );
    }
    $('#notes-empty').hidden = this.store.notes.length > 0;
  }

  renderReminders() {
    const list = $('#reminder-list');
    list.replaceChildren();
    const items = [...this.store.reminders].sort((a, b) => a.at - b.at);
    for (const r of items) {
      list.append(
        el(
          'li',
          { class: 'item', dataset: { tone: r.fired ? '' : 'ember' } },
          el('div', { class: 'item-main' }, r.text, el('small', { text: `${r.alarm ? 'Wecker · ' : ''}${describeWhen(new Date(r.at))}${r.fired ? ' · erledigt' : ''}` })),
          el('button', { type: 'button', 'aria-label': 'Erinnerung löschen', html: icon('trash'), onclick: () => this.store.deleteReminderById(r.id) })
        )
      );
    }
    $('#reminders-empty').hidden = items.length > 0;
  }

  // ----- Timer -----

  renderTimers() {
    const ids = new Set(this.store.timers.map((t) => t.id));
    for (const [id, node] of this.timerEls) {
      if (!ids.has(id)) {
        node.remove();
        this.timerEls.delete(id);
      }
    }
    for (const t of this.store.timers) {
      if (this.timerEls.has(t.id)) continue;
      const C = 2 * Math.PI * 14;
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 36 36');
      svg.setAttribute('aria-hidden', 'true');
      const bg = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      for (const [k, v] of Object.entries({ class: 'ring-bg', cx: 18, cy: 18, r: 14, fill: 'none', 'stroke-width': 3 })) bg.setAttribute(k, v);
      const fgSvg = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      for (const [k, v] of Object.entries({ class: 'ring-fg', cx: 18, cy: 18, r: 14, fill: 'none', 'stroke-width': 3, 'stroke-dasharray': C.toFixed(2), 'stroke-dashoffset': 0 })) fgSvg.setAttribute(k, v);
      svg.append(bg, fgSvg);
      const time = el('span', { class: 'timer-time' });
      const node = el(
        'div',
        { class: 'timer', role: 'timer' },
        svg,
        el('span', { class: 'timer-label', text: t.label || 'Timer' }),
        time,
        el('button', { type: 'button', 'aria-label': 'Timer abbrechen', html: icon('close'), onclick: () => this.store.removeTimer(t.id) })
      );
      node._time = time;
      node._fg = fgSvg;
      node._C = C;
      $('#timers').append(node);
      this.timerEls.set(t.id, node);
    }
    this.#tickTimers();
  }

  #tickTimers() {
    const now = Date.now();
    for (const t of this.store.timers) {
      const node = this.timerEls.get(t.id);
      if (!node) continue;
      const left = Math.max(0, (t.endsAt - now) / 1000);
      node._time.textContent = formatCountdown(left);
      const total = Math.max(1, (t.endsAt - t.createdAt) / 1000);
      node._fg.setAttribute('stroke-dashoffset', String((node._C * (1 - left / total)).toFixed(2)));
    }
  }

  // ----- Karten -----

  #addCard(id, node) {
    this.cardEls.get(id)?.remove();
    this.cardEls.set(id, node);
    $('#cards').prepend(node);
    // Maximal vier Karten gleichzeitig
    const nodes = [...$('#cards').children];
    for (const extra of nodes.slice(4)) extra.remove();
  }

  #closeButton(id) {
    return el('button', {
      class: 'card-close',
      type: 'button',
      'aria-label': 'Schließen',
      html: icon('close'),
      onclick: () => {
        this.cardEls.get(id)?.remove();
        this.cardEls.delete(id);
        this.onCardClosed?.(id);
      },
    });
  }

  #onCard({ type, data }) {
    if (type === 'weather') this.showWeather(data);
  }

  showWeather(w) {
    const id = 'weather';
    const dayLabel = (iso, i) => (i === 0 ? 'Heute' : i === 1 ? 'Morgen' : new Date(`${iso}T12:00`).toLocaleDateString('de-AT', { weekday: 'short' }));
    const card = el(
      'section',
      { class: 'card', 'aria-label': `Wetter ${w.place}` },
      this.#closeButton(id),
      el('div', { class: 'weather-now' }, el('span', { class: 'weather-temp', text: `${w.current.temp}°` }), el('span', { class: 'weather-desc', text: w.current.text })),
      el('p', { class: 'weather-place', text: `${w.place} · gefühlt ${w.current.feels}° · Wind ${w.current.wind} km/h` }),
      el(
        'div',
        { class: 'weather-days' },
        ...w.days.map((d, i) =>
          el('div', { class: 'weather-day' }, el('strong', { text: dayLabel(d.date, i) }), `${d.min}° bis ${d.max}°`, el('br'), d.text, d.rain != null ? el('br') : null, d.rain != null ? `Regen ${d.rain} %` : null)
        )
      )
    );
    this.#addCard(id, card);
  }

  /** Bestätigungskarte für Aktionen (Kalender, Navigation, Musik, Nachrichten, Webseiten ...) */
  showActionCard({ id, icon: iconName, title, lines = [], confirmLabel, href, secondary = [], editable, compose, onConfirm }) {
    const cardId = `action-${id}`;
    let textarea = null;
    if (editable !== undefined) {
      textarea = el('textarea', { 'aria-label': 'Nachrichtentext', rows: 3 });
      textarea.value = editable;
    }
    const confirm = el('button', {
      class: 'pill pill-primary',
      type: 'button',
      text: confirmLabel,
      onclick: () => {
        const done = onConfirm({ href, getEditedBody: textarea ? () => textarea.value : undefined });
        if (done !== false) {
          this.cardEls.get(cardId)?.remove();
          this.cardEls.delete(cardId);
        } else {
          this.toast('Das konnte ich nicht öffnen.', 'error');
        }
      },
    });
    void compose;
    const card = el(
      'section',
      { class: 'card', role: 'group', 'aria-label': title },
      this.#closeButton(cardId),
      el('div', { class: 'card-head' }, el('span', { html: icon(iconName || 'check') }), el('h3', { class: 'card-title', text: title })),
      el('ul', { class: 'card-lines' }, ...lines.filter(Boolean).map((l) => el('li', { text: l }))),
      textarea,
      el(
        'div',
        { class: 'card-actions' },
        confirm,
        ...secondary
          .filter((s) => s.href)
          .map((s) => el('a', { class: 'pill', href: s.href, target: '_blank', rel: 'noopener noreferrer', text: s.label })),
        el('button', { class: 'pill pill-ghost', type: 'button', text: 'Verwerfen', onclick: () => { this.cardEls.get(cardId)?.remove(); this.cardEls.delete(cardId); } })
      )
    );
    this.#addCard(cardId, card);
    this.core.pulse(0.6);
  }

  /** Meldung von Timer, Erinnerung, Wecker */
  showNotice({ kind, title, text, id, reminderId }) {
    const cardId = `notice-${id}`;
    const stopAll = () => {
      this.onDismissNotice?.(kind);
      this.cardEls.get(cardId)?.remove();
      this.cardEls.delete(cardId);
    };
    const actions = [el('button', { class: 'pill pill-primary', type: 'button', text: kind === 'alarm' ? 'Wecker aus' : 'Okay', onclick: stopAll })];
    if (reminderId && (kind === 'alarm' || kind === 'reminder')) {
      actions.push(
        el('button', {
          class: 'pill',
          type: 'button',
          text: '5 Minuten später',
          onclick: () => {
            this.scheduler.snooze(reminderId, 5);
            this.toast('Ich melde mich in 5 Minuten wieder.');
            stopAll();
          },
        })
      );
    }
    const card = el(
      'section',
      { class: 'card', role: 'alert', dataset: { tone: kind === 'info' || kind === 'missed' ? '' : 'ember' } },
      this.#closeButton(cardId),
      el('div', { class: 'card-head' }, el('span', { html: icon(kind === 'timer' ? 'timer' : kind === 'info' ? 'sun' : 'bell') }), el('h3', { class: 'card-title', text: title })),
      text ? el('ul', { class: 'card-lines' }, el('li', { text })) : null,
      el('div', { class: 'card-actions' }, ...(kind === 'info' ? [] : actions))
    );
    this.#addCard(cardId, card);
    this.core.pulse(1);
    if (kind === 'info') setTimeout(() => { this.cardEls.get(cardId)?.remove(); this.cardEls.delete(cardId); }, 12_000);
  }

  // ----- Plattformhinweise für die Einführung -----

  platformNote(assistant) {
    const notes = [];
    if (platform.isIOS && platform.isStandalone && assistant.recognizerKind !== 'server') {
      notes.push('Auf dem iPhone steht die Spracherkennung in der Homescreen-App nicht zur Verfügung. Öffne Ändy in Safari oder nutze einen Server mit Spracherkennung.');
    }
    if (!platform.hasSpeechRecognition && assistant.recognizerKind === 'none') {
      notes.push('Dieser Browser kann keine Sprache erkennen. Du kannst Ändy schreiben, seine Antworten hörst du trotzdem. Für Spracheingabe nimm Chrome, Edge oder Safari.');
    }
    if (!platform.secureContext) notes.push('Mikrofon und Spracherkennung funktionieren nur über eine sichere Verbindung (https).');
    return notes.join(' ');
  }
}
