// BT Intelligence — the talking avatar (js/ai-center/ui.js docks it in the hero and opens its settings sheet).
//   • With the owner's photo: a 2D "jaw drop" lip-sync (the lower face is a clipped copy of the same photo that moves down a few
//     pixels while Dua speaks, with a dark mouth opening behind it) plus a gentle head sway. The mouth line height is adjustable.
//   • Without a photo: a friendly illustrated face in the brand colours that blinks and moves its mouth.
// The mouth is driven by a speech-like rhythm while the browser is speaking (the Web Speech API exposes no audio stream), so it
// reads as talking but is not frame-accurate lip-sync. No photo or audio ever leaves the device. Pure SVG, no innerHTML.
const NS = 'http://www.w3.org/2000/svg';
export const KEYS = { photo: 'bt_jarvis_photo', mode: 'bt_jarvis_photo_mode', mouthY: 'bt_jarvis_mouth_y', live: 'bt_jarvis_live' };
export const MOUTH_MIN = 55, MOUTH_MAX = 85, MOUTH_DEFAULT = 70;

const ls = {
  get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (_) { /* private mode: the setting lasts for this visit only */ } },
  del(k) { try { localStorage.removeItem(k); } catch (_) { /* ignore */ } },
};
export const clampMouthY = v => { const n = Number(v); return Number.isFinite(n) ? Math.min(MOUTH_MAX, Math.max(MOUTH_MIN, Math.round(n))) : MOUTH_DEFAULT; };
export function getPrefs() {
  return { photo: ls.get(KEYS.photo) || '', mode: ls.get(KEYS.mode) || 'photo', mouthY: clampMouthY(ls.get(KEYS.mouthY) == null ? MOUTH_DEFAULT : ls.get(KEYS.mouthY)), live: ls.get(KEYS.live) !== '0' };
}
export function setMouthY(v) { ls.set(KEYS.mouthY, String(clampMouthY(v))); }
export function setLive(on) { ls.set(KEYS.live, on ? '1' : '0'); }
export function clearPhoto() { ls.del(KEYS.photo); ls.del(KEYS.mode); }

const n = (tag, a = {}, ...kids) => { const e = document.createElementNS(NS, tag); for (const k in a) e.setAttribute(k, a[k]); kids.forEach(c => c && e.append(c)); return e; };

// ── the face ────────────────────────────────────────────────────────────────────────────────────
function photoFace({ photo, mouthY }) {
  const S = 4, W = 152;                                    // the square photo sits inside the 160 viewBox with a small margin
  const y = S + (W * mouthY) / 100;                        // mouth line
  const img = (extra = {}) => n('image', { href: photo, x: S, y: S, width: W, height: W, preserveAspectRatio: 'xMidYMid slice', ...extra });
  return n('g', { class: 'jv-head' },
    img(),
    n('ellipse', { class: 'jv-cavity', cx: 80, cy: y + 0.5, rx: 13, ry: 4 }),
    n('g', { class: 'jv-jaw', 'clip-path': 'url(#jv-jawclip)' }, img()));    // finished portraits (square art) talk too
}
function drawnFace() {
  return n('g', { class: 'jv-head' },
    n('path', { class: 'jv-shirt', d: 'M18 160c3-24 22-34 46-39l6-8h20l6 8c24 5 43 15 46 39z' }),
    n('rect', { class: 'jv-neck', x: 68, y: 100, width: 24, height: 22, rx: 8 }),
    n('path', { class: 'jv-hair-b', d: 'M44 74c-2-28 14-46 36-46s38 18 36 46c-3-10-10-17-18-20-13 6-31 6-44-2-5 4-8 12-10 22z' }),
    n('ellipse', { class: 'jv-skin', cx: 80, cy: 78, rx: 30, ry: 35 }),
    n('path', { class: 'jv-hair-f', d: 'M49 70c0-22 13-36 31-36s31 14 31 36c-6-9-12-14-22-17-12 5-26 5-40 17z' }),
    n('g', { class: 'jv-eyes' }, n('ellipse', { class: 'jv-eye', cx: 68, cy: 78, rx: 3.6, ry: 4.4 }), n('ellipse', { class: 'jv-eye', cx: 92, cy: 78, rx: 3.6, ry: 4.4 })),
    n('path', { class: 'jv-brow', d: 'M61 69q7-4 14-1M85 68q7-3 14 1' }),
    n('path', { class: 'jv-nose', d: 'M80 82v9q-3 2-5 1' }),
    n('ellipse', { class: 'jv-mouth', cx: 80, cy: 103, rx: 10, ry: 5 }));
}

export function buildFace(prefs = getPrefs()) {
  const hasPhoto = !!prefs.photo, y = 4 + (152 * prefs.mouthY) / 100;
  const svg = n('svg', { viewBox: '0 0 160 160', class: 'aic-avatar jv-face' + (hasPhoto ? ' jv-has-photo' : ' jv-drawn'), 'aria-hidden': 'true', focusable: 'false', 'data-live': prefs.live ? '1' : '0' },
    n('defs', {},
      n('clipPath', { id: 'jv-round' }, n('circle', { cx: 80, cy: 80, r: 70 })),
      // the moving jaw: a soft box around the chin, starting at the mouth line
      n('clipPath', { id: 'jv-jawclip' }, n('rect', { x: 52, y, width: 56, height: 34, rx: 16 }))),
    n('circle', { class: 'jv-ring2', cx: 80, cy: 80, r: 78.5 }),
    n('circle', { class: 'jv-ring', cx: 80, cy: 80, r: 74 }),
    n('g', { 'clip-path': 'url(#jv-round)' }, n('rect', { class: 'jv-bg', x: 0, y: 0, width: 160, height: 160 }),
      hasPhoto ? photoFace(prefs) : drawnFace()));
  svg.style.setProperty('--mouth', String(env.toFixed(3)));
  return svg;
}

// ── speech-like mouth driver (one shared requestAnimationFrame loop; idle when nobody is talking) ───────
let talking = false, raf = 0, env = 0;
const syllable = t => {                                   // 4-7 syllables a second with short pauses between phrases
  const s = Math.abs(Math.sin(t * 0.0105)) * 0.6 + Math.abs(Math.sin(t * 0.0173 + 1.3)) * 0.4;
  return Math.min(1, s * (Math.sin(t * 0.0021) > -0.75 ? 1 : 0.15) * 1.05);
};
function tick(t) {
  raf = 0;
  env += ((talking ? syllable(t) : 0) - env) * 0.38;
  if (!talking && env < 0.01) env = 0;
  document.querySelectorAll('.aic-avatar[data-live="1"]').forEach(s => s.style.setProperty('--mouth', env.toFixed(3)));
  if (talking || env > 0) raf = requestAnimationFrame(tick);
}
export function setTalking(on) {
  talking = !!on;
  if (typeof requestAnimationFrame !== 'function') return; // Node (tests) has no animation frames
  if (talking && !raf) raf = requestAnimationFrame(tick);
}
export const isTalking = () => talking;
