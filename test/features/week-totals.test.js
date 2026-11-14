const { seedDb } = require('../helpers/memory-db');
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const texts = require('../../src/bot/texts');
const { dbAll } = require('../../src/database/db');
const { generateWeeklyPlan } = require('../../src/features/weekly-planner/generator');
const { getWeekPlanNutrition, summarizePlanWeek } = require('../../src/features/weekly-planner/week-totals');
const { getCurrentWeekBounds } = require('../../src/utils/date-helpers');
const { buildPlanDayScreen, formatWeekSummary } = require('../../src/interface/plan-day');

const D = texts.weeklyPlan.day;
const ZERO = { calories: 0, protein: 0, fat: 0, carbs: 0 };

before(seedDb);

test('summarizePlanWeek: sums, counts distinct days, averages per planned day', () => {
  const summary = summarizePlanWeek([
    { date: '2026-11-09', calories: 500, protein: 20, fat: 10, carbs: 60 },
    { date: '2026-11-09', calories: 700, protein: 40, fat: 30, carbs: 50 },
    { date: '2026-11-12', calories: 600, protein: 30, fat: 20, carbs: 70 }
  ]);
  assert.equal(summary.plannedDays, 2);
  assert.deepEqual(summary.totals, { calories: 1800, protein: 90, fat: 60, carbs: 180 });
  assert.deepEqual(summary.average, { calories: 900, protein: 45, fat: 30, carbs: 90 });
});

test('summarizePlanWeek: empty week gives zeros without dividing by zero', () => {
  assert.deepEqual(summarizePlanWeek([]), { plannedDays: 0, totals: ZERO, average: ZERO });
});

test('getWeekPlanNutrition returns one row per planned dish of the current week', async () => {
  const telegramId = 9301;
  assert.deepEqual(await getWeekPlanNutrition(telegramId), []);
  await generateWeeklyPlan(telegramId);
  const rows = await getWeekPlanNutrition(telegramId);
  assert.equal(rows.length, 35, '7 days × 5 slots');
  const { start, endExclusive } = getCurrentWeekBounds();
  assert.ok(rows.every(r => r.date >= start && r.date < endExclusive));

  const [{ kcal }] = await dbAll(
    `SELECT SUM(r.calories) AS kcal FROM daily_menu_items dmi
     JOIN daily_menu dm ON dmi.daily_menu_id = dm.id
     JOIN recipes r ON dmi.recipe_id = r.id
     WHERE dm.user_id = (SELECT id FROM users WHERE telegram_id = ?)`,
    [telegramId]
  );
  const summary = summarizePlanWeek(rows);
  assert.equal(summary.plannedDays, 7);
  assert.ok(Math.abs(summary.totals.calories - kcal) < 1e-6);
});

test('formatWeekSummary: sums only without targets, percent of the norm with targets', () => {
  const week = {
    plannedDays: 5,
    totals: { calories: 9800, protein: 450.4, fat: 320, carbs: 1100 },
    average: { calories: 1960, protein: 90.08, fat: 64, carbs: 220 }
  };
  assert.deepEqual(formatWeekSummary(week, null), [
    '<b>За неделю</b> · дней с блюдами: 5 из 7',
    'Всего: 9800 ккал · Б 450 г · Ж 320 г · У 1100 г',
    'В среднем в день: 1960 ккал · Б 90 г · Ж 64 г · У 220 г'
  ]);
  const lines = formatWeekSummary(week, { calories: 2400, protein: 150, fat: 80, carbs: 300 });
  assert.equal(lines.length, 3);
  assert.equal(lines[2], 'В среднем в день: 1960 ккал (82%) · Б 90 г (60%) · Ж 64 г (80%) · У 220 г (73%)');
  assert.deepEqual(formatWeekSummary({ plannedDays: 0, totals: ZERO, average: ZERO }, null), []);
  assert.deepEqual(formatWeekSummary(null, null), []);
});

test('buildPlanDayScreen puts the week block after the day totals, also on an empty day', () => {
  const week = {
    plannedDays: 3,
    totals: { calories: 6000, protein: 300, fat: 200, carbs: 700 },
    average: { calories: 2000, protein: 100, fat: 66.7, carbs: 233.3 }
  };
  const base = { date: '2026-11-11', today: '2026-11-12', weekStart: '2026-11-09', targets: null, week };

  const full = buildPlanDayScreen({
    ...base,
    items: [{ slot: 1, name: 'Омлет', calories: 300, protein: 20, fat: 15, carbs: 5 }],
    totals: { calories: 300, protein: 20, fat: 15, carbs: 5 }
  }).text;
  const header = D.weekHeader.replace('{days}', 3);
  assert.ok(full.endsWith('В среднем в день: 2000 ккал · Б 100 г · Ж 67 г · У 233 г'));
  assert.ok(full.indexOf(header) > full.indexOf(D.totalsHeader));

  const empty = buildPlanDayScreen({ ...base, items: [], totals: ZERO }).text;
  assert.ok(empty.includes(D.empty));
  assert.ok(empty.includes(header), 'week context is useful on an empty day too');
});
