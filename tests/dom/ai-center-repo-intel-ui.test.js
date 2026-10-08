// Phase 4 UI: the repository card answers real questions from the real index, honestly, and the palette commands do real things.
import { test, describe, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installDomEnv } from '../helpers/dom-env.js';

installDomEnv('<!doctype html><html><body><div class="page on" id="page-ai-center"><div id="aic-root" class="aic"></div></div></body></html>');
globalThis.requestAnimationFrame = cb => setTimeout(cb, 0);
window.requestAnimationFrame = globalThis.requestAnimationFrame;
window.scrollTo = () => {}; window.Element.prototype.scrollIntoView = () => {};

const idx = JSON.parse(readFileSync('js/ai-center/repo-index.json', 'utf8'));
let fetchMode = 'ok';
globalThis.fetch = async () => { if (fetchMode === 'ok') return { ok: true, json: async () => idx }; if (fetchMode === 'http') return { ok: false, status: 404 }; throw new Error('offline'); };

const reg = await import('../../js/agent/core/tool-registry.js');
reg.registerTool({ name: 'daily_briefing', domain: 'app', risk: 'read', description: 'b', parameters: { type: 'object', properties: {} }, run: () => ({ date: '07/Oct/2026', attention: [], missing_sales_days: 0 }) });
reg.registerTool({ name: 'closing_recent_days', domain: 'closing', risk: 'read', description: 'c', parameters: { type: 'object', properties: {} }, run: () => ({ days: [], incomplete_days: [] }) }); // closing_status deliberately NOT registered

const ui = await import('../../js/ai-center/ui.js');
const RI = await import('../../js/ai-center/repo-intel.js');
const wait = (ms = 40) => new Promise(r => setTimeout(r, ms));
const q = s => document.querySelector(s);
const card = () => q('#aic-repo') ? q('#aic-repo').textContent : '';
async function openRepo(mode = 'ok') {
  fetchMode = mode; ui.__test.S.repo = { state: 'idle', idx: null }; ui.__test.S.repoQ = ''; ui.__test.S.mode = 'investigate'; ui.__test.paint(); await wait(60);
}
async function type(v) { const i = q('#aic-rq'); i.value = v; i.dispatchEvent(new window.Event('input')); await wait(10); }

