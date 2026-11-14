const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  MEAL_KCAL_CAP, SINGLES_PER_PAGE,
  remainingStatus, mealTarget, nutritionDistance, contextFactor,
  rankSingles, pickCombos, distinctCombos, buildSuggestions
} = require('../../src/features/what-to-eat/scoring');

const NORMS = { calories: 2400, protein: 150, fat: 80, carbs: 260 };
const NO_PREFS = { excluded: new Set(), favorite: new Set() };
const ctx = (extra = {}) => ({ norms: NORMS, prefs: NO_PREFS, hour: 10, eatenCategories: new Set(), ...extra });
const recipe = (id, category, calories, protein, fat, carbs, ingredientIds = []) => (
  { id, name: `R${id}`, category, calories, protein, fat, carbs, ingredientIds }
);

const RECIPES = [
  recipe(1, 'breakfast', 400, 25, 15, 40),
  recipe(2, 'main', 600, 45, 20, 50),
  recipe(3, 'main', 550, 20, 25, 60),
  recipe(4, 'salads', 250, 8, 18, 12),
  recipe(5, 'desserts', 300, 15, 10, 40),
  recipe(6, 'main', 700, 50, 30, 55),
  recipe(7, 'salads', 150, 10, 5, 15),
  recipe(8, 'desserts', 200, 5, 8, 30)
];

test('remainingStatus: open, done below 100 kcal, over when negative', () => {
  assert.equal(remainingStatus({ calories: 500 }), 'open');
  assert.equal(remainingStatus({ calories: 99 }), 'done');
  assert.equal(remainingStatus({ calories: -1 }), 'over');
});

test('mealTarget caps a big remainder proportionally', () => {
  assert.deepEqual(mealTarget({ calories: 500, protein: 30, fat: 10, carbs: 60 }), { calories: 500, protein: 30, fat: 10, carbs: 60 });
  const capped = mealTarget({ calories: 1400, protein: 100, fat: 40, carbs: 140 });
  assert.equal(capped.calories, MEAL_KCAL_CAP);
  assert.equal(capped.protein, 50);
});

test('nutritionDistance: zero on a hit, overshooting costs more than undershooting', () => {
  const target = { calories: 600, protein: 40, fat: 20, carbs: 60 };
  assert.equal(nutritionDistance(target, target, NORMS), 0);
  const over = nutritionDistance({ ...target, calories: 700 }, target, NORMS);
  const under = nutritionDistance({ ...target, calories: 500 }, target, NORMS);
  assert.ok(over > under);
});

test('contextFactor: late breakfast is penalized, missing main is favored after noon', () => {
  assert.equal(contextFactor({ category: 'breakfast' }, ctx()), 1);
  assert.ok(contextFactor({ category: 'breakfast' }, ctx({ hour: 15 })) > 1);
  assert.ok(contextFactor({ category: 'main' }, ctx({ hour: 15 })) < 1);
  assert.equal(contextFactor({ category: 'main' }, ctx({ hour: 15, eatenCategories: new Set(['main']) })), 1);
});

test('rankSingles picks the best portion per recipe and sorts by score', () => {
  const target = { calories: 300, protein: 22, fat: 10, carbs: 25 };
  const ranked = rankSingles(RECIPES, target, ctx());
  assert.equal(ranked.length, RECIPES.length);
  for (let i = 1; i < ranked.length; i++) assert.ok(ranked[i - 1].score <= ranked[i].score);
  const main2 = ranked.find(o => o.recipe.id === 2);
  assert.equal(main2.portion, 0.5, 'half of a 600 kcal main fits a 300 kcal target better');
});

test('favorite products lift a recipe in the ranking', () => {
  const target = { calories: 550, protein: 30, fat: 22, carbs: 55 };
  const plain = rankSingles(RECIPES, target, ctx()).map(o => o.recipe.id);
  const tweaked = RECIPES.map(r => (r.id === plain[2] ? { ...r, ingredientIds: [42] } : r));
  const prefs = { excluded: new Set(), favorite: new Set([42]) };
  const fav = rankSingles(tweaked, target, ctx({ prefs })).map(o => o.recipe.id);
  assert.ok(fav.indexOf(plain[2]) < 2);
});

test('pickCombos closes the remainder better than any single dish and respects categories', () => {
  const remaining = { calories: 1300, protein: 90, fat: 40, carbs: 130 };
  const combos = pickCombos(RECIPES, remaining, ctx());
  const bestSingle = rankSingles(RECIPES, remaining, ctx())[0];
  assert.ok(combos[0].score < bestSingle.score);
  for (const combo of combos) {
    const cats = combo.items.map(it => it.recipe.category).filter(c => c !== 'main');
    assert.equal(new Set(cats).size, cats.length, 'non-main categories are not repeated');
    assert.ok(combo.items.length >= 2 && combo.items.length <= 3);
  }
});

test('distinctCombos drops combos sharing two recipes with a kept one', () => {
  const c = (...ids) => ({ items: ids.map(id => ({ recipe: { id } })) });
  assert.deepEqual(distinctCombos([c(1, 2), c(1, 2, 3), c(1, 4), c(5, 6)], 3).map(k => k.items.map(i => i.recipe.id)),
    [[1, 2], [1, 4], [5, 6]]);
});

test('buildSuggestions pages through singles and wraps around', () => {
  const remaining = { calories: 1300, protein: 90, fat: 40, carbs: 130 };
  const first = buildSuggestions(RECIPES, remaining, ctx(), 0);
  const second = buildSuggestions(RECIPES, remaining, ctx(), 1);
  assert.equal(first.singles.length, SINGLES_PER_PAGE);
  assert.ok(first.combos.length > 0);
  const ids = (s) => s.singles.map(o => o.recipe.id);
  assert.equal(ids(first).filter(id => ids(second).includes(id)).length, 0);
  const pages = Math.ceil(RECIPES.length / SINGLES_PER_PAGE);
  assert.deepEqual(ids(buildSuggestions(RECIPES, remaining, ctx(), pages)), ids(first));
});
