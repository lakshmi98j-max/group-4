/*
 * ==========================================================================
 *  ALWAYS WIN FIGHTER - game.js
 *
 *  A browser-based 2D arcade fighter drawn entirely with the HTML5 Canvas
 *  API. Plain JavaScript, no build step, no external assets.
 *
 *  The joke: the fight is rigged. The Hero (player 1) always wins.
 *    - the Challenger's hits do 1-2 damage and the Hero never drops below 10%
 *    - if the player does nothing, the Challenger trips, gets tired, whiffs or
 *      sneezes until she knocks herself out
 *    - every round ends with "HERO WINS!"
 *
 *  File layout (search for the numbered banners):
 *    1. Constants and small utilities
 *    2. Sound          - Web Audio API synthesised effects (no audio files)
 *    3. Input          - keyboard + on-screen touch buttons
 *    4. FaceStore      - the circular face images drawn on each fighter's head
 *    5. Poses & clips  - skeleton animation data (keyframes and procedural clips)
 *    6. Rendering      - drawing a fighter from a pose (hair, face, limbs...)
 *    7. Fighter        - physics, state machine, attacks, player + AI control
 *    8. Background     - pixel-art arena (drawn at 1/3 resolution, upscaled)
 *    9. Game           - rounds, HUD, hit resolution, effects, main loop
 *   10. Screens        - DOM overlays (start / pause / victory / customize)
 *   11. Boot
 * ==========================================================================
 */
(function () {
'use strict';

/* ==========================================================================
   1. CONSTANTS AND UTILITIES
   ========================================================================== */
const W = 960, H = 540;             // logical canvas size; scaled to fit the window
const FLOOR_Y = 450;                // y of the arena floor (feet rest here)
const ARENA_LEFT = 48, ARENA_RIGHT = W - 48;
const GRAVITY = 1800;               // px / s^2
const ROUND_TIME = 60;              // seconds per round
const ROUNDS_TO_WIN = 2;            // best of 3
const HERO_MIN_HP = 10;             // THE RIG: the Hero's health can never drop below 10%
const PUSH_DISTANCE = 52;           // fighters cannot overlap closer than this
const BLEND_TIME = 0.1;             // seconds to blend between animation poses
const BG_SCALE = 3;                 // background drawn at 1/3 resolution for a pixel-art look
const IDLE_PLAYER_SECONDS = 4;      // no attack input for this long = "player is doing nothing"
const TAU = Math.PI * 2;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const smooth = (t) => t * t * (3 - 2 * t);                // smoothstep easing
const easeOut = (t) => 1 - Math.pow(1 - t, 3);

/** Linear interpolation between two pose objects (numbers and nested objects). */
function lerpPose(a, b, t) {
  const out = {};
  for (const k in a) {
    const av = a[k], bv = b[k] === undefined ? av : b[k];
    out[k] = typeof av === 'number' ? av + (bv - av) * t : lerpPose(av, bv, t);
  }
  return out;
}

/** Tiny seeded random generator so the background looks the same every frame. */
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

/** Chunky outlined arcade text used for banners, pop-ups and the HUD. */
function arcadeText(ctx, text, x, y, size, fill, stroke, align = 'center', italic = true) {
  ctx.font = `${italic ? 'italic ' : ''}900 ${size}px Impact, "Arial Black", Haettenschweiler, sans-serif`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  if (stroke) {
    ctx.lineWidth = Math.max(2, size * 0.14);
    ctx.strokeStyle = stroke;
    ctx.strokeText(text, x, y);
  }
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
}

function circleRectHit(cx, cy, r, box) {
  const nx = clamp(cx, box.x, box.x + box.w);
  const ny = clamp(cy, box.y, box.y + box.h);
  const dx = cx - nx, dy = cy - ny;
  return dx * dx + dy * dy <= r * r;
}

/* ==========================================================================
   2. SOUND - everything is synthesised with the Web Audio API
   ========================================================================== */
const Sound = (() => {
  let ctx = null, master = null, noiseBuf = null;
  let muted = false, unlocked = false;

  /** Create (or resume) the AudioContext. Browsers only allow this after a user gesture. */
  function ensure() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.6;
      master.connect(ctx.destination);
      // One second of white noise, reused by every noise-based effect.
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function envelope(gain, t0, peak, attack, decay) {
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.linearRampToValueAtTime(peak, t0 + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
  }

  /** A single oscillator sweeping from f0 to f1. */
  function tone({ type = 'sine', f0 = 440, f1 = f0, dur = 0.2, vol = 0.3, attack = 0.005, delay = 0 }) {
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur);
    const g = ctx.createGain();
    envelope(g, t0, vol, attack, dur);
    osc.connect(g).connect(master);
    osc.start(t0);
    osc.stop(t0 + attack + dur + 0.05);
  }

  /** Filtered noise burst (punch impacts, whooshes, thuds). */
  function noise({ dur = 0.15, vol = 0.3, type = 'bandpass', f0 = 800, f1 = f0, q = 1, attack = 0.002, delay = 0 }) {
    const t0 = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf; src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = type; filter.Q.value = q;
    filter.frequency.setValueAtTime(f0, t0);
    filter.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur);
    const g = ctx.createGain();
    envelope(g, t0, vol, attack, dur);
    src.connect(filter).connect(g).connect(master);
    src.start(t0);
    src.stop(t0 + attack + dur + 0.05);
  }

  const fx = {
    punch()  { noise({ dur: 0.09, vol: 0.5, f0: 1400, f1: 300, q: 0.8 }); tone({ f0: 160, f1: 50, dur: 0.12, vol: 0.5 }); },
    power()  { noise({ dur: 0.22, vol: 0.6, f0: 900, f1: 120, q: 0.7 }); tone({ type: 'square', f0: 120, f1: 30, dur: 0.28, vol: 0.3 }); tone({ f0: 70, f1: 35, dur: 0.3, vol: 0.6 }); },
    whoosh() { noise({ dur: 0.32, vol: 0.25, f0: 300, f1: 2200, q: 1.2, attack: 0.1 }); },
    block()  { tone({ type: 'square', f0: 700, f1: 500, dur: 0.07, vol: 0.18 }); noise({ dur: 0.05, vol: 0.25, type: 'highpass', f0: 3000 }); },
    poke()   { tone({ type: 'triangle', f0: 520, f1: 380, dur: 0.08, vol: 0.2 }); },
    jump()   { tone({ f0: 220, f1: 520, dur: 0.16, vol: 0.15 }); },
    land()   { noise({ dur: 0.08, vol: 0.2, type: 'lowpass', f0: 400, f1: 100 }); },
    ko()     { noise({ dur: 0.6, vol: 0.6, f0: 1200, f1: 60, q: 0.5 }); tone({ type: 'sawtooth', f0: 320, f1: 30, dur: 0.9, vol: 0.3 }); tone({ f0: 90, f1: 25, dur: 0.8, vol: 0.6 }); },
    round()  { tone({ type: 'square', f0: 440, dur: 0.18, vol: 0.18 }); tone({ type: 'square', f0: 660, dur: 0.25, vol: 0.18, delay: 0.18 }); },
    fight()  { tone({ type: 'square', f0: 330, dur: 0.12, vol: 0.2 }); tone({ type: 'square', f0: 494, dur: 0.12, vol: 0.2, delay: 0.12 }); tone({ type: 'square', f0: 659, dur: 0.35, vol: 0.22, delay: 0.24 }); noise({ dur: 0.3, vol: 0.15, f0: 200, f1: 1500, delay: 0.24 }); },
    timeup() { tone({ type: 'square', f0: 600, dur: 0.15, vol: 0.2 }); tone({ type: 'square', f0: 600, dur: 0.15, vol: 0.2, delay: 0.2 }); tone({ type: 'square', f0: 300, f1: 200, dur: 0.5, vol: 0.2, delay: 0.4 }); },
    victory() {
      [523, 659, 784, 1046, 784, 1046].forEach((f, i) => {
        tone({ type: 'square', f0: f, dur: 0.18, vol: 0.15, delay: i * 0.11 });
        tone({ type: 'triangle', f0: f / 2, dur: 0.2, vol: 0.15, delay: i * 0.11 });
      });
    },
    trip()   { tone({ f0: 900, f1: 150, dur: 0.45, vol: 0.22 }); },                       // slide whistle
    thud()   { noise({ dur: 0.12, vol: 0.5, type: 'lowpass', f0: 500, f1: 80 }); tone({ f0: 90, f1: 40, dur: 0.15, vol: 0.5 }); },
    tired()  { noise({ dur: 0.35, vol: 0.12, f0: 500, f1: 250, q: 2, attack: 0.1 }); },
    sneeze() { noise({ dur: 0.08, vol: 0.2, f0: 1500, f1: 2500, attack: 0.05 }); noise({ dur: 0.18, vol: 0.45, f0: 2500, f1: 400, delay: 0.1 }); tone({ type: 'sawtooth', f0: 700, f1: 200, dur: 0.2, vol: 0.12, delay: 0.1 }); },
    dizzy()  { for (let i = 0; i < 4; i++) tone({ f0: 600 + i * 80, f1: 500 + i * 80, dur: 0.12, vol: 0.08, delay: i * 0.12 }); },
    ui()     { tone({ type: 'square', f0: 880, dur: 0.05, vol: 0.08 }); },
    plot()   { tone({ type: 'triangle', f0: 1046, f1: 1568, dur: 0.2, vol: 0.15 }); },     // "plot armor" chime
  };

  return {
    /** Call from a user gesture (key press, tap): creates or resumes the AudioContext. */
    unlock() { unlocked = true; try { ensure(); } catch (e) { /* audio is optional */ } },
    play(name) {
      if (!unlocked) return;                               // browsers block audio before the first gesture
      try { if (!ensure() || !fx[name]) return; fx[name](); } catch (e) { /* audio is optional */ }
    },
    setMuted(m) { muted = m; if (master) master.gain.value = m ? 0 : 0.6; },
    get muted() { return muted; },
  };
})();

/* ==========================================================================
   3. INPUT - keyboard and touch buttons are merged into named actions
   ========================================================================== */
const Input = (() => {
  const ACTIONS = ['left', 'right', 'jump', 'block', 'jab', 'power', 'start', 'pause'];
  const KEYMAP = {
    ArrowLeft: 'left', a: 'left', A: 'left',
    ArrowRight: 'right', d: 'right', D: 'right',
    ArrowUp: 'jump', w: 'jump', W: 'jump',
    ArrowDown: 'block', s: 'block', S: 'block',
    j: 'jab', J: 'jab',
    k: 'power', K: 'power',
    Enter: 'start', ' ': 'start',
    p: 'pause', P: 'pause', Escape: 'pause',
  };
  const keys = {}, touch = {}, cur = {}, prev = {}, pending = {};
  const listeners = [];

  const isDown = (a) => !!(keys[a] || touch[a]);

  /**
   * Called once per frame so pressed() can detect the rising edge of a button.
   * `pending` keeps a press alive until the next frame even if the key was
   * released in between, so very quick taps are never lost.
   */
  function update() {
    for (const a of ACTIONS) { prev[a] = !!cur[a]; cur[a] = isDown(a) || !!pending[a]; pending[a] = false; }
  }

  window.addEventListener('keydown', (e) => {
    const action = KEYMAP[e.key];
    if (!action) return;
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;   // leave form controls alone
    if (action === 'start' && (tag === 'BUTTON' || tag === 'LABEL' || tag === 'A')) return;   // Enter/Space activate the focused button
    keys[action] = true;
    if (!e.repeat) { pending[action] = true; listeners.forEach((fn) => fn(action, e)); }
    if (action !== 'pause' || e.key === 'Escape') e.preventDefault();         // no page scrolling on arrows/space
  });
  window.addEventListener('keyup', (e) => {
    const action = KEYMAP[e.key];
    if (action) keys[action] = false;
  });
  window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

  /** Wire the on-screen buttons. Pointer events give us multi-touch for free. */
  function bindTouch(container) {
    container.querySelectorAll('[data-action]').forEach((btn) => {
      const action = btn.dataset.action;
      const down = (e) => {
        e.preventDefault();
        if (btn.setPointerCapture) { try { btn.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ } }
        touch[action] = true; pending[action] = true;
        btn.classList.add('active');
        listeners.forEach((fn) => fn(action, e));
      };
      const up = (e) => { e.preventDefault(); touch[action] = false; btn.classList.remove('active'); };
      btn.addEventListener('pointerdown', down);
      btn.addEventListener('pointerup', up);
      btn.addEventListener('pointercancel', up);
      btn.addEventListener('lostpointercapture', up);
      btn.addEventListener('contextmenu', (e) => e.preventDefault());
    });
  }

  return {
    update, bindTouch,
    held: (a) => !!cur[a],
    pressed: (a) => !!cur[a] && !prev[a],
    onPress: (fn) => listeners.push(fn),
    clear() { for (const k in keys) keys[k] = false; for (const k in touch) touch[k] = false; for (const k in pending) pending[k] = false; },
  };
})();

/* ==========================================================================
   4. FACES - each fighter's head is a circle showing a 256x256 face image.
      The default faces are cartoon faces drawn here with the Canvas API, one
      per expression. A custom (uploaded) face replaces all expressions.
   ========================================================================== */
const FACE_SIZE = 256;
const EXPRESSIONS = ['normal', 'angry', 'hurt', 'happy', 'dizzy', 'tired'];

const FaceStore = (() => {
  const data = {
    hero: { custom: null, defaults: {} },
    challenger: { custom: null, defaults: {} },
  };
  const listeners = [];

  function buildDefaults(who) {
    for (const ex of EXPRESSIONS) {
      const c = makeCanvas(FACE_SIZE, FACE_SIZE);
      drawDefaultFace(c.getContext('2d'), FACE_SIZE, who, ex);
      data[who].defaults[ex] = c;
    }
  }

  return {
    init() { buildDefaults('hero'); buildDefaults('challenger'); },
    /** The canvas to draw on the head for this fighter and expression. */
    get(who, expr) {
      const d = data[who];
      if (d.custom) return d.custom;
      return d.defaults[expr] || d.defaults.normal;
    },
    getDefault(who, expr) { return data[who].defaults[expr || 'normal']; },
    /** Set a custom circular face canvas (FACE_SIZE square) or null to use the default. */
    setCustom(who, canvas) { data[who].custom = canvas; listeners.forEach((fn) => fn(who)); },
    hasCustom(who) { return !!data[who].custom; },
    onChange(fn) { listeners.push(fn); },
  };
})();

function fillEllipse(ctx, x, y, rx, ry) {
  ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, TAU); ctx.fill();
}

