const texts = require('../bot/texts');

/**
 * Formats a recipe's nutrition line ("КБЖУ: kcal / protein / fat / carbs").
 * @param {{calories: number, protein: number, fat: number, carbs: number}} recipe
 * @returns {string}
 */
function formatNutrition({ calories, protein, fat, carbs }) {
  return texts.recipeCard.nutrition
    .replace('{calories}', calories)
    .replace('{protein}', protein)
    .replace('{fat}', fat)
    .replace('{carbs}', carbs);
}

module.exports = { formatNutrition };
