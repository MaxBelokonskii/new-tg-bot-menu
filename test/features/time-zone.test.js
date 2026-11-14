const { seedDb } = require('../helpers/memory-db');
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { dbRun } = require('../../src/database/db');
const { getOrCreateUser } = require('../../src/features/weekly-planner/logic');
const { DEFAULT_OFFSET_MINUTES, buildClock } = require('../../src/features/time-zone/clock');
const { getUtcOffset, getUserClock, setUtcOffset } = require('../../src/features/time-zone/logic');

before(seedDb);

test('buildClock: local today, time, weekday and ISO week of the zone', () => {
  // 23:30 UTC воскресенья: в Москве уже понедельник — новая неделя
  const clock = buildClock(180, new Date('2026-11-15T23:30:00Z'));
  assert.deepEqual(clock, {
    offsetMinutes: 180,
    today: '2026-11-16',
    minutes: 150,
    hour: 2,
    weekday: 0,
    week: { start: '2026-11-16', endExclusive: '2026-11-23' }
  });
  // тот же момент в Калининграде (+2) — ещё воскресенье прошлой недели
  const kaliningrad = buildClock(120, new Date('2026-11-15T21:30:00Z'));
  assert.equal(kaliningrad.today, '2026-11-15');
  assert.equal(kaliningrad.hour, 23);
  assert.deepEqual(kaliningrad.week, { start: '2026-11-09', endExclusive: '2026-11-16' });
});

test('getUserClock reads the user\'s zone; unknown and new users get Moscow', async () => {
  const now = new Date('2026-11-14T13:00:00Z');
  assert.equal(await getUtcOffset(9901), DEFAULT_OFFSET_MINUTES, 'no user row yet');
  await getOrCreateUser(9901);
  assert.equal((await getUserClock(9901, now)).hour, 16);

  await dbRun('UPDATE users SET utc_offset_minutes = 720 WHERE telegram_id = ?', [9901]);
  const clock = await getUserClock(9901, now);
  assert.equal(clock.today, '2026-11-15');
  assert.equal(clock.hour, 1);
});

test('setUtcOffset accepts only known zones', async () => {
  const now = new Date('2026-11-14T13:00:00Z');
  assert.equal(await setUtcOffset(9902, 150, now), null);
  assert.equal(await getUtcOffset(9902), DEFAULT_OFFSET_MINUTES);
  assert.equal(await setUtcOffset(9902, 420, now), 420);
  assert.equal(await getUtcOffset(9902), 420);
});
