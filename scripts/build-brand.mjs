// BRAND ICON FAMILY GENERATOR  (npm run brand  |  npm run brand:check  |  npm run brand:png)
//
// One geometry, five apps. Every launcher icon is the DuaPharma tile: the white pharmacy cross sits at a
// fixed position, and each app swaps in its own background colour and one corner glyph so the apps can be
// told apart on a home screen while still reading as one family.
//
//   app                       background            glyph
//   BT Sales IC (main PWA)    Primary Navy          rising line + amber point (the original logo)
//   Inventory Search (PWA)    deep teal             magnifier
//   Attendance (Android)      Insight Amber         location pin
//   Closing widgets (Android) info blue             2x2 widget tiles
//   MailRoutine (Android)     violet                envelope
//
// The main PWA icons in icons/ are the original hand-exported master and are NOT rewritten here; this script
// owns everything for the other four apps plus the wordmark files.
//
//   node scripts/build-brand.mjs          write every text output (SVG, Android XML, colour resources)
//   node scripts/build-brand.mjs --check  change nothing; exit 1 if any generated file has drifted (CI/test)
//   node scripts/build-brand.mjs --png    also render PNGs (needs `sharp`: npm i --no-save sharp)
//
// Android vectors use the same 512-unit geometry inside a <group> transform, so there is no hand-maintained
// path data anywhere: change a glyph here, re-run, commit the output.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export const BRAND = {
  navy: '#101B2D',
  teal: '#18A999',
  amber: '#F2B84B',
  white: '#FFFFFF',
};

// ── geometry helpers (512-unit design space) ───────────────────────────────────────────────────────────────
const n = (v) => String(+v.toFixed(2));
/** Rounded rectangle, clockwise. */
const rr = (x, y, w, h, r) =>
  `M${n(x + r)} ${n(y)}H${n(x + w - r)}A${r} ${r} 0 0 1 ${n(x + w)} ${n(y + r)}V${n(y + h - r)}A${r} ${r} 0 0 1 ${n(x + w - r)} ${n(y + h)}` +
  `H${n(x + r)}A${r} ${r} 0 0 1 ${n(x)} ${n(y + h - r)}V${n(y + r)}A${r} ${r} 0 0 1 ${n(x + r)} ${n(y)}Z`;
/** Circle, clockwise. */
const circle = (cx, cy, r) => `M${n(cx - r)} ${n(cy)}A${r} ${r} 0 1 1 ${n(cx + r)} ${n(cy)}A${r} ${r} 0 1 1 ${n(cx - r)} ${n(cy)}Z`;

const SALES_LINE = 'M94 414L104.2 413.9L114.1 413.6L123.9 413.1L133.5 412.3L142.9 411.3L152.1 410.2L161.2 408.8L170 407.1L178.7 405.3L187.2 403.2L195.6 400.9L203.8 398.3L211.8 395.6L219.7 392.5L227.4 389.3L234.9 385.8L242.3 382L249.5 378L256.6 373.8L263.5 369.3L270.3 364.5L276.9 359.5L283.4 354.3L289.8 348.8L296 343L302 336.9L308 330.6L313.8 324L319.5 317.1L325 310L330.5 302.6L335.8 294.9L341 286.9L346 278.7L351 270.1L355.8 261.3L360.6 252.2L365.2 242.7L369.7 233L374.1 223L378.5 212.7L382.7 202.1L386.8 191.2L390.8 180L394.7 168.5L398.6 156.6L402.3 144.5L406 132';

/** The pharmacy cross: identical position, size and corner radius in every icon. */
const cross = (color) => [
  { d: rr(162, 84, 92, 240, 22), fill: color },
  { d: rr(88, 158, 240, 92, 22), fill: color },
];

