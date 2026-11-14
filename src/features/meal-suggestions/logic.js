const { dbGet, dbAll } = require('../../database/db');

/**
 * Returns a random recipe from the given category.
 * @param {string} categoryName - category key (breakfast|main|salads|desserts)
 * @returns {Promise<object|undefined>} Recipe row with `category_name`
 */
async function getRandomRecipeByCategory(categoryName) {
  return dbGet(
    `SELECT r.*, mc.name as category_name
     FROM recipes r
     JOIN meal_categories mc ON r.category_id = mc.id
     WHERE LOWER(mc.name) = LOWER(?)
     ORDER BY RANDOM()
     LIMIT 1`,
    [categoryName]
  );
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
