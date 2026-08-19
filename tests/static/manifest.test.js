import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const manifestPath = path.join(REPO_ROOT, 'manifest.json');

describe('PWA manifest.json (smoke)', () => {
  test('manifest.json exists and is valid JSON', () => {
    assert.ok(fs.existsSync(manifestPath), 'manifest.json is missing');
    const raw = fs.readFileSync(manifestPath, 'utf8');
    assert.doesNotThrow(() => JSON.parse(raw), 'manifest.json is not valid JSON');
  });

  test('required top-level PWA fields are present', () => {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    for (const field of ['name', 'short_name', 'start_url', 'display', 'icons']) {
      assert.ok(field in manifest, `manifest.json is missing required field "${field}"`);
    }
    assert.ok(Array.isArray(manifest.icons) && manifest.icons.length > 0, 'manifest.icons must be a non-empty array');
  });

  test('every declared icon file actually exists on disk', () => {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    for (const icon of manifest.icons) {
      const iconPath = path.join(REPO_ROOT, icon.src);
      assert.ok(fs.existsSync(iconPath), `manifest icon "${icon.src}" does not exist on disk`);
    }
  });

  test('every shortcut icon file exists and shortcuts have required fields', () => {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    for (const shortcut of manifest.shortcuts || []) {
      assert.ok(shortcut.name, 'shortcut is missing a name');
      assert.ok(shortcut.url, `shortcut "${shortcut.name}" is missing a url`);
      for (const icon of shortcut.icons || []) {
        const iconPath = path.join(REPO_ROOT, icon.src);
        assert.ok(fs.existsSync(iconPath), `shortcut "${shortcut.name}" icon "${icon.src}" does not exist on disk`);
      }
    }
  });
});
