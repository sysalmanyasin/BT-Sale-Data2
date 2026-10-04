import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
const { badgeState, cardItems, MAX_CARD_ITEMS } = await import('../../js/agent/core/briefing-badge.js');

const brief = (...levels) => ({ attention: levels.map((l, i) => ({ level: l, area: 'x', message: 'm' + i })) });

describe('✨ badge', () => {
  test('counts warnings only and shows them', () => {
    const b = badgeState(brief('warn', 'info', 'warn', 'good'), null, '2026-10-05');
    assert.deepEqual(b, { count: 2, show: true, label: '2' });
  });
  test('hidden when nothing needs attention or no briefing yet', () => {
    assert.equal(badgeState(brief('info', 'good'), null, 'd').show, false);
    assert.equal(badgeState(null, null, 'd').show, false);
  });
  test('seen today with the same count → hidden; MORE warnings later today → shown again', () => {
    assert.equal(badgeState(brief('warn', 'warn'), { date: 'd', count: 2 }, 'd').show, false);
    assert.equal(badgeState(brief('warn', 'warn', 'warn'), { date: 'd', count: 2 }, 'd').show, true);
  });
  test('a new day resets it', () => assert.equal(badgeState(brief('warn'), { date: 'yesterday', count: 5 }, 'today').show, true));
  test('10+ shows as 9+', () => assert.equal(badgeState(brief(...Array(12).fill('warn')), null, 'd').label, '9+'));
});

describe('Today card', () => {
  test('lists at most 4 warnings and says how many were left out', () => {
    const c = cardItems(brief(...Array(6).fill('warn'), 'info'));
    assert.equal(c.items.length, MAX_CARD_ITEMS); assert.equal(c.more, 2); assert.equal(c.clear, false);
  });
  test('nothing urgent → clear', () => assert.equal(cardItems(brief('info', 'good')).clear, true));
});