function strokeLine(ctx, x1, y1, x2, y2, width, color) {
  ctx.lineCap = 'round'; ctx.lineWidth = width; ctx.strokeStyle = color;
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
}

/**
 * Draws a cartoon face filling a `size` x `size` canvas (the whole canvas is the
 * head). Designed on a 256-unit grid; the fighter faces to the right.
 */
function drawDefaultFace(ctx, size, who, expr) {
  const u = size / 256;
  const hero = who === 'hero';
  const skin = hero ? '#f4c99a' : '#edb98f';
  const shade = hero ? '#d9a06c' : '#d49a73';
  const ink = '#2a1b2e';
  const iris = hero ? '#2b4fd6' : '#2e8b57';
  const lip = '#d62852';

  ctx.save();
  ctx.scale(u, u);
  ctx.clearRect(0, 0, 256, 256);

  // Skin disc with a soft shadow on the lower half.
  ctx.fillStyle = skin;
  ctx.beginPath(); ctx.arc(128, 128, 128, 0, TAU); ctx.fill();
  ctx.fillStyle = shade; ctx.globalAlpha = 0.28;
  ctx.beginPath(); ctx.arc(128, 160, 128, 0.12 * Math.PI, 0.88 * Math.PI); ctx.fill();
  ctx.globalAlpha = 1;

  // Blush: always on the challenger, on the hero only when he's happy.
  if (!hero || expr === 'happy') {
    ctx.fillStyle = '#ff7f9f'; ctx.globalAlpha = expr === 'happy' ? 0.55 : 0.35;
    fillEllipse(ctx, 68, 156, 20, 11); fillEllipse(ctx, 188, 156, 20, 11);
    ctx.globalAlpha = 1;
  }

  // ---- eyes ------------------------------------------------------------
  const eyes = [{ x: 90, y: 112 }, { x: 166, y: 112 }];
  const eyeRy = hero ? 17 : 20;
  for (let i = 0; i < 2; i++) {
    const { x, y } = eyes[i];
    const outer = i === 0 ? -1 : 1;                     // direction away from the nose
    if (expr === 'hurt') {
      // squeezed shut: "> <"
      strokeLine(ctx, x + outer * 14, y - 12, x - outer * 8, y, 7, ink);
      strokeLine(ctx, x + outer * 14, y + 12, x - outer * 8, y, 7, ink);
    } else if (expr === 'happy') {
      // closed, smiling arcs
      ctx.lineCap = 'round'; ctx.lineWidth = 7; ctx.strokeStyle = ink;
      ctx.beginPath(); ctx.moveTo(x - 17, y + 4); ctx.quadraticCurveTo(x, y - 18, x + 17, y + 4); ctx.stroke();
    } else if (expr === 'dizzy') {
      // spiral eyes
      ctx.lineCap = 'round'; ctx.lineWidth = 4; ctx.strokeStyle = ink;
      ctx.beginPath();
      for (let a = 0; a < TAU * 2.6; a += 0.15) {
        const r = a * 2.4;
        const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
        if (a === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.stroke();
    } else {
      // open eye: white, iris, pupil, highlight
      ctx.fillStyle = '#ffffff'; fillEllipse(ctx, x, y, 22, eyeRy);
      const look = expr === 'tired' ? 0 : 4;
      const down = expr === 'tired' ? 5 : 1;
      ctx.fillStyle = iris; ctx.beginPath(); ctx.arc(x + look, y + down, 9.5, 0, TAU); ctx.fill();
      ctx.fillStyle = ink; ctx.beginPath(); ctx.arc(x + look, y + down, 4.5, 0, TAU); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x + look + 3, y + down - 4, 2.5, 0, TAU); ctx.fill();
      // eyelid for narrowed eyes
      if (expr === 'angry' || expr === 'tired') {
        ctx.fillStyle = skin;
        const lid = expr === 'angry' ? 9 : 12;
        ctx.beginPath(); ctx.ellipse(x, y - eyeRy + lid - 2, 24, eyeRy, 0, 0, TAU); ctx.fill();
        strokeLine(ctx, x - 20, y - eyeRy + lid + 2, x + 20, y - eyeRy + lid + 2, 4, ink);
      }
      ctx.lineWidth = 3; ctx.strokeStyle = ink;
      ctx.beginPath(); ctx.ellipse(x, y, 22, eyeRy, 0, 0, TAU); ctx.stroke();
      // lashes for the challenger
      if (!hero) {
        for (let k = 0; k < 3; k++) {
          const a = -Math.PI / 2 + outer * (0.35 + k * 0.3);
          const sx = x + Math.cos(a) * 22, sy = y + Math.sin(a) * eyeRy;
          strokeLine(ctx, sx, sy, sx + Math.cos(a) * 9, sy + Math.sin(a) * 9, 3.5, ink);
        }
      }
    }
    // ---- eyebrow ----
    const browW = hero ? 9 : 6;
    const browY = y - (hero ? 30 : 32);
    let inner = 0, outerLift = 0;                       // vertical offsets at the inner / outer ends
    if (expr === 'angry') { inner = 12; outerLift = -4; }
    else if (expr === 'hurt') { inner = -8; outerLift = -8; }
    else if (expr === 'happy') { inner = -6; outerLift = -6; }
    else if (expr === 'tired') { inner = -4; outerLift = 8; }
    else if (expr === 'dizzy') { inner = -6; outerLift = 4; }
    else if (hero) { inner = 5; }                       // the hero always looks a little determined
    ctx.lineCap = 'round'; ctx.lineWidth = browW; ctx.strokeStyle = hero ? ink : '#5a1e2b';
    ctx.beginPath();
    ctx.moveTo(x - outer * 20, browY + inner);          // inner end (toward nose)
    ctx.quadraticCurveTo(x, browY - 6 + (inner + outerLift) / 2, x + outer * 20, browY + outerLift);
    ctx.stroke();
  }

  // ---- nose ------------------------------------------------------------
  ctx.lineCap = 'round'; ctx.lineWidth = 5; ctx.strokeStyle = shade;
  ctx.beginPath(); ctx.moveTo(126, 132); ctx.quadraticCurveTo(142, 152, 126, 158); ctx.stroke();

  // ---- mouth -----------------------------------------------------------
  const mx = 134, my = 190;
  ctx.lineCap = 'round';
  if (expr === 'angry') {
    // open shout with gritted teeth
    ctx.fillStyle = '#5a1a1a'; fillEllipse(ctx, mx, my, 26, 16);
    ctx.save(); ctx.beginPath(); ctx.ellipse(mx, my, 26, 16, 0, 0, TAU); ctx.clip();
    ctx.fillStyle = '#fff'; ctx.fillRect(mx - 30, my - 18, 60, 12);
    ctx.strokeStyle = '#999'; ctx.lineWidth = 1.5;
    for (let tx = mx - 20; tx <= mx + 20; tx += 10) { ctx.beginPath(); ctx.moveTo(tx, my - 18); ctx.lineTo(tx, my - 6); ctx.stroke(); }
    ctx.restore();
    ctx.lineWidth = 5; ctx.strokeStyle = hero ? ink : lip;
    ctx.beginPath(); ctx.ellipse(mx, my, 26, 16, 0, 0, TAU); ctx.stroke();
  } else if (expr === 'hurt') {
    ctx.fillStyle = '#5a1a1a'; fillEllipse(ctx, mx, my + 2, 13, 17);
    ctx.lineWidth = 5; ctx.strokeStyle = hero ? ink : lip;
    ctx.beginPath(); ctx.ellipse(mx, my + 2, 13, 17, 0, 0, TAU); ctx.stroke();
  } else if (expr === 'happy') {
    // big grin: lower half-ellipse with a row of teeth
    ctx.fillStyle = '#5a1a1a';
    ctx.beginPath(); ctx.ellipse(mx, my - 6, 36, 24, 0, 0, Math.PI); ctx.closePath(); ctx.fill();
    ctx.save(); ctx.beginPath(); ctx.ellipse(mx, my - 6, 36, 24, 0, 0, Math.PI); ctx.closePath(); ctx.clip();
    ctx.fillStyle = '#fff'; ctx.fillRect(mx - 40, my - 8, 80, 10); ctx.restore();
    ctx.lineWidth = 5; ctx.strokeStyle = hero ? ink : lip;
    ctx.beginPath(); ctx.ellipse(mx, my - 6, 36, 24, 0, 0, Math.PI); ctx.closePath(); ctx.stroke();
  } else if (expr === 'dizzy') {
    ctx.lineWidth = 6; ctx.strokeStyle = hero ? ink : lip;
    ctx.beginPath();
    for (let i = 0; i <= 12; i++) {
      const px = mx - 30 + i * 5, py = my + Math.sin(i * 1.3) * 5;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.stroke();
    ctx.fillStyle = '#ff7f9f'; fillEllipse(ctx, mx + 14, my + 12, 8, 10);     // tongue out
  } else if (expr === 'tired') {
    ctx.fillStyle = '#5a1a1a'; fillEllipse(ctx, mx, my + 4, 11, 12);
    ctx.lineWidth = 4; ctx.strokeStyle = hero ? ink : lip;
    ctx.beginPath(); ctx.ellipse(mx, my + 4, 11, 12, 0, 0, TAU); ctx.stroke();
  } else if (hero) {
    // confident smirk
    ctx.lineWidth = 7; ctx.strokeStyle = ink;
    ctx.beginPath(); ctx.moveTo(104, my - 6); ctx.quadraticCurveTo(132, my + 10, 166, my - 14); ctx.stroke();
  } else {
    // glossy lips
    ctx.fillStyle = lip;
    ctx.beginPath(); ctx.moveTo(108, my - 4);
    ctx.quadraticCurveTo(122, my - 16, 134, my - 6); ctx.quadraticCurveTo(146, my - 16, 160, my - 4);
    ctx.quadraticCurveTo(136, my + 14, 108, my - 4); ctx.fill();
    strokeLine(ctx, 110, my - 3, 158, my - 3, 2.5, '#7a1030');
  }

  // ---- little extras ---------------------------------------------------
  if (hero) {
    // a plaster on the cheek: battle-tested
    ctx.save(); ctx.translate(184, 170); ctx.rotate(-0.5);
    ctx.fillStyle = '#f1d9b5'; ctx.fillRect(-14, -5, 28, 10);
    ctx.fillStyle = '#e4c49a'; ctx.fillRect(-4, -5, 8, 10);
    ctx.restore();
  } else {
    ctx.fillStyle = ink; ctx.beginPath(); ctx.arc(168, 176, 3.5, 0, TAU); ctx.fill();   // beauty mark
  }
  if (expr === 'hurt' || expr === 'tired' || expr === 'dizzy') drawSweatDrop(ctx, 206, 78);
  if (expr === 'tired') drawSweatDrop(ctx, 48, 86);

  ctx.restore();
}

function drawSweatDrop(ctx, x, y) {
  ctx.fillStyle = '#8fd3ff'; ctx.strokeStyle = '#2a6f97'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(x, y - 16);
  ctx.quadraticCurveTo(x + 12, y + 2, x, y + 12);
  ctx.quadraticCurveTo(x - 12, y + 2, x, y - 16);
  ctx.fill(); ctx.stroke();
}

/* ==========================================================================
   5. POSES AND ANIMATION CLIPS
      A pose describes the skeleton in the fighter's own frame (facing +x,
      origin at the hip):
        hipH      height of the hip above the ground
        bodyAngle rotation of the whole body around the hip (±PI/2 = lying)
        lean      torso lean (+ forward)
        headTilt  extra head rotation
        armF/armB front and back arm: s = shoulder angle (0 = hanging down,
                  PI/2 = straight forward), e = elbow bend (+ bends forward)
        footF/footB foot position relative to the hip (y down; y == hipH
                  means the foot is on the ground). Knees come from IK.
      A clip is a function (time, fighter) -> pose.
   ========================================================================== */
function stand(hipH, fx, bx, extra = {}) {
  return Object.assign({
    hipH, bodyAngle: 0, lean: 0.05, headTilt: 0,
    armF: { s: 1.15, e: 1.95 }, armB: { s: 0.85, e: 2.1 },
    footF: { x: fx, y: hipH }, footB: { x: bx, y: hipH },
  }, extra);
}

/** Builds a clip from absolute-time keyframes with smooth interpolation. */
function keyframes(frames) {
  const last = frames[frames.length - 1];
  return (time) => {
    if (time <= frames[0].t) return frames[0].pose;
    if (time >= last.t) return last.pose;
    for (let i = 1; i < frames.length; i++) {
      if (time <= frames[i].t) {
        const a = frames[i - 1], b = frames[i];
        return lerpPose(a.pose, b.pose, smooth((time - a.t) / (b.t - a.t)));
      }
    }
    return last.pose;
  };
}

const IDLE_POSE  = stand(72, 16, -18);
const CROUCH     = stand(50, 24, -24, { lean: 0.25 });
const BLOCK_POSE = stand(64, 20, -22, { lean: 0.08, headTilt: 0.1, armF: { s: 1.05, e: 2.45 }, armB: { s: 1.35, e: 2.25 } });
const JUMP_POSE  = { hipH: 72, bodyAngle: 0, lean: 0.05, headTilt: -0.05, armF: { s: 1.5, e: 1.5 }, armB: { s: 0.5, e: 2.0 }, footF: { x: 14, y: 52 }, footB: { x: -8, y: 46 } };
const LAND_POSE  = stand(58, 20, -20, { lean: 0.2 });
const HURT_POSE  = stand(70, 12, -26, { lean: -0.3, headTilt: -0.35, armF: { s: 1.1, e: 0.9 }, armB: { s: 0.9, e: 0.5 } });
const HURT_LIGHT = stand(71, 14, -22, { lean: -0.15, headTilt: -0.2, armF: { s: 1.2, e: 1.6 }, armB: { s: 0.9, e: 1.5 } });
const LIE_BACK   = { hipH: 22, bodyAngle: -Math.PI / 2, lean: 0.1, headTilt: 0.25, armF: { s: 2.6, e: 0.3 }, armB: { s: 2.9, e: 0.2 }, footF: { x: 14, y: 66 }, footB: { x: -4, y: 70 } };
const LIE_FRONT  = { hipH: 22, bodyAngle: Math.PI / 2, lean: -0.1, headTilt: -0.3, armF: { s: 2.7, e: 0.3 }, armB: { s: 2.4, e: 0.5 }, footF: { x: 8, y: 68 }, footB: { x: -6, y: 66 } };
const KNEEL      = { hipH: 42, bodyAngle: 0, lean: 0.35, headTilt: 0.3, armF: { s: 0.9, e: 0.4 }, armB: { s: 0.8, e: 0.5 }, footF: { x: 28, y: 42 }, footB: { x: -34, y: 40 } };
const TIRED_POSE = { hipH: 62, bodyAngle: 0, lean: 0.75, headTilt: 0.35, armF: { s: 1.0, e: 0.3 }, armB: { s: 0.95, e: 0.35 }, footF: { x: 20, y: 62 }, footB: { x: -20, y: 62 } };
const STUMBLE    = stand(60, 34, -34, { lean: 0.7, headTilt: 0.2, armF: { s: 2.0, e: 0.3 }, armB: { s: 1.6, e: 0.6 } });

const FALL_BACK_KF = keyframes([
  { t: 0, pose: HURT_POSE },
  { t: 0.3, pose: { ...LIE_BACK, hipH: 16 } },
  { t: 0.4, pose: { ...LIE_BACK, hipH: 27 } },
  { t: 0.55, pose: LIE_BACK },
]);
const FALL_FRONT_KF = keyframes([
  { t: 0, pose: STUMBLE },
  { t: 0.3, pose: { ...LIE_FRONT, hipH: 16 } },
  { t: 0.4, pose: { ...LIE_FRONT, hipH: 27 } },
  { t: 0.55, pose: LIE_FRONT },
]);
const GETUP_KF = keyframes([
  { t: 0, pose: LIE_BACK },
  { t: 0.3, pose: CROUCH },
  { t: 0.55, pose: IDLE_POSE },
]);
const DEFEAT_KF = keyframes([
  { t: 0, pose: IDLE_POSE },
  { t: 0.5, pose: TIRED_POSE },
  { t: 0.9, pose: KNEEL },
  { t: 1.3, pose: { ...LIE_FRONT, hipH: 16 } },
  { t: 1.6, pose: LIE_FRONT },
]);
const TRIP_KF = keyframes([
  { t: 0.5, pose: stand(70, 20, -20, { lean: 0.32 }) },
  { t: 0.75, pose: STUMBLE },
  { t: 1.05, pose: { ...LIE_FRONT, hipH: 16 } },
  { t: 1.15, pose: { ...LIE_FRONT, hipH: 27 } },
  { t: 1.3, pose: LIE_FRONT },
  { t: 2.1, pose: LIE_FRONT },
  { t: 2.35, pose: KNEEL },
  { t: 2.6, pose: IDLE_POSE },
]);
const WHIFF_KF = keyframes([
  { t: 0, pose: IDLE_POSE },
  { t: 0.4, pose: stand(66, 14, -28, { lean: -0.3, headTilt: -0.1, armB: { s: -1.3, e: 0.9 }, armF: { s: 1.3, e: 1.8 } }) },
  { t: 0.45, pose: stand(66, 14, -28, { lean: -0.32, headTilt: -0.1, armB: { s: -1.35, e: 0.9 }, armF: { s: 1.3, e: 1.8 } }) },
  { t: 0.6, pose: stand(64, 34, -8, { lean: 0.55, headTilt: 0.3, armB: { s: 2.3, e: 0.0 }, armF: { s: 0.4, e: 1.6 } }) },
  { t: 0.75, pose: stand(68, 22, -18, { lean: 0.25, headTilt: 0.2, armB: { s: 1.2, e: 0.3 }, armF: { s: 0.6, e: 0.4 } }) },
]);
const SNEEZE_KF = keyframes([
  { t: 0, pose: IDLE_POSE },
  { t: 0.35, pose: stand(72, 14, -18, { lean: -0.2, headTilt: -0.45, armF: { s: 1.45, e: 2.35 }, armB: { s: 0.6, e: 1.0 } }) },
  { t: 0.55, pose: stand(72, 14, -18, { lean: -0.28, headTilt: -0.55, armF: { s: 1.45, e: 2.4 }, armB: { s: 0.6, e: 1.0 } }) },
  { t: 0.65, pose: stand(66, 20, -22, { lean: 0.55, headTilt: 0.5, armF: { s: 1.0, e: 1.5 }, armB: { s: 0.8, e: 0.9 } }) },
  { t: 0.9, pose: stand(68, 18, -20, { lean: 0.35, headTilt: 0.3, armF: { s: 1.0, e: 1.5 }, armB: { s: 0.8, e: 0.9 } }) },
  { t: 1.4, pose: IDLE_POSE },
]);

const CLIPS = {
  idle(t) {
    const b = Math.sin(t * 3.2);
    return stand(72 + b * 1.2, 16, -18, {
      lean: 0.05 + b * 0.01,
      armF: { s: 1.15 + b * 0.04, e: 1.95 }, armB: { s: 0.85 + b * 0.04, e: 2.1 },
    });
  },
  /** Procedural walk cycle. f.walkDir is +1 when walking forward, -1 backward. */
  walk(t, f) {
    const dir = f.walkDir || 1;
    const ph = (t / 0.5) * TAU * dir;
    const stride = 18, lift = 12;
    const sF = Math.sin(ph);
    const hipH = 71 + Math.abs(sF) * 2;
    return {
      hipH, bodyAngle: 0, lean: 0.08 * dir, headTilt: 0,
      armF: { s: 1.15 + 0.12 * sF, e: 1.95 }, armB: { s: 0.85 - 0.12 * sF, e: 2.1 },
      footF: { x: Math.cos(ph) * stride + 4, y: hipH - Math.max(0, -sF) * lift },
      footB: { x: -Math.cos(ph) * stride - 4, y: hipH - Math.max(0, sF) * lift },
    };
  },
  jump: () => JUMP_POSE,
  land: () => LAND_POSE,
  block: () => BLOCK_POSE,
  hurt: (t, f) => (f.isHero ? HURT_LIGHT : HURT_POSE),
  fall: FALL_BACK_KF,
  fallFront: FALL_FRONT_KF,
  lieBack: () => LIE_BACK,
  lieFront: () => LIE_FRONT,
  getup: GETUP_KF,
  defeat: DEFEAT_KF,
  taunt(t) {
    const b = Math.sin(t * 8);
    return stand(72, 14, -16, { lean: -0.08 + b * 0.03, headTilt: -0.1 + b * 0.08, armF: { s: 0.55, e: 2.5 }, armB: { s: 0.55, e: 2.5 } });
  },
  victory(t) {
    const ph = t * 7, hop = Math.max(0, Math.sin(ph));
    return stand(74, 14, -14, {
      lean: -0.1, headTilt: -0.25,
      armF: { s: 2.9 + 0.12 * Math.sin(ph), e: 0.15 }, armB: { s: 2.7 - 0.12 * Math.sin(ph), e: 0.25 },
      footF: { x: 14, y: 74 - hop * 10 }, footB: { x: -14, y: 74 },
    });
  },
  tired(t) {
    const b = Math.sin(t * 9);
    return { ...TIRED_POSE, lean: 0.75 + b * 0.06, headTilt: 0.35 + b * 0.05 };
  },
  trip(t) {
    if (t < 0.5) {                       // a short run-up before the fall
      const p = CLIPS.walk(t * 1.7, { walkDir: 1 });
      p.lean = 0.32; p.armF = { s: 1.4, e: 1.4 }; p.armB = { s: 0.6, e: 1.6 };
      return p;
    }
    return TRIP_KF(t);
  },
  whiff(t) {
    if (t < 0.75) return WHIFF_KF(t);
    const w = Math.min(1, (t - 0.75) / 0.3);          // dizzy wobble after the big miss
    const p = stand(69, 20, -20, { lean: 0.15, armF: { s: 0.65, e: 0.5 }, armB: { s: 0.55, e: 0.4 } });
    p.lean += Math.sin(t * 8) * 0.18 * w;
    p.headTilt = Math.sin(t * 6) * 0.35 * w;
    return p;
  },
  sneeze: SNEEZE_KF,
};

/* ----- attacks: timing, damage and the animation that goes with them ------ */
const JAB_STRIKE = stand(71, 26, -14, { lean: 0.22, armF: { s: 1.62, e: 0.0 }, armB: { s: 0.8, e: 2.2 } });
const POWER_WINDUP = stand(66, 14, -28, { lean: -0.18, headTilt: -0.05, armB: { s: -0.9, e: 1.4 }, armF: { s: 1.25, e: 1.9 } });
const POWER_STRIKE = stand(66, 36, -10, { lean: 0.42, headTilt: 0.1, armB: { s: 1.75, e: 0.0 }, armF: { s: 0.55, e: 2.3 } });
const CH_JAB_STRIKE = stand(71, 24, -14, { lean: 0.18, armF: { s: 1.6, e: 0.0 }, armB: { s: 0.85, e: 2.2 } });
const KICK_POSE = { hipH: 70, bodyAngle: 0, lean: -0.25, headTilt: 0.05, armF: { s: 0.3, e: 1.2 }, armB: { s: 0.2, e: 1.0 }, footF: { x: 62, y: 14 }, footB: { x: -10, y: 70 } };

const ATTACKS = {
  hero_jab: {
    name: 'jab', startup: 0.07, active: 0.08, recovery: 0.17,
    damage: 7, hitstun: 0.35, knockback: 180, hitPoint: 'fistF', radius: 22, shake: 6, lunge: 120,
    sound: 'punch', words: ['POW!', 'BAM!', 'BIFF!', 'SOCK!', 'WHAP!', 'THWACK!'],
    clip: keyframes([
      { t: 0, pose: IDLE_POSE },
      { t: 0.07, pose: stand(72, 20, -16, { lean: 0.12, armF: { s: 1.35, e: 1.1 }, armB: { s: 0.9, e: 2.1 } }) },
      { t: 0.09, pose: JAB_STRIKE },
      { t: 0.15, pose: JAB_STRIKE },
      { t: 0.32, pose: IDLE_POSE },
    ]),
  },
  hero_power: {
    name: 'power', startup: 0.36, active: 0.12, recovery: 0.32,
    damage: 16, hitstun: 0.6, knockback: 460, hitPoint: 'fistB', radius: 26, shake: 16, lunge: 260,
    sound: 'power', windupSound: 'whoosh', guardBreak: true, knockdown: true, knockdownChance: 0.55,
    words: ['KAPOW!!', 'WHAM!!', 'BOOM!!', 'CRUNCH!!', 'KA-BLAM!!'],
    clip: keyframes([
      { t: 0, pose: IDLE_POSE },
      { t: 0.28, pose: POWER_WINDUP },
      { t: 0.36, pose: { ...POWER_WINDUP, lean: -0.22, armB: { s: -1.0, e: 1.4 } } },
      { t: 0.42, pose: POWER_STRIKE },
      { t: 0.48, pose: POWER_STRIKE },
      { t: 0.8, pose: IDLE_POSE },
    ]),
  },
  ch_jab: {
    name: 'jab', startup: 0.11, active: 0.08, recovery: 0.26,
    damage: 1, hitstun: 0.12, knockback: 70, hitPoint: 'fistF', radius: 18, shake: 1.5, lunge: 60,
    sound: 'poke', words: ['poke', 'tap', 'pat', 'boop', 'bonk'],
    clip: keyframes([
      { t: 0, pose: IDLE_POSE },
      { t: 0.11, pose: stand(72, 18, -16, { lean: 0.1, armF: { s: 1.3, e: 1.2 } }) },
      { t: 0.13, pose: CH_JAB_STRIKE },
      { t: 0.19, pose: CH_JAB_STRIKE },
      { t: 0.45, pose: IDLE_POSE },
    ]),
  },
  ch_kick: {
    name: 'kick', startup: 0.18, active: 0.1, recovery: 0.3,
    damage: 2, hitstun: 0.15, knockback: 100, hitPoint: 'footF', radius: 18, shake: 2, lunge: 80,
    sound: 'poke', words: ['tap!', 'plink', 'boop!', 'tink'],
    clip: keyframes([
      { t: 0, pose: IDLE_POSE },
      { t: 0.1, pose: { hipH: 70, bodyAngle: 0, lean: -0.1, headTilt: 0, armF: { s: 1.0, e: 2.0 }, armB: { s: 0.5, e: 2.0 }, footF: { x: 14, y: 36 }, footB: { x: -12, y: 70 } } },
      { t: 0.18, pose: KICK_POSE },
      { t: 0.28, pose: KICK_POSE },
      { t: 0.58, pose: IDLE_POSE },
    ]),
  },
};

/* ==========================================================================
   6. RENDERING A FIGHTER
   ========================================================================== */
const STYLES = {
  hero: {
    skin: '#f4c99a', ink: '#1d1530', top: '#ff8a1f', topTrim: '#ffe066', pants: '#2f55ff', pantsTrim: '#ffffff',
    belt: '#1d1530', glove: '#e63946', shoe: '#2b2b3d', hair: '#1f1a2e', band: '#e63946',
    torsoW: 38, hipW: 32, torsoLen: 54, neck: 6, headR: 23,
    upperArm: 27, foreArm: 27, thigh: 38, shin: 36, legW: 15, armW: 12, fistR: 10, hairStyle: 'spiky',
  },
  challenger: {
    skin: '#edb98f', ink: '#1d1530', top: '#8e2de2', topTrim: '#ffd166', pants: '#1b1b2f', pantsTrim: '#8e2de2',
    belt: '#ffd166', glove: '#c026d3', shoe: '#3b0764', hair: '#8b1e3f', band: '#ffd166',
    torsoW: 31, hipW: 30, torsoLen: 52, neck: 6, headR: 22,
    upperArm: 26, foreArm: 26, thigh: 37, shin: 36, legW: 13, armW: 10, fistR: 9, hairStyle: 'ponytail',
  },
};

/** Two-bone inverse kinematics: returns the knee for a hip joint and a foot. */
function solveIK(a, b, l1, l2) {
  let dx = b.x - a.x, dy = b.y - a.y;
  let d = Math.hypot(dx, dy) || 0.0001;
  const cd = clamp(d, Math.abs(l1 - l2) + 0.5, l1 + l2 - 0.5);
  dx *= cd / d; dy *= cd / d; d = cd;
  const ax = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, l1 * l1 - ax * ax));
  const mx = a.x + dx * ax / d, my = a.y + dy * ax / d;
  const k1 = { x: mx - dy / d * h, y: my + dx / d * h };
  const k2 = { x: mx + dy / d * h, y: my - dx / d * h };
  return k1.x >= k2.x ? k1 : k2;                       // knees bend forward
}

