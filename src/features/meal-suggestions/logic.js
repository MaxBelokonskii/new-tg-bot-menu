const { db } = require('../../database/db');

/**
 * Получает случайный рецепт из указанной категории
 * @param {string} categoryName - Название категории
 * @returns {Promise<object>} Recipe object
 */
async function getRandomRecipeByCategory(categoryName) {
  return new Promise((resolve, reject) => {
    const query = `
      SELECT r.*, mc.name as category_name 
      FROM recipes r
      JOIN meal_categories mc ON r.category_id = mc.id
      WHERE LOWER(mc.name) = LOWER(?)
      ORDER BY RANDOM()
      LIMIT 1
    `;
    db.get(query, [categoryName], (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

/**
 * Получает ингредиенты для рецепта
 * @param {number} recipeId
 * @returns {Promise<Array>} List of ingredients
 */
async function getRecipeIngredients(recipeId) {
  return new Promise((resolve, reject) => {
    const query = `
      SELECT i.name, ri.amount, ri.unit
      FROM recipe_ingredients ri
      JOIN ingredients i ON ri.ingredient_id = i.id
      WHERE ri.recipe_id = ?
    `;
    db.all(query, [recipeId], (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

module.exports = {
  getRandomRecipeByCategory,
  getRecipeIngredients
};
