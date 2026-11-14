const { dbGet, dbAll, dbRun, withTransaction } = require('../../database/db');
const logger = require('../../utils/logger');

// [RU] Допуск сравнения количеств: суммы — дроби после деления на порции.
// [EN] Amount comparison tolerance: totals are fractions after dividing by servings.
const AMOUNT_EPSILON = 1e-9;

/**
 * Decides whether a "bought" mark survives a rebuild of the list for the same
 * period.
 *
 * [RU] Отметка сохраняется, только если купленного по-прежнему хватает:
 * новое количество не больше старого и «по вкусу» не появилось заново
 * (было — может остаться или пропасть, не было — не должно появиться).
 * [EN] The mark is kept only if what was bought still covers the need: the
 * new amount is not larger and "to taste" did not newly appear.
 *
 * @param {{total_amount: number, to_taste: boolean|number, is_bought: boolean|number}|undefined} oldItem
 * @param {{total_amount: number, to_taste: boolean}} newItem
 * @returns {boolean}
 */
function keepsBoughtMark(oldItem, newItem) {
  if (!oldItem || !oldItem.is_bought) return false;
  if (newItem.total_amount > oldItem.total_amount + AMOUNT_EPSILON) return false;
  return !newItem.to_taste || Boolean(oldItem.to_taste);
}

/**
 * Loads the bought items of the user's latest list if it covers exactly the
 * given period (a list for another period never passes marks on).
 * Must run inside the rebuild transaction, before the old lists are deleted.
 * @param {number} userId - internal users.id
 * @param {{ start: string, endExclusive: string }} bounds
 * @returns {Promise<Map<number, {total_amount: number, to_taste: number, is_bought: number}>>}
 *   ingredient_id → previous item
 */
async function loadPreviousMarks(userId, bounds) {
  const rows = await dbAll(
    `SELECT sli.ingredient_id, sli.total_amount, sli.to_taste, sli.is_bought
     FROM shopping_list_items sli
     WHERE sli.is_bought = 1 AND sli.shopping_list_id = (
       SELECT id FROM shopping_lists
       WHERE user_id = ? AND period_start = ? AND period_end = ?
         AND id = (SELECT MAX(id) FROM shopping_lists WHERE user_id = ?)
     )`,
    [userId, bounds.start, bounds.endExclusive, userId]
  );
  return new Map(rows.map(row => [row.ingredient_id, row]));
}

/**
 * Returns the list row if `listId` is the user's current (latest) list.
 * @param {number} telegramId
 * @param {number} listId
 * @returns {Promise<{id: number}|undefined>}
 */
function findCurrentList(telegramId, listId) {
  return dbGet(
    `SELECT sl.id FROM shopping_lists sl
     JOIN users u ON u.id = sl.user_id
     WHERE u.telegram_id = ? AND sl.id = ?
       AND sl.id = (SELECT MAX(id) FROM shopping_lists WHERE user_id = u.id)`,
    [telegramId, listId]
  );
}

/**
 * Flips the "bought" mark of one item of the user's current list.
 * A list that is not the user's current one (rebuilt, cleared or foreign)
 * is reported as stale and left untouched.
 * @param {number} telegramId
 * @param {number} listId
 * @param {number} ingredientId
 * @returns {Promise<{status: 'ok', isBought: boolean}|{status: 'stale'}>}
 */
async function toggleBought(telegramId, listId, ingredientId) {
  try {
    return await withTransaction(async () => {
      if (!(await findCurrentList(telegramId, listId))) return { status: 'stale' };
      const { changes } = await dbRun(
        `UPDATE shopping_list_items SET is_bought = 1 - is_bought
         WHERE shopping_list_id = ? AND ingredient_id = ?`,
        [listId, ingredientId]
      );
      if (changes === 0) return { status: 'stale' };
      const row = await dbGet(
        'SELECT is_bought FROM shopping_list_items WHERE shopping_list_id = ? AND ingredient_id = ?',
        [listId, ingredientId]
      );
      return { status: 'ok', isBought: Boolean(row.is_bought) };
    });
  } catch (err) {
    logger.error('Error toggling bought mark:', err);
    throw err;
  }
}

/**
 * Clears every "bought" mark of the user's current list.
 * @param {number} telegramId
 * @param {number} listId
 * @returns {Promise<{status: 'ok'|'stale'}>}
 */
async function resetBought(telegramId, listId) {
  try {
    return await withTransaction(async () => {
      if (!(await findCurrentList(telegramId, listId))) return { status: 'stale' };
      await dbRun('UPDATE shopping_list_items SET is_bought = 0 WHERE shopping_list_id = ?', [listId]);
      return { status: 'ok' };
    });
  } catch (err) {
    logger.error('Error resetting bought marks:', err);
    throw err;
  }
}

module.exports = { keepsBoughtMark, loadPreviousMarks, toggleBought, resetBought };
