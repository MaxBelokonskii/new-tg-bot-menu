const { dbGet, dbAll, dbRun, withTransaction } = require('../../database/db');
const logger = require('../../utils/logger');
const { keepsBoughtMark, loadPreviousMarks } = require('./bought');

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
 * Scales merged list rows to the household: quantities × size, "to taste"
 * flags unchanged (taste-only rows stay at 0).
 *
 * [RU] Запросы и рецепты считаются на одного человека; множитель «готовлю на
 * N человек» применяется только здесь, при сборке списка покупок.
 * [EN] Queries and recipes are per person; the "cooking for N people"
 * multiplier is applied only here, when the shopping list is built.
 *
 * @param {Array<{total_amount: number}>} items - rows from mergeIngredientRows
 * @param {number} householdSize - users.household_size (≥ 1)
 * @returns {Array} new rows with scaled total_amount
 */
function scaleForHousehold(items, householdSize) {
  return items.map(item => ({ ...item, total_amount: item.total_amount * householdSize }));
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
 * user's previous lists (only the latest one is ever shown). Quantities are
 * multiplied by the user's household size, which is stored on the list.
 *
 * [RU] При пересборке за тот же период отметки «куплено» переносятся
 * (см. `keepsBoughtMark`); список за другой период начинается без отметок.
 * [EN] Rebuilding for the same period carries "bought" marks over (see
 * `keepsBoughtMark`); a list for another period starts unmarked.
 *
 * @param {number} telegramId
 * @param {Array} ingredients - rows from getIngredientsFromPlan
 * @param {{ start: string, endExclusive: string }} bounds — period_start/period_end
 * @returns {Promise<number>} Shopping list ID
 */
async function saveShoppingList(telegramId, ingredients, bounds) {
  const { start, endExclusive } = bounds;
  return withTransaction(async () => {
    const user = await dbGet('SELECT id, household_size FROM users WHERE telegram_id = ?', [telegramId]);
    if (!user) throw new Error('User not found');

    const previous = await loadPreviousMarks(user.id, bounds);
    await deleteUserLists(user.id);
    const { lastID: listId } = await dbRun(
      'INSERT INTO shopping_lists (user_id, period_start, period_end, household_size) VALUES (?, ?, ?, ?)',
      [user.id, start, endExclusive, user.household_size]
    );
    for (const item of scaleForHousehold(mergeIngredientRows(ingredients), user.household_size)) {
      const bought = keepsBoughtMark(previous.get(item.id), item);
      await dbRun(
        `INSERT INTO shopping_list_items
           (shopping_list_id, ingredient_id, total_amount, unit, to_taste, is_bought)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [listId, item.id, item.total_amount, item.unit, item.to_taste ? 1 : 0, bought ? 1 : 0]
      );
    }
    return listId;
  });
}

/**
 * Returns the user's latest shopping list together with its id and period.
 * @param {number} telegramId
 * @returns {Promise<{ listId: number|null, items: Array<{ingredientId: number, name: string,
 *   type: string, total_amount: number, unit: string, to_taste: boolean, is_bought: boolean}>,
 *   periodStart: string|null, periodEnd: string|null, householdSize?: number }>}
 *   householdSize — the size the list was built for (absent when there is no list)
 */
async function getLastShoppingList(telegramId) {
  let rows;
  try {
    rows = await dbAll(
      `SELECT sl.id AS list_id, sl.period_start, sl.period_end, sl.household_size,
              i.id AS ingredient_id, i.name, i.type,
              sli.total_amount, sli.unit, sli.to_taste, sli.is_bought
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
  if (rows.length === 0) return { listId: null, items: [], periodStart: null, periodEnd: null };
  const {
    list_id: listId, period_start: periodStart, period_end: periodEnd, household_size: householdSize
  } = rows[0];
  const items = rows.map(row => ({
    ingredientId: row.ingredient_id,
    name: row.name,
    type: row.type,
    total_amount: row.total_amount,
    unit: row.unit,
    to_taste: Boolean(row.to_taste),
    is_bought: Boolean(row.is_bought)
  }));
  return { listId, items, periodStart, periodEnd, householdSize };
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
  scaleForHousehold,
  saveShoppingList,
  getLastShoppingList,
  clearShoppingLists
};
