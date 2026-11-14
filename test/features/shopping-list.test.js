const { seedDb } = require('../helpers/memory-db');
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { dbGet } = require('../../src/database/db');
const { generateWeeklyPlan } = require('../../src/features/weekly-planner/generator');
const {
  mergeIngredientRows,
  getIngredientsFromPlan,
  saveShoppingList,
  getLastShoppingList,
  clearShoppingLists
} = require('../../src/features/shopping-list/logic');
const { getCurrentWeekBounds } = require('../../src/utils/date-helpers');

test('mergeIngredientRows collapses units of the same ingredient', () => {
  const merged = mergeIngredientRows([
    { id: 1, total_amount: 300, unit: 'г' },
    { id: 2, total_amount: 1, unit: 'шт' },
    { id: 1, total_amount: 2, unit: 'шт' }
  ]);
  assert.deepEqual(merged, [
    { id: 1, total_amount: 0, unit: '300 г + 2 шт' },
    { id: 2, total_amount: 1, unit: 'шт' }
  ]);
});

before(seedDb);

test('shopping list round-trip: build, save, read, clear', async () => {
  const telegramId = 4001;
  const bounds = getCurrentWeekBounds();
  await generateWeeklyPlan(telegramId);

  const rows = await getIngredientsFromPlan(telegramId, bounds);
  assert.ok(rows.length > 0);

  const listId = await saveShoppingList(telegramId, rows, bounds);
  assert.ok(listId > 0);

  const last = await getLastShoppingList(telegramId);
  assert.equal(last.periodStart, bounds.start);
  assert.equal(last.periodEnd, bounds.endExclusive);
  assert.equal(last.items.length, new Set(rows.map(r => r.id)).size);

  await clearShoppingLists(telegramId);
  assert.deepEqual(await getLastShoppingList(telegramId), { items: [], periodStart: null, periodEnd: null });
  const leftovers = await dbGet('SELECT COUNT(*) AS c FROM shopping_list_items');
  assert.equal(leftovers.c, 0);
});

test('saveShoppingList rolls back when the user is unknown', async () => {
  const before = await dbGet('SELECT COUNT(*) AS c FROM shopping_lists');
  await assert.rejects(
    saveShoppingList(9999, [{ id: 1, total_amount: 1, unit: 'шт' }], getCurrentWeekBounds()),
    /User not found/
  );
  const after = await dbGet('SELECT COUNT(*) AS c FROM shopping_lists');
  assert.equal(after.c, before.c);
});
