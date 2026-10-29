// MAIL COMPOSE — pure helpers behind "Send via Gmail" (js/shared/mail-compose.js)
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseAddresses, isValidAddress, normalizeLists, mergeSendLists, withKindLists,
  encodeHeader, buildMime, composeBodies, toBase64Url, base64Utf8, MAX_RECIPIENTS,
} from '../../js/shared/mail-compose.js';

// Decode a message built by buildMime() back into headers + decoded parts.
function parseMime(raw) {
  const [headerBlock, ...rest] = raw.split('\r\n\r\n');
  const body = rest.join('\r\n\r\n');
  const unfolded = headerBlock.replace(/\r\n[ \t]+/g, ' ');
  const headers = {};
  for (const line of unfolded.split('\r\n')) { const i = line.indexOf(':'); headers[line.slice(0, i).toLowerCase()] = line.slice(i + 1).trim(); }
  const boundary = /boundary="([^"]+)"/.exec(headers['content-type'])[1];
  const parts = body.split('--' + boundary).slice(1, -1).map((chunk) => {
    const [ph, ...pb] = chunk.replace(/^\r\n/, '').split('\r\n\r\n');
    const b64 = pb.join('\r\n\r\n').replace(/\s+/g, '');
    return { type: /Content-Type: ([^;]+)/.exec(ph)[1], rawLines: pb.join('\r\n\r\n').trim().split('\r\n'), text: Buffer.from(b64, 'base64').toString('utf8') };
  });
  return { headers, parts, boundary, ended: body.trimEnd().endsWith('--' + boundary + '--') };
}
const decodeWords = (s) => s.replace(/=\?UTF-8\?B\?([^?]+)\?=\s*/g, (_, b) => Buffer.from(b, 'base64').toString('utf8'));

describe('parseAddresses', () => {
  test('splits on commas, semicolons, spaces and new lines; de-duplicates case-insensitively', () => {
    const r = parseAddresses('a@x.com, B@y.com;\n  c@z.org  a@X.com');
    assert.deepEqual(r.valid, ['a@x.com', 'B@y.com', 'c@z.org']);
    assert.deepEqual(r.invalid, []);
  });
  test('reports what is not an address and strips <angle brackets>', () => {
    const r = parseAddresses('<ok@x.com> nope, also@bad, @x.com, fine.name+tag@sub.example.co.uk');
    assert.deepEqual(r.valid, ['ok@x.com', 'fine.name+tag@sub.example.co.uk']);
    assert.deepEqual(r.invalid, ['nope', 'also@bad', '@x.com']);
  });
  test('rejects anything that could smuggle a header or a second recipient', () => {
    for (const bad of ['a@x.com\r\nBcc: z@z.com', 'a@x.com>,b@y.com', '"a b"@x.com', 'a@x.com\n', 'a b@x.com', 'a@x', 'a@-x.com']) {
      assert.equal(isValidAddress(bad), false, bad);
    }
    assert.equal(isValidAddress('sy.salmanyasin@gmail.com'), true);
  });
  test('empty and null input', () => {
    assert.deepEqual(parseAddresses(''), { valid: [], invalid: [] });
    assert.deepEqual(parseAddresses(null), { valid: [], invalid: [] });
  });
});

