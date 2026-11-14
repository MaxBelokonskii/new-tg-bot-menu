const { dbAll } = require('../../database/db');
const {
  EMPTY_PREFS, parseIdList, filterByPrefs, favoriteWeight, pickWeighted
} = require('../ingredient-prefs/scoring');

/**
 * Returns a random recipe from the given category, honoring the user's
 * product preferences: recipes with excluded products are never picked,
 * recipes with favorite products get a higher weight.
 *
 * @param {string} categoryName - category key (breakfast|main|salads|desserts)
 * @param {{prefs?: {excluded: Set<number>, favorite: Set<number>}, random?: () => number}} [options]
 * @returns {Promise<object|null>} Recipe row with `category_name`, or null
 *   when the category is empty after exclusions
 */
async function getRandomRecipeByCategory(categoryName, options = {}) {
  const { prefs = EMPTY_PREFS, random = Math.random } = options;
  const rows = await dbAll(
    `SELECT r.*, mc.name AS category_name,
            (SELECT GROUP_CONCAT(ri.ingredient_id) FROM recipe_ingredients ri
             WHERE ri.recipe_id = r.id) AS ingredient_ids
     FROM recipes r
     JOIN meal_categories mc ON r.category_id = mc.id
     WHERE LOWER(mc.name) = LOWER(?)`,
    [categoryName]
  );
  const candidates = rows.map(r => ({ ...r, ingredientIds: parseIdList(r.ingredient_ids) }));
  const pick = pickWeighted(filterByPrefs(candidates, prefs), c => favoriteWeight(c, prefs), random);
  if (!pick) return null;
  const { ingredient_ids: _ids, ingredientIds: _parsed, ...recipe } = pick;
  return recipe;
}

/**
 * Returns the ingredient list of a recipe.
 * @param {number} recipeId
 * @returns {Promise<Array<{name: string, amount: number, unit: string}>>}
 */
async function getRecipeIngredients(recipeId) {
  return dbAll(
    `SELECT i.name, ri.amount, ri.unit
     FROM recipe_ingredients ri
     JOIN ingredients i ON ri.ingredient_id = i.id
     WHERE ri.recipe_id = ?`,
    [recipeId]
  );
}

module.exports = {
  getRandomRecipeByCategory,
  getRecipeIngredients
};
