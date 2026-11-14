const { dbAll, withTransaction } = require('../../database/db');
const { calculateRemaining, sumNutrition } = require('../../utils/nutrition-totals');
const { getOrCreateUser } = require('../weekly-planner/logic');
const { getUserProfile } = require('../profile/logic');
const { pickTargets } = require('../profile/targets');
const { getUserIngredientPrefs } = require('../ingredient-prefs/logic');
const { parseIdList, filterByPrefs } = require('../ingredient-prefs/scoring');
const { getDayLog, addEntry } = require('../food-log/logic');
const { remainingStatus, buildSuggestions } = require('./scoring');

/**
 * Loads every recipe with category, per-serving nutrition and ingredient ids.
 * @returns {Promise<Array<{id: number, name: string, category: string, calories: number,
 *   protein: number, fat: number, carbs: number, ingredientIds: number[]}>>}
 */
async function loadRecipes() {
  const rows = await dbAll(
    `SELECT r.id, r.name, mc.name AS category, r.calories, r.protein, r.fat, r.carbs,
            (SELECT GROUP_CONCAT(ri.ingredient_id) FROM recipe_ingredients ri
             WHERE ri.recipe_id = r.id) AS ingredient_ids
     FROM recipes r
     JOIN meal_categories mc ON mc.id = r.category_id`
  );
  return rows.map(({ ingredient_ids: ids, ...recipe }) => ({ ...recipe, ingredientIds: parseIdList(ids) }));
}

/**
 * Computes today's "what else to eat" suggestions for the user.
 *
 * [RU] Остаток = нормы (3.3) − съеденное сегодня по дневнику (3.4).
 * Кандидаты — все рецепты без исключённых продуктов (3.2) и без уже
 * съеденных сегодня. Без анкеты/норм — status 'noTargets'.
 * [EN] Remainder = targets (3.3) − eaten today per the diary (3.4).
 * Candidates are all recipes without excluded products (3.2) and not eaten
 * today. No profile/targets → status 'noTargets'.
 *
 * [RU] Дата и час — локальные для пользователя (getUserClock): правила
 * времени суток (завтрак после 12:00) идут по его часам, не по серверным.
 * [EN] Date and hour are the user's local ones (getUserClock): time-of-day
 * rules (breakfast after 12:00) follow the user's clock, not the server's.
 *
 * @param {number} telegramId
 * @param {{today: string, hour: number, page?: number}} options
 *   today — YYYY-MM-DD, hour — 0..23 in the user's zone
 * @returns {Promise<{status: 'noTargets'|'open'|'done'|'over', remaining?: object,
 *   singles?: Array, combos?: Array, page?: number}>}
 */
async function getSuggestions(telegramId, { today, hour, page = 0 }) {
  const profile = await getUserProfile(telegramId);
  const norms = profile ? pickTargets(profile) : null;
  if (!norms || !norms.calories || norms.protein === null || norms.protein === undefined) {
    return { status: 'noTargets' };
  }

  const entries = await getDayLog(telegramId, today);
  const remaining = calculateRemaining(sumNutrition(entries), norms);
  const status = remainingStatus(remaining);
  if (status !== 'open') return { status, remaining };

  const eatenIds = new Set(entries.map(e => e.recipeId));
  const recipes = await loadRecipes();
  const eatenCategories = new Set(recipes.filter(r => eatenIds.has(r.id)).map(r => r.category));
  const prefs = await getUserIngredientPrefs(await getOrCreateUser(telegramId));
  const candidates = filterByPrefs(recipes, prefs).filter(r => !eatenIds.has(r.id));

  const ctx = { norms, prefs, hour, eatenCategories };
  return { status, remaining, ...buildSuggestions(candidates, remaining, ctx, page) };
}

/**
 * Logs several dishes (a suggested combination) to the diary at once.
 * @param {number} telegramId
 * @param {Array<{recipeId: number, portion: number}>} items
 * @param {string} date - YYYY-MM-DD, the user's local today
 * @returns {Promise<number>} number of entries written
 */
async function logCombo(telegramId, items, date) {
  return withTransaction(async () => {
    let written = 0;
    for (const { recipeId, portion } of items) {
      if (await addEntry(telegramId, { recipeId, portion, date })) written++;
    }
    return written;
  });
}

module.exports = {
  loadRecipes,
  getSuggestions,
  logCombo
};
