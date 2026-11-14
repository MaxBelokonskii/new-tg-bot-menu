const { dbGet, dbAll, dbRun } = require('../../database/db');
const { getOrCreateUser } = require('../weekly-planner/logic');

// Сколько рецептов на одной странице списка избранного
const PAGE_SIZE = 8;

/**
 * Clamps a page number into the available range and computes the offset.
 * @param {number} total - number of items
 * @param {number} page - requested zero-based page
 * @param {number} [pageSize=PAGE_SIZE]
 * @returns {{page: number, pages: number, offset: number}} pages is at least 1
 */
function paginate(total, page, pageSize = PAGE_SIZE) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const requested = Number.isInteger(page) ? page : 0;
  const clamped = Math.min(Math.max(requested, 0), pages - 1);
  return { page: clamped, pages, offset: clamped * pageSize };
}

/**
 * True when the recipe is in the user's favorites.
 * @param {number} telegramId
 * @param {number} recipeId
 * @returns {Promise<boolean>}
 */
async function isFavorite(telegramId, recipeId) {
  const userId = await getOrCreateUser(telegramId);
  const row = await dbGet(
    'SELECT 1 AS found FROM favorite_recipes WHERE user_id = ? AND recipe_id = ?',
    [userId, recipeId]
  );
  return Boolean(row);
}

/**
 * Adds a recipe to or removes it from the user's favorites. Idempotent:
 * adding twice keeps one row, removing a missing row is a no-op.
 *
 * @param {number} telegramId
 * @param {number} recipeId
 * @param {boolean} favorite - true to add, false to remove
 * @returns {Promise<boolean|null>} the resulting state, or null when the recipe does not exist
 */
async function setFavorite(telegramId, recipeId, favorite) {
  const recipe = await dbGet('SELECT id FROM recipes WHERE id = ?', [recipeId]);
  if (!recipe) return null;
  const userId = await getOrCreateUser(telegramId);
  if (favorite) {
    await dbRun(
      'INSERT OR IGNORE INTO favorite_recipes (user_id, recipe_id) VALUES (?, ?)',
      [userId, recipeId]
    );
  } else {
    await dbRun('DELETE FROM favorite_recipes WHERE user_id = ? AND recipe_id = ?', [userId, recipeId]);
  }
  return favorite;
}

/**
 * Lists one page of the user's favorite recipes, newest first.
 * [RU] created_at хранится с точностью до секунды, поэтому при равенстве
 * порядок добирается rowid (порядок вставки).
 * [EN] created_at has one-second precision, so ties fall back to rowid
 * (insertion order).
 *
 * @param {number} telegramId
 * @param {number} [page=0] - zero-based; clamped into the available range
 * @returns {Promise<{recipes: Array<{id: number, name: string, calories: number}>,
 *   page: number, pages: number, total: number}>}
 */
async function listFavorites(telegramId, page = 0) {
  const userId = await getOrCreateUser(telegramId);
  const { total } = await dbGet(
    'SELECT COUNT(*) AS total FROM favorite_recipes WHERE user_id = ?',
    [userId]
  );
  const paging = paginate(total, page);
  const recipes = await dbAll(
    `SELECT r.id, r.name, r.calories
     FROM favorite_recipes f
     JOIN recipes r ON r.id = f.recipe_id
     WHERE f.user_id = ?
     ORDER BY f.created_at DESC, f.rowid DESC
     LIMIT ? OFFSET ?`,
    [userId, PAGE_SIZE, paging.offset]
  );
  return { recipes, page: paging.page, pages: paging.pages, total };
}

module.exports = {
  PAGE_SIZE,
  paginate,
  isFavorite,
  setFavorite,
  listFavorites
};
