import { test } from 'node:test'; import assert from 'node:assert/strict';
import { installDomEnv } from '../helpers/dom-env.js';
installDomEnv();
document.body.innerHTML = '<div id="mail-root"></div>';
const { MailBriefing } = await import('../../js/mail/mail-briefing.js');
test('onShow builds the page; reconnect is a safe no-op when never connected', async () => {
  MailBriefing.onShow();
  assert.ok(document.getElementById('mail-go'));
  assert.equal(await MailBriefing.reconnect(), false);
  assert.equal(MailBriefing.isConnected(), false);
  assert.equal(MailBriefing.snapshot().loaded, false);
  await assert.rejects(MailBriefing.refresh(), /not connected/);
});
