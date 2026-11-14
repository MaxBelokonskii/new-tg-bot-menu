const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  planWeeks, weekKindOfMonday, weekKindOfDate, planHorizon
} = require('../../src/features/weekly-planner/plan-weeks');
const { weeklyReminderWeek } = require('../../src/features/reminders/schedule');
const { formatDayMonthName, formatDateRange, formatWeekRange } = require('../../src/interface/date-labels');
const { formatPeriodLabel, formatShoppingList } = require('../../src/interface/shopping-list');

// 2026-11-15 — воскресенье, 2026-11-16 — понедельник
test('planWeeks / planHorizon: current and next ISO week, also across the year', () => {
  assert.deepEqual(planWeeks('2026-11-15'), {
    current: { start: '2026-11-09', endExclusive: '2026-11-16' },
    next: { start: '2026-11-16', endExclusive: '2026-11-23' }
  });
  assert.deepEqual(planWeeks('2026-11-16').current, { start: '2026-11-16', endExclusive: '2026-11-23' });
  assert.deepEqual(planHorizon('2026-11-12'), { first: '2026-11-09', last: '2026-11-22' });
  assert.deepEqual(planHorizon('2026-12-30'), { first: '2026-12-28', last: '2027-01-10' });
});

test('weekKindOfMonday accepts only the current or next Monday; the boundary moves at midnight', () => {
  // воскресенье: 16.11 — следующая неделя
  assert.equal(weekKindOfMonday('2026-11-09', '2026-11-15'), 'current');
  assert.equal(weekKindOfMonday('2026-11-16', '2026-11-15'), 'next');
  assert.equal(weekKindOfMonday('2026-11-23', '2026-11-15'), null);
  // понедельник: 16.11 — уже текущая, 09.11 — устарела
  assert.equal(weekKindOfMonday('2026-11-16', '2026-11-16'), 'current');
  assert.equal(weekKindOfMonday('2026-11-23', '2026-11-16'), 'next');
  assert.equal(weekKindOfMonday('2026-11-09', '2026-11-16'), null);
  assert.equal(weekKindOfMonday('2026-11-17', '2026-11-16'), null, 'not a Monday');
});

test('weekKindOfDate covers this Monday … next Sunday only', () => {
  const today = '2026-11-12';
  assert.equal(weekKindOfDate('2026-11-09', today), 'current');
  assert.equal(weekKindOfDate('2026-11-15', today), 'current');
  assert.equal(weekKindOfDate('2026-11-16', today), 'next');
  assert.equal(weekKindOfDate('2026-11-22', today), 'next');
  for (const outside of ['2026-11-08', '2026-11-23', '2026-02-31', 'junk', undefined]) {
    assert.equal(weekKindOfDate(outside, today), null, String(outside));
  }
});

test('weeklyReminderWeek: Mon–Thu → this week, Fri–Sun → next week', () => {
  assert.deepEqual(weeklyReminderWeek('2026-11-16'), { kind: 'current', monday: '2026-11-16' }, 'Monday');
  assert.deepEqual(weeklyReminderWeek('2026-11-19'), { kind: 'current', monday: '2026-11-16' }, 'Thursday');
  assert.deepEqual(weeklyReminderWeek('2026-11-20'), { kind: 'next', monday: '2026-11-23' }, 'Friday');
  assert.deepEqual(weeklyReminderWeek('2026-11-22'), { kind: 'next', monday: '2026-11-23' }, 'Sunday');
});

test('date labels: day, range within a month and across months', () => {
  assert.equal(formatDayMonthName('2026-05-01'), '1 мая');
  assert.equal(formatDateRange('2026-11-17', '2026-11-23'), '17–23 нояб.');
  assert.equal(formatWeekRange('2026-11-30'), '30 нояб. – 6 дек.');
  assert.equal(formatWeekRange('2026-12-28'), '28 дек. – 3 янв.');
});

test('shopping list period label is relative to today; a future period is not stale', () => {
  const today = '2026-11-14';
  assert.equal(formatPeriodLabel('2026-11-14', '2026-11-15', today), 'на сегодня, 14 нояб.');
  assert.equal(formatPeriodLabel('2026-11-13', '2026-11-14', today), 'на 13 нояб.');
  assert.equal(formatPeriodLabel('2026-11-09', '2026-11-16', today), 'на эту неделю, 9–15 нояб.');
  assert.equal(formatPeriodLabel('2026-11-16', '2026-11-23', today), 'на следующую неделю, 16–22 нояб.');
  assert.equal(formatPeriodLabel('2026-11-02', '2026-11-09', today), 'на 2–8 нояб.');
  assert.equal(formatPeriodLabel(null, null, today), '');

  const items = [{ name: 'Соль', type: 'Специи и приправы', total_amount: 0, unit: '', to_taste: true }];
  const next = formatShoppingList({ items, periodStart: '2026-11-16', periodEnd: '2026-11-23' }, today);
  assert.ok(next.includes('(на следующую неделю, 16–22 нояб.)'));
  assert.ok(!next.includes('⚠️'));
  // через неделю тот же список — «на эту неделю», ещё через неделю — прошедший
  assert.ok(formatShoppingList({ items, periodStart: '2026-11-16', periodEnd: '2026-11-23' }, '2026-11-20')
    .includes('(на эту неделю, 16–22 нояб.)'));
  assert.ok(formatShoppingList({ items, periodStart: '2026-11-16', periodEnd: '2026-11-23' }, '2026-11-23')
    .includes('⚠️'));
});
