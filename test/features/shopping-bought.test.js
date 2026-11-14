const { seedDb } = require('../helpers/memory-db');
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { dbAll } = require('../../src/database/db');
const { getOrCreateUser } = require('../../src/features/weekly-planner/logic');
const { saveShoppingList, getLastShoppingList } = require('../../src/features/shopping-list/logic');
const { keepsBoughtMark, toggleBought, resetBought } = require('../../src/features/shopping-list/bought');

const DAY = { start: '2026-11-14', endExclusive: '2026-11-15' };
const WEEK = { start: '2026-11-09', endExclusive: '2026-11-16' };

let ids;
before(async () => {
  await seedDb();
  ids = (await dbAll('SELECT id FROM ingredients ORDER BY id LIMIT 4')).map(r => r.id);
});

// Сырые строки getIngredientsFromPlan: [ingredient index, amount | null (по вкусу)].
const rows = (spec) => spec.map(([i, amount]) => (
  amount === null
    ? { id: ids[i], base_unit: null, total_amount: null }
    : { id: ids[i], base_unit: 'г', total_amount: amount }
));

const marks = async (telegramId) => {
  const { items } = await getLastShoppingList(telegramId);
  return Object.fromEntries(items.map(item => [ids.indexOf(item.ingredientId), item.is_bought]));
};

async function newUserWithList(telegramId, spec, bounds = WEEK) {
  await getOrCreateUser(telegramId);
  return saveShoppingList(telegramId, rows(spec), bounds);
}

test('keepsBoughtMark: amount not larger and no newly appeared "to taste"', () => {
  const old = { total_amount: 200, to_taste: 0, is_bought: 1 };
  assert.equal(keepsBoughtMark(old, { total_amount: 200, to_taste: false }), true);
  assert.equal(keepsBoughtMark(old, { total_amount: 150, to_taste: false }), true);
  assert.equal(keepsBoughtMark(old, { total_amount: 200.0000000001, to_taste: false }), true, 'float noise');
  assert.equal(keepsBoughtMark(old, { total_amount: 201, to_taste: false }), false);
  assert.equal(keepsBoughtMark(old, { total_amount: 100, to_taste: true }), false, 'to taste appeared');
  const tasteOld = { total_amount: 0, to_taste: 1, is_bought: 1 };
  assert.equal(keepsBoughtMark(tasteOld, { total_amount: 0, to_taste: true }), true);
  assert.equal(keepsBoughtMark({ ...old, to_taste: 1 }, { total_amount: 50, to_taste: false }), true);
  assert.equal(keepsBoughtMark({ ...old, is_bought: 0 }, { total_amount: 1, to_taste: false }), false);
  assert.equal(keepsBoughtMark(undefined, { total_amount: 1, to_taste: false }), false);
});

test('toggleBought flips own items, including "to taste" ones', async () => {
  const listId = await newUserWithList(5101, [[0, 100], [1, null]]);
  assert.deepEqual(await marks(5101), { 0: false, 1: false });

  assert.deepEqual(await toggleBought(5101, listId, ids[1]), { status: 'ok', isBought: true });
  assert.deepEqual(await marks(5101), { 0: false, 1: true });
  assert.deepEqual(await toggleBought(5101, listId, ids[1]), { status: 'ok', isBought: false });
  assert.deepEqual(await marks(5101), { 0: false, 1: false });
});

test('toggleBought refuses foreign, rebuilt and unknown targets', async () => {
  const ownList = await newUserWithList(5201, [[0, 100]]);
  const foreignList = await newUserWithList(5202, [[0, 100]]);

  assert.deepEqual(await toggleBought(5201, foreignList, ids[0]), { status: 'stale' });
  assert.deepEqual(await marks(5202), { 0: false }, 'foreign item untouched');
  assert.deepEqual(await toggleBought(5201, ownList, ids[3]), { status: 'stale' }, 'not in the list');

  await saveShoppingList(5201, rows([[0, 100]]), WEEK);
  assert.deepEqual(await toggleBought(5201, ownList, ids[0]), { status: 'stale' }, 'old list id');
});

test('rebuild for the same period keeps marks only where the purchase still covers it', async () => {
  const listId = await newUserWithList(5301, [[0, 200], [1, 100], [2, null], [3, 50]]);
  for (const i of [0, 1, 2, 3]) await toggleBought(5301, listId, ids[i]);

  // 0: меньше → остаётся; 1: больше → сброс; 2: «по вкусу» → остаётся;
  // 3: появилось «по вкусу» → сброс.
  await saveShoppingList(5301, rows([[0, 150], [1, 120], [2, null], [3, 50], [3, null]]), WEEK);
  assert.deepEqual(await marks(5301), { 0: true, 1: false, 2: true, 3: false });
});

test('rebuild for another period starts unmarked', async () => {
  const listId = await newUserWithList(5401, [[0, 200]], WEEK);
  await toggleBought(5401, listId, ids[0]);
  await saveShoppingList(5401, rows([[0, 100]]), DAY);
  assert.deepEqual(await marks(5401), { 0: false });
});

test('resetBought clears all marks of own list and refuses foreign ones', async () => {
  const listId = await newUserWithList(5501, [[0, 10], [1, 20]]);
  const foreignList = await newUserWithList(5502, [[0, 10]]);
  await toggleBought(5501, listId, ids[0]);
  await toggleBought(5501, listId, ids[1]);
  await toggleBought(5502, foreignList, ids[0]);

  assert.deepEqual(await resetBought(5501, foreignList), { status: 'stale' });
  assert.deepEqual(await marks(5502), { 0: true });
  assert.deepEqual(await resetBought(5501, listId), { status: 'ok' });
  assert.deepEqual(await marks(5501), { 0: false, 1: false });
});
