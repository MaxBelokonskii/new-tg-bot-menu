const { seedDb } = require('../helpers/memory-db');
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { dbGet, dbAll } = require('../../src/database/db');
const { formatLocalDate, addDays } = require('../../src/utils/date-helpers');
const { saveSelectedDish } = require('../../src/features/weekly-planner/logic');
const {
  isDiaryDate,
  portionFromHalves,
  isSearchQuery,
  filterRecipesByName,
  searchRecipes,
  addEntry,
  deleteEntry,
  getEntry,
  updateEntryPortion,
  getDayLog,
  getDayTotals,
  getPlanDishes
} = require('../../src/features/food-log/logic');

const USER = 7001;
const OTHER = 7002;
const TODAY = formatLocalDate(new Date());

const recipeByName = (name) => dbGet(
  'SELECT id, calories, protein, fat, carbs FROM recipes WHERE name = ?', [name]
);

before(seedDb);

test('isDiaryDate accepts today..today−7 and rejects the rest', () => {
  const today = '2026-11-14';
  assert.ok(isDiaryDate('2026-11-14', today));
  assert.ok(isDiaryDate('2026-11-07', today));
  for (const bad of ['2026-11-06', '2026-11-15', '2026-02-31', '14.11.2026', '', undefined]) {
    assert.equal(isDiaryDate(bad, today), false, String(bad));
  }
});

test('portionFromHalves maps 1..4 halves to ½..2 portions only', () => {
  assert.deepEqual([1, 2, 3, 4].map(portionFromHalves), [0.5, 1, 1.5, 2]);
  assert.equal(portionFromHalves(5), null);
  assert.equal(portionFromHalves(0), null);
});

test('filterRecipesByName is case/ё-insensitive, prefix matches first, limited', () => {
  const recipes = [
    { id: 1, name: 'Нежный омлет с овощами' },
    { id: 2, name: 'Омлет с сыром' },
    { id: 3, name: 'Лёгкий десерт' },
    { id: 4, name: 'Салат' }
  ];
  assert.deepEqual(filterRecipesByName(recipes, 'ОМЛЕТ').recipes.map(r => r.id), [2, 1]);
  assert.deepEqual(filterRecipesByName(recipes, 'легкий').recipes.map(r => r.id), [3]);
  const limited = filterRecipesByName(recipes, 'о', 1);
  assert.equal(limited.recipes.length, 1);
  assert.equal(limited.total, 2);
  assert.equal(filterRecipesByName(recipes, '   ').total, 0);
  assert.equal(isSearchQuery('о'), false);
  assert.equal(isSearchQuery(' ом '), true);
});

test('searchRecipes finds Cyrillic names in the seeded catalog, max 10', async () => {
  const omelets = await searchRecipes('омлет');
  assert.ok(omelets.total >= 5);
  assert.ok(omelets.recipes.every(r => r.name.toLowerCase().includes('омлет')));
  assert.ok(omelets.recipes[0].name.toLowerCase().startsWith('омлет'));
  const salads = await searchRecipes('Салат');
  assert.ok(salads.total > 10);
  assert.equal(salads.recipes.length, 10);
  assert.equal((await searchRecipes('несуществующее блюдо')).total, 0);
});

test('addEntry + getDayLog/getDayTotals scale nutrition by portion', async () => {
  const omelet = await recipeByName('Омлет с сыром');
  const id1 = await addEntry(USER, { recipeId: omelet.id, portion: 1.5 });
  const id2 = await addEntry(USER, { recipeId: omelet.id, portion: 0.5, slot: 1 });
  assert.ok(id1 && id2);

  const log = await getDayLog(USER, TODAY);
  assert.equal(log.length, 2);
  assert.equal(log[0].id, id1);
  assert.equal(log[0].name, 'Омлет с сыром');
  assert.equal(log[0].slot, null);
  assert.equal(log[0].calories, omelet.calories * 1.5);
  assert.equal(log[1].slot, 1);

  const totals = await getDayTotals(USER, TODAY);
  assert.equal(totals.calories, omelet.calories * 2);
  assert.ok(Math.abs(totals.protein - omelet.protein * 2) < 1e-9);
  assert.deepEqual(await getDayLog(USER, addDays(TODAY, -1)), []);
});

