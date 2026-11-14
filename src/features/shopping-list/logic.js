const { dbGet, dbAll, dbRun, withTransaction } = require('../../database/db');
const logger = require('../../utils/logger');

/**
 * Aggregates ingredients from the user's daily_menu within the given period.
 * @param {number} telegramId
 * @param {{ start: string, endExclusive: string }} bounds — half-open YYYY-MM-DD range
 * @returns {Promise<Array>}
 */
async function getIngredientsFromPlan(telegramId, bounds) {
  const { start, endExclusive } = bounds;
  try {
    return await dbAll(
      `SELECT i.id, i.name, i.type, SUM(ri.amount) as total_amount, ri.unit
       FROM users u
       JOIN daily_menu dm ON u.id = dm.user_id
       JOIN daily_menu_items dmi ON dm.id = dmi.daily_menu_id
       JOIN recipe_ingredients ri ON dmi.recipe_id = ri.recipe_id
       JOIN ingredients i ON ri.ingredient_id = i.id
       WHERE u.telegram_id = ?
         AND dm.date >= ?
         AND dm.date < ?
       GROUP BY i.id, ri.unit`,
      [telegramId, start, endExclusive]
    );
  } catch (err) {
    logger.error('Error fetching ingredients from plan:', err);
    throw err;
  }
}

/**
 * Collapses aggregated rows into one row per ingredient id.
 *
 * [RU] Один и тот же ингредиент может встретиться с разными единицами
 * («лук» как `300 г` в одном рецепте и `2 шт` в другом). PK таблицы —
 * (shopping_list_id, ingredient_id), поэтому склеиваем единицы в одну
 * строку `"300 г + 2 шт"` с amount = 0 — в UI она выводится целиком через unit.
 * [EN] The same ingredient may arrive with several units. The table PK is
 * (shopping_list_id, ingredient_id), so units are merged into one display
 * string `"300 g + 2 pcs"` with amount = 0 — the UI renders it via `unit`.
 *
 * @param {Array<{id: number, total_amount: number, unit: string}>} rows
 * @returns {Array<{id: number, total_amount: number, unit: string}>}
 */
function mergeIngredientRows(rows) {
  const merged = new Map();
  for (const row of rows) {
    const part = `${row.total_amount} ${row.unit}`;
    const existing = merged.get(row.id);
    if (existing) existing.parts.push(part);
    else merged.set(row.id, { id: row.id, total_amount: row.total_amount, unit: row.unit, parts: [part] });
  }
  return [...merged.values()].map(({ id, total_amount, unit, parts }) => (
    parts.length > 1
      ? { id, total_amount: 0, unit: parts.join(' + ') }
      : { id, total_amount, unit }
  ));
}

/**
 * Persists the aggregated shopping list for the given period.
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

    const { lastID: listId } = await dbRun(
      'INSERT INTO shopping_lists (user_id, period_start, period_end) VALUES (?, ?, ?)',
      [user.id, start, endExclusive]
    );
    for (const item of mergeIngredientRows(ingredients)) {
      await dbRun(
        `INSERT INTO shopping_list_items (shopping_list_id, ingredient_id, total_amount, unit)
         VALUES (?, ?, ?, ?)`,
        [listId, item.id, item.total_amount, item.unit]
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
      `SELECT sl.period_start, sl.period_end, i.name, i.type, sli.total_amount, sli.unit
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
  const items = rows.map(({ name, type, total_amount, unit }) => ({ name, type, total_amount, unit }));
  return { items, periodStart, periodEnd };
}

/**
 * Deletes all shopping lists of the user.
 * @param {number} telegramId
 * @returns {Promise<void>}
 */
async function clearShoppingLists(telegramId) {
  // [RU] FK ON: shopping_list_items ссылается на shopping_lists без ON DELETE CASCADE —
  // сначала дочерние строки, затем родители, обе операции в одной транзакции.
  // [EN] FK ON: shopping_list_items references shopping_lists without ON DELETE
  // CASCADE — delete children first, then parents, inside a single transaction.
  try {
    await withTransaction(async () => {
      await dbRun(
        `DELETE FROM shopping_list_items
         WHERE shopping_list_id IN (
           SELECT id FROM shopping_lists
           WHERE user_id = (SELECT id FROM users WHERE telegram_id = ?)
         )`,
        [telegramId]
      );
      await dbRun(
        'DELETE FROM shopping_lists WHERE user_id = (SELECT id FROM users WHERE telegram_id = ?)',
        [telegramId]
      );
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