describe('repository card answers from the real index', () => {
  before(async () => { ui.onShow(); await wait(80); });
  beforeEach(async () => { await openRepo(); });

  test('connected: shows INDEX READY with the real counts and commit, and says it holds no source code', () => {
    assert.match(card(), /INDEX READY/); assert.equal(/NOT CONNECTED/.test(card()), false);
    assert.ok(card().includes(idx.commit)); assert.ok(card().includes(idx.files + ' files'));
    assert.match(card(), /WHERE things are implemented/); assert.match(card(), /no source code/);
  });
  test('Where is approval implemented? -> file, line, role, summary, related feature, and a GitHub link at the indexed commit', async () => {
    await type('Where is approval implemented?');
    const t = card();
    assert.match(t, /ARCHITECTURE NOTE/); assert.match(t, /runTool is the single gate/);
    const sym = RI.resolvePointer(idx, { file: 'js/agent/core/tool-registry.js', symbol: 'runTool' });
    assert.ok(t.includes('js/agent/core/tool-registry.js:' + sym.line)); assert.match(t, /single gate: hard blocks/);
    assert.match(t, /feature: Approval/);
    const a = [...document.querySelectorAll('#aic-repo a')].find(x => /tool-registry\.js/.test(x.href));
    assert.ok(a, 'link present'); assert.ok(a.href.startsWith('https://github.com/sysalmanyasin/BT-Sale-Data2/blob/' + idx.commit + '/js/agent/core/tool-registry.js#L' + sym.line));
    assert.equal(a.target, '_blank'); assert.match(a.rel, /noopener/); assert.match(a.rel, /noreferrer/);
  });
  test('Which tool provides closing data? -> the closing tools, and a tool missing from the running registry is flagged', async () => {
    await type('Which tool provides closing data?');
    const t = card();
    assert.match(t, /closing_status/); assert.match(t, /closing_recent_days/); assert.match(t, /js\/agent\/tools\/closing\.js:/); assert.match(t, /closing \/ read/);
    assert.equal(/tests\/dom/.test(t), false, 'a test stub is never offered as a closing tool');
    assert.match(t, /not registered in this running app: closing_status/);
  });
  test('example-question buttons run a real query and fill the box', async () => {
    const b = [...document.querySelectorAll('#aic-repo button')].find(x => x.textContent === 'Where does VERIFY happen?');
    b.click(); await wait(10);
    assert.equal(q('#aic-rq').value, 'Where does VERIFY happen?'); assert.match(card(), /setVerifier/); assert.match(card(), /does not wait for the cloud sync/);
  });
  test('every example question produces locations; topic buttons work', async () => {
    for (const s of RI.SAMPLE_QUESTIONS) { await type(s); assert.ok(document.querySelectorAll('#aic-repo .aic-rres li').length > 0, s); }
    [...document.querySelectorAll('#aic-repo button')].find(x => x.textContent === 'Undo').click(); await wait(10);
    assert.match(card(), /runUndo/);
  });
  test('a topic answer shows its tools with domain and risk', async () => {
    await type('target pace');
    assert.match(card(), /ARCHITECTURE NOTE/); assert.match(card(), /get_target_pace/); assert.match(card(), /sales \/ read/); assert.match(card(), /feature: Forecast and target pace/);
  });
  test('plain symbol search still works and shows the related feature', async () => {
    await type('readTool');
    assert.equal(/ARCHITECTURE NOTE/.test(card()), false); assert.match(card(), /MATCHES IN THE CODE INDEX/);
    assert.match(card(), /js\/ai-center\/adapters\.js:/); assert.match(card(), /feature: How the AI Center connects to the BT Agent/);
  });
  test('an unmatched query says so and invents nothing; HTML in the query is never interpreted', async () => {
    await type('zzzqqqxxx'); assert.match(card(), /Nothing in the code index matches/); assert.equal(document.querySelectorAll('#aic-repo .aic-rres li').length, 0);
    await type('<img src=x onerror=alert(1)>'); assert.equal(document.querySelectorAll('#aic-repo img').length, 0);
  });
  test('no source code is displayed: only index fields appear (no function bodies / statements from the files)', async () => {
    await type('Where is approval implemented?');
    const src = readFileSync('js/agent/core/tool-registry.js', 'utf8').split('\n');
    const body = src.slice(115, 140).map(l => l.trim()).filter(l => l.length > 40);
    for (const l of body) assert.equal(card().includes(l), false, 'source line leaked: ' + l.slice(0, 60));
  });
});

describe('unavailable index is reported honestly', () => {
  before(async () => { ui.onShow(); await wait(40); });
  test('network failure -> NOT CONNECTED with the real reason and the rebuild command, not a fake answer', async () => {
    await openRepo('offline');
    assert.match(card(), /NOT CONNECTED/); assert.match(card(), /npm run index:repo/); assert.equal(q('#aic-rq'), null, 'no search box pretending to work');
  });
  test('HTTP error -> same honest state', async () => {
    await openRepo('http'); assert.match(card(), /NOT CONNECTED/);
  });
});

describe('command palette', () => {
  before(async () => { ui.onShow(); await wait(40); });
  const runCommand = async text => {
    ui.__test.openPalette();
    const i = q('.aic-pin'); i.value = text; i.dispatchEvent(new window.Event('input'));
    const li = [...document.querySelectorAll('.aic-plist li')].find(x => x.textContent.toLowerCase().includes(text.toLowerCase()));
    assert.ok(li, 'command "' + text + '" is listed'); li.click(); await wait(80);
  };
  test('Explain architecture is a real action: opens the repository card with a real answer (no "docs" toast)', async () => {
    fetchMode = 'ok'; ui.__test.S.repo = { state: 'idle', idx: null }; ui.__test.S.repoQ = ''; ui.__test.S.mode = 'monitor';
    await runCommand('Explain architecture'); await wait(80);
    assert.equal(ui.__test.S.mode, 'investigate'); assert.equal(Boolean(q('.aic-toast') && /docs\//.test(q('.aic-toast').textContent)), false);
    assert.match(card(), /ARCHITECTURE NOTE/); assert.match(card(), /no brain of its own/); assert.match(card(), /agent-panel\.js:/);
  });
  test('Search repository opens the card and focuses the search box', async () => {
    ui.__test.S.mode = 'monitor'; await runCommand('Search repository'); await wait(100);
    assert.equal(ui.__test.S.mode, 'investigate'); assert.equal(document.activeElement && document.activeElement.id, 'aic-rq');
  });
});
