const fs = require('fs');
const path = require('path');
const { baseToGrams } = require('./unit-converter');

const NUTRITION_PATH = path.resolve(__dirname, '../../database/ingredient-nutrition.json');

function loadNutrition() {
  try {
    const raw = JSON.parse(fs.readFileSync(NUTRITION_PATH, 'utf8'));
    return new Map(Object.entries(raw).filter(([name]) => !name.startsWith('_')));
  } catch (err) {
    throw new Error(`Failed to load ${NUTRITION_PATH}: ${err.message}`);
  }
}

const NUTRITION = loadNutrition();

// [RU] Стандартная порция по категории: вес сырья и потолок ккал. Потолок нужен
// для блюд из сухих круп и сладостей — по весу сырья порция там вышла бы
// слишком калорийной (3 стакана сухого риса «весят» меньше готового плова).
// [EN] Standard portion per category: raw weight and a kcal ceiling. The
// ceiling covers dishes made of dry grains and sweets, where a raw-weight
// portion would be far too dense.
const PORTIONS = Object.freeze({
  breakfast: Object.freeze({ grams: 250, kcal: 450 }),
  main: Object.freeze({ grams: 350, kcal: 600 }),
  salads: Object.freeze({ grams: 250, kcal: 400 }),
  desserts: Object.freeze({ grams: 150, kcal: 350 })
});
const DEFAULT_PORTION = Object.freeze({ grams: 300, kcal: 500 });

/**
 * @param {string} name - canonical ingredient name
 * @returns {boolean}
 */
function hasNutrition(name) {
  return NUTRITION.has(name);
}

const round1 = (value) => Math.round(value * 10) / 10;

/**
 * Computes servings and nutrition per serving of a recipe from its resolved
 * ingredient rows and ingredient-nutrition.json.
 *
 * [RU] КБЖУ из recipes.json не используется: у ~80 рецептов оно указано на
 * 100 г, а ингредиенты — на всё блюдо (servings = 1). Порции — максимум из
 * servings в JSON, «вес сырья / порция» и «ккал / потолок порции».
 * [EN] recipes.json nutrition is ignored: ~80 recipes list it per 100 g while
 * ingredients cover the whole dish (servings = 1). Servings is the max of the
 * JSON value, raw weight / portion and kcal / portion ceiling.
 *
 * @param {{category: string, servings?: number}} recipe
 * @param {Array<{name: string, amountBase: number|null, baseUnit: string|null}>} rows
 * @returns {{servings: number, weight: number, calories: number, protein: number, fat: number, carbs: number}}
 *   weight and nutrition are per serving
 * @throws {Error} when an ingredient has no nutrition entry
 */
function computeRecipeNutrition(recipe, rows) {
  const total = { weight: 0, calories: 0, protein: 0, fat: 0, carbs: 0 };
  for (const row of rows) {
    const values = NUTRITION.get(row.name);
    if (!values) throw new Error(`Ingredient missing in ingredient-nutrition.json: ${row.name}`);
    if (row.amountBase === null) continue;
    const grams = baseToGrams(row.name, row.amountBase, row.baseUnit);
    const [kcal, protein, fat, carbs] = values;
    total.weight += grams;
    total.calories += (kcal * grams) / 100;
    total.protein += (protein * grams) / 100;
    total.fat += (fat * grams) / 100;
    total.carbs += (carbs * grams) / 100;
  }
  const portion = PORTIONS[recipe.category] || DEFAULT_PORTION;
  const servings = Math.max(
    1,
    Number(recipe.servings) || 1,
    Math.round(total.weight / portion.grams),
    Math.ceil(total.calories / portion.kcal)
  );
  return {
    servings,
    weight: Math.round(total.weight / servings),
    calories: Math.round(total.calories / servings),
    protein: round1(total.protein / servings),
    fat: round1(total.fat / servings),
    carbs: round1(total.carbs / servings)
  };
}

module.exports = { computeRecipeNutrition, hasNutrition, PORTIONS };
