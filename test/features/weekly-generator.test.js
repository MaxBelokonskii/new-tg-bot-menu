const { seedDb } = require('../helpers/memory-db');
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { dbAll } = require('../../src/database/db');
const { saveSelectedDish, getWeeklyPlan } = require('../../src/features/weekly-planner/logic');
const { saveUserProfile } = require('../../src/features/profile/logic');
const {
  generateWeeklyPlan,
  countWeekItems,
  pickRecipe,
  TOP_K
} = require('../../src/features/weekly-planner/generator');
const { getWeekBounds } = require('../../src/utils/date-helpers');

const TODAY = '2026-11-14';
const WEEK = getWeekBounds(TODAY);

const PROFILE = { weight: 80, height: 180, age: 30, sex: 'male', activity_level: 'moderate', goal: 'maintain' };
const recipes = (n) => Array.from({ length: n }, (_, i) => ({ id: i + 1, calories: (i + 1) * 100 }));

test('pickRecipe draws among the TOP_K closest to the target', () => {
  const pool = recipes(10);
  const seen = new Set();
  for (let i = 0; i < 50; i++) {
    seen.add(pickRecipe(pool, 500, new Set(), new Set(), () => i / 50).id);
  }
  assert.equal(seen.size, TOP_K);
  for (const id of seen) assert.ok(Math.abs(id * 100 - 500) <= 200, `id ${id} too far`);
});

test('pickRecipe skips used recipes and resets when the pool is exhausted', () => {
  const pool = recipes(2);
  const used = new Set([1]);
  assert.equal(pickRecipe(pool, 100, used, new Set(), () => 0).id, 2);
  used.add(2);
  const dayTaken = new Set([1]);
  assert.equal(pickRecipe(pool, 100, used, dayTaken, () => 0).id, 2);
  assert.equal(used.size, 0, 'week set is reset after exhaustion');
  assert.equal(pickRecipe(pool, 100, new Set(), new Set([1, 2])), null);
});

before(seedDb);

test('with a filled profile the week has no repeated dishes per category (4.14)', async () => {
  await saveUserProfile(6001, PROFILE);
  await generateWeeklyPlan(6001, { week: WEEK });
  const rows = await dbAll(
    `SELECT dmi.slot, dmi.recipe_id FROM daily_menu_items dmi
     JOIN daily_menu dm ON dm.id = dmi.daily_menu_id
     WHERE dm.user_id = (SELECT id FROM users WHERE telegram_id = ?)`,
    [6001]
  );
  assert.equal(rows.length, 35);
  const bySlotGroup = { breakfast: [1], main: [2, 3], salads: [4], desserts: [5] };
  for (const [category, slots] of Object.entries(bySlotGroup)) {
    const ids = rows.filter(r => slots.includes(r.slot)).map(r => r.recipe_id);
    assert.equal(new Set(ids).size, ids.length, `${category} repeats within the week`);
  }
});

test('fill mode keeps manual dishes and fills only empty slots (4.17)', async () => {
  const [{ id: manualBreakfast }] = await dbAll(
    "SELECT r.id FROM recipes r JOIN meal_categories mc ON mc.id = r.category_id WHERE mc.name = 'breakfast' LIMIT 1"
  );
  await saveSelectedDish(6002, manualBreakfast, TODAY);
  assert.equal(await countWeekItems(6002, WEEK), 1);

  const first = await generateWeeklyPlan(6002, { week: WEEK, mode: 'fill' });
  assert.equal(first.slotsWritten, 34);
  const plan = await getWeeklyPlan(6002, WEEK);
  const breakfasts = plan.filter(p => p.slot === 1);
  const todayBreakfast = breakfasts.find(p => p.date === TODAY);
  const manualRow = (await dbAll('SELECT name FROM recipes WHERE id = ?', [manualBreakfast]))[0];
  assert.equal(todayBreakfast.name, manualRow.name);
  assert.equal(breakfasts.filter(p => p.name === manualRow.name).length, 1, 'manual dish not repeated');

  const second = await generateWeeklyPlan(6002, { week: WEEK, mode: 'fill' });
  assert.equal(second.slotsWritten, 0);

  const overwrite = await generateWeeklyPlan(6002, { week: WEEK, mode: 'overwrite' });
  assert.equal(overwrite.slotsWritten, 35);
  assert.equal(await countWeekItems(6002, WEEK), 35);
});