// Glyphs live in the lower-right free area (x > 258, y > 258) and stay inside the 66dp adaptive-icon safe zone.
const GLYPHS = {
  sales: () => [
    { d: SALES_LINE, stroke: BRAND.teal, sw: 28 },
    { d: circle(406, 132, 27), fill: BRAND.amber },
  ],
  inventory: () => [
    { d: circle(338, 338, 58), stroke: BRAND.amber, sw: 26 },
    { d: 'M388 388L410 410', stroke: BRAND.amber, sw: 32 },
  ],
  attendance: (c) => [
    {
      // Teardrop pin (drawn clockwise). The inner circle runs the opposite way round so it punches a hole under the non-zero rule,
      // which keeps it transparent in the Android themed (monochrome) layer too.
      d:
        'M356 270C392 270 422 299 422 336C422 372 392 410 356 448C320 410 290 372 290 336C290 299 320 270 356 270Z' +
        'M332 336A24 24 0 1 0 380 336A24 24 0 1 0 332 336Z',
      fill: c.glyph,
    },
  ],
  widgets: () => [
    { d: rr(272, 272, 66, 66, 16), fill: BRAND.teal },
    { d: rr(350, 272, 66, 66, 16), fill: BRAND.teal },
    { d: rr(272, 350, 66, 66, 16), fill: BRAND.teal },
    { d: rr(350, 350, 66, 66, 16), fill: BRAND.amber },
  ],
  mail: () => [
    { d: rr(284, 302, 140, 100, 16), stroke: BRAND.amber, sw: 18 },
    { d: 'M296 320L354 364L412 320', stroke: BRAND.amber, sw: 18 },
  ],
};

/** App registry. `android` / `pwa` say where each icon family is written. */
export const APPS = {
  sales: { id: 'sales', label: 'Dua BT Sales', bg: BRAND.navy, cross: BRAND.white, glyph: BRAND.white },
  inventory: {
    id: 'inventory', label: 'Dua Inv Search', bg: '#0C6A60', cross: BRAND.white, glyph: BRAND.amber,
    pwa: 'inventory-search/icons',
  },
  attendance: {
    id: 'attendance', label: 'Dua Attendance', bg: BRAND.amber, cross: BRAND.navy, glyph: BRAND.navy,
    android: { dir: 'android-attendance', colorName: 'ic_launcher_background', legacy: ['drawable'] },
  },
  widgets: {
    id: 'widgets', label: 'Dua Closing', bg: '#2C5282', cross: BRAND.white, glyph: BRAND.white,
    android: { dir: 'android-widget', colorName: 'ic_launcher_background', legacy: ['drawable', 'mipmap-anydpi'], alpha: true },
  },
  mail: {
    id: 'mail', label: 'Dua Mail', bg: '#4C3A8A', cross: BRAND.white, glyph: BRAND.amber,
    android: { dir: 'android-mailroutine', colorName: 'mr_icon_bg', legacy: [], alpha: true },
  },
};

export const prims = (app) => [...cross(app.cross), ...GLYPHS[app.id === 'sales' ? 'sales' : app.id](app)];

// ── SVG ────────────────────────────────────────────────────────────────────────────────────────────────────
const paint = (p, mono) => {
  const col = (c) => (mono ? '#FFFFFF' : c);
  return p.stroke
    ? `<path d="${p.d}" fill="none" stroke="${col(p.stroke)}" stroke-width="${p.sw}" stroke-linecap="round" stroke-linejoin="round"/>`
    : `<path d="${p.d}" fill="${col(p.fill)}"/>`;
};

/** Square tile. kind: 'tile' (rounded, any-purpose) | 'full' (full-bleed, content pulled in: maskable / apple-touch). */
export function tileSvg(app, kind = 'tile', title = app.label) {
  const body = prims(app).map((p) => paint(p)).join('');
  if (kind === 'tile') {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">\n  <title>${title}</title>\n<rect width="512" height="512" rx="112" fill="${app.bg}"/>\n${body}\n</svg>\n`;
  }
  const scale = kind === 'maskable' ? 0.72 : 0.86;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">\n  <title>${title}</title>\n<rect width="512" height="512" fill="${app.bg}"/>\n<g transform="translate(256 256) scale(${scale}) translate(-255 -255)">${body}</g>\n</svg>\n`;
}

// ── Android vector drawables ───────────────────────────────────────────────────────────────────────────────
const vecPath = (p, mono) => {
  const col = (c) => (mono ? '#FFFFFF' : c);
  return p.stroke
    ? `        <path\n            android:strokeColor="${col(p.stroke)}"\n            android:strokeWidth="${p.sw}"\n            android:strokeLineCap="round"\n            android:strokeLineJoin="round"\n            android:pathData="${p.d}" />`
    : `        <path\n            android:fillColor="${col(p.fill)}"\n            android:pathData="${p.d}" />`;
};

const vecHead = '<vector xmlns:android="http://schemas.android.com/apk/res/android"\n    android:width="108dp"\n    android:height="108dp"\n    android:viewportWidth="108"\n    android:viewportHeight="108">\n';

