// Ändys animierter KI-Kern (Canvas 2D).
// Vier Zustände mit eigenem Charakter:
// Im Porträtmodus (portrait) sitzt dein Bild in der Mitte; der Canvas zeichnet nur noch das Licht
// darum herum (Aura, Ringe, Spektrum, Funken) und meldet Pegel/Glanz per CSS-Variablen an das Bild.
//   sleeping  – ruhig atmender, gedimmter Kern
//   listening – blau, reagiert auf Sprache/Mikrofonpegel
//   thinking  – violett, kreisende Bögen und Funken
//   speaking  – leuchtend, Ring-Spektrum folgt dem Ausgabepegel

const TAU = Math.PI * 2;

const STATES = {
  sleeping: { energy: 0.1, glow: 0.38, hueA: 258, hueB: 222, spin: 0.12, core: 0.9, bars: 0, orbit: 0, sat: 55 },
  listening: { energy: 0.42, glow: 0.85, hueA: 205, hueB: 250, spin: 0.35, core: 1.0, bars: 0.55, orbit: 0, sat: 90 },
  thinking: { energy: 0.6, glow: 0.9, hueA: 282, hueB: 218, spin: 1.1, core: 0.96, bars: 0, orbit: 1, sat: 92 },
  speaking: { energy: 0.55, glow: 1.0, hueA: 268, hueB: 205, spin: 0.5, core: 1.04, bars: 1, orbit: 0, sat: 95 },
};

const lerp = (a, b, k) => a + (b - a) * k;

// Weiches, deterministisches Pseudo-Rauschen
function noise(x) {
  return Math.sin(x * 1.7) * 0.5 + Math.sin(x * 2.9 + 1.3) * 0.3 + Math.sin(x * 5.3 + 0.7) * 0.2;
}

