const { seedDb } = require('../helpers/memory-db');
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { dbGet, dbAll } = require('../../src/database/db');
const { parseAmount, normalizeUnit } = require('../../src/database/migrate');

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