test('addEntry rejects bad portion/slot and returns null for an unknown recipe', async () => {
  const omelet = await recipeByName('Омлет с сыром');
  await assert.rejects(addEntry(USER, { recipeId: omelet.id, portion: 3 }), /portion/);
  await assert.rejects(addEntry(USER, { recipeId: omelet.id, slot: 9 }), /slot/);
  assert.equal(await addEntry(USER, { recipeId: 999999 }), null);
});

test('deleteEntry removes only the owner\'s entry and returns its date', async () => {
  const omelet = await recipeByName('Омлет с сыром');
  const yesterday = addDays(TODAY, -1);
  const id = await addEntry(OTHER, { recipeId: omelet.id, date: yesterday });

  assert.equal(await deleteEntry(USER, id), null, 'foreign entry is not deleted');
  assert.ok(await dbGet('SELECT 1 FROM food_log WHERE id = ?', [id]));

  assert.equal(await deleteEntry(OTHER, id), yesterday);
  assert.equal(await dbGet('SELECT 1 FROM food_log WHERE id = ?', [id]), undefined);
  assert.equal(await deleteEntry(OTHER, id), null, 'second delete is a no-op');
});

test('getEntry returns only the owner\'s entry with per-serving nutrition', async () => {
  const omelet = await recipeByName('Омлет с сыром');
  const id = await addEntry(USER, { recipeId: omelet.id, portion: 1.5 });
  const entry = await getEntry(USER, id);
  assert.deepEqual(
    [entry.id, entry.date, entry.portion, entry.recipeId, entry.name, entry.calories],
    [id, TODAY, 1.5, omelet.id, 'Омлет с сыром', omelet.calories]
  );
  assert.equal(await getEntry(OTHER, id), null);
  assert.equal(await getEntry(USER, 999999), null);
});

test('updateEntryPortion changes only the owner\'s entry within the diary window', async () => {
  const omelet = await recipeByName('Омлет с сыром');
  const yesterday = addDays(TODAY, -1);
  const id = await addEntry(USER, { recipeId: omelet.id, date: yesterday });
  const portionOf = async () => (await dbGet('SELECT portion FROM food_log WHERE id = ?', [id])).portion;

  assert.deepEqual(await updateEntryPortion(USER, id, 2), { status: 'updated', date: yesterday });
  assert.equal(await portionOf(), 2);
  const [logged] = await getDayLog(USER, yesterday);
  assert.equal(logged.calories, omelet.calories * 2);

  assert.deepEqual(await updateEntryPortion(OTHER, id, 0.5), { status: 'notFound' }, 'foreign entry');
  assert.deepEqual(await updateEntryPortion(USER, 999999, 0.5), { status: 'notFound' }, 'missing entry');
  assert.equal(await portionOf(), 2);

  // окно дневника считается от переданного «сегодня»
  const later = addDays(yesterday, 8);
  assert.deepEqual(await updateEntryPortion(USER, id, 0.5, later), { status: 'outOfRange', date: yesterday });
  assert.equal(await portionOf(), 2);

  for (const bad of [portionFromHalves(5), 3, 0, undefined]) {
    await assert.rejects(updateEntryPortion(USER, id, bad), /portion/, String(bad));
  }
  assert.equal(await portionOf(), 2);
});

test('getPlanDishes lists today\'s plan and flags dishes already in the diary', async () => {
  const breakfast = await recipeByName('Омлет с томатами и сыром');
  await saveSelectedDish(OTHER, breakfast.id);
  let dishes = await getPlanDishes(OTHER, TODAY);
  assert.deepEqual(dishes, [
    { slot: 1, recipeId: breakfast.id, name: 'Омлет с томатами и сыром', logged: false }
  ]);

  await addEntry(OTHER, { recipeId: breakfast.id, slot: 1 });
  dishes = await getPlanDishes(OTHER, TODAY);
  assert.equal(dishes[0].logged, true);
  assert.deepEqual(await getPlanDishes(USER, addDays(TODAY, -1)), []);
});

test('food_log has the (user_id, date) index and FK constraints', async () => {
  const indexes = await dbAll('PRAGMA index_list(food_log)');
  assert.ok(indexes.some(i => i.name === 'idx_food_log_user_date'));
  const fks = await dbAll('PRAGMA foreign_key_list(food_log)');
  assert.deepEqual(fks.map(f => f.table).sort(), ['recipes', 'users']);
});
