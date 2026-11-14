const { dbGet, dbAll, dbRun, withTransaction } = require('../../database/db');
const { getOrCreateUser } = require('../weekly-planner/logic');
const { formatLocalDate, addDays } = require('../../utils/date-helpers');
const { scaleNutrition, sumNutrition } = require('../../utils/nutrition-totals');

// [RU] Допустимые порции: ½ / 1 / 1½ / 2. В callback_data порция едет как
// число половинок (1..4), чтобы не тащить точку в данные кнопки.
// [EN] Allowed portions: ½ / 1 / 1½ / 2. callback_data carries the portion
// as a number of halves (1..4) to keep dots out of button data.
const PORTIONS = [0.5, 1, 1.5, 2];
const HISTORY_DAYS = 7;
const SEARCH_LIMIT = 10;
const MIN_QUERY_LENGTH = 2;
const MAX_SLOT = 5;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const todayString = () => formatLocalDate(new Date());

/**
 * True for a valid YYYY-MM-DD date within the diary window
 * [today − HISTORY_DAYS, today].
 * @param {string} date
 * @param {string} [today] - YYYY-MM-DD, defaults to the local today
 * @returns {boolean}
 */
function isDiaryDate(date, today = todayString()) {
  if (typeof date !== 'string' || !DATE_PATTERN.test(date)) return false;
  if (addDays(date, 0) !== date) return false;
  return date >= addDays(today, -HISTORY_DAYS) && date <= today;
}

/**
 * Converts a halves count from callback_data (1..4) into a portion.
 * @param {number} halves
 * @returns {number|null} portion or null when not allowed
 */
function portionFromHalves(halves) {
  const portion = halves / 2;
  return PORTIONS.includes(portion) ? portion : null;
}

/**
 * Normalises a recipe name or search query for case-insensitive matching.
 * [RU] Поиск в JS: SQLite LOWER() не понимает кириллицу. «ё» ≡ «е».
 * [EN] Matching happens in JS: SQLite LOWER() is ASCII-only. "ё" ≡ "е".
 * @param {string} value
 * @returns {string}
 */
function normalizeName(value) {
  return String(value).toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
}

/**
 * True when the query is long enough to search by.
 * @param {string} query
 * @returns {boolean}
 */
function isSearchQuery(query) {
  return typeof query === 'string' && normalizeName(query).length >= MIN_QUERY_LENGTH;
}

/**
 * Filters recipes whose name contains the query (case/ё-insensitive).
 * Names starting with the query come first, then alphabetical order.
 *
 * @param {Array<{id: number, name: string}>} recipes
 * @param {string} query
 * @param {number} [limit=SEARCH_LIMIT]
 * @returns {{recipes: Array<object>, total: number}} first `limit` matches and the match count
 */
function filterRecipesByName(recipes, query, limit = SEARCH_LIMIT) {
  const needle = normalizeName(query);
  if (!needle) return { recipes: [], total: 0 };
  const matches = recipes
    .map(recipe => ({ recipe, name: normalizeName(recipe.name) }))
    .filter(({ name }) => name.includes(needle))
    .sort((a, b) => (Number(b.name.startsWith(needle)) - Number(a.name.startsWith(needle)))
      || a.recipe.name.localeCompare(b.recipe.name, 'ru'));
  return { recipes: matches.slice(0, limit).map(m => m.recipe), total: matches.length };
}

/**
 * Searches the recipe collection by a part of the name.
 * @param {string} query
 * @returns {Promise<{recipes: Array<{id: number, name: string, calories: number}>, total: number}>}
 */
async function searchRecipes(query) {
  const all = await dbAll('SELECT id, name, calories FROM recipes');
  return filterRecipesByName(all, query);
}

/**
 * Loads a recipe's name and per-serving nutrition.
 * @param {number} recipeId
 * @returns {Promise<{id: number, name: string, calories: number, protein: number, fat: number, carbs: number}|undefined>}
 */
function getRecipeNutrition(recipeId) {
  return dbGet(
    'SELECT id, name, calories, protein, fat, carbs FROM recipes WHERE id = ?',
    [recipeId]
  );
}

/**
 * Records an eaten dish in the diary.
 *
 * @param {number} telegramId
 * @param {{recipeId: number, portion?: number, date?: string, slot?: number|null}} entry
 *   date defaults to the local today; slot is set only for dishes taken from the plan
 * @returns {Promise<number|null>} new entry id, or null if the recipe does not exist
 * @throws {Error} on a portion or slot outside the allowed values
 */
