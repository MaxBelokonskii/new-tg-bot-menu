const { seedDb } = require('../helpers/memory-db');
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { dbAll, dbGet, dbRun } = require('../../src/database/db');
const { getOrCreateUser } = require('../../src/features/weekly-planner/logic');
const {
  getUserIngredientPrefs, getPrefsByTelegramId, listPrefs, addPrefsFromText, removePref
} = require('../../src/features/ingredient-prefs/logic');
const { generateWeeklyPlan, EmptyCategoryError } = require('../../src/features/weekly-planner/generator');
const { getWeekBounds } = require('../../src/utils/date-helpers');
const { getRandomRecipeByCategory } = require('../../src/features/meal-suggestions/logic');
const { findRecipesByInventory } = require('../../src/features/reverse-search/logic');
const { migrateLegacyExclusions } = require('../../src/database/legacy-exclusions');

const ingredientId = async (name) => (await dbGet('SELECT id FROM ingredients WHERE name = ?', [name])).id;
const recipeIdsWith = async (name) => new Set((await dbAll(
  `SELECT ri.recipe_id FROM recipe_ingredients ri JOIN ingredients i ON i.id = ri.ingredient_id
   WHERE i.name = ?`, [name]
)).map(r => r.recipe_id));

before(seedDb);

test('addPrefsFromText resolves input, reports unknown with suggestions and skips duplicates', async () => {
  const result = await addPrefsFromText(7001, 'excluded', 'грибы, Креветки, курица, грибы');
  assert.deepEqual(result.added.sort(), ['Грибы', 'Креветки']);
  assert.deepEqual(result.unknown, [{ token: 'курица', suggestions: ['Куриное филе', 'Куриные бедра', 'Куриный фарш'] }]);

  const again = await addPrefsFromText(7001, 'excluded', 'грибы');
  assert.deepEqual(again.already, ['Грибы']);
  assert.deepEqual(again.added, []);
  assert.deepEqual((await listPrefs(7001, 'excluded')).map(i => i.name), ['Грибы', 'Креветки']);
});

test('a product moves between lists instead of being in both', async () => {
  await addPrefsFromText(7002, 'favorite', 'творог, авокадо');
  const moved = await addPrefsFromText(7002, 'excluded', 'творог');
  assert.deepEqual(moved.moved, ['Творог']);
  const prefs = await getPrefsByTelegramId(7002);
  assert.deepEqual([...prefs.excluded], [await ingredientId('Творог')]);
  assert.deepEqual([...prefs.favorite], [await ingredientId('Авокадо')]);

  assert.equal(await removePref(7002, await ingredientId('Авокадо')), true);
  assert.equal(await removePref(7002, await ingredientId('Авокадо')), false);
  assert.deepEqual(await listPrefs(7002, 'favorite'), []);
});

test('unknown kind is rejected', async () => {
  await assert.rejects(addPrefsFromText(7003, 'hated', 'сыр'), /Unknown ingredient pref kind/);
});

test('weekly generation never plans a recipe with an excluded product', async () => {
  await addPrefsFromText(7004, 'excluded', 'яйцо, сыр');
  await generateWeeklyPlan(7004, { week: getWeekBounds('2026-11-14'), random: () => 0.5 });
  const banned = new Set([...await recipeIdsWith('Яйцо'), ...await recipeIdsWith('Сыр')]);
  const planned = await dbAll(
    `SELECT dmi.recipe_id FROM daily_menu_items dmi JOIN daily_menu dm ON dm.id = dmi.daily_menu_id
     WHERE dm.user_id = ?`, [await getOrCreateUser(7004)]
  );
  assert.equal(planned.length, 35);
  for (const { recipe_id: id } of planned) assert.ok(!banned.has(id), `recipe ${id} has an excluded product`);
});

