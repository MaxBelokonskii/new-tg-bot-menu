const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  GRACE_MINUTES,
  DEFAULTS,
  isDue,
  lastSentAfterChange,
  formatTime
} = require('../../src/features/reminders/schedule');

const MSK = 180;
const KAMCHATKA = 720;
// 2026-11-14 — суббота
const at = (iso) => new Date(iso);
const reminder = (over = {}) => ({
  type: 'morning', enabled: 1, time_minutes: 8 * 60, weekday: null, last_sent_date: null, ...over
});

test('isDue: at and after the time within the grace window, not before', () => {
  assert.equal(isDue(reminder(), MSK, at('2026-11-14T04:59:00Z')), false, '07:59');
  assert.equal(isDue(reminder(), MSK, at('2026-11-14T05:00:00Z')), true, '08:00');
  const lastInWindow = new Date(Date.UTC(2026, 10, 14, 5, GRACE_MINUTES - 1));
  assert.equal(isDue(reminder(), MSK, lastInWindow), true, 'last minute of the window');
  const afterWindow = new Date(Date.UTC(2026, 10, 14, 5, GRACE_MINUTES));
  assert.equal(isDue(reminder(), MSK, afterWindow), false, 'window is over (e.g. restart in the evening)');
});

test('isDue: +12 morning reminder fires on the user\'s local date across UTC midnight', () => {
  const now = at('2026-11-14T20:00:00Z'); // 08:00 15.11 на Камчатке
  assert.equal(isDue(reminder(), KAMCHATKA, now), true);
  assert.equal(isDue(reminder({ last_sent_date: '2026-11-14' }), KAMCHATKA, now), true, 'sent yesterday (local)');
  assert.equal(isDue(reminder({ last_sent_date: '2026-11-15' }), KAMCHATKA, now), false, 'already sent today (local)');
  // Для Москвы в этот момент 23:00 14.11 — утреннее окно давно закрыто
  assert.equal(isDue(reminder(), MSK, now), false);
});

test('isDue: disabled, already sent and "sent in the future" (zone moved back) are skipped', () => {
  const now = at('2026-11-14T05:30:00Z');
  assert.equal(isDue(reminder({ enabled: 0 }), MSK, now), false);
  assert.equal(isDue(reminder({ last_sent_date: '2026-11-14' }), MSK, now), false);
  assert.equal(isDue(reminder({ last_sent_date: '2026-11-15' }), MSK, now), false);
  assert.equal(isDue(reminder({ last_sent_date: '2026-11-13' }), MSK, now), true);
});

test('isDue: the grace window of a late evening reminder stops at local midnight', () => {
  const evening = reminder({ type: 'evening', time_minutes: 22 * 60 });
  assert.equal(isDue(evening, MSK, at('2026-11-14T20:59:00Z')), true, '23:59');
  assert.equal(isDue(evening, MSK, at('2026-11-14T21:30:00Z')), false, '00:30 next day');
});

test('isDue: weekly fires only on its weekday', () => {
  const weekly = reminder({ type: 'weekly', time_minutes: 18 * 60, weekday: DEFAULTS.weekly.weekday });
  assert.equal(isDue(weekly, MSK, at('2026-11-15T15:00:00Z')), true, 'Sunday 18:00');
  assert.equal(isDue(weekly, MSK, at('2026-11-14T15:00:00Z')), false, 'Saturday 18:00');
  assert.equal(isDue({ ...weekly, weekday: 5 }, MSK, at('2026-11-14T15:00:00Z')), true, 'Saturday when set');
});

test('lastSentAfterChange: a time already passed today counts as sent', () => {
  const evening = { time_minutes: 20 * 60, last_sent_date: null };
  // включили в 21:30 напоминание на 20:00 — сегодня уже не шлём
  assert.equal(lastSentAfterChange(evening, MSK, at('2026-11-14T18:30:00Z')), '2026-11-14');
  // включили в 19:00 — сегодня ещё придёт
  assert.equal(lastSentAfterChange(evening, MSK, at('2026-11-14T16:00:00Z')), null);
  // время ещё впереди — прежнее значение сохраняется (в т.ч. «уже отправлено сегодня»)
  assert.equal(
    lastSentAfterChange({ ...evening, last_sent_date: '2026-11-14' }, MSK, at('2026-11-14T16:00:00Z')),
    '2026-11-14'
  );
  // дата «из будущего» (после смены пояса назад) не откатывается
  assert.equal(
    lastSentAfterChange({ ...evening, last_sent_date: '2026-11-15' }, MSK, at('2026-11-14T18:30:00Z')),
    '2026-11-15'
  );
  // локальная дата берётся по поясу пользователя
  assert.equal(
    lastSentAfterChange({ time_minutes: 7 * 60, last_sent_date: null }, KAMCHATKA, at('2026-11-14T20:00:00Z')),
    '2026-11-15'
  );
});

test('formatTime pads hours and minutes', () => {
  assert.equal(formatTime(7 * 60), '07:00');
  assert.equal(formatTime(18 * 60 + 5), '18:05');
});
