import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { collectFacts, renderBlock, currentBlock, widgetClaims, ROOT } from '../../scripts/readme-facts.mjs';

const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');

describe('README stays in sync with the repository (anti-drift guard)', () => {
  test('generated "Repository facts" block matches the real tree (fix: npm run readme:sync)', () => {
    const have = currentBlock(readme);
    assert.ok(have, 'README.md is missing the repo-facts markers');
    assert.equal(have, renderBlock(collectFacts()));
  });

  test('every "N home-screen widgets" claim equals the widget XML count', () => {
    const claims = widgetClaims(readme);
    assert.ok(claims.length > 0, 'README no longer mentions the widget count');
    const real = collectFacts().widgets;
    for (const c of claims) assert.equal(c, real, `README claims ${c} widgets but ${real} exist`);
  });

  test('every workflow and Edge Function named in the README exists', () => {
    for (const w of ['test.yml', 'supabase-deploy.yml', 'agent-live-eval.yml']) {
      assert.ok(fs.existsSync(path.join(ROOT, '.github/workflows', w)), `missing workflow ${w}`);
    }
    for (const f of ['bt-agent', 'send-daily-ntfy-briefing', 'closing-ntfy-notify', 'set-staff-login', 'google-drive', 'inventory-chat', 'medicine-ai-info']) {
      assert.ok(fs.existsSync(path.join(ROOT, 'supabase/functions', f)), `missing Edge Function ${f}`);
    }
  });
});
