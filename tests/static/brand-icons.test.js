// The DuaPharma icon family: five apps, one shared cross + per-app background and glyph (scripts/build-brand.mjs).
// These tests stop the apps drifting back to a single shared icon, and stop generated files going stale.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { APPS, BRAND, textOutputs, colorPatches, patchColors } from '../../scripts/build-brand.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const md5 = (rel) => createHash('md5').update(fs.readFileSync(path.join(ROOT, rel))).digest('hex');
const androidApps = Object.values(APPS).filter((a) => a.android);
const res = (a, f) => `${a.android.dir}/app/src/main/res/${f}`;

describe('brand icon family', () => {
  test('every app has its own background colour and a distinct label', () => {
    const apps = Object.values(APPS);
    assert.equal(new Set(apps.map((a) => a.bg.toLowerCase())).size, apps.length, 'two apps share a launcher background colour');
    assert.equal(new Set(apps.map((a) => a.label)).size, apps.length, 'two apps share a label');
    for (const a of apps) assert.match(a.label, /^Dua /, `${a.id} label must carry the Dua prefix`);
  });

  test('generated text outputs are up to date (run `npm run brand`)', () => {
    for (const [rel, content] of Object.entries(textOutputs())) {
      assert.equal(read(rel), content, `${rel} is stale: run npm run brand`);
    }
    for (const [rel, patch] of Object.entries(colorPatches())) {
      assert.equal(read(rel), patchColors(read(rel), patch), `${rel}: launcher background colour is stale`);
    }
  });

  test('Android launcher layers are not shared between apps', () => {
    for (const layer of ['ic_launcher_foreground.xml', 'ic_launcher_monochrome.xml']) {
      const hashes = androidApps.map((a) => md5(res(a, `drawable/${layer}`)));
      assert.equal(new Set(hashes).size, hashes.length, `${layer} is identical in two Android apps`);
    }
  });

  test('Android adaptive icons reference a colour that exists and keep the themed layer', () => {
    for (const a of androidApps) {
      const xml = read(res(a, 'mipmap-anydpi-v26/ic_launcher.xml'));
      assert.match(xml, new RegExp(`@color/${a.android.colorName}`));
      assert.match(xml, /<monochrome android:drawable="@drawable\/ic_launcher_monochrome"/);
      assert.match(read(res(a, 'values/colors.xml')), new RegExp(`name="${a.android.colorName}">[^<]*${a.bg.slice(1)}`, 'i'));
    }
  });

  test('themed (monochrome) layers are single-colour so Android can tint them', () => {
    for (const a of androidApps) {
      const xml = read(res(a, 'drawable/ic_launcher_monochrome.xml'));
      const colours = new Set([...xml.matchAll(/(?:fillColor|strokeColor)="(#[0-9A-Fa-f]+)"/g)].map((m) => m[1].toUpperCase()));
      assert.deepEqual([...colours], ['#FFFFFF'], `${a.id} monochrome layer must be one colour`);
    }
  });

  test('Android app labels carry the Dua prefix', () => {
    for (const a of androidApps) {
      const m = read(res(a, 'values/strings.xml')).match(/<string name="app_name">([^<]+)<\/string>/);
      assert.equal(m && m[1], a.label, `${a.android.dir} app_name`);
    }
  });

  test('Inventory Search ships its own icons and no longer borrows the main app icons', () => {
    const inv = APPS.inventory.pwa;
    for (const f of ['icon.svg', 'icon-192.png', 'icon-512.png', 'icon-maskable-192.png', 'icon-maskable-512.png', 'apple-touch-icon.png', 'favicon-32.png']) {
      assert.ok(fs.existsSync(path.join(ROOT, inv, f)), `${inv}/${f} missing (npm run brand:png)`);
    }
    for (const f of ['icon-192.png', 'icon-512.png', 'apple-touch-icon.png', 'favicon-32.png']) {
      assert.notEqual(md5(`${inv}/${f}`), md5(`icons/${f}`), `${f} is identical to the main app's`);
    }
    for (const rel of ['inventory-search/index.html', 'inventory-search/manifest.json']) {
      assert.ok(!/\.\.\/icons\/(icon|favicon|apple)/.test(read(rel)), `${rel} still points at the main app's icons`);
    }
    const manifest = JSON.parse(read('inventory-search/manifest.json'));
    for (const i of manifest.icons) assert.ok(fs.existsSync(path.join(ROOT, 'inventory-search', i.src)), `${i.src} missing`);
    assert.match(manifest.short_name, /^Dua /);
  });

  test('main app carries the Dua prefix and the DuaPharma wordmark', () => {
    assert.match(JSON.parse(read('manifest.json')).short_name, /^Dua /);
    assert.match(read('index.html'), /duapharma-wordmark-dark\.svg/);
    assert.match(read('sw.js'), /duapharma-wordmark-dark\.svg/, 'wordmark must be in APP_SHELL for offline sign-in');
    for (const f of ['dark', 'light']) assert.ok(fs.existsSync(path.join(ROOT, `icons/duapharma-wordmark-${f}.svg`)));
  });

  test('palette stays on the documented brand colours', () => {
    assert.deepEqual(BRAND, { navy: '#101B2D', teal: '#18A999', amber: '#F2B84B', white: '#FFFFFF' });
  });
});