describe('send lists: normalise, merge, update', () => {
  test('normalizeLists coerces garbage into the one shape', () => {
    assert.deepEqual(normalizeLists(null), { checklist: { to: [], cc: [] }, salereport: { to: [], cc: [] }, signature: '', updatedAt: '' });
    const n = normalizeLists({ checklist: { to: ['a@x.com', 'bad', 'A@X.com'], cc: ['a@x.com', 'c@x.com'] }, salereport: 'oops', signature: 'Hi\r\n\u0007There  ', updatedAt: 'not a date' });
    assert.deepEqual(n.checklist, { to: ['a@x.com'], cc: ['c@x.com'] });   // cc never repeats a To address
    assert.deepEqual(n.salereport, { to: [], cc: [] });
    assert.equal(n.signature, 'Hi\nThere');
    assert.equal(n.updatedAt, '');
  });
  test('caps recipients per box', () => {
    const many = Array.from({ length: MAX_RECIPIENTS + 10 }, (_, i) => 'p' + i + '@x.com');
    assert.equal(normalizeLists({ checklist: { to: many } }).checklist.to.length, MAX_RECIPIENTS);
  });
  test('newer updatedAt wins, so a removal on one device sticks', () => {
    const older = { checklist: { to: ['a@x.com', 'b@x.com'], cc: [] }, updatedAt: '2026-10-01T10:00:00.000Z' };
    const newer = { checklist: { to: ['a@x.com'], cc: [] }, updatedAt: '2026-10-02T10:00:00.000Z' };
    assert.deepEqual(mergeSendLists(older, newer).checklist.to, ['a@x.com']);   // remote newer wins
    assert.deepEqual(mergeSendLists(newer, older).checklist.to, ['a@x.com']);   // local newer wins
  });
  test('ties and missing timestamps keep the local copy; empty local takes the remote', () => {
    const l = { checklist: { to: ['l@x.com'] }, updatedAt: '2026-10-01T10:00:00.000Z' };
    const r = { checklist: { to: ['r@x.com'] }, updatedAt: '2026-10-01T10:00:00.000Z' };
    assert.deepEqual(mergeSendLists(l, r).checklist.to, ['l@x.com']);
    assert.deepEqual(mergeSendLists(l, { checklist: { to: ['r@x.com'] } }).checklist.to, ['l@x.com']);
    assert.deepEqual(mergeSendLists(null, r).checklist.to, ['r@x.com']);
    assert.equal(mergeSendLists(null, null).updatedAt, '');
  });
  test('a hostile remote cannot inject bad addresses', () => {
    const m = mergeSendLists(null, { checklist: { to: ['ok@x.com', 'x@y.com\r\nBcc: evil@z.com'] }, updatedAt: '2026-10-01T10:00:00.000Z' });
    assert.deepEqual(m.checklist.to, ['ok@x.com']);
  });
  test('withKindLists replaces one report only, stamps updatedAt and rejects unknown kinds', () => {
    const base = { checklist: { to: ['a@x.com'], cc: [] }, salereport: { to: ['s@x.com'], cc: [] }, updatedAt: '2026-10-01T10:00:00.000Z' };
    const n = withKindLists(base, 'salereport', ['n@x.com'], ['c@x.com'], 'Sig', '2026-10-05T00:00:00.000Z');
    assert.deepEqual(n.checklist.to, ['a@x.com']);
    assert.deepEqual(n.salereport, { to: ['n@x.com'], cc: ['c@x.com'] });
    assert.equal(n.signature, 'Sig');
    assert.equal(n.updatedAt, '2026-10-05T00:00:00.000Z');
    assert.throws(() => withKindLists(base, 'nope', [], [], '', ''), /Unknown report kind/);
  });
});

describe('encodeHeader', () => {
  test('plain ASCII passes through; CR/LF are removed', () => {
    assert.equal(encodeHeader('Daily Check List - Bahria Town'), 'Daily Check List - Bahria Town');
    assert.equal(encodeHeader('Hello\r\nBcc: evil@z.com'), 'Hello Bcc: evil@z.com');
  });
  test('non-ASCII (em dash, rupee sign) becomes RFC 2047 words that decode back, each within 75 chars', () => {
    const s = 'Daily Check List \u2014 Bahria Town \u2014 \u20a8 658,700 \u2014 ' + 'long '.repeat(20);
    const out = encodeHeader(s);
    assert.match(out, /^=\?UTF-8\?B\?/);
    for (const w of out.split('\r\n ')) assert.ok(w.length <= 75, 'word too long: ' + w.length);
    assert.equal(decodeWords(out.replace(/\r\n /g, ' ')).trim(), s.trim());
  });
  test('never splits a character that needs several bytes', () => {
    const s = '\u20a8'.repeat(40);
    assert.equal(decodeWords(encodeHeader(s).replace(/\r\n /g, ' ')).trim(), s);
  });
});

