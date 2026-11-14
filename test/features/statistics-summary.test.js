const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  roundShares, energyShares, summarizePlanVsFact, summarizeVariety, buildWeekStats
} = require('../../src/features/statistics/summary');

// Неделя Пн 09.11 … Вс 15.11, сегодня — четверг 12.11
const MONDAY = '2026-11-09';
const TODAY = '2026-11-12';
const ZERO = { calories: 0, protein: 0, fat: 0, carbs: 0 };

const row = (date, recipeId, name, calories, protein = 0, fat = 0, carbs = 0) => ({
  date, recipeId, name, calories, protein, fat, carbs
});

test('roundShares: whole percents always add up to 100; zero energy is null', () => {
  assert.deepEqual(roundShares({ protein: 1, fat: 1, carbs: 1 }), { protein: 34, fat: 33, carbs: 33 });
  assert.deepEqual(roundShares({ protein: 0, fat: 0, carbs: 5 }), { protein: 0, fat: 0, carbs: 100 });
  assert.equal(roundShares({ protein: 0, fat: 0, carbs: 0 }), null);
});

test('energyShares: P×4, F×9, C×4 over their sum', () => {
  // 100 г Б = 400, 50 г Ж = 450, 150 г У = 600 → 1450 ккал
  assert.deepEqual(energyShares({ protein: 100, fat: 50, carbs: 150 }), { protein: 28, fat: 31, carbs: 41 });
  assert.deepEqual(energyShares({ protein: 25, fat: 0, carbs: 75 }), { protein: 25, fat: 0, carbs: 75 });
  assert.equal(energyShares({ protein: null, fat: undefined, carbs: 0 }), null);
});

test('buildWeekStats: per-day totals, future days, averages per day with entries', () => {
  const stats = buildWeekStats({
    monday: MONDAY,
    today: TODAY,
    eaten: [
      row('2026-11-09', 1, 'Омлет', 500, 30, 20, 40),
      row('2026-11-09', 2, 'Суп', 700, 30, 30, 60),
      row('2026-11-11', 1, 'Омлет', 600, 30, 20, 80),
      // запись «из будущего» (смена пояса) в статистику не попадает
      row('2026-11-13', 3, 'Торт', 900, 10, 50, 100)
    ],
    planned: [],
    recent: [],
    targets: null
  });
  assert.deepEqual(stats.days.map(d => [d.date, d.future, d.entries, d.totals.calories]), [
    ['2026-11-09', false, 2, 1200],
    ['2026-11-10', false, 0, 0],
    ['2026-11-11', false, 1, 600],
    ['2026-11-12', false, 0, 0],
    ['2026-11-13', true, 0, 0],
    ['2026-11-14', true, 0, 0],
    ['2026-11-15', true, 0, 0]
  ]);
  assert.equal(stats.daysWithEntries, 2);
  assert.deepEqual(stats.totals, { calories: 1800, protein: 90, fat: 70, carbs: 180 });
  assert.deepEqual(stats.average, { calories: 900, protein: 45, fat: 35, carbs: 90 });
  // 360 / 630 / 720 ккал из 1710
  assert.deepEqual(stats.shares, { protein: 21, fat: 37, carbs: 42 });
  assert.equal(stats.targetShares, null);
  assert.equal(stats.planVsFact, null);
});

test('buildWeekStats: target shares come from the daily targets', () => {
  const targets = { calories: 2000, protein: 100, fat: 60, carbs: 250 };
  const stats = buildWeekStats({
    monday: MONDAY, today: TODAY, eaten: [row(MONDAY, 1, 'Омлет', 500, 30, 20, 40)],
    planned: [], recent: [], targets
  });
  // 400 / 540 / 1000 ккал из 1940
  assert.deepEqual(stats.targetShares, { protein: 21, fat: 28, carbs: 51 });
  assert.equal(stats.targets, targets);
});

test('buildWeekStats: empty week — zeros, no average, no shares, no division by zero', () => {
  const stats = buildWeekStats({ monday: MONDAY, today: TODAY, eaten: [], planned: [], recent: [], targets: null });
  assert.equal(stats.daysWithEntries, 0);
  assert.deepEqual(stats.totals, ZERO);
  assert.equal(stats.average, null);
  assert.equal(stats.shares, null);
  assert.equal(stats.planVsFact, null);
  assert.deepEqual(stats.variety, { distinct: 0, top: [] });
});

test('summarizePlanVsFact: plan and fact are cut at today', () => {
  const planned = [
    { date: '2026-11-09', calories: 2000 },
    { date: '2026-11-10', calories: 1500 },
    { date: '2026-11-10', calories: 500 },
    { date: '2026-11-13', calories: 3000 } // завтра — не считается
  ];
  const result = summarizePlanVsFact(planned, [{ date: '2026-11-09', calories: 2000 }], TODAY);
  assert.deepEqual(result, { plannedDays: 2, planned: 4000, eaten: 2000, diff: -2000 });
});

test('summarizePlanVsFact: plan only in the future (or none) skips the block', () => {
  assert.equal(summarizePlanVsFact([{ date: '2026-11-14', calories: 900 }], [], TODAY), null);
  assert.equal(summarizePlanVsFact([], [{ date: TODAY, calories: 900 }], TODAY), null);
});

test('buildWeekStats: eaten rows after today do not count against the plan', () => {
  const stats = buildWeekStats({
    monday: MONDAY,
    today: TODAY,
    eaten: [row(TODAY, 1, 'Омлет', 800), row('2026-11-13', 1, 'Омлет', 800)],
    planned: [{ date: TODAY, calories: 500 }],
    recent: [],
    targets: null
  });
  assert.deepEqual(stats.planVsFact, { plannedDays: 1, planned: 500, eaten: 800, diff: 300 });
});

test('summarizeVariety: distinct recipes and a deterministic top-3', () => {
  const rows = [
    { recipeId: 5, name: 'Суп' },
    { recipeId: 2, name: 'Омлет' },
    { recipeId: 5, name: 'Суп' },
    { recipeId: 9, name: 'Борщ' },
    { recipeId: 2, name: 'Омлет' },
    { recipeId: 7, name: 'Каша' },
    { recipeId: 8, name: 'Каша' },
    { recipeId: 8, name: 'Каша' }
  ];
  const result = summarizeVariety(rows);
  assert.equal(result.distinct, 5);
  // три блюда по 2 раза: порядок по названию, затем по id; «Борщ» и «Каша»(7) — по 1
  assert.deepEqual(result.top, [
    { recipeId: 8, name: 'Каша', count: 2 },
    { recipeId: 2, name: 'Омлет', count: 2 },
    { recipeId: 5, name: 'Суп', count: 2 }
  ]);
  assert.deepEqual(summarizeVariety([
    { recipeId: 4, name: 'Каша' }, { recipeId: 3, name: 'Каша' }
  ]).top.map(i => i.recipeId), [3, 4], 'same name → by id');
  assert.deepEqual(summarizeVariety([]), { distinct: 0, top: [] });
});
