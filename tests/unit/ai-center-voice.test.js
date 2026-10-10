import { test } from 'node:test';
import assert from 'node:assert/strict';
import { voiceSupport, speakable, createRecognizer, speak } from '../../js/ai-center/voice.js';

test('support detection is honest: nothing available means nothing claimed', () => {
  assert.deepEqual(voiceSupport({}), { input: false, output: false });
  assert.equal(createRecognizer({}), null);
  assert.equal(speak({}, 'hello'), false);
  assert.deepEqual(voiceSupport({ webkitSpeechRecognition: function () {} }), { input: true, output: false });
});
test('speakable drops tables, code and markdown, and caps the length', () => {
  const t = speakable('## Sales\n**Rs 410,000** today.\n| a | b |\n|---|---|\n| 1 | 2 |\n```js\nx()\n```\nSee [report](http://x).');
  assert.equal(t, 'Sales Rs 410,000 today. See report.');
  assert.ok(speakable('word. '.repeat(200)).length <= 421);
  assert.equal(speakable(''), '');
});
test('recognizer: interim then final text; a failure never delivers text', () => {
  let inst; const got = { interim: [], final: [], end: 0, err: [] };
  class FakeSR { constructor() { inst = this; } start() { this.started = true; } stop() { this.onend(); } }
  const rec = createRecognizer({ SpeechRecognition: FakeSR }, { lang: 'en-PK', onInterim: t => got.interim.push(t), onFinal: t => got.final.push(t), onEnd: () => got.end++, onError: c => got.err.push(c) });
  rec.start(); assert.ok(inst.started); assert.equal(inst.lang, 'en-PK');
  inst.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: 'what needs' }], { isFinal: false })] });
  inst.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: 'what needs my attention' }], { isFinal: true })] });
  rec.stop();
  assert.deepEqual(got.interim, ['what needs']); assert.deepEqual(got.final, ['what needs my attention']); assert.equal(got.end, 1);
  rec.start(); inst.onerror({ error: 'not-allowed' }); inst.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: 'x' }], { isFinal: true })] }); inst.onend();
  assert.deepEqual(got.err, ['not-allowed']); assert.deepEqual(got.final, ['what needs my attention'], 'no text after an error');
});
test('speak cancels earlier speech first and speaks the plain-text version', () => {
  const log = [];
  const win = { speechSynthesis: { cancel: () => log.push('cancel'), speak: u => log.push('say:' + u.text) }, SpeechSynthesisUtterance: function (t) { this.text = t; } };
  assert.equal(speak(win, '**Hi** there'), true);
  assert.deepEqual(log, ['cancel', 'say:Hi there']);
});