/** Turns a pose into joint positions (relative to the hip, before bodyAngle). */
function computeSkeleton(pose, st) {
  const lean = pose.lean;
  const shoulder = { x: Math.sin(lean) * st.torsoLen, y: -Math.cos(lean) * st.torsoLen };
  const headAngle = lean + pose.headTilt;
  const headD = st.neck + st.headR;
  const head = { x: shoulder.x + Math.sin(headAngle) * headD, y: shoulder.y - Math.cos(headAngle) * headD };
  const arm = (a, side) => {
    const sx = shoulder.x + side * 3, sy = shoulder.y + 4;
    const d1 = lean + a.s;
    const elbow = { x: sx + Math.sin(d1) * st.upperArm, y: sy + Math.cos(d1) * st.upperArm };
    const d2 = d1 + a.e;
    const fist = { x: elbow.x + Math.sin(d2) * st.foreArm, y: elbow.y + Math.cos(d2) * st.foreArm };
    return { shoulder: { x: sx, y: sy }, elbow, fist };
  };
  const leg = (foot, side) => {
    const hj = { x: side * 6, y: 2 };
    return { hip: hj, knee: solveIK(hj, foot, st.thigh, st.shin), foot };
  };
  return {
    shoulder, head, headAngle, lean,
    armF: arm(pose.armF, 1), armB: arm(pose.armB, -1),
    legF: leg(pose.footF, 1), legB: leg(pose.footB, -1),
  };
}

