const { dbGet, dbAll, dbRun, withTransaction } = require('../../database/db');
const logger = require('../../utils/logger');

/**
 * Aggregates ingredients from the user's daily_menu within the given period.
 *
 * [RU] Количества берутся в базовой единице ингредиента (`amount_base`/`base_unit`,
 * см. `database/unit-conversions.json`) и делятся на `recipes.servings`: в рецепте
 * ингредиенты на все порции, а план — на одного человека. Строки «по вкусу»
 * приходят с `base_unit = NULL` и `total_amount = NULL`.
 * [EN] Amounts come in the ingredient's base unit and are divided by
 * `recipes.servings`: recipe ingredients cover all servings, the plan is for
 * one person. "To taste" rows arrive with NULL base_unit/total_amount.
 *
 * @param {number} telegramId
 * @param {{ start: string, endExclusive: string }} bounds — half-open YYYY-MM-DD range
 * @returns {Promise<Array<{id: number, name: string, type: string, base_unit: string|null, total_amount: number|null}>>}
 */
async function getIngredientsFromPlan(telegramId, bounds) {
  const { start, endExclusive } = bounds;
  try {
    return await dbAll(
      `SELECT i.id, i.name, i.type, ri.base_unit,
              SUM(ri.amount_base * 1.0 / r.servings) AS total_amount
       FROM users u
       JOIN daily_menu dm ON u.id = dm.user_id
       JOIN daily_menu_items dmi ON dm.id = dmi.daily_menu_id
       JOIN recipes r ON dmi.recipe_id = r.id
       JOIN recipe_ingredients ri ON r.id = ri.recipe_id
       JOIN ingredients i ON ri.ingredient_id = i.id
       WHERE u.telegram_id = ?
         AND dm.date >= ?
         AND dm.date < ?
       GROUP BY i.id, ri.base_unit`,
      [telegramId, start, endExclusive]
    );
  } catch (err) {
    logger.error('Error fetching ingredients from plan:', err);
    throw err;
  }
}

/**
 * Collapses aggregated rows into one shopping-list row per ingredient:
 * the quantity in the base unit plus a "to taste" flag.
 *
 * [RU] У ингредиента одна базовая единица, поэтому строк на id максимум две:
 * количественная и «по вкусу». Если есть только «по вкусу» — total_amount = 0.
 * [EN] An ingredient has a single base unit, so there are at most two rows
 * per id: the quantity and "to taste". Taste-only rows get total_amount = 0.
 *
 * @param {Array<{id: number, base_unit: string|null, total_amount: number|null}>} rows
 * @returns {Array<{id: number, total_amount: number, unit: string, to_taste: boolean}>}
 */
function mergeIngredientRows(rows) {
  const merged = new Map();
  for (const row of rows) {
    const item = merged.get(row.id) || { id: row.id, total_amount: 0, unit: '', to_taste: false };
    if (row.base_unit && row.total_amount > 0) {
      item.total_amount += row.total_amount;
      item.unit = row.base_unit;
    } else {
      item.to_taste = true;
    }
    merged.set(row.id, item);
  }
  return [...merged.values()];
}

/**
 * Deletes every shopping list of a user (children first: no ON DELETE CASCADE).
 * Must run inside a transaction.
 * @param {number} userId - internal users.id
 * @returns {Promise<void>}
 */
async function deleteUserLists(userId) {
  await dbRun(
    `DELETE FROM shopping_list_items
     WHERE shopping_list_id IN (SELECT id FROM shopping_lists WHERE user_id = ?)`,
    [userId]
  );
  await dbRun('DELETE FROM shopping_lists WHERE user_id = ?', [userId]);
}

/**
 * Persists the aggregated shopping list for the given period, replacing the
 * user's previous lists (only the latest one is ever shown).
 * @param {number} telegramId
 * @param {Array} ingredients - rows from getIngredientsFromPlan
 * @param {{ start: string, endExclusive: string }} bounds — period_start/period_end
 * @returns {Promise<number>} Shopping list ID
 */
async function saveShoppingList(telegramId, ingredients, bounds) {
  const { start, endExclusive } = bounds;
  return withTransaction(async () => {
    const user = await dbGet('SELECT id FROM users WHERE telegram_id = ?', [telegramId]);
    if (!user) throw new Error('User not found');

    await deleteUserLists(user.id);
    const { lastID: listId } = await dbRun(
      'INSERT INTO shopping_lists (user_id, period_start, period_end) VALUES (?, ?, ?)',
      [user.id, start, endExclusive]
    );
    for (const item of mergeIngredientRows(ingredients)) {
      await dbRun(
        `INSERT INTO shopping_list_items (shopping_list_id, ingredient_id, total_amount, unit, to_taste)
         VALUES (?, ?, ?, ?, ?)`,
        [listId, item.id, item.total_amount, item.unit, item.to_taste ? 1 : 0]
      );
    }
    return listId;
  });
}

/**
 * Returns the user's latest shopping list together with its period.
 * @param {number} telegramId
 * @returns {Promise<{ items: Array, periodStart: string|null, periodEnd: string|null }>}
 */
async function getLastShoppingList(telegramId) {
  let rows;
  try {
    rows = await dbAll(
      `SELECT sl.period_start, sl.period_end, i.name, i.type, sli.total_amount, sli.unit, sli.to_taste
       FROM users u
       JOIN shopping_lists sl ON u.id = sl.user_id
       JOIN shopping_list_items sli ON sl.id = sli.shopping_list_id
       JOIN ingredients i ON sli.ingredient_id = i.id
       WHERE u.telegram_id = ? AND sl.id = (
         SELECT MAX(id) FROM shopping_lists WHERE user_id = u.id
       )`,
      [telegramId]
    );
  } catch (err) {
    logger.error('Error fetching last shopping list:', err);
    throw err;
  }
  if (rows.length === 0) return { items: [], periodStart: null, periodEnd: null };
  const { period_start: periodStart, period_end: periodEnd } = rows[0];
  const items = rows.map(({ name, type, total_amount, unit, to_taste }) => (
    { name, type, total_amount, unit, to_taste: Boolean(to_taste) }
  ));
  return { items, periodStart, periodEnd };
}

/**
 * Deletes all shopping lists of the user.
 * @param {number} telegramId
 * @returns {Promise<void>}
 */
async function clearShoppingLists(telegramId) {
  try {
    await withTransaction(async () => {
      const user = await dbGet('SELECT id FROM users WHERE telegram_id = ?', [telegramId]);
      if (user) await deleteUserLists(user.id);
    });
  } catch (err) {
    logger.error('Error clearing shopping lists:', err);
    throw err;
  }
}

module.exports = {
  getIngredientsFromPlan,
  mergeIngredientRows,
  saveShoppingList,
  getLastShoppingList,
  clearShoppingLists
};
