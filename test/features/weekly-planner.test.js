const { seedDb } = require('../helpers/memory-db');
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { dbGet, dbAll } = require('../../src/database/db');
const {
  getOrCreateUser,
  saveSelectedDish,
  replaceInSlot,
  getWeeklyPlan
} = require('../../src/features/weekly-planner/logic');
const { generateWeeklyPlan } = require('../../src/features/weekly-planner/generator');
const { formatLocalDate } = require('../../src/utils/date-helpers');

const recipeIds = async (category) => (await dbAll(
  `SELECT r.id FROM recipes r JOIN meal_categories mc ON r.category_id = mc.id
   WHERE mc.name = ? ORDER BY r.id`,
  [category]
)).map(r => r.id);

before(seedDb);

test('getOrCreateUser is idempotent', async () => {
  const first = await getOrCreateUser(1001, 'alice');
  const second = await getOrCreateUser(1001, 'alice');
  assert.equal(first, second);
});

test('saveSelectedDish derives slot from category and reports status', async () => {
  const [b1, b2] = await recipeIds('breakfast');
  const [m1, m2, m3] = await recipeIds('main');

  assert.deepEqual(await saveSelectedDish(2001, b1), { slot: 1, status: 'added' });
  assert.deepEqual(await saveSelectedDish(2001, b1), { slot: 1, status: 'unchanged' });
  assert.deepEqual(await saveSelectedDish(2001, b2), { slot: 1, status: 'replaced' });

  assert.deepEqual(await saveSelectedDish(2001, m1), { slot: 2, status: 'added' });
  assert.deepEqual(await saveSelectedDish(2001, m2), { slot: 3, status: 'added' });
  assert.deepEqual(await saveSelectedDish(2001, m3), { slot: 2, status: 'replaced' });
});

test('concurrent saveSelectedDish calls fill both main slots', async () => {
  const [m1, m2] = await recipeIds('main');
  const results = await Promise.all([saveSelectedDish(2002, m1), saveSelectedDish(2002, m2)]);
  assert.deepEqual(results.map(r => r.slot).sort(), [2, 3]);
});

test('replaceInSlot rejects a recipe from another category', async () => {
  const [salad] = await recipeIds('salads');
  const today = formatLocalDate(new Date());
  await assert.rejects(replaceInSlot(2003, today, 1, salad), /not allowed in slot 1/);
  assert.equal(await replaceInSlot(2003, today, 4, salad), true);
});

test('generateWeeklyPlan fills 7 days x 5 slots with distinct mains', async () => {
  const { weekStart, daysFilled } = await generateWeeklyPlan(3001);
  assert.equal(daysFilled.length, 7);
  assert.equal(daysFilled[0], weekStart);

  const plan = await getWeeklyPlan(3001);
  assert.equal(plan.length, 35);
  for (const date of daysFilled) {
    const day = plan.filter(p => p.date === date);
    assert.deepEqual(day.map(p => p.slot), [1, 2, 3, 4, 5]);
    assert.notEqual(day[1].name, day[2].name, `mains differ on ${date}`);
  }

  // [RU] Повторная генерация не плодит связи неделя→день.
  // [EN] Regeneration does not duplicate week→day links.
  await generateWeeklyPlan(3001);
  const links = await dbGet(
    `SELECT COUNT(*) AS c FROM weekly_menu_days wmd
     JOIN weekly_menu wm ON wm.id = wmd.weekly_menu_id
     WHERE wm.user_id = (SELECT id FROM users WHERE telegram_id = ?)`,
    [3001]
  );
  assert.equal(links.c, 7);
});
