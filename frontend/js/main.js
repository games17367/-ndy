// Startpunkt: verbindet alle Module und kümmert sich um Einführung, Installation und PWA.

import { Store } from './store.js';
import { ApiClient } from './api.js';
import { Speaker } from './speech-out.js';
import { Scheduler } from './scheduler.js';
import { Assistant } from './assistant.js';
import { AndyCore } from './core-canvas.js';
import { UI, el, $ } from './ui.js';
import { ActionRunner } from './actions.js';
import { SettingsUI } from './settings-ui.js';
import { platform } from './platform.js';
import * as sound from './audio.js';

const store = new Store();
const api = new ApiClient(store);
const speaker = new Speaker({ store, api });
const scheduler = new Scheduler(store);
const assistant = new Assistant({ store, api, speaker, scheduler });

const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
const core = new AndyCore($('#core'), { reducedMotion: reduced, portrait: true, host: $('#core-tap') });
core.setLevelProvider(() => assistant.level);
core.start();

const ui = new UI({ store, assistant, scheduler, core });
const actions = new ActionRunner({
  store,
  scheduler,
  ui,
  log: (text) => ui.log(text),
  applySetting: (key, value) => assistant.applySetting(key, value),
});
assistant.actions = actions;

let installPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
});
window.addEventListener('appinstalled', () => {
  installPrompt = null;
  ui.toast('Ändy ist installiert.');
});

const settingsUI = new SettingsUI({ store, assistant, speaker, ui, getInstallPrompt: () => installPrompt });
ui.onOpenSettings = () => settingsUI.open();
ui.onCloseSettings = () => settingsUI.close();
ui.onDismissNotice = () => sound.stopAlarm();
ui.onCardClosed = () => {
  if (sound.isAlarmRinging()) sound.stopAlarm();
};
ui.onBannerAction = async (id) => {
  if (id === 'open-settings') settingsUI.open('connection');
  else if (id === 'retry-mic') {
    await assistant.prepareFromGesture();
    if (assistant.engaged) await assistant.enableWake();
    else await assistant.engage({ source: 'button' });
  } else if (id === 'mic-help') {
    ui.showBanner({
      id: 'mic-help',
      kind: 'info',
      text: platform.isIOS
        ? 'iPhone: Einstellungen, Safari, Mikrofon auf „Fragen“ oder „Erlauben“ stellen. Danach die Seite neu laden.'
        : 'Tippe in der Adressleiste auf das Schloss- oder Einstellungs-Symbol, erlaube das Mikrofon und lade die Seite neu.',
    });
  }
};

// Der erste Tipp irgendwo schaltet den Ton frei (Browser verlangen eine Geste).
document.addEventListener('pointerdown', () => assistant.prepareFromGesture(), { once: true, capture: true });

// ---------------------------------------------------------------------
// Einführung und Start-Bildschirm
// ---------------------------------------------------------------------

function switchRow(key, label, hint) {
  const input = el('input', { type: 'checkbox', role: 'switch', 'aria-label': label });
  input.checked = Boolean(store.settings[key]);
  input.addEventListener('change', () => store.set(key, input.checked));
  return el(
    'div',
    { class: 'row' },
    el('span', { class: 'row-label', text: label }),
    el('div', { class: 'row-control' }, el('label', { class: 'switch' }, input, el('span', { class: 'knob' }))),
    el('span', { class: 'row-hint', text: hint })
  );
}

function hideOverlay() {
  $('#onboarding').hidden = true;
  document.body.style.overflow = '';
}

function showOnboarding() {
  $('#ob-title').textContent = 'Sarvus! Ich bin Ändy.';
  $('#ob-text').textContent = 'Dein Sprachassistent mit Schmäh. Sag „Sarvus Ändy“ oder tippe auf mein Gesicht, dann reden wir.';
  $('#ob-options').replaceChildren(
    switchRow('saveHistory', 'Gespräche auf diesem Gerät merken', 'Ohne das vergesse ich alles, sobald du die Seite schließt.'),
    switchRow('memoryEnabled', 'Langzeitgedächtnis', 'Ich darf mir Dinge merken, die du mir erzählst. Du kannst sie jederzeit ansehen und löschen.')
  );
  const note = [
    'Beides bleibt nur auf diesem Gerät und ist jederzeit in den Einstellungen änderbar. Dein Gesprächstext geht an meinen Server, damit ich antworten kann.',
    ui.platformNote(assistant),
  ]
    .filter(Boolean)
    .join(' ');
  $('#ob-note').textContent = note;
  $('#ob-start').textContent = 'Los geht’s';
  $('#ob-text-only').hidden = false;
  $('#ob-text-only').textContent = 'Nur schreiben';
  $('#ob-start').onclick = async () => {
    store.set('onboarded', true);
    hideOverlay();
    await assistant.prepareFromGesture();
    await assistant.engage({ source: 'button' });
  };
  $('#ob-text-only').onclick = async () => {
    store.set('onboarded', true);
    store.set('activation', 'button');
    hideOverlay();
    await assistant.prepareFromGesture();
  };
  $('#onboarding').hidden = false;
  document.body.style.overflow = 'hidden';
  $('#ob-start').focus();
}

/** Wird per Siri-Kurzbefehl oder Home-Screen-Abkürzung geöffnet (?start=1): ein Tipp, dann hört Ändy zu. */
function showStartOverlay() {
  $('#ob-title').textContent = 'Ändy ist bereit.';
  $('#ob-text').textContent = 'Tippe einmal, damit ich zuhören darf. Dein Browser verlangt diesen Tipp für das Mikrofon.';
  $('#ob-options').replaceChildren();
  $('#ob-note').textContent = '';
  $('#ob-start').textContent = 'Ändy wecken';
  $('#ob-text-only').textContent = 'Später';
  $('#ob-text-only').hidden = false;
  $('#ob-start').onclick = async () => {
    hideOverlay();
    await assistant.prepareFromGesture();
    await assistant.engage({ source: 'button' });
  };
  $('#ob-text-only').onclick = hideOverlay;
  $('#onboarding').hidden = false;
  document.body.style.overflow = 'hidden';
  $('#ob-start').focus();
}

// ---------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------

async function boot() {
  await assistant.init();
  scheduler.start();

  const params = new URLSearchParams(location.search);
  const wantStart = params.get('start') === '1';
  if (wantStart) history.replaceState(null, '', location.pathname + location.hash);

  if (!store.settings.onboarded) {
    showOnboarding();
  } else if (wantStart) {
    showStartOverlay();
  } else {
    assistant.startProactive();
    // Dauerlauschen automatisch fortsetzen, wenn das Mikrofon schon erlaubt ist (am Computer)
    if (assistant.wakeWanted && !platform.isIOS) {
      try {
        const perm = await navigator.permissions?.query({ name: 'microphone' });
        if (perm?.state === 'granted') assistant.enableWake();
      } catch {
        /* Permissions-API nicht verfügbar → Nutzer tippt */
      }
    }
  }

  if (params.has('debug')) window.__aendy = { store, assistant, speaker, scheduler, core, ui, api };
}

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

boot().catch((err) => {
  console.error('[Ändy] Start fehlgeschlagen:', err);
  ui.toast('Beim Start ist etwas schiefgegangen. Lade die Seite neu.', 'error');
});