function strokePath(ctx, pts, width, color) {
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.lineWidth = width; ctx.strokeStyle = color;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.stroke();
}

function fillPoly(ctx, pts, fill, stroke, lw) {
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
  ctx.fillStyle = fill; ctx.fill();
  if (stroke) { ctx.lineJoin = 'round'; ctx.lineWidth = lw; ctx.strokeStyle = stroke; ctx.stroke(); }
}

function drawLeg(ctx, st, leg) {
  const pts = [leg.hip, leg.knee, leg.foot];
  strokePath(ctx, pts, st.legW + 5, st.ink);
  strokePath(ctx, pts, st.legW, st.pants);
  // boot
  const heel = { x: leg.foot.x - 6, y: leg.foot.y + 2 }, toe = { x: leg.foot.x + 14, y: leg.foot.y + 2 };
  strokePath(ctx, [heel, toe], st.legW + 5, st.ink);
  strokePath(ctx, [heel, toe], st.legW, st.shoe);
}

function drawArm(ctx, st, arm) {
  const pts = [arm.shoulder, arm.elbow, arm.fist];
  strokePath(ctx, pts, st.armW + 5, st.ink);
  strokePath(ctx, pts, st.armW, st.skin);
  // glove / fist wrap
  ctx.fillStyle = st.glove; ctx.strokeStyle = st.ink; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(arm.fist.x, arm.fist.y, st.fistR, 0, TAU); ctx.fill(); ctx.stroke();
}

function drawTorso(ctx, st, sk) {
  const px = Math.cos(sk.lean), py = Math.sin(sk.lean);          // perpendicular to the spine
  const s = sk.shoulder, tw = st.torsoW / 2, hw = st.hipW / 2;
  // shorts / trousers top
  fillPoly(ctx, [{ x: -hw - 1, y: -6 }, { x: hw + 1, y: -6 }, { x: hw + 2, y: 14 }, { x: -hw - 2, y: 14 }], st.pants, st.ink, 4);
  // torso
  const poly = [
    { x: s.x - px * tw, y: s.y - py * tw }, { x: s.x + px * tw, y: s.y + py * tw },
    { x: hw, y: 4 }, { x: -hw, y: 4 },
  ];
  fillPoly(ctx, poly, st.top, st.ink, 5);
  // trim: a V-neck line for the hero, a sash for the challenger
  ctx.lineCap = 'round'; ctx.lineWidth = 4; ctx.strokeStyle = st.topTrim;
  ctx.beginPath();
  if (st.hairStyle === 'spiky') {
    ctx.moveTo(s.x - px * tw * 0.6, s.y - py * tw * 0.6); ctx.lineTo(s.x + 2, s.y + 20); ctx.lineTo(s.x + px * tw * 0.6, s.y + py * tw * 0.6);
  } else {
    ctx.moveTo(s.x + px * tw * 0.7, s.y + py * tw * 0.7 + 4); ctx.lineTo(-hw * 0.6, -2);
  }
  ctx.stroke();
  // belt
  strokePath(ctx, [{ x: -hw - 2, y: 0 }, { x: hw + 2, y: 0 }], 10, st.ink);
  strokePath(ctx, [{ x: -hw - 2, y: 0 }, { x: hw + 2, y: 0 }], 6, st.belt);
}

/** Hair is drawn behind the face so an uploaded photo is never covered. */
function drawHair(ctx, st, R, f) {
  const t = f.animT || 0;
  ctx.lineJoin = 'round';
  if (st.hairStyle === 'spiky') {
    // ribbon tails of the headband flutter behind the head
    const wob = Math.sin(t * 9) * 4 - (f.vx || 0) * 0.02;
    for (let i = 0; i < 2; i++) {
      const y0 = -R * 0.55 + i * 8;
      ctx.lineCap = 'round'; ctx.lineWidth = 9; ctx.strokeStyle = st.ink;
      ctx.beginPath(); ctx.moveTo(-R + 4, y0); ctx.quadraticCurveTo(-R - 16, y0 + 8 + wob, -R - 34 - i * 6, y0 + 2 - wob + i * 10); ctx.stroke();
      ctx.lineWidth = 5; ctx.strokeStyle = st.band; ctx.stroke();
    }
    // spikes
    ctx.fillStyle = st.hair; ctx.strokeStyle = st.ink; ctx.lineWidth = 3;
    const n = 6;
    for (let i = 0; i < n; i++) {
      const a = Math.PI + (i + 0.5) / n * Math.PI;      // spread across the top half
      const len = R + 12 + (i % 2) * 7;
      const w = 0.2;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a - w) * (R - 2), Math.sin(a - w) * (R - 2));
      ctx.lineTo(Math.cos(a) * len - 4, Math.sin(a) * len);
      ctx.lineTo(Math.cos(a + w) * (R - 2), Math.sin(a + w) * (R - 2));
      ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    ctx.beginPath(); ctx.arc(0, 0, R + 3, Math.PI * 0.95, TAU + Math.PI * 0.05); ctx.fill(); ctx.stroke();
  } else {
    // ponytail swinging behind the back
    const sw = Math.sin(t * 4) * 5 - (f.vx || 0) * 0.04;
    ctx.lineCap = 'round';
    const tail = [{ x: -R * 0.6, y: -R * 0.6 }, { x: -R - 14 + sw, y: -R * 0.2 }, { x: -R - 18 + sw * 1.6, y: R * 1.1 }];
    ctx.lineWidth = 17; ctx.strokeStyle = st.ink;
    ctx.beginPath(); ctx.moveTo(tail[0].x, tail[0].y); ctx.quadraticCurveTo(tail[1].x, tail[1].y, tail[2].x, tail[2].y); ctx.stroke();
    ctx.lineWidth = 12; ctx.strokeStyle = st.hair; ctx.stroke();
    // hair framing the face plus a bun on top
    ctx.fillStyle = st.hair; ctx.strokeStyle = st.ink; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(-R * 0.45, -R * 0.95, 10, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 0, R + 5, Math.PI * 0.85, TAU + Math.PI * 0.15); ctx.fill(); ctx.stroke();
    // hair tie
    ctx.fillStyle = st.band; ctx.beginPath(); ctx.arc(-R * 0.8, -R * 0.45, 5, 0, TAU); ctx.fill(); ctx.stroke();
  }
}

function drawHead(ctx, st, sk, f) {
  const h = sk.head, R = st.headR;
  // neck
  strokePath(ctx, [sk.shoulder, h], 18, st.ink);
  strokePath(ctx, [sk.shoulder, h], 14, st.skin);
  ctx.save();
  ctx.translate(h.x, h.y);
  ctx.rotate(sk.headAngle);
  drawHair(ctx, st, R, f);
  // the face image, clipped to the head circle
  ctx.save();
  ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.clip();
  ctx.drawImage(f.face, -R, -R, R * 2, R * 2);
  ctx.restore();
  ctx.lineWidth = 4; ctx.strokeStyle = st.ink;
  ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.stroke();
  // accessories in front of the face
  if (st.hairStyle === 'spiky') {
    // headband along the top edge of the head
    ctx.lineCap = 'butt';
    ctx.lineWidth = 10; ctx.strokeStyle = st.ink;
    ctx.beginPath(); ctx.arc(0, 0, R - 3, Math.PI + 0.4, TAU - 0.4); ctx.stroke();
    ctx.lineWidth = 6; ctx.strokeStyle = st.band; ctx.stroke();
  } else {
    // earrings
    ctx.fillStyle = st.band; ctx.strokeStyle = st.ink; ctx.lineWidth = 2;
    for (const sx of [-1, 1]) { ctx.beginPath(); ctx.arc(sx * (R - 1), R * 0.35, 4, 0, TAU); ctx.fill(); ctx.stroke(); }
  }
  ctx.restore();
}

/**
 * Draws a fighter-like view object at the current origin (its feet).
 * view = { style, pose, skel, facing, face, animT, vx }
 */
function renderFighter(ctx, v) {
  const st = v.style, pose = v.pose, sk = v.skel;
  ctx.save();
  ctx.translate(0, -pose.hipH);
  ctx.scale(v.facing, 1);
  ctx.rotate(pose.bodyAngle);
  const backArmInFront = sk.armB.fist.x > 16 && sk.armB.elbow.x > 2;   // a punching rear arm crosses in front
  if (!backArmInFront) drawArm(ctx, st, sk.armB);
  drawLeg(ctx, st, sk.legB);
  drawTorso(ctx, st, sk);
  drawLeg(ctx, st, sk.legF);
  drawHead(ctx, st, sk, v);
  if (backArmInFront) drawArm(ctx, st, sk.armB);
  drawArm(ctx, st, sk.armF);
  ctx.restore();
}

function drawStar(ctx, x, y, r, color, ink) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + i * Math.PI / 5;
    const rr = i % 2 === 0 ? r : r * 0.45;
    const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = color; ctx.fill();
  if (ink) { ctx.lineWidth = 2; ctx.strokeStyle = ink; ctx.lineJoin = 'round'; ctx.stroke(); }
}

/* ==========================================================================
   7. FIGHTER - physics, state machine, attacks, player and AI control
      States: idle, walk, jump, land, block, attack, hurt, down, getup, ko,
              victory, defeat, taunt, trip, tired, whiff, sneeze
   ========================================================================== */
const MISFORTUNE_DURATION = { trip: 2.6, tired: 2.4, whiff: 2.2, sneeze: 1.4 };

class Fighter {
  constructor(id, game) {
    this.id = id;
    this.game = game;
    this.isHero = id === 'hero';
    this.name = this.isHero ? 'THE HERO' : 'THE CHALLENGER';
    this.style = STYLES[id];
    this.maxHp = 100;
    this.speed = this.isHero ? 270 : 180;
    this.animT = Math.random() * 10;
    this.smugT = 0;
    this.reset(this.isHero ? 320 : 640, this.isHero ? 1 : -1);
  }

  /** Puts the fighter back at a start position with full health. */
  reset(x, facing) {
    this.hp = this.maxHp; this.displayHp = this.maxHp;
    this.x = x; this.y = FLOOR_Y; this.vx = 0; this.vy = 0;
    this.facing = facing; this.onGround = true;
    this.attack = null; this.walkDir = 1; this.lie = 'back'; this.flags = {};
    this.state = 'idle'; this.stateTime = 0; this.stateDur = 0;
    this.pose = CLIPS.idle(0, this); this.prevPose = this.pose; this.blendT = BLEND_TIME;
    this.skel = computeSkeleton(this.pose, this.style);
    this.face = FaceStore.get(this.id, 'normal');
    this.ai = { timer: 0, intent: 'wait', misfortune: rand(3, 5) };
  }

  setState(name, dur = 0) {
    this.prevPose = this.pose;
    this.blendT = 0;
    this.state = name; this.stateTime = 0; this.stateDur = dur; this.flags = {};
  }

