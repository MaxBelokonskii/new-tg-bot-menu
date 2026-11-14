const { dbGet, dbAll } = require('../../database/db');
const { getOrCreateUser, CATEGORY_TO_SLOTS } = require('./logic');

/**
 * Returns the dishes planned for one day with per-serving nutrition,
 * ordered by slot.
 * @param {number} telegramId
 * @param {string} date - YYYY-MM-DD
 * @returns {Promise<Array<{slot: number, recipe_id: number, name: string,
 *   calories: number, protein: number, fat: number, carbs: number}>>}
 */
async function getDayPlan(telegramId, date) {
  const userId = await getOrCreateUser(telegramId);
  return dbAll(
    `SELECT dmi.slot, r.id AS recipe_id, r.name, r.calories, r.protein, r.fat, r.carbs
     FROM daily_menu_items dmi
     JOIN daily_menu dm ON dmi.daily_menu_id = dm.id
     JOIN recipes r ON dmi.recipe_id = r.id
     WHERE dm.user_id = ? AND dm.date = ?
     ORDER BY dmi.slot ASC`,
    [userId, date]
  );
}

/**
 * Checks where a recipe would land in the day's plan without writing
 * anything — lets the UI ask "replace?" before saveSelectedDish overwrites
 * an occupied slot.
 *
 * [RU] freeSlot — первый свободный слот категории (тот же, что выберет
 * saveSelectedDish); null — все слоты категории заняты, и тогда occupied —
 * кандидаты на замену. alreadyPlanned — рецепт уже стоит в одном из них.
 * [EN] freeSlot is the first free slot of the category (the one
 * saveSelectedDish would pick); null means every slot is taken and
 * `occupied` lists the replacement candidates. alreadyPlanned — the recipe
 * already sits in one of them.
 *
 * @param {number} telegramId
 * @param {number} recipeId
 * @param {string} date - YYYY-MM-DD
 * @returns {Promise<{recipe: {id: number, name: string}, alreadyPlanned: boolean,
 *   freeSlot: number|null, occupied: Array<{slot: number, recipeId: number, name: string}>}|null>}
 *   null when the recipe does not exist
 */
async function checkDishPlacement(telegramId, recipeId, date) {
  const recipe = await dbGet(
    `SELECT r.id, r.name, LOWER(mc.name) AS category
     FROM recipes r
     JOIN meal_categories mc ON r.category_id = mc.id
     WHERE r.id = ?`,
    [recipeId]
  );
  if (!recipe) return null;
  const slots = CATEGORY_TO_SLOTS[recipe.category];
  if (!slots) throw new Error(`Unknown recipe category: ${recipe.category}`);

  const items = (await getDayPlan(telegramId, date)).filter(item => slots.includes(item.slot));
  const taken = new Set(items.map(item => item.slot));
  return {
    recipe: { id: recipe.id, name: recipe.name },
    alreadyPlanned: items.some(item => item.recipe_id === recipe.id),
    freeSlot: slots.find(slot => !taken.has(slot)) ?? null,
    occupied: items.map(item => ({ slot: item.slot, recipeId: item.recipe_id, name: item.name }))
  };
}

module.exports = { getDayPlan, checkDishPlacement };