test('weekly generation fails with EmptyCategoryError when a category is fully excluded', async () => {
  const names = (await dbAll(
    `SELECT DISTINCT i.name FROM ingredients i JOIN recipe_ingredients ri ON ri.ingredient_id = i.id
     JOIN recipes r ON r.id = ri.recipe_id JOIN meal_categories mc ON mc.id = r.category_id
     WHERE mc.name = 'desserts'`
  )).map(r => r.name);
  await addPrefsFromText(7005, 'excluded', names.join(', '));
  await assert.rejects(generateWeeklyPlan(7005, { week: getWeekBounds('2026-11-14') }), (err) => err instanceof EmptyCategoryError);
});

test('random dish skips excluded products and returns null for an emptied category', async () => {
  const prefs = { excluded: new Set([await ingredientId('Яйцо')]), favorite: new Set() };
  const banned = await recipeIdsWith('Яйцо');
  for (let i = 0; i < 20; i++) {
    const recipe = await getRandomRecipeByCategory('breakfast', { prefs, random: () => i / 20 });
    assert.ok(recipe && !banned.has(recipe.id));
    assert.equal(recipe.category_name, 'breakfast');
    assert.equal(recipe.ingredientIds, undefined, 'helper fields are stripped');
  }
  const all = new Set((await dbAll('SELECT id FROM ingredients')).map(r => r.id));
  assert.equal(await getRandomRecipeByCategory('salads', { prefs: { excluded: all, favorite: new Set() } }), null);
});

test('random dish favors recipes with favorite products', async () => {
  const fav = await ingredientId('Творог');
  const withFav = await recipeIdsWith('Творог');
  const prefs = { excluded: new Set(), favorite: new Set([fav]) };
  let hits = 0;
  const draws = 200;
  for (let i = 0; i < draws; i++) {
    const recipe = await getRandomRecipeByCategory('breakfast', { prefs, random: () => i / draws });
    if (withFav.has(recipe.id)) hits++;
  }
  const breakfasts = (await dbAll(
    `SELECT r.id FROM recipes r JOIN meal_categories mc ON mc.id = r.category_id WHERE mc.name = 'breakfast'`
  )).map(r => r.id);
  const baseShare = breakfasts.filter(id => withFav.has(id)).length / breakfasts.length;
  assert.ok(hits / draws > baseShare, `favorite share ${hits / draws} should exceed ${baseShare}`);
});

test('reverse search drops excluded recipes and ranks favorites first at equal missing count', async () => {
  const everything = (await dbAll('SELECT name FROM ingredients')).map(r => r.name);
  const plain = await findRecipesByInventory(everything, null);
  const victim = plain[0];
  const victimIngredient = (await dbGet(
    'SELECT ingredient_id AS id FROM recipe_ingredients WHERE recipe_id = ? LIMIT 1', [victim.id]
  )).id;
  const excluded = await findRecipesByInventory(everything, null, {
    excluded: new Set([victimIngredient]), favorite: new Set()
  });
  assert.ok(!excluded.some(r => r.id === victim.id));

  const fav = await ingredientId('Креветки');
  const ranked = await findRecipesByInventory(everything, null, { excluded: new Set(), favorite: new Set([fav]) });
  assert.ok(ranked[0].favorites > 0);
  for (let i = 1; i < ranked.length; i++) assert.ok(ranked[i - 1].favorites >= ranked[i].favorites);
});

test('legacy exclude_ingredients moves into user_ingredient_prefs and the column is dropped', async () => {
  const userId = await getOrCreateUser(7006);
  await dbRun('ALTER TABLE user_preferences ADD COLUMN exclude_ingredients TEXT');
  await dbRun('INSERT INTO user_preferences (user_id, exclude_ingredients) VALUES (?, ?)', [userId, 'грибы; молоко, ерунда']);

  const report = await migrateLegacyExclusions();
  assert.deepEqual(report, { users: 1, moved: 2, skipped: ['ерунда'] });
  const prefs = await getUserIngredientPrefs(userId);
  assert.deepEqual(prefs.excluded, new Set([await ingredientId('Грибы'), await ingredientId('Молоко')]));
  const columns = (await dbAll('PRAGMA table_info(user_preferences)')).map(c => c.name);
  assert.ok(!columns.includes('exclude_ingredients'));
  assert.deepEqual(await migrateLegacyExclusions(), { users: 0, moved: 0, skipped: [] });
});
