const { seedDb } = require('../helpers/memory-db');
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { dbGet, dbAll } = require('../../src/database/db');
const { parseAmount, normalizeUnit } = require('../../src/database/ingredient-normalizer');

const count = async (table) => (await dbGet(`SELECT COUNT(*) AS c FROM ${table}`)).c;

test('parseAmount handles numbers, fractions, ranges and free text', () => {
  const cases = [
    ['100 г', 100, 'г'],
    ['3 шт', 3, 'шт'],
    ['1/2 ст.', 0.5, 'ст.'],
    ['2-3 шт', 2, 'шт'],
    ['250–300 г', 250, 'г'],
    ['1 — 2 ст. л.', 1, 'ст. л.'],
    ['0,5 кг', 0.5, 'кг'],
    ['2-3 шт (200 г)', 2, 'шт (200 г)'],
    ['4', 4, 'шт'],
    ['по вкусу', 0, 'по вкусу'],
    ['', 0, 'не указано'],
    [undefined, 0, 'не указано']
  ];
  for (const [input, amount, unit] of cases) {
    assert.deepEqual(parseAmount(input), { amount, unit }, `input: ${input}`);
  }
});

test('normalizeUnit folds aliases and strips weight suffixes', () => {
  assert.equal(normalizeUnit('шт (200 г)'), normalizeUnit('шт'));
  assert.equal(normalizeUnit('ст.л.'), normalizeUnit('ст. л.'));
});

before(seedDb);

test('migrate seeds all recipes with FK integrity', async () => {
  assert.equal(await count('recipes'), 117);
  assert.equal(await count('meal_categories'), 4);
  assert.ok(await count('ingredients') > 100);
  assert.deepEqual(await dbAll('PRAGMA foreign_key_check'), []);
  const untyped = await dbGet("SELECT COUNT(*) AS c FROM ingredients WHERE type IS NULL OR type = ''");
  assert.equal(untyped.c, 0);
});

test('ingredient dictionary is sanitized (Stage 3.1)', async () => {
  const names = (await dbAll('SELECT name FROM ingredients')).map(r => r.name);
  assert.ok(names.length >= 130 && names.length <= 140, `ingredients: ${names.length}`);
  assert.deepEqual(names.filter(n => /,|\sили\s|\//.test(n)), []);
  for (const gone of ['Сыр 9%', 'Сыр тертый', 'Соль, перец', 'Перец', 'Салат айсберг']) {
    assert.ok(!names.includes(gone), gone);
  }
});

test('no ingredient rows are lost to collisions', async () => {
  const { resolveCatalog } = require('../../src/database/migrate');
  const { recipes } = require('../../database/recipes.json');
  const { resolved } = resolveCatalog(recipes);
  const expected = [...resolved.values()].reduce((sum, rows) => sum + rows.length, 0);
  assert.equal(await count('recipe_ingredients'), expected);
});

test('migrate is idempotent', async () => {
  const before = {
    recipes: await count('recipes'),
    ingredients: await count('ingredients'),
    links: await count('recipe_ingredients')
  };
  await seedDb();
  assert.deepEqual({
    recipes: await count('recipes'),
    ingredients: await count('ingredients'),
    links: await count('recipe_ingredients')
  }, before);
});

test('catalog stores servings and base-unit amounts', async () => {
  const multi = await dbGet('SELECT COUNT(*) AS c FROM recipes WHERE servings > 1');
  assert.ok(multi.c > 90, `multi-serving recipes: ${multi.c}`);
  const broken = await dbGet(
    `SELECT COUNT(*) AS c FROM recipe_ingredients
     WHERE (base_unit IS NULL) != (amount_base IS NULL) OR amount_base <= 0`
  );
  assert.equal(broken.c, 0);
  const units = await dbAll('SELECT COUNT(DISTINCT base_unit) AS n, ingredient_id FROM recipe_ingredients WHERE base_unit IS NOT NULL GROUP BY ingredient_id HAVING n > 1');
  assert.deepEqual(units, [], 'one base unit per ingredient');
});

test('every recipe has sane computed nutrition per serving (Stage 3.1 p.5)', async () => {
  const recipes = await dbAll('SELECT name, calories, protein, fat, carbs FROM recipes');
  for (const r of recipes) {
    assert.ok(r.calories >= 50 && r.calories <= 700, `${r.name}: ${r.calories} kcal`);
    const fromMacros = r.protein * 4 + r.fat * 9 + r.carbs * 4;
    assert.ok(Math.abs(fromMacros - r.calories) / r.calories <= 0.15, `${r.name}: ${r.calories} vs ${fromMacros}`);
  }
});
