const { test } = require('node:test');
const assert = require('node:assert/strict');
const texts = require('../../src/bot/texts');
const { scaleNutrition, sumNutrition, calculateRemaining } = require('../../src/utils/nutrition-totals');
const { addDays } = require('../../src/utils/date-helpers');
const {
  buildProgressBar, formatPortion, formatDayLabel, buildDayScreen
} = require('../../src/interface/food-log');

const T = texts.foodLog;

test('scaleNutrition multiplies per-serving values by the portion', () => {
  assert.deepEqual(
    scaleNutrition({ calories: 400, protein: 20, fat: 10.5, carbs: 50 }, 1.5),
    { calories: 600, protein: 30, fat: 15.75, carbs: 75 }
  );
  assert.deepEqual(
    scaleNutrition({ calories: 300, protein: null, fat: 0, carbs: 8 }, 0.5),
    { calories: 150, protein: 0, fat: 0, carbs: 4 }
  );
});

test('sumNutrition adds entries; empty list gives zeros', () => {
  assert.deepEqual(sumNutrition([]), { calories: 0, protein: 0, fat: 0, carbs: 0 });
  assert.deepEqual(
    sumNutrition([
      { calories: 600, protein: 30, fat: 15, carbs: 75 },
      { calories: 150.5, protein: 5, fat: 2.5, carbs: 20 }
    ]),
    { calories: 750.5, protein: 35, fat: 17.5, carbs: 95 }
  );
});

test('calculateRemaining: target − eaten, negative when over, null without target', () => {
  assert.deepEqual(
    calculateRemaining(
      { calories: 2500, protein: 100, fat: 50, carbs: 300 },
      { calories: 2400, protein: 150, fat: null, carbs: 300 }
    ),
    { calories: -100, protein: 50, fat: null, carbs: 0 }
  );
});

test('addDays shifts across month/year boundaries and normalises invalid dates', () => {
  assert.equal(addDays('2026-11-14', -1), '2026-11-13');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-02-31', 0), '2026-03-03');
});

test('buildProgressBar: green share, red when over, safe on zero target', () => {
  assert.equal(buildProgressBar(0, 2000), `${'⬜'.repeat(10)} 0%`);
  assert.equal(buildProgressBar(1040, 2000), `${'🟩'.repeat(5)}${'⬜'.repeat(5)} 52%`);
  assert.equal(buildProgressBar(2000, 2000), `${'🟩'.repeat(10)} 100%`);
  assert.equal(buildProgressBar(2300, 2000), `${'🟥'.repeat(10)} 115%`);
  assert.equal(buildProgressBar(0, 0), '⬜'.repeat(10));
  assert.equal(buildProgressBar(5, 0), '🟥'.repeat(10));
});

test('formatPortion and formatDayLabel', () => {
  assert.deepEqual([0.5, 1, 1.5, 2].map(formatPortion), ['½', '1', '1½', '2']);
  assert.equal(formatDayLabel('2026-11-14', '2026-11-14'), T.dayToday.replace('{date}', '14.11'));
  assert.equal(formatDayLabel('2026-11-13', '2026-11-14'), T.dayYesterday.replace('{date}', '13.11'));
  assert.equal(formatDayLabel('2026-11-10', '2026-11-14'), '10.11');
});

const ENTRY = { id: 7, name: 'Омлет с сыром', portion: 1.5, calories: 630, protein: 37.6, fat: 45, carbs: 9.4 };
const callbackData = (extra) => extra.reply_markup.inline_keyboard.flat().map(b => b.callback_data);

test('buildDayScreen with targets shows entries, totals vs norms and buttons', () => {
  const { text, extra } = buildDayScreen({
    date: '2026-11-14', today: '2026-11-14', oldest: '2026-11-07',
    entries: [ENTRY],
    totals: { calories: 630, protein: 37.6, fat: 45, carbs: 9.4 },
    targets: { calories: 2400, protein: 140, fat: 40, carbs: 300 }
  });
  assert.ok(text.includes('1. Омлет с сыром ×1½ — 630 ккал · Б 38 · Ж 45 · У 9'));
  assert.ok(text.includes(`${T.nutrients.calories}: 630 / 2400 ккал · ${T.left.replace('{value}', 1770)}`));
  assert.ok(text.includes(`${T.nutrients.fat}: 45 / 40 г · ${T.over.replace('{value}', 5)}`));
  assert.ok(!text.includes(T.noProfileHint));
  assert.deepEqual(callbackData(extra), [
    'fl_plan_2026-11-14', 'fl_search_2026-11-14', 'fl_del_7', 'wte_show_0', 'fl_day_2026-11-13'
  ]);
});

test('buildDayScreen without targets shows eaten totals and the profile hint', () => {
  const { text, extra } = buildDayScreen({
    date: '2026-11-07', today: '2026-11-14', oldest: '2026-11-07',
    entries: [], totals: { calories: 0, protein: 0, fat: 0, carbs: 0 }, targets: null
  });
  assert.ok(text.includes(T.empty));
  assert.ok(text.includes(T.noProfileHint));
  assert.ok(!text.includes('🟩') && !text.includes('⬜'));
  // самый старый день: «назад» нет, «вперёд» ведёт на следующий день
  assert.deepEqual(callbackData(extra), [
    'fl_plan_2026-11-07', 'fl_search_2026-11-07', 'fl_day_2026-11-08'
  ]);
});