  canAct() {
    return this.onGround && (this.state === 'idle' || this.state === 'walk' || this.state === 'block' || this.state === 'taunt');
  }
  isBlocking() { return this.state === 'block'; }
  isLying() {
    return this.state === 'down' || this.state === 'ko' || this.state === 'getup' ||
      (this.state === 'trip' && this.stateTime > 0.75) || (this.state === 'defeat' && this.stateTime > 0.9);
  }
  isInvulnerable() { return this.isLying() || this.state === 'victory' || this.state === 'defeat'; }
  isDizzy() {
    return this.state === 'ko' || this.state === 'down' || (this.state === 'whiff' && this.stateTime > 0.65);
  }

  /** Converts a skeleton point (hip-relative, body frame) into world coordinates. */
  worldPoint(p) {
    const A = this.pose.bodyAngle, c = Math.cos(A), s = Math.sin(A);
    const rx = p.x * c - p.y * s, ry = p.x * s + p.y * c;
    return { x: this.x + this.facing * rx, y: this.y - this.pose.hipH + ry };
  }
  headWorld() { return this.worldPoint(this.skel.head); }

  /** Axis-aligned box that attacks can hit, or null when the fighter cannot be hit. */
  getHurtbox() {
    if (this.isInvulnerable()) return null;
    const h = this.headWorld();
    const top = Math.min(h.y - this.style.headR, this.y - this.pose.hipH - 20);
    return { x: this.x - 24, y: top, w: 48, h: this.y - top };
  }

  currentClip() {
    switch (this.state) {
      case 'attack': return this.attack.clip;
      case 'ko':
        if (this.lie === 'front-hold') return CLIPS.lieFront;
        if (this.lie === 'back-hold') return CLIPS.lieBack;
        return this.lie === 'front' ? CLIPS.fallFront : CLIPS.fall;
      case 'down': return CLIPS.fall;
      default: return CLIPS[this.state] || CLIPS.idle;
    }
  }

  currentExpression() {
    const s = this.state, t = this.stateTime;
    if (this.smugT > 0) return 'happy';
    if (s === 'victory') return 'happy';
    if (s === 'hurt' || (s === 'sneeze' && t > 0.55) || (s === 'trip' && t > 0.5)) return 'hurt';
    if (this.isDizzy()) return 'dizzy';
    if (s === 'tired' || s === 'defeat' || s === 'getup') return 'tired';
    if (s === 'attack') return (this.isHero && this.attack.name === 'jab') ? 'normal' : 'angry';
    return 'normal';
  }

  /* ---------------------------------------------------------------- update */
  update(dt, opp) {
    this.stateTime += dt;
    this.animT += dt;
    this.smugT = Math.max(0, this.smugT - dt);

    switch (this.state) {
      case 'attack': this.updateAttack(opp); break;
      case 'hurt': if (this.stateTime >= this.stateDur) this.setState('idle'); break;
      case 'land': if (this.stateTime >= 0.1) this.setState('idle'); break;
      case 'taunt': if (this.stateTime >= this.stateDur) this.setState('idle'); break;
      case 'down': if (this.stateTime >= this.stateDur) this.setState('getup', 0.55); break;
      case 'getup': if (this.stateTime >= this.stateDur) this.setState('idle'); break;
      case 'defeat': if (this.stateTime >= 1.6) { this.lie = 'front-hold'; this.setState('ko'); } break;
      case 'trip': this.updateTrip(); break;
      case 'tired': this.updateTired(dt); break;
      case 'whiff': this.updateWhiff(); break;
      case 'sneeze': this.updateSneeze(); break;
      case 'victory':
        if (this.onGround && this.stateTime - (this.flags.lastHop || -1) > 0.75) {
          this.flags.lastHop = this.stateTime; this.vy = -300; this.onGround = false;
        }
        break;
      default: break;
    }

    // Face the opponent whenever we are free to act.
    if (this.canAct() || this.state === 'hurt') this.facing = opp.x >= this.x ? 1 : -1;

    // ---- physics ----
    if (this.state !== 'walk' && this.onGround) this.vx *= Math.max(0, 1 - 10 * dt);   // ground friction
    if (!this.onGround) {
      this.vy += GRAVITY * dt;
      this.y += this.vy * dt;
      if (this.y >= FLOOR_Y) { this.y = FLOOR_Y; this.vy = 0; this.onGround = true; this.onLand(); }
    }
    this.x = clamp(this.x + this.vx * dt, ARENA_LEFT, ARENA_RIGHT);

    // ---- animation ----
    const target = this.currentClip()(this.stateTime, this);
    this.blendT = Math.min(BLEND_TIME, this.blendT + dt);
    this.pose = this.blendT < BLEND_TIME ? lerpPose(this.prevPose, target, smooth(this.blendT / BLEND_TIME)) : target;
    this.skel = computeSkeleton(this.pose, this.style);
    this.face = FaceStore.get(this.id, this.currentExpression());

    // the white "damage just taken" part of the health bar catches up slowly
    this.displayHp += (this.hp - this.displayHp) * Math.min(1, dt * 3);
  }

  onLand() {
    if (this.state === 'jump') { this.setState('land'); Sound.play('land'); this.game.dust(this.x, FLOOR_Y, 4); }
    if (this.state !== 'walk') this.vx *= 0.3;
  }

  jump() {
    if (!this.onGround) return;
    this.vy = -640; this.onGround = false;
    this.setState('jump');
    Sound.play('jump');
  }

  startAttack(key) {
    const def = ATTACKS[key];
    this.attack = Object.assign({ hasHit: false }, def);
    this.setState('attack', def.startup + def.active + def.recovery);
    this.vx = 0;
    if (def.windupSound) Sound.play(def.windupSound);
    if (this.isHero) this.game.notePlayerAction();
  }

  hitPoint(name) {
    const sk = this.skel;
    if (name === 'fistB') return sk.armB.fist;
    if (name === 'footF') return sk.legF.foot;
    return sk.armF.fist;
  }

  updateAttack(opp) {
    const a = this.attack, t = this.stateTime;
    // step into the punch during the active frames
    if (a.lunge && t >= a.startup * 0.5 && t < a.startup + a.active) this.vx = this.facing * a.lunge;
    if (!a.hasHit && t >= a.startup && t <= a.startup + a.active) {
      const p = this.worldPoint(this.hitPoint(a.hitPoint));
      const box = opp.getHurtbox();
      if (box && circleRectHit(p.x, p.y, a.radius, box)) {
        a.hasHit = true;
        this.game.resolveHit(this, opp, a, p);
      }
    }
    if (t >= this.stateDur) {
      if (!a.hasHit && !this.isHero && Math.abs(opp.x - this.x) < 170 && Math.random() < 0.5) {
        const h = this.headWorld();
        this.game.popup('miss', h.x + this.facing * 30, h.y - 20, { color: '#cfc6ff', size: 18, life: 0.7 });
      }
      this.setState(this.onGround ? 'idle' : 'jump');
    }
  }

  /** Reaction to being hit. The Hero flinches; the Challenger can be knocked down or out. */
  hurtBy(atk, dir) {
    if (this.isHero) {
      // super armor: a Hero mid-punch does not even flinch
      if (this.state === 'attack') { this.vx = dir * 40; return; }
      if (!this.onGround) return;
      this.vx = dir * 70;
      this.setState('hurt', 0.15);
      return;
    }
    this.vx = dir * atk.knockback;
    if (this.hp <= 0) { this.knockOut(); return; }
    if (atk.knockdown && (Math.random() < atk.knockdownChance || this.hp < 30)) {
      this.setState('down', 1.3);
    } else {
      this.setState('hurt', atk.hitstun);
    }
  }

  knockOut() {
    const A = this.pose.bodyAngle;
    if (A > 1.0) this.lie = 'front-hold';
    else if (A < -1.0) this.lie = 'back-hold';
    else this.lie = (this.state === 'trip' || this.state === 'defeat') ? 'front' : 'back';
    this.setState('ko');
  }

  /* ------------------------------------------------------- player control */
  updatePlayer(dt, input) {
    const s = this.state;
    if (s === 'attack' || s === 'hurt' || s === 'land' || s === 'victory') return;
    const dir = (input.held('right') ? 1 : 0) - (input.held('left') ? 1 : 0);

    if (!this.onGround) {                       // airborne: steer a little and air-jab
      if (dir) this.vx = dir * 200;
      if (input.pressed('jab')) this.startAttack('hero_jab');
      return;
    }
    if (input.pressed('jab')) return this.startAttack('hero_jab');
    if (input.pressed('power')) return this.startAttack('hero_power');
    if (input.pressed('jump')) { this.vx = dir * 200; return this.jump(); }
    if (input.held('block')) {
      if (s !== 'block') this.setState('block');
      this.vx = 0;
      return;
    }
    if (dir) {
      if (s !== 'walk') this.setState('walk');
      this.vx = dir * this.speed;
      this.walkDir = dir === this.facing ? 1 : -1;
      return;
    }
    if (s !== 'idle') { this.setState('idle'); this.vx = 0; }
  }

  /* ----------------------------------------------------------- AI control */
  updateAI(dt, opp) {
    if (!this.canAct()) return;
    const ai = this.ai;
    ai.misfortune -= dt;
    if (ai.misfortune <= 0) { this.doMisfortune(); return; }
    ai.timer -= dt;
    if (ai.timer <= 0) this.decide(opp);
    if (this.state === 'attack') return;         // decide() may have started an attack
    switch (ai.intent) {
      case 'approach': this.moveToward(opp, 1); break;
      case 'retreat': this.moveToward(opp, -1); break;
      case 'block':
        if (this.state !== 'block') this.setState('block');
        this.vx = 0;
        break;
      default:
        if (this.state !== 'idle' && this.state !== 'taunt') { this.setState('idle'); }
        if (this.state === 'idle') this.vx = 0;
    }
  }

  moveToward(opp, sign) {
    const dir = (opp.x >= this.x ? 1 : -1) * sign;
    if (this.state !== 'walk') this.setState('walk');
    this.vx = dir * this.speed;
    this.walkDir = dir === this.facing ? 1 : -1;
  }

  /** Picks a new intention. She is a competent-looking fighter who never quite lands anything. */
  decide(opp) {
    const ai = this.ai, d = Math.abs(opp.x - this.x), r = Math.random();
    if (d > 170) {
      if (r < 0.7) { ai.intent = 'approach'; ai.timer = rand(0.3, 0.8); }
      else if (r < 0.82) { ai.intent = 'wait'; ai.timer = 0.6; this.vx = (opp.x >= this.x ? 1 : -1) * 160; this.jump(); }
      else if (r < 0.92) { ai.intent = 'wait'; ai.timer = 1.1; this.setState('taunt', 1.1); }
      else { ai.intent = 'wait'; ai.timer = rand(0.3, 0.6); }
    } else if (d > 100) {
      if (r < 0.45) { ai.intent = 'approach'; ai.timer = rand(0.2, 0.4); }
      else if (r < 0.7) { ai.intent = 'wait'; ai.timer = 0.4; this.startAttack(Math.random() < 0.5 ? 'ch_jab' : 'ch_kick'); }   // misjudged range
      else if (r < 0.85) { ai.intent = 'block'; ai.timer = rand(0.4, 0.8); }
      else { ai.intent = 'retreat'; ai.timer = rand(0.2, 0.4); }
    } else {
      if (r < 0.5) { ai.intent = 'wait'; ai.timer = 0.3; this.startAttack(Math.random() < 0.6 ? 'ch_jab' : 'ch_kick'); }
      else if (r < 0.7) { ai.intent = 'block'; ai.timer = rand(0.4, 0.9); }
      else if (r < 0.88) { ai.intent = 'retreat'; ai.timer = rand(0.25, 0.5); }
      else { ai.intent = 'wait'; ai.timer = rand(0.2, 0.4); }
    }
  }

  /* --------------------------------------------------- misfortunes (the rig) */
  /** Every few seconds the Challenger hurts herself. More often if the player is idle. */
  doMisfortune() {
    const r = Math.random();
    const type = r < 0.35 ? 'trip' : r < 0.6 ? 'tired' : r < 0.85 ? 'whiff' : 'sneeze';
    this.ai.intent = 'wait'; this.ai.timer = 0.3;
    this.ai.misfortune = this.game.playerIdle() ? rand(2.5, 4) : rand(8, 13);
    this.setState(type, MISFORTUNE_DURATION[type]);
    this.game.stats.misfortunes++;
  }

  updateTrip() {
    const t = this.stateTime, f = this.flags;
    if (t < 0.5) this.vx = this.facing * 230;                  // the run-up
    else if (t < 0.75) this.vx = this.facing * 130;            // the stumble
    else if (t < 1.05) {                                       // the fall
      this.vx = this.facing * 60;
      if (!f.whistle) { f.whistle = true; Sound.play('trip'); }
    } else {
      this.vx = 0;
      if (!f.landed) {
        f.landed = true;
        Sound.play('thud'); this.game.shake(6); this.game.dust(this.x + this.facing * 40, FLOOR_Y, 10);
        this.game.selfOwn(this, 16, 'OOPS!', '#ffb703');
        if (this.state !== 'trip') return;
      }
    }
    if (t >= this.stateDur) this.setState('idle');
  }

  updateTired(dt) {
    const t = this.stateTime, f = this.flags, h = this.headWorld();
    this.vx = 0;
    if (t > 0.3 && !f.d1) {
      f.d1 = true; Sound.play('tired');
      this.game.selfOwn(this, 12, 'TIRED!', '#9bf6ff');
      if (this.state !== 'tired') return;
    }
    if (t > 1.0 && !f.h1) { f.h1 = true; Sound.play('tired'); this.game.popup('huff...', h.x + this.facing * 30, h.y - 10, { color: '#dff6ff', size: 20, life: 0.9 }); }
    if (t > 1.7 && !f.h2) { f.h2 = true; Sound.play('tired'); this.game.popup('puff...', h.x + this.facing * 30, h.y - 10, { color: '#dff6ff', size: 20, life: 0.9 }); }
    if (Math.random() < dt * 4) this.game.sweat(h.x - this.facing * 10, h.y - 20);
    if (t >= this.stateDur) this.setState('idle');
  }