export class AndyCore {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{reducedMotion?: boolean, portrait?: boolean, host?: HTMLElement|null}} [opts]
   */
  constructor(canvas, { reducedMotion = false, portrait = false, host = null } = {}) {
    this.canvas = canvas;
    this.portrait = portrait;
    this.host = host;
    this.lastLv = -1;
    this.lastGlow = -1;
    this.ctx = canvas.getContext('2d');
    this.reduced = reducedMotion;
    this.state = 'sleeping';
    this.levelProvider = () => 0;
    this.p = { ...STATES.sleeping, level: 0 };
    this.t = 0;
    this.last = 0;
    this.running = false;
    this.burst = 0;
    this.size = 0;
    this.dpr = 1;
    this.particles = Array.from({ length: 64 }, (_, i) => ({
      a: Math.random() * TAU,
      r: 0.62 + Math.random() * 0.45,
      s: (Math.random() * 0.5 + 0.25) * (i % 2 ? 1 : -1),
      size: Math.random() * 1.6 + 0.6,
      tw: Math.random() * TAU,
    }));
    this.#bindResize();
    this.frame = this.frame.bind(this);
  }

  #bindResize() {
    const resize = () => {
      const rect = this.canvas.getBoundingClientRect();
      const size = Math.max(120, Math.floor(Math.min(rect.width, rect.height) || 300));
      this.dpr = Math.min(2, globalThis.devicePixelRatio || 1);
      this.size = size;
      this.canvas.width = Math.round(size * this.dpr);
      this.canvas.height = Math.round(size * this.dpr);
      this.draw(0); // sofort neu zeichnen, damit nichts flackert
    };
    this.resize = resize;
    if (typeof ResizeObserver !== 'undefined') {
      this.ro = new ResizeObserver(resize);
      this.ro.observe(this.canvas);
    } else {
      globalThis.addEventListener?.('resize', resize);
    }
    resize();
  }

  setState(state) {
    if (!STATES[state] || state === this.state) return;
    this.state = state;
    this.burst = Math.max(this.burst, 0.8); // kleiner „Schubs“ beim Zustandswechsel
  }

  setLevelProvider(fn) {
    this.levelProvider = fn || (() => 0);
  }

  pulse(strength = 0.7) {
    this.burst = Math.max(this.burst, strength);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  frame(now) {
    if (!this.running) return;
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.draw(dt);
    this.raf = requestAnimationFrame(this.frame);
  }

  /** Gibt Pegel und Glanz nur bei spürbarer Änderung an die Bildtaste weiter (spart Style-Berechnungen). */
  #publish(level, glow) {
    const lv = 1 + Math.min(1, level) * (this.state === 'speaking' ? 0.07 : 0.035) * (this.reduced ? 0 : 1);
    const g = Math.min(1, 0.22 + glow * 0.35 + level * 0.6);
    if (Math.abs(lv - this.lastLv) > 0.0015) {
      this.host.style.setProperty('--lv', lv.toFixed(4));
      this.lastLv = lv;
    }
    if (Math.abs(g - this.lastGlow) > 0.01) {
      this.host.style.setProperty('--glow', g.toFixed(3));
      this.lastGlow = g;
    }
  }

  draw(dt) {
    const { ctx, size, dpr } = this;
    if (!ctx || !size) return;
    const target = STATES[this.state];
    const speedScale = this.reduced ? 0.35 : 1;
    const k = 1 - Math.exp(-dt * 3.2);
    const p = this.p;
    for (const key of ['energy', 'glow', 'hueA', 'hueB', 'spin', 'core', 'bars', 'orbit', 'sat']) {
      p[key] = lerp(p[key], target[key], dt === 0 ? 1 : k);
    }
    // Pegel weich folgen lassen (schnell hoch, langsam runter)
    const raw = Math.max(0, Math.min(1, this.levelProvider() || 0));
    p.level = raw > p.level ? lerp(p.level, raw, 1 - Math.exp(-dt * 18)) : lerp(p.level, raw, 1 - Math.exp(-dt * 5));
    this.burst *= Math.exp(-dt * 2.6);

    this.t += dt * speedScale;
    const t = this.t;
    const level = Math.max(p.level, this.burst * 0.6);
    if (this.host) this.#publish(level, p.glow);
    const energy = p.energy + level * 0.9;

    const s = size * dpr;
    const cx = s / 2;
    const cy = s / 2;
    const R = s / 2;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, s, s);
    ctx.globalCompositeOperation = 'lighter';

    const hsla = (h, sat, l, a) => `hsla(${h.toFixed(0)}, ${sat.toFixed(0)}%, ${l}%, ${Math.max(0, Math.min(1, a)).toFixed(3)})`;

    // 1) Äußeres Leuchten
    const breath = 1 + Math.sin(t * (state2speed(this.state))) * 0.035;
    const haloR = R * (0.98 + level * 0.06);
    const halo = ctx.createRadialGradient(cx, cy, R * 0.15, cx, cy, haloR);
    halo.addColorStop(0, hsla(p.hueA, p.sat, 60, 0.34 * p.glow));
    halo.addColorStop(0.5, hsla(p.hueB, p.sat, 48, 0.16 * p.glow));
    halo.addColorStop(1, hsla(p.hueB, p.sat, 40, 0));
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, s, s);

    // 2) Kern (im Porträtmodus ersetzt dein Bild den Kern)
    const coreR = R * 0.4 * p.core * breath * (1 + level * 0.1);
    if (!this.portrait) {
    const core = ctx.createRadialGradient(cx - coreR * 0.28, cy - coreR * 0.34, coreR * 0.05, cx, cy, coreR);
    core.addColorStop(0, hsla(p.hueA - 10, 80, 92, 0.95));
    core.addColorStop(0.35, hsla(p.hueA, p.sat, 66, 0.9));
    core.addColorStop(0.75, hsla(p.hueB, p.sat, 36, 0.8));
    core.addColorStop(1, hsla(p.hueB, p.sat, 22, 0.15));
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(cx, cy, coreR, 0, TAU);
    ctx.fill();

    // Glanzlicht
    const spec = ctx.createRadialGradient(cx - coreR * 0.35, cy - coreR * 0.42, 0, cx - coreR * 0.35, cy - coreR * 0.42, coreR * 0.5);
    spec.addColorStop(0, `rgba(255,255,255,${(0.35 * p.glow).toFixed(3)})`);
    spec.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = spec;
    ctx.beginPath();
    ctx.arc(cx, cy, coreR, 0, TAU);
    ctx.fill();
    }

    // 3) Wabernde Ringe
    const rings = 5;
    for (let k2 = 0; k2 < rings; k2++) {
      const base = this.portrait
        ? R * (0.77 + k2 * 0.03) * (1 + level * 0.012 * (rings - k2))
        : R * (0.5 + k2 * 0.075) * (1 + level * 0.04 * (rings - k2));
      const amp = R * (0.008 + energy * 0.03) * (1 + k2 * 0.25) * (this.portrait ? 0.45 : 1);
      const speed = p.spin * (0.6 + k2 * 0.22) * (k2 % 2 ? -1 : 1);
      const phase = k2 * 1.7;
      const hue = lerp(p.hueA, p.hueB, k2 / (rings - 1));
      ctx.beginPath();
      const steps = 96;
      for (let i = 0; i <= steps; i++) {
        const a = (i / steps) * TAU;
        const w =
          Math.sin(a * 3 + t * speed * 2 + phase) * 0.6 +
          Math.sin(a * 5 - t * speed * 1.4 + phase * 1.3) * 0.4 +
          Math.sin(a * 2 + t * 0.7 + phase) * 0.3;
        const r = base + w * amp;
        const x = cx + Math.cos(a) * r;
        const y = cy + Math.sin(a) * r;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.lineWidth = Math.max(1, (1.1 + energy * 1.6) * dpr * (1 - k2 * 0.1));
      ctx.strokeStyle = hsla(hue, p.sat, 66, (0.5 - k2 * 0.07) * (0.35 + p.glow * 0.65));
      ctx.stroke();
    }

    // 4) Spektrum-Ring (Sprechen / Zuhören)
    if (p.bars > 0.02 && !this.reduced) {
      const bars = 72;
      const inner = this.portrait ? R * 0.91 : R * 0.74;
      const barScale = this.portrait ? 0.4 : 1;
      ctx.lineCap = 'round';
      ctx.lineWidth = Math.max(1.5, R * 0.016);
      for (let i = 0; i < bars; i++) {
        const a = (i / bars) * TAU + t * 0.1;
        const n = noise(i * 0.55 + t * (this.state === 'speaking' ? 5.5 : 3));
        const len = R * (0.012 + (0.02 + Math.abs(n) * 0.14) * Math.min(1.4, level * 1.6 + 0.12) * p.bars) * barScale;
        const hue = lerp(p.hueB, p.hueA, 0.5 + 0.5 * Math.sin(a + t));
        ctx.strokeStyle = hsla(hue, p.sat, 70, 0.75 * p.bars);
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
        ctx.lineTo(cx + Math.cos(a) * (inner + len), cy + Math.sin(a) * (inner + len));
        ctx.stroke();
      }
    }

    // 5) Denken: kreisende Bögen
    if (p.orbit > 0.02) {
      ctx.lineCap = 'round';
      for (let i = 0; i < 3; i++) {
        const r = this.portrait ? R * (0.78 + i * 0.035) : R * (0.66 + i * 0.1);
        const start = t * (1.6 + i * 0.7) * (i % 2 ? -1 : 1) + i * 2.1;
        const len = 0.9 + 0.5 * Math.sin(t * 1.3 + i);
        ctx.beginPath();
        ctx.arc(cx, cy, r, start, start + len);
        ctx.lineWidth = Math.max(2, R * 0.022) * (1 - i * 0.2);
        ctx.strokeStyle = hsla(lerp(p.hueA, p.hueB, i / 2), p.sat, 72, 0.85 * p.orbit);
        ctx.stroke();
        // Funke am Bogenende
        const ex = cx + Math.cos(start + len) * r;
        const ey = cy + Math.sin(start + len) * r;
        const g = ctx.createRadialGradient(ex, ey, 0, ex, ey, R * 0.05);
        g.addColorStop(0, hsla(p.hueA, 90, 85, 0.9 * p.orbit));
        g.addColorStop(1, hsla(p.hueA, 90, 70, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(ex, ey, R * 0.05, 0, TAU);
        ctx.fill();
      }
    }

    // 6) Partikel
    const pSpeed = (0.3 + p.spin) * (1 + level);
    for (const part of this.particles) {
      part.a += part.s * dt * pSpeed * speedScale * 0.5;
      const wob = Math.sin(t * 0.8 + part.tw) * 0.02;
      const pr = this.portrait ? 0.9 + ((part.r - 0.62) / 0.45) * 0.1 : part.r;
      const r = R * (pr + wob) * (this.state === 'thinking' && !this.portrait ? 0.88 : 1);
      const x = cx + Math.cos(part.a) * r;
      const y = cy + Math.sin(part.a) * r;
      const tw = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * 2 + part.tw));
      ctx.fillStyle = hsla(lerp(p.hueA, p.hueB, (Math.sin(part.tw) + 1) / 2), p.sat, 78, tw * (0.15 + p.glow * 0.5));
      ctx.beginPath();
      ctx.arc(x, y, part.size * dpr, 0, TAU);
      ctx.fill();
    }

    ctx.globalCompositeOperation = 'source-over';
  }
}

function state2speed(state) {
  return state === 'sleeping' ? 1.1 : state === 'thinking' ? 4 : state === 'speaking' ? 3 : 2.2;
}
