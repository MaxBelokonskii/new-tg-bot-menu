const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  parseIdList, filterByPrefs, favoriteCount, favoriteWeight, pickWeighted, FAVORITE_BONUS, FAVORITE_CAP
} = require('../../src/features/ingredient-prefs/scoring');
const { pickRecipe } = require('../../src/features/weekly-planner/generator');

const prefs = { excluded: new Set([9]), favorite: new Set([1, 2, 3]) };
const recipe = (id, ingredientIds, calories = 100) => ({ id, ingredientIds, calories });

test('parseIdList parses GROUP_CONCAT output', () => {
  assert.deepEqual(parseIdList('3,17,42'), [3, 17, 42]);
  assert.deepEqual(parseIdList(null), []);
});

test('filterByPrefs drops recipes with an excluded ingredient', () => {
  const list = [recipe(1, [1, 9]), recipe(2, [2]), recipe(3, [])];
  assert.deepEqual(filterByPrefs(list, prefs).map(r => r.id), [2, 3]);
  assert.equal(filterByPrefs(list).length, 3);
});

test('favorite weight grows with favorites up to the cap', () => {
  assert.equal(favoriteCount(recipe(1, [1, 1, 2, 5]), prefs), 2);
  assert.equal(favoriteWeight(recipe(1, [5]), prefs), 1);
  assert.equal(favoriteWeight(recipe(1, [1]), prefs), 1 + FAVORITE_BONUS);
  assert.equal(favoriteWeight(recipe(1, [1, 2, 3]), prefs), 1 + FAVORITE_BONUS * FAVORITE_CAP);
});

test('pickWeighted respects weights', () => {
  const items = ['a', 'b'];
  const weight = (x) => (x === 'a' ? 1 : 3);
  assert.equal(pickWeighted(items, weight, () => 0.2), 'a');
  assert.equal(pickWeighted(items, weight, () => 0.3), 'b');
  assert.equal(pickWeighted([], weight), null);
});

test('pickRecipe lets a favorite recipe win TOP_K slots despite a larger kcal distance', () => {
  // target 500: plain recipes at 500..540, favorite at 555 — distance 55 / 2 = 27.5 beats 30 and 40
  const pool = [500, 510, 520, 530, 540].map((kcal, i) => recipe(i + 1, [5], kcal));
  pool.push(recipe(99, [1, 2], 555));
  const seen = new Set();
  for (let i = 0; i < 40; i++) seen.add(pickRecipe(pool, 500, new Set(), new Set(), () => i / 40, prefs).id);
  assert.ok(seen.has(99));
  assert.ok(!seen.has(5), 'the farthest plain recipe drops out of TOP_K');
});
