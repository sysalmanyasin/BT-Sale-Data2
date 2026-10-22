import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const cover = read('css/cover-dashboard.css');
const nav = read('css/nav.css');
const index = read('index.html');

// Cover group slug -> the body[data-domain] the section itself uses (ui.js showPage)
const SLUG_TO_DOMAIN = { manager: 'manager', notes: 'notesheets', closing: 'closing', audit: 'audit', inventory: 'inventory', str: 'str' };

const coverGroup = (slug) => {
  const m = cover.match(new RegExp(`\\.cover-group\\[data-group="${slug}"\\]\\{--g-accent:var\\(--([\\w-]+)\\);--g-bg:var\\(--([\\w-]+)\\);\\}`));
  assert.ok(m, `cover-dashboard.css has no colour rule for group "${slug}"`);
  return { accent: m[1], bg: m[2] };
};
const navDomain = (domain) => {
  const m = nav.match(new RegExp(`body\\[data-domain="${domain}"\\]\\s*\\{\\s*--accent:\\s*var\\(--([\\w-]+)\\);\\s*--alt:\\s*var\\(--([\\w-]+)\\);`));
  assert.ok(m, `nav.css has no re-theme block for domain "${domain}"`);
  return { accent: m[1], bg: m[2] };
};

describe('Cover design guard', () => {
  for (const [slug, domain] of Object.entries(SLUG_TO_DOMAIN)) {
    test(`Cover "${slug}" group uses the same accent/tint as the ${domain} section itself`, () => {
      assert.deepEqual(coverGroup(slug), navDomain(domain));
    });
  }

  test('Sales group uses the base app accent', () => {
    assert.deepEqual(coverGroup('sales'), { accent: 'accent', bg: 'alt' });
  });

  test('Sections drawer groups use the same colours as Cover', () => {
    for (const [slug, domain] of Object.entries({ closing: 'closing', audit: 'audit', inventory: 'inventory', str: 'str', manager: 'manager' })) {
      const m = nav.match(new RegExp(`#sections-list > \\.sections-group\\[data-domain="${domain}"\\]\\s*\\{\\s*--g-accent:\\s*var\\(--([\\w-]+)\\);\\s*--g-bg:\\s*var\\(--([\\w-]+)\\);`));
      assert.ok(m, `drawer rule missing for ${domain}`);
      assert.deepEqual({ accent: m[1], bg: m[2] }, coverGroup(slug));
    }
  });

  test('hover lift is limited to hover-capable pointers (no sticky lift on touch)', () => {
    const lift = cover.match(/\.cover-group:hover\{[^}]*translateY/);
    assert.ok(lift, 'hover lift rule missing');
    const before = cover.slice(0, lift.index);
    assert.match(before.slice(before.lastIndexOf('@media')), /^@media \(hover:hover\) and \(pointer:fine\)\{\s*$/);
  });

  test('loading skeleton ships in index.html and Cover has no bare "Loading…" text', () => {
    assert.match(index, /id="cover-container" aria-busy="true"/);
    assert.ok((index.match(/cover-skel-kpi/g) || []).length >= 4, 'KPI skeleton tiles missing');
    assert.ok(!/id="cover-container">Loading/.test(index));
    assert.match(cover, /prefers-reduced-motion:no-preference\)\{\s*\.skel/);
  });

  test('hero domain strip has one segment per Cover group', () => {
    const strip = index.match(/cover-page-hero-domainstrip"[^>]*>((?:<span><\/span>)+)/);
    assert.ok(strip);
    assert.equal((strip[1].match(/<span>/g) || []).length, 8);
  });
});