async function addEntry(telegramId, { recipeId, portion = 1, date = todayString(), slot = null }) {
  if (!PORTIONS.includes(portion)) throw new Error(`Invalid portion: ${portion}`);
  if (slot !== null && !(Number.isInteger(slot) && slot >= 1 && slot <= MAX_SLOT)) {
    throw new Error(`Invalid slot: ${slot}`);
  }
  const userId = await getOrCreateUser(telegramId);
  // [RU] INSERT … SELECT FROM recipes: несуществующий рецепт даёт 0 строк
  // вместо FK-ошибки — одна запись без read-then-write.
  // [EN] INSERT … SELECT FROM recipes: an unknown recipe inserts 0 rows
  // instead of raising an FK error — a single write, no read-then-write.
  const { lastID, changes } = await dbRun(
    `INSERT INTO food_log (user_id, date, recipe_id, portion, slot)
     SELECT ?, ?, id, ?, ? FROM recipes WHERE id = ?`,
    [userId, date, portion, slot, recipeId]
  );
  return changes ? lastID : null;
}

/**
 * Deletes a diary entry if it belongs to the user.
 * @param {number} telegramId
 * @param {number} entryId
 * @returns {Promise<string|null>} date of the deleted entry, or null if not found / not owned
 */
async function deleteEntry(telegramId, entryId) {
  const userId = await getOrCreateUser(telegramId);
  return withTransaction(async () => {
    const row = await dbGet(
      'SELECT date FROM food_log WHERE id = ? AND user_id = ?',
      [entryId, userId]
    );
    if (!row) return null;
    await dbRun('DELETE FROM food_log WHERE id = ? AND user_id = ?', [entryId, userId]);
    return row.date;
  });
}

/**
 * Returns the user's diary entries for a date with nutrition scaled by portion.
 * @param {number} telegramId
 * @param {string} date - YYYY-MM-DD
 * @returns {Promise<Array<{id: number, recipeId: number, name: string, portion: number,
 *   slot: number|null, calories: number, protein: number, fat: number, carbs: number}>>}
 */
async function getDayLog(telegramId, date) {
  const userId = await getOrCreateUser(telegramId);
  const rows = await dbAll(
    `SELECT fl.id, fl.recipe_id, fl.portion, fl.slot,
            r.name, r.calories, r.protein, r.fat, r.carbs
     FROM food_log fl
     JOIN recipes r ON r.id = fl.recipe_id
     WHERE fl.user_id = ? AND fl.date = ?
     ORDER BY fl.id`,
    [userId, date]
  );
  return rows.map(row => ({
    id: row.id,
    recipeId: row.recipe_id,
    name: row.name,
    portion: row.portion,
    slot: row.slot,
    ...scaleNutrition(row, row.portion)
  }));
}

/**
 * Returns eaten kcal/P/F/C for a date.
 * @param {number} telegramId
 * @param {string} date - YYYY-MM-DD
 * @returns {Promise<{calories: number, protein: number, fat: number, carbs: number}>}
 */
async function getDayTotals(telegramId, date) {
  return sumNutrition(await getDayLog(telegramId, date));
}

/**
 * Returns dishes planned for a date (daily_menu) with a flag telling
 * whether the recipe is already in that day's diary.
 * @param {number} telegramId
 * @param {string} date - YYYY-MM-DD
 * @returns {Promise<Array<{slot: number, recipeId: number, name: string, logged: boolean}>>}
 */
async function getPlanDishes(telegramId, date) {
  const userId = await getOrCreateUser(telegramId);
  const rows = await dbAll(
    `SELECT dmi.slot, r.id AS recipe_id, r.name,
            EXISTS (SELECT 1 FROM food_log fl
                    WHERE fl.user_id = dm.user_id AND fl.date = dm.date
                      AND fl.recipe_id = dmi.recipe_id) AS logged
     FROM daily_menu dm
     JOIN daily_menu_items dmi ON dmi.daily_menu_id = dm.id
     JOIN recipes r ON r.id = dmi.recipe_id
     WHERE dm.user_id = ? AND dm.date = ?
     ORDER BY dmi.slot`,
    [userId, date]
  );
  return rows.map(row => ({
    slot: row.slot, recipeId: row.recipe_id, name: row.name, logged: Boolean(row.logged)
  }));
}

module.exports = {
  PORTIONS,
  HISTORY_DAYS,
  SEARCH_LIMIT,
  MIN_QUERY_LENGTH,
  isDiaryDate,
  portionFromHalves,
  normalizeName,
  isSearchQuery,
  filterRecipesByName,
  searchRecipes,
  getRecipeNutrition,
  addEntry,
  deleteEntry,
  getDayLog,
  getDayTotals,
  getPlanDishes
};