/** Adaptive foreground (mono=false) or themed monochrome layer (mono=true). Mark sits inside the 66dp safe zone. */
export function androidLayer(app, mono) {
  const g = '    <group\n        android:translateX="18.66"\n        android:translateY="18.66"\n        android:scaleX="0.1386"\n        android:scaleY="0.1386">\n';
  return `${vecHead}${g}${prims(app).map((p) => vecPath(p, mono)).join('\n')}\n    </group>\n</vector>\n`;
}

/** Legacy full-tile drawable (pre-API-26 launcher, widget previews, in-app logo). */
export function androidLegacy(app) {
  const g = '    <group\n        android:translateX="3"\n        android:translateY="3"\n        android:scaleX="0.2"\n        android:scaleY="0.2">\n';
  const bg = `    <path\n        android:fillColor="${app.bg}"\n        android:pathData="M0,0h108v108h-108z" />\n`;
  return `${vecHead}${bg}${g}${prims(app).map((p) => vecPath(p, false)).join('\n')}\n    </group>\n</vector>\n`;
}

export function androidAdaptiveXml(app) {
  return `<?xml version="1.0" encoding="utf-8"?>
<!-- ${app.label} launcher icon (generated by scripts/build-brand.mjs — edit the generator, not this file).
     DuaPharma family: pharmacy cross in a fixed position, per-app background + corner glyph.
     The monochrome layer drives Android 13+ themed icons. -->
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/${app.android.colorName}" />
    <foreground android:drawable="@drawable/ic_launcher_foreground" />
    <monochrome android:drawable="@drawable/ic_launcher_monochrome" />
</adaptive-icon>
`;
}

const argb = (hex) => (hex.length === 7 ? `#FF${hex.slice(1)}` : hex);
export const colorValue = (app) => (app.android.alpha ? argb(app.bg) : app.bg);

