const { dbGet, dbRun, withTransaction } = require('../../database/db');
const { getOrCreateUser } = require('../weekly-planner/logic');

// [RU] Допустимое число людей «готовлю на N»: 1..6, по умолчанию 1.
// [EN] Allowed "cooking for N people" values: 1..6, 1 by default.
const MIN_HOUSEHOLD_SIZE = 1;
const MAX_HOUSEHOLD_SIZE = 6;
const DEFAULT_HOUSEHOLD_SIZE = 1;

/**
 * True for an integer household size within MIN..MAX.
 * @param {number} size
 * @returns {boolean}
 */
function isValidHouseholdSize(size) {
  return Number.isInteger(size) && size >= MIN_HOUSEHOLD_SIZE && size <= MAX_HOUSEHOLD_SIZE;
}

/**
 * Returns how many people the user cooks for; the default for an unknown
 * user. Read-only — does not create the user row.
 * @param {number} telegramId
 * @returns {Promise<number>}
 */
async function getHouseholdSize(telegramId) {
  const row = await dbGet('SELECT household_size FROM users WHERE telegram_id = ?', [telegramId]);
  return row ? row.household_size : DEFAULT_HOUSEHOLD_SIZE;
}

/**
 * Stores how many people the user cooks for. The existing shopping list is
 * not rebuilt — it keeps the size it was built for.
 * @param {number} telegramId
 * @param {number} size - MIN_HOUSEHOLD_SIZE..MAX_HOUSEHOLD_SIZE
 * @returns {Promise<number|null>} saved size, or null for an invalid one
 */
async function setHouseholdSize(telegramId, size) {
  if (!isValidHouseholdSize(size)) return null;
  return withTransaction(async () => {
    const userId = await getOrCreateUser(telegramId);
    await dbRun('UPDATE users SET household_size = ? WHERE id = ?', [size, userId]);
    return size;
  });
}

/**
 * Household size the user's current (latest) shopping list was built for,
 * or null when there is no list.
 * @param {number} telegramId
 * @returns {Promise<number|null>}
 */
async function getListHouseholdSize(telegramId) {
  const row = await dbGet(
    `SELECT sl.household_size FROM shopping_lists sl
     JOIN users u ON u.id = sl.user_id
     WHERE u.telegram_id = ?
     ORDER BY sl.id DESC LIMIT 1`,
    [telegramId]
  );
  return row ? row.household_size : null;
}

module.exports = {
  MIN_HOUSEHOLD_SIZE,
  MAX_HOUSEHOLD_SIZE,
  DEFAULT_HOUSEHOLD_SIZE,
  isValidHouseholdSize,
  getHouseholdSize,
  setHouseholdSize,
  getListHouseholdSize
};
