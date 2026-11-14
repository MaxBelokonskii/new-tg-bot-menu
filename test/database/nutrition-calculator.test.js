const { test } = require('node:test');
const assert = require('node:assert/strict');
const { computeRecipeNutrition } = require('../../src/database/nutrition-calculator');
const { resolveRecipeIngredients } = require('../../src/database/ingredient-normalizer');

const rows = (ingredients) => resolveRecipeIngredients(ingredients).rows;

test('nutrition is summed from ingredients per 100 g', () => {
  const n = computeRecipeNutrition(
    { category: 'breakfast', servings: 1 },
    rows([{ item: 'Творог', amount: '200 г' }, { item: 'Соль', amount: 'по вкусу' }])
  );
  assert.deepEqual(n, { servings: 1, weight: 200, calories: 242, protein: 34.4, fat: 10, carbs: 3.6 });
});

test('pieces are weighed by piece weight', () => {
  const n = computeRecipeNutrition({ category: 'breakfast' }, rows([{ item: 'Яйцо', amount: '2 шт' }]));
  assert.equal(n.weight, 110);
  assert.equal(n.calories, 157);
});

test('a whole-dish recipe is split into standard portions', () => {
  const n = computeRecipeNutrition(
    { category: 'main', servings: 1 },
    rows([{ item: 'Рыба', amount: '1400 г' }])
  );
  assert.equal(n.servings, 4);
  assert.equal(n.weight, 350);
});

test('dense dishes are split by the kcal ceiling', () => {
  const n = computeRecipeNutrition(
    { category: 'desserts', servings: 1 },
    rows([{ item: 'Шоколад горький', amount: '150 г' }])
  );
  assert.ok(n.calories <= 350, `kcal ${n.calories}`);
  assert.ok(n.servings >= 3);
});

test('declared servings are kept when larger', () => {
  const n = computeRecipeNutrition({ category: 'salads', servings: 6 }, rows([{ item: 'Огурец', amount: '2 шт' }]));
  assert.equal(n.servings, 6);
});

test('unknown ingredients fail loudly', () => {
  assert.throws(
    () => computeRecipeNutrition({ category: 'main' }, [{ name: 'Нечто', amountBase: 1, baseUnit: 'г' }]),
    /ingredient-nutrition\.json/
  );
});
