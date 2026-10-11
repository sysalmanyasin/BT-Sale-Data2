// The talking avatar: preferences, the face it builds (with and without a photo) and the speech-like mouth driver.
import { test, describe, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDomEnv } from '../helpers/dom-env.js';

describe('ai-center avatar', () => {
  let AV;
  before(async () => { installDomEnv(); AV = await import('../../js/ai-center/avatar.js'); });
  beforeEach(() => { try { localStorage.clear(); } catch (_) { /* no storage */ } });

  test('mouth height is clamped and has a sane default', () => {
    assert.equal(AV.clampMouthY(10), AV.MOUTH_MIN); assert.equal(AV.clampMouthY(999), AV.MOUTH_MAX);
    assert.equal(AV.clampMouthY('abc'), AV.MOUTH_DEFAULT); assert.equal(AV.getPrefs().mouthY, AV.MOUTH_DEFAULT);
    AV.setMouthY(63); assert.equal(AV.getPrefs().mouthY, 63);
  });
  test('face animation is on by default and can be switched off', () => {
    assert.equal(AV.getPrefs().live, true);
    AV.setLive(false); assert.equal(AV.getPrefs().live, false);
    assert.equal(AV.buildFace().getAttribute('data-live'), '0');
  });
  test('without a photo: a drawn face with eyes that blink and a mouth', () => {
    const f = AV.buildFace();
    assert.ok(f.classList.contains('jv-drawn') && f.querySelector('.jv-eye') && f.querySelector('.jv-mouth'));
    assert.equal(f.getAttribute('aria-hidden'), 'true');
    assert.equal(f.querySelectorAll('image').length, 0);
  });
  test('with a photo: the photo plus a moving jaw clipped at the chosen mouth line', () => {
    localStorage.setItem(AV.KEYS.photo, 'data:image/jpeg;base64,AAAA'); AV.setMouthY(70);
    const f = AV.buildFace();
    assert.equal(f.querySelectorAll('image').length, 2, 'base photo + jaw copy');
    assert.ok(f.querySelector('.jv-jaw') && f.querySelector('.jv-cavity'));
    const clip = f.querySelector('#jv-jawclip rect');
    assert.ok(Math.abs(Number(clip.getAttribute('y')) - (4 + 152 * 0.7)) < 0.01, 'jaw starts at the mouth line');
    AV.setMouthY(60);
    assert.ok(Number(AV.buildFace().querySelector('#jv-jawclip rect').getAttribute('y')) < Number(clip.getAttribute('y')), 'moving the slider moves the jaw');
  });
  test('a finished square illustration is shown whole, without a moving jaw', () => {
    localStorage.setItem(AV.KEYS.photo, 'data:image/jpeg;base64,AAAA'); localStorage.setItem(AV.KEYS.mode, 'art');
    const f = AV.buildFace(); assert.equal(f.querySelectorAll('image').length, 1); assert.equal(f.querySelector('.jv-jaw'), null);
  });
  test('removing the photo returns to the drawn face', () => {
    localStorage.setItem(AV.KEYS.photo, 'data:image/jpeg;base64,AAAA'); AV.clearPhoto();
    assert.equal(AV.getPrefs().photo, ''); assert.ok(AV.buildFace().classList.contains('jv-drawn'));
  });
  test('talking flag toggles without needing animation frames (Node)', () => {
    AV.setTalking(true); assert.equal(AV.isTalking(), true); AV.setTalking(false); assert.equal(AV.isTalking(), false);
  });
});

describe('voice preferences (avatar settings)', () => {
  let V;
  before(async () => { installDomEnv(); V = await import('../../js/agent/ui/voice.js'); });
  test('speed is clamped, defaults to 1, and the voice choice can be cleared', () => {
    try { localStorage.clear(); } catch (_) { /* none */ }
    assert.equal(V.getVoiceRate(), 1);
    V.setVoiceRate(1.15); assert.equal(V.getVoiceRate(), 1.15);
    V.setVoiceRate(9); assert.equal(V.getVoiceRate(), 1.6);
    V.setVoiceName('Test Voice'); assert.equal(V.getVoiceName(), 'Test Voice');
    V.setVoiceName(''); assert.equal(V.getVoiceName(), '');
  });
});