  updateWhiff() {
    const t = this.stateTime, f = this.flags;
    if (t < 0.45) this.vx = 0;
    else if (t < 0.65) {
      this.vx = this.facing * 180;                              // a huge haymaker that hits only air
      if (!f.swing) { f.swing = true; Sound.play('whoosh'); }
    } else if (!f.miss) {
      f.miss = true; Sound.play('dizzy');
      this.game.selfOwn(this, 13, 'WHIFF!', '#ff9ecd');
      if (this.state !== 'whiff') return;
    }
    if (t >= this.stateDur) this.setState('idle');
  }

  updateSneeze() {
    const t = this.stateTime, f = this.flags;
    this.vx = 0;
    if (t > 0.2 && !f.ah) { f.ah = true; const h = this.headWorld(); this.game.popup('ah... ah...', h.x, h.y - 50, { color: '#caffbf', size: 20, life: 0.5 }); }
    if (t > 0.55 && !f.achoo) {
      f.achoo = true; Sound.play('sneeze'); this.vx = -this.facing * 90;
      const h = this.headWorld();
      this.game.sparks(h.x + this.facing * 30, h.y + 10, 8, ['#caffbf', '#ffffff'], 140);
      this.game.selfOwn(this, 9, 'ACHOO!', '#caffbf');
      if (this.state !== 'sneeze') return;
    }
    if (t >= this.stateDur) this.setState('idle');
  }

  /* ---------------------------------------------------------------- draw */
  draw(ctx) {
    ctx.save();
    ctx.translate(this.x, this.y);
    // charging glow on the rear fist during the power punch wind-up
    if (this.state === 'attack' && this.attack.name === 'power' && this.stateTime < this.attack.startup) {
      const fist = this.skel.armB.fist, A = this.pose.bodyAngle;
      const rx = fist.x * Math.cos(A) - fist.y * Math.sin(A), ry = fist.x * Math.sin(A) + fist.y * Math.cos(A);
      const gx = this.facing * rx, gy = -this.pose.hipH + ry;
      const k = this.stateTime / this.attack.startup;
      const g = ctx.createRadialGradient(gx, gy, 2, gx, gy, 18 + k * 26);
      g.addColorStop(0, 'rgba(255,230,120,0.9)'); g.addColorStop(1, 'rgba(255,120,40,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(gx, gy, 18 + k * 26, 0, TAU); ctx.fill();
    }
    renderFighter(ctx, this);
    ctx.restore();
    // dizzy stars circling the head
    if (this.isDizzy()) {
      const h = this.headWorld();
      for (let i = 0; i < 3; i++) {
        const a = this.animT * 5 + i * TAU / 3;
        drawStar(ctx, h.x + Math.cos(a) * 30, h.y - 12 + Math.sin(a) * 10, 7, '#ffd166', this.style.ink);
      }
    }
  }

  drawShadow(ctx) {
    const air = clamp((FLOOR_Y - this.y) / 400, 0, 0.8);
    ctx.fillStyle = `rgba(0,0,0,${0.35 - air * 0.3})`;
    const lying = Math.abs(this.pose.bodyAngle) > 1;
    ctx.beginPath(); ctx.ellipse(this.x, FLOOR_Y + 5, (lying ? 80 : 42) * (1 - air), 8, 0, 0, TAU); ctx.fill();
  }
}

/* ==========================================================================
   8. BACKGROUND - a sunset rooftop arena drawn at 1/3 resolution and scaled
      up without smoothing, which gives the chunky pixel-art look.
   ========================================================================== */
class Background {
  constructor() {
    this.w = W / BG_SCALE; this.h = H / BG_SCALE;          // 320 x 180
    this.low = makeCanvas(this.w, this.h);
    this.lctx = this.low.getContext('2d');
    this.sky = this.prerender((c) => this.drawSky(c));
    this.city = this.prerender((c) => this.drawCity(c));
    this.front = this.prerender((c) => this.drawFront(c));
    const rng = mulberry32(7);
    this.clouds = [];
    for (let i = 0; i < 5; i++) this.clouds.push({ x: rng() * this.w, y: 14 + rng() * 44, w: 22 + rng() * 26, speed: 3 + rng() * 5 });
    this.crowd = [];
    const palette = [['#1b1333', '#231a44', '#2a1f4f'], ['#140c26', '#1d1538', '#181030']];
    for (let row = 0; row < 2; row++) {
      for (let i = 0; i < 40; i++) {
        this.crowd.push({ x: -6 + i * 8.4 + rng() * 4 + row * 4, row, ph: rng() * TAU, color: palette[row][Math.floor(rng() * 3)], arms: rng() < 0.4 });
      }
    }
  }

  prerender(fn) { const c = makeCanvas(this.w, this.h); fn(c.getContext('2d')); return c; }

  drawSky(c) {
    const g = c.createLinearGradient(0, 0, 0, 110);
    g.addColorStop(0, '#1a0b3d'); g.addColorStop(0.45, '#5b2a86'); g.addColorStop(0.75, '#e85d75'); g.addColorStop(1, '#ffb86b');
    c.fillStyle = g; c.fillRect(0, 0, this.w, 110);
    const rng = mulberry32(3);
    c.fillStyle = '#fff';
    for (let i = 0; i < 40; i++) { c.globalAlpha = 0.3 + rng() * 0.7; c.fillRect(Math.floor(rng() * this.w), Math.floor(rng() * 50), 1, 1); }
    c.globalAlpha = 1;
    // a retro striped sun
    c.fillStyle = '#ffe08a'; c.beginPath(); c.arc(236, 80, 22, 0, TAU); c.fill();
    c.fillStyle = '#ff9f1c'; c.beginPath(); c.arc(236, 80, 22, 0, Math.PI); c.fill();
    c.fillStyle = '#e85d75';
    for (let y = 84; y < 102; y += 5) c.fillRect(214, y, 44, 2);
  }

  drawCity(c) {
    const rng = mulberry32(42);
    let x = 0;
    while (x < this.w) {
      const w = 10 + Math.floor(rng() * 22), h = 20 + Math.floor(rng() * 55), top = 110 - h;
      c.fillStyle = rng() < 0.5 ? '#24143f' : '#2d1a4d';
      c.fillRect(x, top, w, h + 2);
      for (let wy = top + 3; wy < 108; wy += 5) {
        for (let wx = x + 2; wx < x + w - 2; wx += 4) {
          if (rng() < 0.45) { c.fillStyle = rng() < 0.8 ? '#ffd166' : '#ff9f1c'; c.fillRect(wx, wy, 2, 2); }
        }
      }
      if (rng() < 0.3) {
        c.fillStyle = '#24143f'; c.fillRect(x + Math.floor(w / 2), top - 8, 1, 8);
        c.fillStyle = '#ff4d4d'; c.fillRect(x + Math.floor(w / 2), top - 9, 1, 1);
      }
      x += w + 1 + Math.floor(rng() * 3);
    }
    // the back wall of the arena, with a banner
    c.fillStyle = '#3b2a5a'; c.fillRect(0, 108, this.w, 42);
    c.fillStyle = '#4a3870'; c.fillRect(0, 108, this.w, 3);
    c.fillStyle = '#34244f';
    for (let px = 4; px < this.w; px += 32) c.fillRect(px, 114, 26, 14);
    c.fillStyle = '#b3002d'; c.fillRect(92, 112, 136, 16);
    c.fillStyle = '#ffd166'; c.fillRect(92, 112, 136, 2); c.fillRect(92, 126, 136, 2);
    c.fillStyle = '#fff'; c.font = 'bold 9px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('ALWAYS WIN FIGHTER', 160, 120);
  }

  drawFront(c) {
    // railing in front of the crowd
    c.fillStyle = '#6b5a8e'; c.fillRect(0, 144, this.w, 2);
    c.fillStyle = '#4a3870'; c.fillRect(0, 146, this.w, 4);
    c.fillStyle = '#6b5a8e';
    for (let px = 6; px < this.w; px += 20) c.fillRect(px, 144, 2, 6);
    // the mat
    c.fillStyle = '#2d6a9f'; c.fillRect(0, 150, this.w, 30);
    c.fillStyle = '#3a7fb8'; c.fillRect(0, 150, this.w, 2);
    c.strokeStyle = 'rgba(255,255,255,0.18)'; c.lineWidth = 1;
    for (let lx = -40; lx <= this.w + 40; lx += 40) { c.beginPath(); c.moveTo(lx, 150); c.lineTo(160 + (lx - 160) * 1.6, 180); c.stroke(); }
    c.fillStyle = 'rgba(255,255,255,0.12)'; c.fillRect(0, 160, this.w, 1); c.fillRect(0, 170, this.w, 1);
    c.strokeStyle = 'rgba(255,209,102,0.5)'; c.lineWidth = 2;
    c.beginPath(); c.ellipse(160, 165, 50, 9, 0, 0, TAU); c.stroke();
    c.fillStyle = '#1d3f63'; c.fillRect(0, 176, this.w, 4);
  }

