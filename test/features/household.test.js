const { seedDb } = require('../helpers/memory-db');
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { dbGet } = require('../../src/database/db');
const { getOrCreateUser } = require('../../src/features/weekly-planner/logic');
const { generateWeeklyPlan } = require('../../src/features/weekly-planner/generator');
const {
  DEFAULT_HOUSEHOLD_SIZE,
  isValidHouseholdSize,
  getHouseholdSize,
  setHouseholdSize,
  getListHouseholdSize
} = require('../../src/features/household/logic');
const {
  scaleForHousehold,
  getIngredientsFromPlan,
  saveShoppingList,
  getLastShoppingList
} = require('../../src/features/shopping-list/logic');
const { formatShoppingList, formatPeriodLabel } = require('../../src/interface/shopping-list');
const { buildChecklistScreen } = require('../../src/interface/shopping-checklist');
const { getWeekBounds } = require('../../src/utils/date-helpers');

const TODAY = '2026-11-14';
const WEEK = getWeekBounds(TODAY);

before(seedDb);

test('isValidHouseholdSize accepts integers 1..6 only', () => {
  for (const n of [1, 2, 3, 4, 5, 6]) assert.ok(isValidHouseholdSize(n), String(n));
  for (const n of [0, 7, -1, 2.5, NaN, '3', null, undefined]) assert.ok(!isValidHouseholdSize(n), String(n));
});

test('getHouseholdSize: default for unknown and fresh users, without creating a row', async () => {
  assert.equal(DEFAULT_HOUSEHOLD_SIZE, 1);
  assert.equal(await getHouseholdSize(8801), 1);
  assert.equal(await dbGet('SELECT id FROM users WHERE telegram_id = ?', [8801]), undefined);
  await getOrCreateUser(8801);
  assert.equal(await getHouseholdSize(8801), 1);
});

test('setHouseholdSize saves valid sizes and rejects the rest', async () => {
  assert.equal(await setHouseholdSize(8802, 0), null);
  assert.equal(await setHouseholdSize(8802, 7), null);
  assert.equal(await setHouseholdSize(8802, 2.5), null);
  assert.equal(await getHouseholdSize(8802), 1);
  assert.equal(await setHouseholdSize(8802, 4), 4, 'creates the user when missing');
  assert.equal(await getHouseholdSize(8802), 4);
  assert.equal(await setHouseholdSize(8802, 1), 1);
  assert.equal(await getHouseholdSize(8802), 1);
});

test('scaleForHousehold multiplies quantities and keeps to-taste flags', () => {
  const items = [
    { id: 1, total_amount: 150, unit: 'г', to_taste: true },
    { id: 2, total_amount: 0, unit: '', to_taste: true },
    { id: 3, total_amount: 1.5, unit: 'шт', to_taste: false }
  ];
  assert.deepEqual(scaleForHousehold(items, 3), [
    { id: 1, total_amount: 450, unit: 'г', to_taste: true },
    { id: 2, total_amount: 0, unit: '', to_taste: true },
    { id: 3, total_amount: 4.5, unit: 'шт', to_taste: false }
  ]);
  assert.equal(items[0].total_amount, 150, 'input is not mutated');
});

test('the shopping list is scaled by the household size and remembers it', async () => {
  const telegramId = 8803;
  await generateWeeklyPlan(telegramId, { week: WEEK });
  const rows = await getIngredientsFromPlan(telegramId, WEEK);

  await saveShoppingList(telegramId, rows, WEEK);
  const single = await getLastShoppingList(telegramId);
  assert.equal(single.householdSize, 1);
  assert.equal(await getListHouseholdSize(telegramId), 1);

  await setHouseholdSize(telegramId, 3);
  assert.equal(await getListHouseholdSize(telegramId), 1, 'the list is not rebuilt by the setting');
  await saveShoppingList(telegramId, rows, WEEK);
  const family = await getLastShoppingList(telegramId);
  assert.equal(family.householdSize, 3);
  assert.equal(await getListHouseholdSize(telegramId), 3);

  const byId = new Map(single.items.map(i => [i.ingredientId, i]));
  assert.equal(family.items.length, single.items.length);
  for (const item of family.items) {
    const one = byId.get(item.ingredientId);
    assert.ok(Math.abs(item.total_amount - one.total_amount * 3) < 1e-9, item.name);
    assert.equal(item.to_taste, one.to_taste, item.name);
    assert.equal(item.unit, one.unit, item.name);
  }
  assert.ok(family.items.some(i => i.total_amount > 0));
});

test('getListHouseholdSize is null without a list', async () => {
  assert.equal(await getListHouseholdSize(8899), null);
});

test('list header gets " · на N чел." only for more than one person', () => {
  assert.equal(formatPeriodLabel('2026-11-09', '2026-11-16', TODAY, 3), 'на эту неделю, 9–15 нояб. · на 3 чел.');
  assert.equal(formatPeriodLabel('2026-11-09', '2026-11-16', TODAY, 1), 'на эту неделю, 9–15 нояб.');
  assert.equal(formatPeriodLabel('2026-11-09', '2026-11-16', TODAY), 'на эту неделю, 9–15 нояб.');

  const items = [{ ingredientId: 1, name: 'Огурец', type: 'Овощи', total_amount: 300, unit: 'г',
    to_taste: false, is_bought: false }];
  const list = { listId: 5, items, periodStart: '2026-11-14', periodEnd: '2026-11-15', householdSize: 2 };
  assert.ok(formatShoppingList(list, TODAY).includes('(на сегодня, 14 нояб. · на 2 чел.)'));
  assert.ok(buildChecklistScreen(list, 0, TODAY).text.includes('(на сегодня, 14 нояб. · на 2 чел.)'));
  assert.ok(!formatShoppingList({ ...list, householdSize: 1 }, TODAY).includes('чел.'));
});