describe('buildMime', () => {
  const html = '<table style="border:1px solid #000"><tr><td>Net Total \u20a8 444,785</td></tr></table>';
  const text = 'Net Total \u20a8 444,785\nLine two';

  test('builds To, Cc, subject and two UTF-8 base64 parts that decode back exactly', () => {
    const raw = buildMime({ to: ['a@x.com', 'b@x.com'], cc: ['c@x.com'], subject: 'Sale Report \u2014 25/Oct/2026', text, html, boundary: 'BND123' });
    const m = parseMime(raw);
    assert.equal(m.headers['mime-version'], '1.0');
    assert.equal(m.headers.to, 'a@x.com, b@x.com');
    assert.equal(m.headers.cc, 'c@x.com');
    assert.equal(decodeWords(m.headers.subject).trim(), 'Sale Report \u2014 25/Oct/2026');
    assert.equal(m.boundary, 'BND123');
    assert.ok(m.ended, 'closing boundary present');
    assert.deepEqual(m.parts.map((p) => p.type), ['text/plain', 'text/html']);
    assert.equal(m.parts[0].text, text.replace(/\n/g, '\r\n'));
    assert.equal(m.parts[1].text, html);
    for (const p of m.parts) for (const line of p.rawLines) assert.ok(line.length <= 76, 'base64 line over 76 chars');
  });
  test('no Cc header when there is no Cc, and never a Bcc header', () => {
    const raw = buildMime({ to: ['a@x.com'], subject: 's', text, html });
    assert.ok(!/^cc:/im.test(raw));
    assert.ok(!/^bcc:/im.test(raw));
  });
  test('a header-injection attempt throws instead of reaching the message', () => {
    assert.throws(() => buildMime({ to: ['a@x.com\r\nBcc: evil@z.com'], subject: 's', text, html }), /valid email/);
    assert.throws(() => buildMime({ to: ['a@x.com'], cc: ['b@x.com,evil@z.com'], subject: 's', text, html }), /valid email/);
    const raw = buildMime({ to: ['a@x.com'], subject: 'Hi\r\nBcc: evil@z.com', text, html });
    assert.ok(!/^bcc:/im.test(raw), 'subject newline must not start a header');
  });
  test('needs at least one To', () => {
    assert.throws(() => buildMime({ to: [], subject: 's', text, html }), /at least one/);
  });
  test('long recipient lists fold onto continuation lines', () => {
    const to = Array.from({ length: 30 }, (_, i) => 'recipient.number' + i + '@example.com');
    const head = buildMime({ to, subject: 's', text, html }).split('\r\n\r\n')[0];
    for (const line of head.split('\r\n')) assert.ok(line.length < 200, 'header line too long');
    assert.equal(parseMime(buildMime({ to, subject: 's', text, html })).headers.to.split(', ').length, 30);
  });
});

describe('composeBodies and base64 helpers', () => {
  test('wraps the report in a full HTML document and leaves the fragment untouched', () => {
    const b = composeBodies({ html: '<div id="r">x</div>', text: 'x', signature: '' });
    assert.ok(b.html.startsWith('<!DOCTYPE html><html><head><meta charset="utf-8">'));
    assert.ok(b.html.includes('<div id="r">x</div>'));
    assert.equal(b.text, 'x\n');
  });
  test('signature is added to both parts and HTML-escaped', () => {
    const b = composeBodies({ html: '<p>r</p>', text: 'r', signature: 'Salman Yasin\n<script>alert(1)</script>' });
    assert.ok(b.html.includes('Salman Yasin<br>&lt;script&gt;alert(1)&lt;/script&gt;'));
    assert.ok(!b.html.includes('<script>'));
    assert.ok(b.text.includes('\n\n-- \nSalman Yasin\n<script>alert(1)</script>'));
  });
  test('toBase64Url is URL-safe and unpadded and round-trips', () => {
    const s = '\u20a8\u2014 ??>>~~ a';
    const u = toBase64Url(s);
    assert.ok(!/[+/=]/.test(u));
    const std = u.replace(/-/g, '+').replace(/_/g, '/');
    assert.equal(Buffer.from(std + '='.repeat((4 - (std.length % 4)) % 4), 'base64').toString('utf8'), s);
    assert.equal(base64Utf8('abc'), 'YWJj');
  });
});