// ── wordmark (Poppins Bold "Dua" + Poppins Regular "Pharma", converted to outlines: no font dependency) ──────
const WM = {"dua": "M69.3 -35.1Q69.3 -24.8 64.75 -16.8Q60.2 -8.8 51.85 -4.4Q43.5 0 32.5 0H6.2V-70.2H32.5Q43.6 -70.2 51.9 -65.8Q60.2 -61.4 64.75 -53.45Q69.3 -45.5 69.3 -35.1ZM51.9 -35.1Q51.9 -44.8 46.5 -50.2Q41.1 -55.6 31.4 -55.6H23.3V-14.8H31.4Q41.1 -14.8 46.5 -20.1Q51.9 -25.4 51.9 -35.1Z M133 -55.8V0H115.9V-7.6Q113.3 -3.9 108.85 -1.65Q104.4 0.6 99 0.6Q92.6 0.6 87.7 -2.25Q82.8 -5.1 80.1 -10.5Q77.4 -15.9 77.4 -23.2V-55.8H94.4V-25.5Q94.4 -19.9 97.3 -16.8Q100.2 -13.7 105.1 -13.7Q110.1 -13.7 113 -16.8Q115.9 -19.9 115.9 -25.5V-55.8Z M165.5 -56.6Q171.4 -56.6 175.85 -54.2Q180.3 -51.8 182.7 -47.9V-55.8H199.8V0H182.7V-7.9Q180.2 -4 175.75 -1.6Q171.3 0.8 165.4 0.8Q158.6 0.8 153 -2.75Q147.4 -6.3 144.15 -12.85Q140.9 -19.4 140.9 -28Q140.9 -36.6 144.15 -43.1Q147.4 -49.6 153 -53.1Q158.6 -56.6 165.5 -56.6ZM170.5 -41.7Q165.4 -41.7 161.85 -38.05Q158.3 -34.4 158.3 -28Q158.3 -21.6 161.85 -17.85Q165.4 -14.1 170.5 -14.1Q175.6 -14.1 179.15 -17.8Q182.7 -21.5 182.7 -27.9Q182.7 -34.3 179.15 -38Q175.6 -41.7 170.5 -41.7Z", "pharma": "M236.2 -29.1H222.8V0H213.7V-69.7H236.2Q248 -69.7 254.15 -64Q260.3 -58.3 260.3 -49.3Q260.3 -40.6 254.35 -34.85Q248.4 -29.1 236.2 -29.1ZM251 -49.3Q251 -62.2 236.2 -62.2H222.8V-36.6H236.2Q243.8 -36.6 247.4 -39.9Q251 -43.2 251 -49.3Z M320.2 -32.3V0H311.2V-31Q311.2 -39.2 307.1 -43.55Q303 -47.9 295.9 -47.9Q288.7 -47.9 284.45 -43.4Q280.2 -38.9 280.2 -30.3V0H271.1V-74H280.2V-47Q282.9 -51.2 287.65 -53.5Q292.4 -55.8 298.3 -55.8Q304.5 -55.8 309.5 -53.15Q314.5 -50.5 317.35 -45.2Q320.2 -39.9 320.2 -32.3Z M357.2 -55.7Q364.4 -55.7 369.7 -52.6Q375 -49.5 377.6 -44.8V-54.8H386.8V0H377.6V-10.2Q374.9 -5.4 369.55 -2.25Q364.2 0.9 357.1 0.9Q349.8 0.9 343.9 -2.7Q338 -6.3 334.6 -12.8Q331.2 -19.3 331.2 -27.6Q331.2 -36 334.6 -42.35Q338 -48.7 343.95 -52.2Q349.9 -55.7 357.2 -55.7ZM359 -47.8Q353.9 -47.8 349.7 -45.4Q345.5 -43 343 -38.4Q340.5 -33.8 340.5 -27.6Q340.5 -21.3 343 -16.65Q345.5 -12 349.7 -9.55Q353.9 -7.1 359 -7.1Q364.1 -7.1 368.35 -9.55Q372.6 -12 375.1 -16.65Q377.6 -21.3 377.6 -27.5Q377.6 -33.7 375.1 -38.3Q372.6 -42.9 368.35 -45.35Q364.1 -47.8 359 -47.8Z M428.5 -55.8V-46.4H426.1Q410.8 -46.4 410.8 -29.8V0H401.7V-54.8H410.8V-45.9Q413.2 -50.6 417.65 -53.2Q422.1 -55.8 428.5 -55.8Z M526.6 -32.3V0H517.6V-31Q517.6 -39.2 513.55 -43.55Q509.5 -47.9 502.6 -47.9Q495.5 -47.9 491.3 -43.35Q487.1 -38.8 487.1 -30.2V0H478.1V-31Q478.1 -39.2 474.05 -43.55Q470 -47.9 463.1 -47.9Q456 -47.9 451.8 -43.35Q447.6 -38.8 447.6 -30.2V0H438.5V-54.8H447.6V-46.9Q450.3 -51.2 454.85 -53.5Q459.4 -55.8 464.9 -55.8Q471.8 -55.8 477.1 -52.7Q482.4 -49.6 485 -43.6Q487.3 -49.4 492.6 -52.6Q497.9 -55.8 504.4 -55.8Q510.8 -55.8 515.8 -53.15Q520.8 -50.5 523.7 -45.2Q526.6 -39.9 526.6 -32.3Z M563.6 -55.7Q570.8 -55.7 576.1 -52.6Q581.4 -49.5 584 -44.8V-54.8H593.2V0H584V-10.2Q581.3 -5.4 575.95 -2.25Q570.6 0.9 563.5 0.9Q556.2 0.9 550.3 -2.7Q544.4 -6.3 541 -12.8Q537.6 -19.3 537.6 -27.6Q537.6 -36 541 -42.35Q544.4 -48.7 550.35 -52.2Q556.3 -55.7 563.6 -55.7ZM565.4 -47.8Q560.3 -47.8 556.1 -45.4Q551.9 -43 549.4 -38.4Q546.9 -33.8 546.9 -27.6Q546.9 -21.3 549.4 -16.65Q551.9 -12 556.1 -9.55Q560.3 -7.1 565.4 -7.1Q570.5 -7.1 574.75 -9.55Q579 -12 581.5 -16.65Q584 -21.3 584 -27.5Q584 -33.7 581.5 -38.3Q579 -42.9 574.75 -45.35Q570.5 -47.8 565.4 -47.8Z", "width": 600.4};
export function wordmarkSvg(variant) {
  const dua = variant === 'dark' ? BRAND.white : BRAND.navy;
  const pharma = variant === 'dark' ? BRAND.teal : '#0E8074';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-2 -80 ${n(WM.width + 4)} 92" role="img">\n  <title>DuaPharma</title>\n<path fill="${dua}" d="${WM.dua}"/>\n<path fill="${pharma}" d="${WM.pharma}"/>\n</svg>\n`;
}

