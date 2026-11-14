const { seedDb } = require('../helpers/memory-db');
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { dbAll, dbGet } = require('../../src/database/db');
const { saveUserProfile } = require('../../src/features/profile/logic');
const { addEntry, getDayLog } = require('../../src/features/food-log/logic');
const { addPrefsFromText } = require('../../src/features/ingredient-prefs/logic');
const { getSuggestions, logCombo } = require('../../src/features/what-to-eat/logic');

const SURVEY = { weight: 80, height: 180, age: 30, sex: 'male', activity_level: 'moderate', goal: 'maintain' };
// [RU] Локальные дата и час пользователя приходят из getUserClock — здесь фиксированы.
// [EN] The user's local date and hour come from getUserClock — fixed here.
const TODAY = '2026-11-14';
const CLOCK = { today: TODAY, hour: 9 };
const optionIds = (result) => [
  ...result.singles.map(o => o.recipe.id),
  ...result.combos.flatMap(c => c.items.map(it => it.recipe.id))
];

before(seedDb);

test('without a profile there is nothing to compute', async () => {
  assert.deepEqual(await getSuggestions(8001, CLOCK), { status: 'noTargets' });
});

test('suggestions skip recipes eaten today and recipes with excluded products', async () => {
  await saveUserProfile(8002, SURVEY);
  const eaten = await dbGet('SELECT id FROM recipes ORDER BY id LIMIT 1');
  await addEntry(8002, { recipeId: eaten.id, date: TODAY });
  await addPrefsFromText(8002, 'excluded', 'яйцо');
  const banned = new Set((await dbAll(
    `SELECT ri.recipe_id FROM recipe_ingredients ri JOIN ingredients i ON i.id = ri.ingredient_id
     WHERE i.name = 'Яйцо'`
  )).map(r => r.recipe_id));

  for (let page = 0; page < 5; page++) {
    const result = await getSuggestions(8002, { ...CLOCK, page });
    assert.equal(result.status, 'open');
    assert.equal(result.singles.length, 3);
    for (const id of optionIds(result)) {
      assert.notEqual(id, eaten.id);
      assert.ok(!banned.has(id), `recipe ${id} contains an excluded product`);
    }
  }
});

test('combos target the whole remainder; singles stay within a meal', async () => {
  await saveUserProfile(8003, SURVEY);
  const result = await getSuggestions(8003, CLOCK);
  assert.ok(result.remaining.calories > 2000);
  for (const option of result.singles) assert.ok(option.nutrition.calories < result.remaining.calories);
  assert.ok(result.combos.length > 0);
  assert.ok(result.combos[0].nutrition.calories > result.singles[0].nutrition.calories);
});

test('logCombo writes all dishes; a full day turns into done / over', async () => {
  await saveUserProfile(8004, SURVEY);
  const ids = (await dbAll('SELECT id FROM recipes ORDER BY calories DESC LIMIT 3')).map(r => r.id);
  assert.equal(await logCombo(8004, ids.map(recipeId => ({ recipeId, portion: 2 })), TODAY), 3);
  assert.equal((await getDayLog(8004, TODAY)).length, 3);

  let result = await getSuggestions(8004, CLOCK);
  while (result.status === 'open') {
    await logCombo(8004, [{ recipeId: ids[0], portion: 2 }], TODAY);
    result = await getSuggestions(8004, CLOCK);
  }
  assert.ok(['done', 'over'].includes(result.status));
  assert.equal(result.singles, undefined);
});