  draw(ctx, t) {
    const l = this.lctx;
    l.clearRect(0, 0, this.w, this.h);
    l.drawImage(this.sky, 0, 0);
    l.fillStyle = 'rgba(255,214,230,0.75)';
    for (const cl of this.clouds) {
      const x = ((cl.x + t * cl.speed) % (this.w + 60)) - 30;
      l.fillRect(Math.floor(x), cl.y, cl.w, 5);
      l.fillRect(Math.floor(x + 5), cl.y - 3, cl.w - 12, 3);
      l.fillRect(Math.floor(x + 3), cl.y + 5, cl.w - 6, 2);
    }
    l.drawImage(this.city, 0, 0);
    // a bobbing, cheering crowd
    for (const p of this.crowd) {
      const bob = Math.sin(t * 3 + p.ph);
      const y = (p.row === 0 ? 134 : 141) - Math.max(0, bob) * 2;
      l.fillStyle = p.color;
      l.fillRect(Math.floor(p.x), Math.floor(y), 6, 10);
      l.beginPath(); l.arc(p.x + 3, y - 2, 3, 0, TAU); l.fill();
      if (p.arms && bob > 0.3) { l.fillRect(Math.floor(p.x) - 2, Math.floor(y) - 6, 1, 7); l.fillRect(Math.floor(p.x) + 7, Math.floor(y) - 6, 1, 7); }
    }
    l.drawImage(this.front, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.low, 0, 0, W, H);
    ctx.imageSmoothingEnabled = true;
  }
}

/* ==========================================================================
   9. GAME - rounds, HUD, hit resolution, effects and the main loop
      Modes: menu -> intro (VS screen) -> round_intro -> fight -> round_end
             -> (next round | match_end)
   ========================================================================== */
class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.scale = 1;
    this.hero = new Fighter('hero', this);
    this.challenger = new Fighter('challenger', this);
    this.bg = new Background();
    this.mode = 'menu'; this.modeT = 0; this.paused = false;
    this.debugSpeed = 1;                        // >1 runs several updates per frame (used by tests)
    this.round = 1; this.heroWins = 0; this.challengerWins = 0; this.timer = ROUND_TIME;
    this.timeScale = 1; this.hitstop = 0; this.time = 0; this.lastNow = 0;
    this.lastPlayerAction = -100; this.introTap = false;
    this.particles = []; this.popups = []; this.banners = [];
    this.shakeP = 0; this.flashA = 0;
    this.roundEnd = null;
    this.stats = this.freshStats();
    this.frame = this.frame.bind(this);
  }

  freshStats() { return { punches: 0, power: 0, blocked: 0, damageTaken: 0, misfortunes: 0, rounds: 0, time: 0, plot: 0 }; }
  start() { this.lastNow = performance.now(); requestAnimationFrame(this.frame); }
  setMode(m) { this.mode = m; this.modeT = 0; Screens.onMode(m); }
  notePlayerAction() { this.lastPlayerAction = this.time; }
  playerIdle() { return this.time - this.lastPlayerAction > IDLE_PLAYER_SECONDS; }

  /* ------------------------------------------------------------ main loop */
  frame(now) {
    const rawDt = Math.min(0.05, Math.max(0, (now - this.lastNow) / 1000));
    this.lastNow = now;
    Input.update();
    if (Input.pressed('pause')) this.togglePause();
    if (!this.paused) for (let i = 0; i < this.debugSpeed; i++) this.update(rawDt);
    this.render();
    requestAnimationFrame(this.frame);
  }

  update(rawDt) {
    this.time += rawDt; this.modeT += rawDt;
    let dt = rawDt * this.timeScale;
    if (this.hitstop > 0) { this.hitstop -= rawDt; dt = 0; }     // freeze the fighters on impact
    switch (this.mode) {
      case 'menu':
        this.updateFighters(dt, false);
        break;
      case 'intro':
        this.updateFighters(dt, false);
        if ((this.modeT > 0.5 && (Input.pressed('start') || Input.pressed('jab') || Input.pressed('power') || this.introTap)) || this.modeT > 6) {
          this.introTap = false;
          this.startMatch();
        }
        break;
      case 'round_intro':
        this.updateFighters(dt, false);
        if (this.modeT >= 1.3) {
          this.setMode('fight');
          this.banner('FIGHT!', { color: '#ff4d4d', dur: 0.9, size: 110 });
          Sound.play('fight');
        }
        break;
      case 'fight': this.updateFight(dt); break;
      case 'round_end': this.updateRoundEnd(dt, rawDt); break;
      case 'match_end':
        this.updateFighters(dt, false);
        if (Math.random() < rawDt * 6) this.confetti();
        break;
      default: break;
    }
    this.updateEffects(rawDt);
  }

  updateFighters(dt, control) {
    if (control) { this.hero.updatePlayer(dt, Input); this.challenger.updateAI(dt, this.hero); }
    this.hero.update(dt, this.challenger);
    this.challenger.update(dt, this.hero);
    this.separate();
  }

  updateFight(dt) {
    this.updateFighters(dt, true);
    if (this.mode !== 'fight') return;              // a KO may just have ended the round
    this.stats.time += dt;
    this.timer = Math.max(0, this.timer - dt);
    if (this.timer <= 0) this.startRoundEnd('time');
  }

  /** Keeps the two fighters from overlapping (unless one jumps over the other). */
  separate() {
    const a = this.hero, b = this.challenger;
    if (a.isLying() || b.isLying() || Math.abs(a.y - b.y) > 90) return;
    const dx = b.x - a.x, d = Math.abs(dx);
    if (d >= PUSH_DISTANCE) return;
    const s = dx > 0 ? 1 : dx < 0 ? -1 : a.facing;
    const push = (PUSH_DISTANCE - d) / 2;
    a.x -= s * push; b.x += s * push;
    if (a.x < ARENA_LEFT) { a.x = ARENA_LEFT; b.x = a.x + PUSH_DISTANCE; }
    if (a.x > ARENA_RIGHT) { a.x = ARENA_RIGHT; b.x = a.x - PUSH_DISTANCE; }
    if (b.x < ARENA_LEFT) { b.x = ARENA_LEFT; a.x = b.x + PUSH_DISTANCE; }
    if (b.x > ARENA_RIGHT) { b.x = ARENA_RIGHT; a.x = b.x - PUSH_DISTANCE; }
  }

  /* ------------------------------------------------------- match flow */
  startIntro() {
    if (this.mode === 'intro') return;
    this.paused = false;
    this.hero.reset(320, 1); this.challenger.reset(640, -1);
    this.introTap = false;
    this.setMode('intro');
    Sound.play('round');
  }

  startMatch() {
    this.round = 1; this.heroWins = 0; this.challengerWins = 0;
    this.stats = this.freshStats();
    this.startRound();
  }

  startRound() {
    this.hero.reset(320, 1); this.challenger.reset(640, -1);
    this.timer = ROUND_TIME; this.timeScale = 1; this.hitstop = 0; this.roundEnd = null;
    this.particles.length = 0; this.popups.length = 0; this.banners.length = 0;
    this.lastPlayerAction = this.time;
    this.setMode('round_intro');
    this.banner(this.round >= 3 ? 'FINAL ROUND' : `ROUND ${this.round}`, { color: '#ffffff', dur: 1.25, size: 84 });
    Sound.play('round');
  }

  startRoundEnd(reason) {
    if (this.mode === 'round_end') return;
    this.setMode('round_end');
    this.roundEnd = { reason, phase: reason === 'ko' ? 'ko' : 'timeup', t: 0 };
    this.hero.vx = 0;
    if (this.hero.canAct()) this.hero.setState('idle');
    if (reason === 'ko') {
      this.timeScale = 0.25; this.flashA = 1; this.shake(18);
      Sound.play('ko');
      this.banner('K.O.!', { color: '#ffd166', stroke: '#7a0000', dur: 1.6, size: 130 });
    } else {
      Sound.play('timeup');
      this.banner('TIME UP!', { color: '#9bf6ff', dur: 1.4, size: 90 });
      this.challenger.vx = 0;
      if (this.challenger.isLying()) this.challenger.knockOut();   // already on the floor: stay there
      else this.challenger.setState('defeat', 1.6);                 // she collapses from exhaustion anyway
    }
  }

  updateRoundEnd(dt, rawDt) {
    const re = this.roundEnd;
    re.t += rawDt;
    this.updateFighters(dt, false);
    if (re.phase === 'ko') {
      if (re.t > 0.9) this.timeScale = 1;
      if (re.t > 1.7) this.heroWinsRound();
    } else if (re.phase === 'timeup') {
      if (re.t > 1.9) this.heroWinsRound();
    } else if (re.phase === 'wins') {
      if (Math.random() < rawDt * 10) this.confetti();
      if (re.t > 3.4) this.nextRound();
    }
  }

  heroWinsRound() {
    const re = this.roundEnd;
    re.phase = 'wins'; re.t = 0;
    this.heroWins++; this.stats.rounds++;
    this.hero.setState('victory');
    const sub = re.reason === 'time'
      ? 'the Challenger ran out of steam'
      : pick(['FLAWLESS!', 'as expected', 'what a surprise', 'rigged? never.', 'the script said so']);
    this.banner('HERO WINS!', { color: '#ffd166', dur: 3.2, size: 96, sub });
    Sound.play('victory');
  }

  nextRound() {
    if (this.heroWins >= ROUNDS_TO_WIN) this.endMatch();
    else { this.round++; this.startRound(); }
  }

  endMatch() {
    this.setMode('match_end');
    Screens.showVictory(this);
  }

  goMenu() {
    this.paused = false;
    this.hero.reset(320, 1); this.challenger.reset(640, -1);
    this.particles.length = 0; this.popups.length = 0; this.banners.length = 0;
    this.timeScale = 1; this.hitstop = 0;
    this.setMode('menu');
  }

  togglePause() {
    if (this.mode !== 'fight' && this.mode !== 'round_intro' && this.mode !== 'round_end') return;
    this.paused = !this.paused;
    Screens.onPause(this.paused);
  }

  /* --------------------------------------------------- hits and damage */
  /** Applies damage. The Hero's health is clamped to HERO_MIN_HP. Returns damage dealt. */
  damage(f, amount) {
    const before = f.hp;
    f.hp = f.isHero ? Math.max(HERO_MIN_HP, f.hp - amount) : Math.max(0, f.hp - amount);
    return before - f.hp;
  }

  resolveHit(att, def, atk, p) {
    const dir = att.facing;
    if (def.isBlocking() && !atk.guardBreak) {
      this.sparks(p.x, p.y, 8, ['#ffffff', '#9bf6ff', '#a0c4ff'], 220);
      this.popup('BLOCK', p.x, p.y - 30, { color: '#9bf6ff', size: 26 });
      Sound.play('block');
      def.vx = dir * 140; this.shake(3); this.hitstop = 0.04;
      this.stats.blocked++;
      if (!def.isHero) {                                  // chip damage through her guard
        this.damage(def, 2);
        if (def.hp <= 0) { def.knockOut(); this.startRoundEnd('ko'); }
      }
      return;
    }
    if (def.isBlocking() && atk.guardBreak) this.popup('GUARD BREAK!', p.x, p.y - 75, { color: '#ff9f1c', size: 30 });
    const dealt = this.damage(def, atk.damage);
    const big = att.isHero;
    this.sparks(p.x, p.y, big ? (atk.guardBreak ? 26 : 14) : 5,
      big ? ['#ffd166', '#ff9f1c', '#ffffff', '#ff4d4d'] : ['#ffc6ff', '#ffffff'], big ? 340 : 160);
    this.popup(pick(atk.words), p.x + dir * 10, p.y - 45, {
      color: big ? pick(['#ffd166', '#ff4d4d', '#ff9f1c']) : '#ffc6ff',
      size: big ? (atk.guardBreak ? 58 : 42) : 20, rot: rand(-0.25, 0.25),
    });
    if (dealt > 0) {
      const h = def.headWorld();
      this.popup('-' + dealt, def.x - dir * 10, h.y - 60, { color: '#ffffff', size: big ? 24 : 16, life: 0.8 });
    }
    Sound.play(atk.sound);
    this.shake(atk.shake);
    this.hitstop = big ? (atk.guardBreak ? 0.1 : 0.05) : 0.02;
    if (def.isHero) {
      this.stats.damageTaken += dealt;
      if (dealt === 0) {
        const h = def.headWorld();
        this.popup('PLOT ARMOR!', def.x, h.y - 70, { color: '#ffd166', size: 30, life: 1.2 });
        Sound.play('plot');
        def.smugT = 1.2; this.stats.plot++;
      }
      def.hurtBy(atk, dir);
    } else {
      this.stats.punches++;
      if (atk.guardBreak) this.stats.power++;
      def.hurtBy(atk, dir);
      if (def.hp <= 0) this.startRoundEnd('ko');
    }
  }

  /** The Challenger hurting herself (trip, exhaustion, whiff, sneeze). */
  selfOwn(f, amount, word, color) {
    const dealt = this.damage(f, amount);
    const h = f.headWorld();
    this.popup(word, h.x, h.y - 55, { color, size: 42, rot: rand(-0.2, 0.2) });
    if (dealt > 0) this.popup('-' + dealt, f.x, h.y - 20, { color: '#fff', size: 20, life: 0.8 });
    if (f.hp <= 0) { f.knockOut(); this.startRoundEnd('ko'); }
  }

  /* -------------------------------------------------------------- effects */
  shake(p) { this.shakeP = Math.max(this.shakeP, p); }

  sparks(x, y, n, colors, speed = 300) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU), v = rand(speed * 0.4, speed);
      this.particles.push({ type: 'spark', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: rand(0.25, 0.5), max: 0.5, size: rand(5, 11), color: pick(colors), rot: rand(0, TAU), spin: rand(-12, 12), g: 500 });
    }
  }
  dust(x, y, n) {
    for (let i = 0; i < n; i++) this.particles.push({ type: 'dot', x: x + rand(-20, 20), y, vx: rand(-60, 60), vy: rand(-90, -30), life: rand(0.4, 0.8), max: 0.8, size: rand(4, 9), color: 'rgba(220,210,240,0.7)', g: 60 });
  }
  sweat(x, y) {
    this.particles.push({ type: 'dot', x, y, vx: rand(-40, 40), vy: rand(-120, -60), life: 0.7, max: 0.7, size: 5, color: '#8fd3ff', g: 500 });
  }
  confetti() {
    this.particles.push({ type: 'confetti', x: rand(0, W), y: -10, vx: rand(-40, 40), vy: rand(80, 160), life: 4, max: 4, size: rand(6, 10), color: pick(['#ffd166', '#ff4d4d', '#9bf6ff', '#caffbf', '#ffc6ff', '#ffffff']), rot: rand(0, TAU), spin: rand(-6, 6), g: 40 });
  }
  popup(text, x, y, o = {}) {
    this.popups.push({ text, x, y, vy: -70, life: o.life || 1, max: o.life || 1, color: o.color || '#fff', size: o.size || 32, rot: o.rot || 0 });
  }
  banner(text, o = {}) {
    this.banners.push({ text, sub: o.sub, color: o.color || '#fff', stroke: o.stroke || '#1d1530', size: o.size || 80, dur: o.dur || 1.5, t: 0 });
  }

  updateEffects(dt) {
    for (const p of this.particles) {
      p.life -= dt; p.vy += (p.g || 0) * dt; p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.spin) p.rot += p.spin * dt;
      if (p.type === 'confetti') p.vx += Math.sin(p.rot) * 30 * dt;
    }
    this.particles = this.particles.filter((p) => p.life > 0 && p.y < H + 20);
    for (const p of this.popups) { p.life -= dt; p.y += p.vy * dt; p.vy *= 1 - 2 * dt; }
    this.popups = this.popups.filter((p) => p.life > 0);
    for (const b of this.banners) b.t += dt;
    this.banners = this.banners.filter((b) => b.t < b.dur);
    this.shakeP = Math.max(0, this.shakeP - 45 * dt);
    this.flashA = Math.max(0, this.flashA - 2.5 * dt);
  }

  /* ------------------------------------------------------------ rendering */
  render() {
    const ctx = this.ctx, s = this.scale;
    ctx.setTransform(s, 0, 0, s, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const sx = (Math.random() * 2 - 1) * this.shakeP, sy = (Math.random() * 2 - 1) * this.shakeP;
    ctx.save();
    ctx.translate(sx, sy);
    this.bg.draw(ctx, this.time);
    if (this.mode === 'intro') { this.renderIntro(ctx); ctx.restore(); return; }
    // the attacker is drawn on top
    const order = (this.challenger.state === 'attack' && this.hero.state !== 'attack') ? [this.hero, this.challenger] : [this.challenger, this.hero];
    for (const f of order) f.drawShadow(ctx);
    for (const f of order) f.draw(ctx);
    this.renderParticles(ctx);
    this.renderPopups(ctx);
    ctx.restore();
    if (this.mode !== 'menu') this.renderHUD(ctx);
    this.renderBanners(ctx);
    if (this.flashA > 0) { ctx.fillStyle = `rgba(255,255,255,${this.flashA.toFixed(3)})`; ctx.fillRect(0, 0, W, H); }
  }

  renderParticles(ctx) {
    for (const p of this.particles) {
      const a = clamp(p.life / p.max, 0, 1);
      if (p.type === 'spark') {
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        drawStar(ctx, 0, 0, p.size * (0.4 + 0.6 * a), p.color, null);
        ctx.restore();
      } else if (p.type === 'confetti') {
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.fillStyle = p.color; ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        ctx.restore();
      } else {
        ctx.globalAlpha = a; ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, TAU); ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
  }

  renderPopups(ctx) {
    for (const p of this.popups) {
      const u = 1 - p.life / p.max;
      const scale = u < 0.15 ? lerp(0.3, 1.15, u / 0.15) : u < 0.3 ? lerp(1.15, 1, (u - 0.15) / 0.15) : 1;
      ctx.save();
      ctx.globalAlpha = u > 0.7 ? clamp((1 - u) / 0.3, 0, 1) : 1;
      ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.scale(scale, scale);
      arcadeText(ctx, p.text, 0, 0, p.size, p.color, '#1d1530');
      ctx.restore();
    }
  }

  renderBanners(ctx) {
    for (const b of this.banners) {
      let scale = 1, alpha = 1;
      if (b.t < 0.25) scale = lerp(2.4, 1, easeOut(b.t / 0.25));
      if (b.t > b.dur - 0.3) alpha = clamp((b.dur - b.t) / 0.3, 0, 1);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(W / 2, H / 2 - 50);
      ctx.scale(scale, scale);
      arcadeText(ctx, b.text, 0, 0, b.size, b.color, b.stroke);
      if (b.sub) arcadeText(ctx, b.sub, 0, b.size * 0.62, Math.max(18, b.size * 0.28), '#ffffff', b.stroke);
      ctx.restore();
    }
  }

  renderHUD(ctx) {
    const barW = 360, barH = 24, y = 24;
    this.drawHealthBar(ctx, this.hero, 70, y, barW, barH, 'left');
    this.drawHealthBar(ctx, this.challenger, W - 70 - barW, y, barW, barH, 'right');
    this.drawPortrait(ctx, this.hero, 40, 40, 26);
    this.drawPortrait(ctx, this.challenger, W - 40, 40, 26);
    arcadeText(ctx, this.hero.name, 74, y + barH + 18, 20, '#fff', '#1d1530', 'left');
    arcadeText(ctx, this.challenger.name, W - 74, y + barH + 18, 20, '#fff', '#1d1530', 'right');
    arcadeText(ctx, 'P1', 70 + barW, y + barH + 18, 15, '#ffd166', '#1d1530', 'right', false);
    arcadeText(ctx, 'CPU', W - 70 - barW, y + barH + 18, 15, '#ffc6ff', '#1d1530', 'left', false);
    // round win markers
    for (let i = 0; i < ROUNDS_TO_WIN; i++) {
      this.drawPip(ctx, 84 + i * 24, y + barH + 44, i < this.heroWins);
      this.drawPip(ctx, W - 84 - i * 24, y + barH + 44, i < this.challengerWins);
    }
    // timer
    const tx = W / 2;
    ctx.fillStyle = '#1d1530'; ctx.fillRect(tx - 44, 8, 88, 56);
    ctx.fillStyle = '#2a1b4a'; ctx.fillRect(tx - 40, 12, 80, 48);
    const secs = Math.ceil(this.timer);
    const urgent = secs <= 10 && this.mode === 'fight' && Math.floor(this.time * 4) % 2 === 0;
    arcadeText(ctx, String(secs).padStart(2, '0'), tx, 37, 40, urgent ? '#ff4d4d' : '#ffd166', '#1d1530', 'center', false);
  }

  drawPip(ctx, x, y, filled) {
    ctx.beginPath(); ctx.arc(x, y, 7, 0, TAU);
    ctx.fillStyle = filled ? '#ffd166' : '#2a1b4a'; ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = '#1d1530'; ctx.stroke();
  }

  drawHealthBar(ctx, f, x, y, w, h, side) {
    ctx.fillStyle = '#1d1530'; ctx.fillRect(x - 4, y - 4, w + 8, h + 8);
    ctx.fillStyle = '#5a1a1a'; ctx.fillRect(x, y, w, h);
    const hpW = w * clamp(f.hp / f.maxHp, 0, 1), ghostW = w * clamp(f.displayHp / f.maxHp, 0, 1);
    // bars drain toward the centre of the screen
    const bx = side === 'left' ? x : x + w - hpW, gx = side === 'left' ? x : x + w - ghostW;
    ctx.fillStyle = '#ffffff'; ctx.fillRect(gx, y, ghostW, h);
    const low = f.hp / f.maxHp < 0.3;
    const grad = ctx.createLinearGradient(0, y, 0, y + h);
    grad.addColorStop(0, low ? '#ff9f1c' : '#ffe066'); grad.addColorStop(1, low ? '#e63946' : '#52b788');
    ctx.fillStyle = grad; ctx.fillRect(bx, y, hpW, h);
    ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fillRect(bx, y, hpW, h * 0.35);
    if (f.isHero && f.hp <= HERO_MIN_HP) {
      ctx.lineWidth = 3; ctx.strokeStyle = `rgba(255,209,102,${(0.5 + 0.5 * Math.sin(this.time * 10)).toFixed(3)})`;
      ctx.strokeRect(x - 2, y - 2, w + 4, h + 4);
      arcadeText(ctx, 'PLOT ARMOR', x + w - 8, y + h / 2, 14, '#ffd166', '#1d1530', 'right');
    }
  }

  drawPortrait(ctx, f, cx, cy, r) {
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.clip();
    if (!f.isHero) { ctx.translate(cx, cy); ctx.scale(-1, 1); ctx.translate(-cx, -cy); }   // look toward the centre
    ctx.drawImage(f.face, cx - r, cy - r, r * 2, r * 2);
    ctx.restore();
    ctx.lineWidth = 4; ctx.strokeStyle = '#1d1530'; ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.stroke();
    ctx.lineWidth = 2; ctx.strokeStyle = '#ffd166'; ctx.beginPath(); ctx.arc(cx, cy, r + 3, 0, TAU); ctx.stroke();
  }

  /** The "VS" character introduction screen. */
  renderIntro(ctx) {
    const t = this.modeT;
    ctx.fillStyle = 'rgba(10,5,30,0.8)'; ctx.fillRect(-40, -40, W + 80, H + 80);
    const slide = easeOut(clamp(t / 0.6, 0, 1));
    fillPoly(ctx, [{ x: -40, y: -40 }, { x: W / 2 + 60, y: -40 }, { x: W / 2 - 60, y: H + 40 }, { x: -40, y: H + 40 }], 'rgba(47,85,255,0.28)');
    fillPoly(ctx, [{ x: W / 2 + 60, y: -40 }, { x: W + 40, y: -40 }, { x: W + 40, y: H + 40 }, { x: W / 2 - 60, y: H + 40 }], 'rgba(142,45,226,0.28)');
    const hx = lerp(-250, 230, slide), cx = lerp(W + 250, W - 230, slide);
    this.drawFighterPreview(ctx, this.hero, hx, 500, 1.55, CLIPS.idle(t), 1);
    this.drawFighterPreview(ctx, this.challenger, cx, 500, 1.55, CLIPS.taunt(t), -1);
    ctx.save();
    ctx.globalAlpha = slide;
    arcadeText(ctx, 'THE HERO', 230, 80, 52, '#ffd166', '#1d1530');
    arcadeText(ctx, 'Record: 999 - 0', 230, 122, 22, '#fff', '#1d1530');
    arcadeText(ctx, 'Undefeated. Unbothered. Lucky.', 230, 150, 18, '#cfc6ff', '#1d1530', 'center', false);
    arcadeText(ctx, 'THE CHALLENGER', W - 230, 80, 52, '#ffc6ff', '#1d1530');
    arcadeText(ctx, 'Record: 0 - 999', W - 230, 122, 22, '#fff', '#1d1530');
    arcadeText(ctx, 'Trained for years. Trips a lot.', W - 230, 150, 18, '#cfc6ff', '#1d1530', 'center', false);
    ctx.restore();
    const pulse = 1 + 0.08 * Math.sin(t * 6);
    ctx.save();
    ctx.translate(W / 2, H / 2 - 20); ctx.scale(pulse, pulse); ctx.rotate(-0.1);
    arcadeText(ctx, 'VS', 0, 0, 120, '#ff4d4d', '#ffffff');
    ctx.restore();
    if (t > 0.8 && Math.floor(t * 2) % 2 === 0) arcadeText(ctx, 'PRESS ENTER OR TAP TO FIGHT', W / 2, H - 36, 24, '#fff', '#1d1530');
  }

  drawFighterPreview(ctx, f, x, feetY, scale, pose, facing) {
    const view = { style: f.style, pose, skel: computeSkeleton(pose, f.style), facing, face: FaceStore.get(f.id, 'normal'), animT: this.time, vx: 0 };
    ctx.save(); ctx.translate(x, feetY); ctx.scale(scale, scale);
    renderFighter(ctx, view);
    ctx.restore();
  }
}

/* ==========================================================================
   10. SCREENS - the DOM overlays and settings
   ========================================================================== */
const $ = (id) => document.getElementById(id);

const Screens = (() => {
  let game = null;
  const settings = (() => {
    try { return Object.assign({ sound: true, touch: 'auto' }, JSON.parse(localStorage.getItem('awf_settings') || '{}')); }
    catch (e) { return { sound: true, touch: 'auto' }; }
  })();

  function saveSettings() { try { localStorage.setItem('awf_settings', JSON.stringify(settings)); } catch (e) { /* ignore */ } }
  function show(id) {
    document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('hidden', s.id !== id));
    fitTitles();
  }

  /** Shrinks the big one-line titles when the available font is wider than expected. */
  function fitTitles() {
    const stageW = $('stage').clientWidth;
    document.querySelectorAll('.title-main, .title-sub, .victory-title').forEach((el) => {
      el.style.fontSize = '';
      if (!el.offsetParent) return;                         // hidden
      const max = stageW * 0.92;
      if (el.scrollWidth > max) el.style.fontSize = (parseFloat(getComputedStyle(el).fontSize) * max / el.scrollWidth) + 'px';
    });
  }
  function hideAll() { document.querySelectorAll('.screen').forEach((s) => s.classList.add('hidden')); }

  function applySettings() {
    Sound.setMuted(!settings.sound);
    const touchDevice = (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) || navigator.maxTouchPoints > 0;
    const on = settings.touch === 'on' || (settings.touch === 'auto' && touchDevice);
    document.body.classList.toggle('touch', on);
    const soundLabel = `\u{1F50A} Sound: ${settings.sound ? 'On' : 'Off'}`;
    const touchLabel = `\u{1F4F1} Touch controls: ${{ auto: 'Auto', on: 'On', off: 'Off' }[settings.touch]}`;
    for (const id of ['btn-sound', 'btn-sound-2']) $(id).textContent = soundLabel;
    for (const id of ['btn-touch', 'btn-touch-2']) $(id).textContent = touchLabel;
  }

  function toggleFullscreen() {
    try {
      if (document.fullscreenElement) document.exitFullscreen();
      else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {});
    } catch (e) { /* not supported (e.g. iPhone Safari) */ }
  }

  function init(g) {
    game = g;
    $('btn-start').addEventListener('click', () => { Sound.unlock(); Sound.play('ui'); game.startIntro(); });
    $('btn-play-again').addEventListener('click', () => { Sound.play('ui'); game.startMatch(); });
    $('btn-victory-menu').addEventListener('click', () => { Sound.play('ui'); game.goMenu(); });
    $('btn-pause').addEventListener('click', () => { Sound.play('ui'); game.togglePause(); });
    $('btn-resume').addEventListener('click', () => { Sound.play('ui'); game.togglePause(); });
    $('btn-pause-menu').addEventListener('click', () => { Sound.play('ui'); game.goMenu(); });
    for (const id of ['btn-sound', 'btn-sound-2']) $(id).addEventListener('click', () => { settings.sound = !settings.sound; saveSettings(); applySettings(); Sound.play('ui'); });
    for (const id of ['btn-touch', 'btn-touch-2']) $(id).addEventListener('click', () => {
      settings.touch = { auto: 'on', on: 'off', off: 'auto' }[settings.touch]; saveSettings(); applySettings(); Sound.play('ui');
    });
    for (const id of ['btn-fullscreen', 'btn-fullscreen-2']) $(id).addEventListener('click', () => { Sound.play('ui'); toggleFullscreen(); });

    // Enter / Space start the game from the start screen and replay from the victory screen.
    Input.onPress((action) => {
      if (action !== 'start') return;
      if (game.mode === 'menu' && !$('screen-start').classList.contains('hidden')) game.startIntro();
      else if (game.mode === 'match_end' && !$('screen-victory').classList.contains('hidden')) game.startMatch();
    });
    // Tapping the arena skips the VS screen.
    game.canvas.addEventListener('pointerdown', () => { if (game.mode === 'intro') game.introTap = true; });
    applySettings();
  }

  function onMode(m) {
    if (m === 'menu') show('screen-start');
    else if (m !== 'match_end') hideAll();
    $('btn-pause').classList.toggle('hidden', !(m === 'fight' || m === 'round_intro' || m === 'round_end'));
  }

  function onPause(paused) { if (paused) show('screen-pause'); else hideAll(); }

  function showVictory(g) {
    const s = g.stats;
    $('victory-sub').textContent = pick([
      'A flawless 2 to 0. Nobody is surprised.',
      'The Challenger has requested a rematch. It will go the same way.',
      'Judges score it 10-10-10 for the Hero. The judges are also the Hero.',
      'Experts call it the least surprising result in sports history.',
    ]);
    const rows = [
      ['Rounds', `${g.heroWins} - ${g.challengerWins}`],
      ['Punches landed', s.punches],
      ['Power punches landed', s.power],
      ['Blocks', s.blocked],
      ['Damage taken', `${s.damageTaken} (floor: ${HERO_MIN_HP}%)`],
      ['Plot armor saves', s.plot],
      ['Challenger misfortunes', s.misfortunes],
      ['Fight time', `${s.time.toFixed(1)} s`],
    ];
    $('victory-stats').innerHTML = rows.map(([k, v]) => `<li><span>${k}</span><span>${v}</span></li>`).join('');
    show('screen-victory');
  }

  return { init, onMode, onPause, showVictory, show, hideAll, fitTitles };
})();


/* ==========================================================================
   11. BOOT
   ========================================================================== */
function fitStage(game) {
  const stage = $('stage');
  const vw = window.innerWidth, vh = window.innerHeight;
  let w = vw, h = vw * 9 / 16;
  if (h > vh) { h = vh; w = h * 16 / 9; }
  w = Math.floor(w); h = Math.floor(h);
  stage.style.width = w + 'px';
  stage.style.height = h + 'px';
  stage.style.setProperty('--unit', (w / 100) + 'px');   // 1em = 1% of the stage width (see style.css)
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  game.canvas.width = Math.round(w * dpr);
  game.canvas.height = Math.round(h * dpr);
  game.scale = game.canvas.width / W;
}

function boot() {
  FaceStore.init();
  const game = new Game($('game'));
  Screens.init(game);
  Input.bindTouch($('touch-controls'));
  Input.onPress(() => Sound.unlock());                   // audio can only start after a user gesture
  window.addEventListener('pointerdown', () => Sound.unlock());
  const refit = () => { fitStage(game); Screens.fitTitles(); };
  window.addEventListener('resize', refit);
  window.addEventListener('orientationchange', refit);
  refit();
    game.start();
  window.AWF = game;                                      // handy for poking at the game from the console
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();

})();
