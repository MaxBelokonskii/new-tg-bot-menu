const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const {
  localParts, addDays, isValidDate, weekdayOf, getWeekBounds, getDayBounds
} = require('../../src/utils/date-helpers');

const MSK = 180;
const KAMCHATKA = 720;
const at = (iso) => new Date(iso);
const ORIGINAL_TZ = process.env.TZ;

after(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
});

test('localParts shifts the instant by the offset', () => {
  // 2026-11-14 — суббота
  assert.deepEqual(localParts(at('2026-11-14T05:00:00Z'), MSK), { date: '2026-11-14', minutes: 480, weekday: 5 });
  // 23:30 UTC при +3 — уже 02:30 следующего дня
  assert.deepEqual(localParts(at('2026-11-14T23:30:00Z'), MSK), { date: '2026-11-15', minutes: 150, weekday: 6 });
  // +12 переходит через полночь UTC: 20:30Z субботы — 08:30 воскресенья на Камчатке
  assert.deepEqual(localParts(at('2026-11-14T20:30:00Z'), KAMCHATKA), { date: '2026-11-15', minutes: 510, weekday: 6 });
  // через границу года
  assert.equal(localParts(at('2026-12-31T21:00:00Z'), MSK).date, '2027-01-01');
});

test('addDays crosses month/year/leap boundaries; isValidDate rejects overflow', () => {
  assert.equal(addDays('2026-11-30', 1), '2026-12-01');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(addDays('2026-11-14', -7), '2026-11-07');
  assert.ok(isValidDate('2028-02-29'));
  for (const bad of ['2026-02-29', '2026-02-31', '2026-13-01', '14.11.2026', '', undefined, null, 20261114]) {
    assert.equal(isValidDate(bad), false, String(bad));
  }
});

test('weekdayOf and getWeekBounds: ISO week Monday..Sunday', () => {
  assert.equal(weekdayOf('2026-11-09'), 0, 'Monday');
  assert.equal(weekdayOf('2026-11-15'), 6, 'Sunday');
  const week = { start: '2026-11-09', endExclusive: '2026-11-16' };
  assert.deepEqual(getWeekBounds('2026-11-09'), week, 'Monday is the first day');
  assert.deepEqual(getWeekBounds('2026-11-14'), week);
  assert.deepEqual(getWeekBounds('2026-11-15'), week, 'Sunday is the last day');
  assert.deepEqual(getWeekBounds('2026-11-16'), { start: '2026-11-16', endExclusive: '2026-11-23' });
  // неделя через границу года
  assert.deepEqual(getWeekBounds('2027-01-01'), { start: '2026-12-28', endExclusive: '2027-01-04' });
  assert.deepEqual(getDayBounds('2026-11-30'), { start: '2026-11-30', endExclusive: '2026-12-01' });
});

test('results do not depend on the server time zone (process.env.TZ)', () => {
  const snapshot = () => ({
    local: localParts(at('2026-11-15T21:30:00Z'), MSK), // 00:30 понедельника по Москве
    plus: addDays('2026-03-29', 1), // переход на летнее время в Европе
    weekday: weekdayOf('2026-11-16'),
    week: getWeekBounds('2026-03-29')
  });
  const results = ['UTC', 'Pacific/Kiritimati', 'America/Los_Angeles', 'Europe/Berlin'].map((tz) => {
    process.env.TZ = tz;
    return snapshot();
  });
  for (const result of results) assert.deepEqual(result, results[0]);
  assert.deepEqual(results[0].local, { date: '2026-11-16', minutes: 30, weekday: 0 });
  assert.equal(results[0].plus, '2026-03-30');
  assert.deepEqual(results[0].week, { start: '2026-03-23', endExclusive: '2026-03-30' });
});
