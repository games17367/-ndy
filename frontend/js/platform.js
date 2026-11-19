// Erkennt Gerät, Browser und verfügbare Web-Schnittstellen.
// Alles hier ist defensiv geschrieben: nichts darf werfen, nur weil eine API fehlt.

const nav = typeof navigator !== 'undefined' ? navigator : {};
const win = typeof window !== 'undefined' ? window : {};
const ua = nav.userAgent || '';

const isIOS =
  /iPad|iPhone|iPod/.test(ua) || (nav.platform === 'MacIntel' && (nav.maxTouchPoints || 0) > 1);
const isAndroid = /Android/i.test(ua);
const isMobile = isIOS || isAndroid || /Mobi/i.test(ua);
const isFirefox = /Firefox|FxiOS/i.test(ua);
const isSafari = /^((?!chrome|android|crios|fxios|edgios).)*safari/i.test(ua);
const isStandalone = Boolean(
  (win.matchMedia && win.matchMedia('(display-mode: standalone)').matches) || nav.standalone === true
);

const SpeechRecognitionCtor = win.SpeechRecognition || win.webkitSpeechRecognition || null;

export const platform = {
  isIOS,
  isAndroid,
  isMobile,
  isFirefox,
  isSafari,
  isStandalone,
  secureContext: typeof win.isSecureContext === 'boolean' ? win.isSecureContext : true,
  SpeechRecognition: SpeechRecognitionCtor,
  hasSpeechRecognition: Boolean(SpeechRecognitionCtor),
  hasSpeechSynthesis: Boolean(win.speechSynthesis && win.SpeechSynthesisUtterance),
  hasMediaDevices: Boolean(nav.mediaDevices && nav.mediaDevices.getUserMedia),
  hasMediaRecorder: typeof win.MediaRecorder !== 'undefined',
  hasWakeLock: Boolean(nav.wakeLock && nav.wakeLock.request),
  hasNotifications: typeof win.Notification !== 'undefined',
  hasGeolocation: Boolean(nav.geolocation),
  hasShare: typeof nav.share === 'function',
  hasVibrate: typeof nav.vibrate === 'function',
  hasServiceWorker: 'serviceWorker' in nav,

  /** Kurzer Name fürs KI-Gerät („iPhone“, „Android“, „Desktop“) */
  label() {
    if (isIOS) return /iPad/.test(ua) ? 'iPad' : 'iPhone';
    if (isAndroid) return 'Android';
    if (/Mac/.test(nav.platform || '')) return 'Mac';
    if (/Win/.test(nav.platform || '')) return 'Windows-PC';
    return 'Desktop';
  },
};

/**
 * Bekannte Einschränkung: In der auf den iPhone-Homescreen gelegten Web-App (Standalone-Modus)
 * steht die Browser-Spracherkennung nicht zuverlässig zur Verfügung.
 */
export function browserSpeechRecognitionUsable() {
  if (!platform.hasSpeechRecognition) return false;
  if (platform.isIOS && platform.isStandalone) return false;
  return true;
}
