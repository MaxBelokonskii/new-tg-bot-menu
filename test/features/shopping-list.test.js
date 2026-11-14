const { seedDb } = require('../helpers/memory-db');
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { dbGet, dbRun } = require('../../src/database/db');
const { generateWeeklyPlan } = require('../../src/features/weekly-planner/generator');
const {
  mergeIngredientRows,
  getIngredientsFromPlan,
  saveShoppingList,
  getLastShoppingList,
  clearShoppingLists
} = require('../../src/features/shopping-list/logic');
const { getWeekBounds } = require('../../src/utils/date-helpers');

const WEEK = getWeekBounds('2026-11-14');

test('mergeIngredientRows keeps one row per ingredient with a to-taste flag', () => {
  const merged = mergeIngredientRows([
    { id: 1, base_unit: 'г', total_amount: 300 },
    { id: 2, base_unit: null, total_amount: null },
    { id: 1, base_unit: null, total_amount: null },
    { id: 3, base_unit: 'шт', total_amount: 1.5 }
  ]);
  assert.deepEqual(merged, [
    { id: 1, total_amount: 300, unit: 'г', to_taste: true },
    { id: 2, total_amount: 0, unit: '', to_taste: true },
    { id: 3, total_amount: 1.5, unit: 'шт', to_taste: false }
  ]);
});

before(seedDb);

test('shopping list round-trip: build, save, read, clear', async () => {
  const telegramId = 4001;
  const bounds = WEEK;
  await generateWeeklyPlan(telegramId, { week: WEEK });

  const rows = await getIngredientsFromPlan(telegramId, bounds);
  assert.ok(rows.length > 0);

  const listId = await saveShoppingList(telegramId, rows, bounds);
  assert.ok(listId > 0);

  const last = await getLastShoppingList(telegramId);
  assert.equal(last.periodStart, bounds.start);
  assert.equal(last.periodEnd, bounds.endExclusive);
  assert.equal(last.items.length, new Set(rows.map(r => r.id)).size);

  const names = last.items.map(i => i.name);
  assert.equal(new Set(names).size, names.length, 'every product appears once');
  assert.ok(last.items.every(i => i.total_amount > 0 || i.to_taste), 'no empty quantities');

  await clearShoppingLists(telegramId);
  assert.deepEqual(
    await getLastShoppingList(telegramId),
    { listId: null, items: [], periodStart: null, periodEnd: null }
  );
  const leftovers = await dbGet('SELECT COUNT(*) AS c FROM shopping_list_items');
  assert.equal(leftovers.c, 0);
});

test('saveShoppingList rolls back when the user is unknown', async () => {
  const before = await dbGet('SELECT COUNT(*) AS c FROM shopping_lists');
  await assert.rejects(
    saveShoppingList(9999, [{ id: 1, total_amount: 1, base_unit: 'шт' }], WEEK),
    /User not found/
  );
  const after = await dbGet('SELECT COUNT(*) AS c FROM shopping_lists');
  assert.equal(after.c, before.c);
});

test('rebuilding replaces the previous list instead of piling snapshots', async () => {
  const telegramId = 4002;
  const bounds = WEEK;
  await generateWeeklyPlan(telegramId, { week: WEEK });
  const rows = await getIngredientsFromPlan(telegramId, bounds);
  await saveShoppingList(telegramId, rows, bounds);
  await saveShoppingList(telegramId, rows, bounds);
  const lists = await dbGet(
    'SELECT COUNT(*) AS c FROM shopping_lists sl JOIN users u ON u.id = sl.user_id WHERE u.telegram_id = ?',
    [telegramId]
  );
  assert.equal(lists.c, 1);
});

test('amounts are per one serving', async () => {
  const telegramId = 4003;
  const recipe = await dbGet(
    `SELECT r.id, r.servings, ri.amount_base, ri.ingredient_id
     FROM recipes r JOIN recipe_ingredients ri ON ri.recipe_id = r.id
     WHERE r.servings > 1 AND ri.amount_base > 0 LIMIT 1`
  );
  assert.ok(recipe, 'catalog has multi-serving recipes');
  const { lastID: userId } = await dbRun('INSERT INTO users (telegram_id) VALUES (?)', [telegramId]);
  const bounds = WEEK;
  const { lastID: menuId } = await dbRun(
    'INSERT INTO daily_menu (user_id, date) VALUES (?, ?)', [userId, bounds.start]
  );
  await dbRun(
    'INSERT INTO daily_menu_items (daily_menu_id, recipe_id, slot) VALUES (?, ?, 1)', [menuId, recipe.id]
  );
  const rows = await getIngredientsFromPlan(telegramId, bounds);
  const row = rows.find(r => r.id === recipe.ingredient_id && r.base_unit);
  assert.ok(Math.abs(row.total_amount - recipe.amount_base / recipe.servings) < 1e-9);
});