// ── output plan ────────────────────────────────────────────────────────────────────────────────────────────
/** Every generated TEXT file: { repo-relative path: content }. Pure, so tests can diff it against the repo. */
export function textOutputs() {
  const out = {};
  out['icons/duapharma-wordmark-dark.svg'] = wordmarkSvg('dark');
  out['icons/duapharma-wordmark-light.svg'] = wordmarkSvg('light');
  for (const app of Object.values(APPS)) {
    if (app.pwa) {
      out[`${app.pwa}/icon.svg`] = tileSvg(app, 'tile');
      out[`${app.pwa}/icon-maskable.svg`] = tileSvg(app, 'maskable');
    }
    if (app.android) {
      const res = `${app.android.dir}/app/src/main/res`;
      out[`${res}/drawable/ic_launcher_foreground.xml`] = androidLayer(app, false);
      out[`${res}/drawable/ic_launcher_monochrome.xml`] = androidLayer(app, true);
      out[`${res}/mipmap-anydpi-v26/ic_launcher.xml`] = androidAdaptiveXml(app);
      for (const d of app.android.legacy) out[`${res}/${d}/ic_launcher.xml`] = androidLegacy(app);
    }
  }
  return out;
}

/** Colour resources are patched in place (the files hold other colours too). Returns { path: { name, value } }. */
export function colorPatches() {
  const out = {};
  for (const app of Object.values(APPS)) {
    if (app.android) out[`${app.android.dir}/app/src/main/res/values/colors.xml`] = { name: app.android.colorName, value: colorValue(app) };
  }
  return out;
}

export function patchColors(xml, { name, value }) {
  const re = new RegExp(`(<color name="${name}">)[^<]*(</color>)`);
  if (re.test(xml)) return xml.replace(re, `$1${value}$2`);
  return xml.replace('</resources>', `    <color name="${name}">${value}</color>\n</resources>`);
}

// ── PNG rendering (optional; needs sharp) ──────────────────────────────────────────────────────────────────
const PNG_SIZES = [
  ['icon-192.png', 'tile', 192], ['icon-512.png', 'tile', 512],
  ['icon-maskable-192.png', 'maskable', 192], ['icon-maskable-512.png', 'maskable', 512],
  ['apple-touch-icon.png', 'apple', 180], ['favicon-32.png', 'tile', 32],
];

function familySheet() {
  const apps = Object.values(APPS);
  const cell = 200;
  const tiles = apps.map((a, i) => {
    const x = 28 + i * cell;
    const inner = tileSvg(a, 'tile').replace(/^<svg[^>]*>\s*<title>[^<]*<\/title>\s*/, '').replace(/<\/svg>\s*$/, '');
    return `<g transform="translate(${x} 28) scale(0.3125)">${inner}</g><text x="${x + 80}" y="222" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="15" font-weight="700" fill="#101B2D">${a.label}</text>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${28 + apps.length * cell}" height="250" viewBox="0 0 ${28 + apps.length * cell} 250"><rect width="100%" height="100%" fill="#F4F6F9"/>${tiles}</svg>`;
}

async function renderPngs() {
  let sharp;
  try { sharp = (await import('sharp')).default; } catch {
    console.error('PNG output needs sharp:  npm i --no-save sharp   (it is intentionally not a project dependency)');
    process.exit(2);
  }
  for (const app of Object.values(APPS)) {
    if (!app.pwa) continue;
    for (const [file, kind, size] of PNG_SIZES) {
      const svg = tileSvg(app, kind === 'apple' ? 'full' : kind);
      writeFileSync(join(ROOT, app.pwa, file), await sharp(Buffer.from(svg), { density: 384 }).resize(size, size).png().toBuffer());
    }
  }
  mkdirSync(join(ROOT, 'docs/brand'), { recursive: true });
  writeFileSync(join(ROOT, 'docs/brand/icon-family.png'), await sharp(Buffer.from(familySheet()), { density: 192 }).png().toBuffer());
}

// ── CLI ────────────────────────────────────────────────────────────────────────────────────────────────────
async function main() {
  const check = process.argv.includes('--check');
  const drift = [];
  const put = (rel, content) => {
    const abs = join(ROOT, rel);
    const cur = existsSync(abs) ? readFileSync(abs, 'utf8') : null;
    if (cur === content) return;
    if (check) { drift.push(rel); return; }
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
    console.log('wrote', rel);
  };
  for (const [rel, content] of Object.entries(textOutputs())) put(rel, content);
  for (const [rel, patch] of Object.entries(colorPatches())) {
    const abs = join(ROOT, rel);
    put(rel, patchColors(readFileSync(abs, 'utf8'), patch));
  }
  if (check) {
    if (drift.length) { console.error('Brand outputs are stale — run `npm run brand`:\n  ' + drift.join('\n  ')); process.exit(1); }
    console.log('brand outputs up to date');
    return;
  }
  if (process.argv.includes('--png')) await renderPngs();
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();
